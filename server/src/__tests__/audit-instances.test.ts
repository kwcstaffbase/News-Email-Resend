import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

// ── DB mock ───────────────────────────────────────────────────────────────────

/**
 * Simulate the DB returning distinct instance_id rows per table.
 * executeRows is a list of arrays (one per SCOPED_TABLES iteration).
 */
let executeRows: Array<Array<{ instance_id: string; row_count: string }>> = [];
let executeCallCount = 0;

mock.module("../db/client.ts", () => ({
  db: {
    execute: () => {
      const rows = executeRows[executeCallCount] ?? [];
      executeCallCount++;
      return Promise.resolve(rows);
    },
  },
  // Drizzle table references used in the sql template tag — pass-through objects
  changelog: {},
  sessions: {},
  settings: {},
  users: {},
}));

// ── Schema mock ───────────────────────────────────────────────────────────────

mock.module("../db/schema.ts", () => ({
  changelog: { _: { name: "changelog" } },
  sessions: { _: { name: "sessions" } },
  settings: { _: { name: "settings" } },
  users: { _: { name: "users" } },
}));

// ── Logger mock ───────────────────────────────────────────────────────────────

// ── getInstanceSettings mock ──────────────────────────────────────────────────

let instanceSettings: Record<string, { staffbaseUrl: string | null; apiToken: string | null }> = {};

mock.module("../lib/staffbase-api.ts", () => ({
  getInstanceSettings: (instanceId: string) =>
    Promise.resolve(instanceSettings[instanceId] ?? { staffbaseUrl: null, apiToken: null }),
  // Stub the remaining exports so this process-global mock cannot leave a
  // consumer (e.g. sso.ts / html.ts importing upsertStaffbaseUrl) unable to
  // link when another test file imports them after this one runs.
  upsertStaffbaseUrl: () => Promise.resolve(),
  getApiToken: () => Promise.resolve(null),
  staffbaseFetch: () => Promise.resolve(new Response(null)),
  extractTraceHeaders: () => ({}),
}));

// ── deleteInstance (injected into runAudit) ──────────────────────────────────
// We DO NOT `mock.module("../lib/remote-calls.ts", ...)` because bun-test runs
// all test files in a shared process and `mock.module` is global — mocking
// that module here would leak into `remote-calls.test.ts` and break its real
// transactional tests.  Instead, `runAudit` accepts an optional `purge`
// dependency that we inject from each test case.

let deletedInstances: string[] = [];
let deleteInstanceShouldFail = false;

const mockPurge = (instanceId: string): Promise<boolean> => {
  if (deleteInstanceShouldFail) return Promise.resolve(false);
  deletedInstances.push(instanceId);
  return Promise.resolve(true);
};

// ── fetch mock ────────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
const originalProcessPluginId = process.env.PLUGIN_ID;
const originalBunPluginId = Bun.env.PLUGIN_ID;
let fetchResponses: Record<string, { status: number }> = {};
let fetchThrowForUrl: string | null = null;
let capturedRequests: Array<{ url: string; method: string; accept?: string }> = [];

const mockFetch = (input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) => {
  let url: string;
  if (typeof input === "string") {
    url = input;
  } else if (input instanceof URL) {
    url = input.href;
  } else {
    url = input.url;
  }
  const method = ((init as RequestInit)?.method ?? "GET").toUpperCase();
  const accept = ((init as RequestInit)?.headers as Record<string, string> | undefined)?.Accept;
  capturedRequests.push({ url, method, accept });
  if (fetchThrowForUrl && url.startsWith(fetchThrowForUrl)) {
    throw new Error("Network error (mocked)");
  }
  const match = Object.entries(fetchResponses).find(([prefix]) => url.startsWith(prefix));
  const status = match?.[1].status ?? 200;
  return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status }));
};
globalThis.fetch = mockFetch as typeof fetch;

function setPluginId(value: string | undefined) {
  if (value === undefined) {
    delete process.env.PLUGIN_ID;
    delete Bun.env.PLUGIN_ID;
    return;
  }
  process.env.PLUGIN_ID = value;
  Bun.env.PLUGIN_ID = value;
}

function resetState() {
  executeRows = [];
  executeCallCount = 0;
  instanceSettings = {};
  deletedInstances = [];
  deleteInstanceShouldFail = false;
  fetchResponses = {};
  fetchThrowForUrl = null;
  capturedRequests = [];
  setPluginId(undefined);
  globalThis.fetch = mockFetch as typeof fetch;
}

/** Build rows for a single table: [{ instance_id, row_count }, ...] */
function tableRows(
  entries: Array<[string, number]>
): Array<{ instance_id: string; row_count: string }> {
  return entries.map(([instance_id, count]) => ({
    instance_id,
    row_count: String(count),
  }));
}

// ── Module under test ─────────────────────────────────────────────────────────

let enumerateInstanceIds: () => Promise<
  Map<string, import("../scripts/audit-instances.ts").TableCount[]>
>;
let classifyInstance: (id: string) => Promise<{
  status: import("../scripts/audit-instances.ts").InstanceStatus;
  staffbaseUrl: string | null;
}>;
let runAudit: (
  options: import("../scripts/audit-instances.ts").RunAuditOptions
) => Promise<import("../scripts/audit-instances.ts").AuditReport>;

beforeAll(async () => {
  const mod = await import("../scripts/audit-instances.ts");
  enumerateInstanceIds = mod.enumerateInstanceIds;
  classifyInstance = mod.classifyInstance;
  runAudit = mod.runAudit;
});

afterEach(resetState);
afterAll(() => {
  setPluginId(originalProcessPluginId);
  if (originalBunPluginId === undefined) {
    delete Bun.env.PLUGIN_ID;
  } else {
    Bun.env.PLUGIN_ID = originalBunPluginId;
  }
  globalThis.fetch = originalFetch;
});

// ── enumerateInstanceIds ──────────────────────────────────────────────────────

describe("enumerateInstanceIds", () => {
  test("returns an empty map when all tables are empty", async () => {
    // 4 tables, all returning empty arrays
    executeRows = [[], [], [], []];
    const result = await enumerateInstanceIds();
    expect(result.size).toBe(0);
  });

  test("collects instance_ids from a single table", async () => {
    executeRows = [
      tableRows([
        ["inst-a", 5],
        ["inst-b", 3],
      ]), // users
      [], // sessions
      [], // settings
      [], // changelog
    ];
    const result = await enumerateInstanceIds();
    expect(result.size).toBe(2);
    expect(result.get("inst-a")).toBeDefined();
    expect(result.get("inst-b")).toBeDefined();
  });

  test("unions instance_ids across multiple tables correctly", async () => {
    executeRows = [
      tableRows([["inst-a", 10]]), // users
      tableRows([["inst-b", 2]]), // sessions
      tableRows([["inst-c", 1]]), // settings
      [], // changelog
    ];
    const result = await enumerateInstanceIds();
    expect(result.size).toBe(3);
  });

  test("accumulates row counts per table for the same instance", async () => {
    executeRows = [
      tableRows([["inst-x", 7]]), // users
      tableRows([["inst-x", 3]]), // sessions
      tableRows([["inst-x", 1]]), // settings
      tableRows([["inst-x", 4]]), // changelog
    ];
    const result = await enumerateInstanceIds();
    expect(result.size).toBe(1);
    const counts = result.get("inst-x") ?? [];
    const total = counts.reduce((s, t) => s + t.rowCount, 0);
    expect(total).toBe(15);
    expect(counts.some((t) => t.tableName === "users" && t.rowCount === 7)).toBe(true);
    expect(counts.some((t) => t.tableName === "changelog" && t.rowCount === 4)).toBe(true);
  });

  test("executes exactly one query per scoped table (4 tables)", async () => {
    executeRows = [[], [], [], []];
    await enumerateInstanceIds();
    expect(executeCallCount).toBe(4);
  });
});

// ── classifyInstance ──────────────────────────────────────────────────────────

describe("classifyInstance", () => {
  test("returns host-unknown when settings has no staffbase_url", async () => {
    instanceSettings["inst-1"] = { staffbaseUrl: null, apiToken: "token" };
    const { status } = await classifyInstance("inst-1");
    expect(status).toBe("host-unknown");
  });

  test("returns host-unknown when instance has no settings row", async () => {
    // instanceSettings is empty — getInstanceSettings returns { null, null }
    const { status } = await classifyInstance("no-settings");
    expect(status).toBe("host-unknown");
  });

  test("returns no-credentials when staffbase_url is set but api_token is null", async () => {
    instanceSettings["inst-2"] = {
      staffbaseUrl: "https://test.staffbase.com",
      apiToken: null,
    };
    const { status } = await classifyInstance("inst-2");
    expect(status).toBe("no-credentials");
  });

  test("returns live when probe returns 200", async () => {
    instanceSettings["inst-3"] = {
      staffbaseUrl: "https://alive.staffbase.com",
      apiToken: "validtoken",
    };
    fetchResponses["https://alive.staffbase.com"] = { status: 200 };
    const { status } = await classifyInstance("inst-3");
    expect(status).toBe("live");
  });

  test("returns credentials-revoked when probe returns 401", async () => {
    instanceSettings["inst-4"] = {
      staffbaseUrl: "https://revoked.staffbase.com",
      apiToken: "oldtoken",
    };
    fetchResponses["https://revoked.staffbase.com"] = { status: 401 };
    const { status } = await classifyInstance("inst-4");
    expect(status).toBe("credentials-revoked");
  });

  test("returns credentials-revoked when probe returns 403", async () => {
    instanceSettings["inst-5"] = {
      staffbaseUrl: "https://forbidden.staffbase.com",
      apiToken: "oldtoken",
    };
    fetchResponses["https://forbidden.staffbase.com"] = { status: 403 };
    const { status } = await classifyInstance("inst-5");
    expect(status).toBe("credentials-revoked");
  });

  test("returns missing when probe returns 404", async () => {
    instanceSettings["inst-6"] = {
      staffbaseUrl: "https://gone.staffbase.com",
      apiToken: "token",
    };
    fetchResponses["https://gone.staffbase.com"] = { status: 404 };
    const { status } = await classifyInstance("inst-6");
    expect(status).toBe("missing");
  });

  test("returns unreachable when fetch throws a network error", async () => {
    instanceSettings["inst-7"] = {
      staffbaseUrl: "https://unreachable.staffbase.com",
      apiToken: "token",
    };
    fetchThrowForUrl = "https://unreachable.staffbase.com";
    const { status } = await classifyInstance("inst-7");
    expect(status).toBe("unreachable");
  });

  test("exposes staffbaseUrl in the result", async () => {
    instanceSettings["inst-8"] = {
      staffbaseUrl: "https://mycompany.staffbase.com",
      apiToken: "tok",
    };
    fetchResponses["https://mycompany.staffbase.com"] = { status: 200 };
    const { staffbaseUrl } = await classifyInstance("inst-8");
    expect(staffbaseUrl).toBe("https://mycompany.staffbase.com");
  });
});

// ── runAudit ──────────────────────────────────────────────────────────────────

describe("runAudit — dry-run", () => {
  test("reports correct totals and does not delete anything", async () => {
    // Two instances: one live, one with revoked credentials
    executeRows = [
      tableRows([
        ["live-inst", 5],
        ["dead-inst", 3],
      ]),
      [],
      [],
      [],
    ];
    instanceSettings["live-inst"] = {
      staffbaseUrl: "https://live.staffbase.com",
      apiToken: "tok",
    };
    instanceSettings["dead-inst"] = {
      staffbaseUrl: "https://dead.staffbase.com",
      apiToken: "old",
    };
    fetchResponses["https://live.staffbase.com"] = { status: 200 };
    fetchResponses["https://dead.staffbase.com"] = { status: 401 };

    const report = await runAudit({ apply: false, purge: mockPurge });

    expect(report.dryRun).toBe(true);
    expect(report.totalInstances).toBe(2);
    expect(report.byStatus.live).toBe(1);
    expect(report.byStatus["credentials-revoked"]).toBe(1);
    expect(deletedInstances).toHaveLength(0);
    expect(report.instances.every((i) => i.purged === null)).toBe(true);
  });
});

describe("runAudit — apply", () => {
  test("purges credentials-revoked and missing instances", async () => {
    executeRows = [
      tableRows([
        ["live-inst", 5],
        ["dead-inst", 3],
        ["gone-inst", 2],
      ]),
      [],
      [],
      [],
    ];
    instanceSettings["live-inst"] = {
      staffbaseUrl: "https://live.staffbase.com",
      apiToken: "tok",
    };
    instanceSettings["dead-inst"] = {
      staffbaseUrl: "https://dead.staffbase.com",
      apiToken: "old",
    };
    instanceSettings["gone-inst"] = {
      staffbaseUrl: "https://gone.staffbase.com",
      apiToken: "tok",
    };
    fetchResponses["https://live.staffbase.com"] = { status: 200 };
    fetchResponses["https://dead.staffbase.com"] = { status: 401 };
    fetchResponses["https://gone.staffbase.com"] = { status: 404 };

    const report = await runAudit({ apply: true, purge: mockPurge });

    expect(report.dryRun).toBe(false);
    expect(deletedInstances).toContain("dead-inst");
    expect(deletedInstances).toContain("gone-inst");
    expect(deletedInstances).not.toContain("live-inst");
    expect(deletedInstances).toHaveLength(2);

    const liveEntry = report.instances.find((i) => i.instanceId === "live-inst");
    expect(liveEntry?.purged).toBeNull();

    const deadEntry = report.instances.find((i) => i.instanceId === "dead-inst");
    expect(deadEntry?.purged).toBe(true);
  });

  test("does not purge host-unknown or no-credentials instances", async () => {
    executeRows = [
      tableRows([
        ["unknown-inst", 4],
        ["nocreds-inst", 2],
      ]),
      [],
      [],
      [],
    ];
    instanceSettings["unknown-inst"] = { staffbaseUrl: null, apiToken: null };
    instanceSettings["nocreds-inst"] = {
      staffbaseUrl: "https://x.staffbase.com",
      apiToken: null,
    };

    const report = await runAudit({ apply: true, purge: mockPurge });

    expect(deletedInstances).toHaveLength(0);
    expect(report.instances.every((i) => i.purged === null)).toBe(true);
  });

  test("marks purged=false and sets purgeError when deleteInstance fails", async () => {
    executeRows = [tableRows([["fail-inst", 1]]), [], [], []];
    instanceSettings["fail-inst"] = {
      staffbaseUrl: "https://fail.staffbase.com",
      apiToken: "tok",
    };
    fetchResponses["https://fail.staffbase.com"] = { status: 401 };
    deleteInstanceShouldFail = true;

    const report = await runAudit({ apply: true, purge: mockPurge });

    const entry = report.instances.find((i) => i.instanceId === "fail-inst");
    expect(entry?.purged).toBe(false);
    expect(entry?.purgeError).toBeTruthy();
  });

  test("exits with totalRows and rowsPerTable correctly computed", async () => {
    executeRows = [
      tableRows([["inst-z", 10]]), // users
      tableRows([["inst-z", 5]]), // sessions
      tableRows([["inst-z", 1]]), // settings
      tableRows([["inst-z", 3]]), // changelog
    ];
    instanceSettings["inst-z"] = { staffbaseUrl: null, apiToken: null };

    const report = await runAudit({ apply: false, purge: mockPurge });

    const entry = report.instances.find((i) => i.instanceId === "inst-z");
    expect(entry?.totalRows).toBe(19);
    const usersRow = entry?.rowsPerTable.find((t) => t.tableName === "users");
    expect(usersRow?.rowCount).toBe(10);
  });
});

// ── classifyInstance — two-stage probe ───────────────────────────────────────

describe("classifyInstance — two-stage probe", () => {
  test("makes an unauthenticated HEAD to the base URL before the auth probe", async () => {
    instanceSettings["inst-head"] = {
      staffbaseUrl: "https://co.staffbase.com",
      apiToken: "tok",
    };
    fetchResponses["https://co.staffbase.com"] = { status: 200 };

    await classifyInstance("inst-head");

    expect(capturedRequests[0]?.method).toBe("HEAD");
    expect(capturedRequests[0]?.url).toBe("https://co.staffbase.com");
  });

  test("returns unreachable immediately when HEAD throws — skips auth probe", async () => {
    instanceSettings["inst-down"] = {
      staffbaseUrl: "https://down.staffbase.com",
      apiToken: "tok",
    };
    fetchThrowForUrl = "https://down.staffbase.com";

    const { status } = await classifyInstance("inst-down");

    expect(status).toBe("unreachable");
    // Only one fetch attempt — the HEAD; no auth probe should follow
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]?.method).toBe("HEAD");
  });

  test("returns unreachable when host is reachable but auth probe throws", async () => {
    instanceSettings["inst-flaky"] = {
      staffbaseUrl: "https://flaky.staffbase.com",
      apiToken: "tok",
    };
    // HEAD to base URL has no explicit response → mock returns 200 (default) → reachable
    // GET to /api/... throws → network error on auth step
    fetchThrowForUrl = "https://flaky.staffbase.com/api/";

    const { status } = await classifyInstance("inst-flaky");

    expect(status).toBe("unreachable");
    expect(capturedRequests.some((r) => r.method === "HEAD")).toBe(true);
    expect(capturedRequests.some((r) => r.method === "GET")).toBe(true);
  });

  test("uses /api/plugins/{PLUGIN_ID}/installations/{instanceId} when PLUGIN_ID is set", async () => {
    setPluginId("test-plugin-id");
    instanceSettings["inst-p"] = {
      staffbaseUrl: "https://example.staffbase.com",
      apiToken: "tok",
    };
    // Installations endpoint → live; user-search → revoked (proves which path was taken)
    fetchResponses[
      "https://example.staffbase.com/api/plugins/test-plugin-id/installations/inst-p"
    ] = { status: 200 };
    fetchResponses["https://example.staffbase.com/api/users/search"] = { status: 401 };

    const { status } = await classifyInstance("inst-p");

    expect(status).toBe("live");
    const authReq = capturedRequests.find((r) => r.method === "GET");
    expect(authReq?.url).toContain("/api/plugins/test-plugin-id/installations/inst-p");
  });

  test("returns missing when installations endpoint returns 404", async () => {
    setPluginId("test-plugin-id");
    instanceSettings["inst-gone"] = {
      staffbaseUrl: "https://example.staffbase.com",
      apiToken: "tok",
    };
    fetchResponses[
      "https://example.staffbase.com/api/plugins/test-plugin-id/installations/inst-gone"
    ] = { status: 404 };

    const { status } = await classifyInstance("inst-gone");

    expect(status).toBe("missing");
  });

  test("returns credentials-revoked when installations endpoint returns 401", async () => {
    setPluginId("test-plugin-id");
    instanceSettings["inst-revoked"] = {
      staffbaseUrl: "https://example.staffbase.com",
      apiToken: "tok",
    };
    fetchResponses[
      "https://example.staffbase.com/api/plugins/test-plugin-id/installations/inst-revoked"
    ] = { status: 401 };

    const { status } = await classifyInstance("inst-revoked");

    expect(status).toBe("credentials-revoked");
  });

  test("falls back to user-search with correct Accept header when PLUGIN_ID is unset", async () => {
    // PLUGIN_ID not set (ensured by resetState)
    instanceSettings["inst-fb"] = {
      staffbaseUrl: "https://fb.staffbase.com",
      apiToken: "tok",
    };
    fetchResponses["https://fb.staffbase.com/api/users/search"] = { status: 200 };

    const { status } = await classifyInstance("inst-fb");

    expect(status).toBe("live");
    const authReq = capturedRequests.find((r) => r.method === "GET");
    expect(authReq?.url).toContain("/api/users/search");
    expect(authReq?.accept).toBe("application/vnd.staffbase.accessors.users-search.v1+json");
  });
});
