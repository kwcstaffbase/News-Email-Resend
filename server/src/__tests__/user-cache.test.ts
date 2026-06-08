import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

// Track DB operations
let insertCalls: unknown[] = [];
let selectQueue: unknown[][] = [];
let deleteCalls: unknown[] = [];

function nextSelectResult(): unknown[] {
  return selectQueue.shift() ?? [];
}

function chainResult(value: unknown): unknown {
  const promise = Promise.resolve(value);
  return new Proxy(promise as object, {
    get(target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        return (target as any)[prop].bind(target);
      }
      return (...args: unknown[]) => {
        if (prop === "values") insertCalls.push(args[0]);
        if (prop === "where") deleteCalls.push(args[0]);
        return chainResult(value);
      };
    },
  });
}

// cleanupDeletedUser now runs every write inside db.transaction(...).
// The mock surfaces the same chain semantics on the tx argument.
const dbMock = {
  select: () => chainResult(nextSelectResult()),
  insert: (..._args: unknown[]) => {
    return chainResult([]);
  },
  update: () => chainResult([]),
  delete: () => {
    deleteCalls.push("delete");
    return chainResult([]);
  },
  transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(dbMock),
};
mock.module("../db/client.ts", () => ({ db: dbMock }));

// Mock staffbase-api to prevent real HTTP calls
let mockFetchResponse: Response = new Response("[]", { status: 200 });
// Per-call response queue: when non-empty, each staffbaseFetch call pops from here
// instead of using mockFetchResponse. Allows mixed 200/404 scenarios.
let mockFetchQueue: Response[] = [];
// Track calls to staffbaseFetch
let fetchCalls: string[] = [];
mock.module("../lib/staffbase-api.ts", () => ({
  staffbaseFetch: (path: string) => {
    fetchCalls.push(path);
    const response = mockFetchQueue.shift() ?? mockFetchResponse;
    return Promise.resolve(response);
  },
  getInstanceSettings: (instanceId: string) => {
    fetchCalls.push(`getInstanceSettings:${instanceId}`);
    return Promise.resolve({ staffbaseUrl: "https://co.staffbase.com", apiToken: "token" });
  },
  extractTraceHeaders: () => ({}),
  // Stub the remaining exports so this process-global mock cannot leave a
  // consumer (e.g. sso.ts / html.ts importing upsertStaffbaseUrl) unable to
  // link when another test file imports them after this one runs.
  upsertStaffbaseUrl: () => Promise.resolve(),
  getApiToken: () => Promise.resolve(null),
}));

// Use real crypto with a test key (avoids mocking ../lib/crypto.ts which
// would interfere with crypto.test.ts in the same process).
const TEST_ENCRYPTION_KEY = "a".repeat(64);

// Use real remote-calls (avoids mocking ../lib/remote-calls.ts which
// would interfere with remote-calls.test.ts in the same process).
// cleanupDeletedUser will use our db mock's delete/update which are no-ops.
let _deleteCalls = 0;

let upsertUser: (user: {
  userId: string;
  instanceId: string;
  userName?: string;
  firstName?: string | null;
  lastName?: string | null;
}) => Promise<void>;
let refreshAllUsers: () => Promise<{
  total: number;
  active: number;
  deleted: number;
  fetchErrors: number;
}>;
let ensureUserInCache: (instanceId: string, userId: string) => Promise<void>;
let revalidateAccessor: (instanceId: string, userId: string) => Promise<{ deleted: boolean }>;
let revalidateReferencedUsers: (
  instanceId: string,
  userIds: ReadonlyArray<string | null | undefined>
) => Promise<void>;

let clearGdprCaches: () => void;

beforeAll(async () => {
  Bun.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const mod = await import("../lib/user-cache.ts");
  upsertUser = mod.upsertUser;
  refreshAllUsers = mod.refreshAllUsers;
  ensureUserInCache = mod.ensureUserInCache;
  revalidateAccessor = mod.revalidateAccessor;
  revalidateReferencedUsers = mod.revalidateReferencedUsers;
  clearGdprCaches = mod._clearGdprCachesForTest;
});

beforeEach(() => {
  selectQueue = [];
  insertCalls = [];
  deleteCalls = [];
  fetchCalls = [];
  mockFetchQueue = [];
  _deleteCalls = 0;
  mockFetchResponse = new Response("[]", { status: 200 });
  clearGdprCaches?.();
});

afterEach(() => {
  selectQueue = [];
  insertCalls = [];
  deleteCalls = [];
  fetchCalls = [];
  mockFetchQueue = [];
});

describe("upsertUser", () => {
  test("inserts user with first and last name", async () => {
    await upsertUser({
      userId: "u1",
      instanceId: "inst1",
      firstName: "Alice",
      lastName: "Smith",
    });
    // upsertUser calls db.insert(...).values(...).onConflictDoUpdate(...)
    // The chain proxy tracks that values was called
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  test("splits userName into first/last when names not provided", async () => {
    await upsertUser({
      userId: "u2",
      instanceId: "inst1",
      userName: "John Doe",
    });
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  test("single-word userName goes to firstName only", async () => {
    await upsertUser({
      userId: "u3",
      instanceId: "inst1",
      userName: "Admin",
    });
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  test("presence-only upsert when no names at all", async () => {
    await upsertUser({
      userId: "u4",
      instanceId: "inst1",
    });
    expect(insertCalls.length).toBeGreaterThan(0);
  });
});

describe("refreshAllUsers", () => {
  test("returns zeros when no instances have credentials", async () => {
    selectQueue = [[]]; // no settings rows
    const result = await refreshAllUsers();
    expect(result).toEqual({ total: 0, active: 0, deleted: 0, fetchErrors: 0 });
  });

  test("returns zeros when instances lack apiToken", async () => {
    selectQueue = [
      [{ instanceId: "i1", staffbaseUrl: "https://co.staffbase.com", apiToken: null }],
    ];
    const result = await refreshAllUsers();
    // Instance has no apiToken → filtered out as not "ready"
    expect(result).toEqual({ total: 0, active: 0, deleted: 0, fetchErrors: 0 });
  });

  test("processes active users from Staffbase API", async () => {
    // Settings: one instance with credentials (use real encrypt)
    const { encrypt } = await import("../lib/crypto.ts");
    selectQueue = [
      [{ instanceId: "i1", staffbaseUrl: "https://co.staffbase.com", apiToken: encrypt("token1") }],
      // Users for that instance
      [{ userId: "user-a" }],
    ];
    mockFetchResponse = new Response(
      JSON.stringify({ id: "user-a", profile: { firstName: "Alice", lastName: "B" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const result = await refreshAllUsers();
    expect(result.active).toBe(1);
    expect(result.deleted).toBe(0);
  });

  test("handles deleted users (404)", async () => {
    const { encrypt } = await import("../lib/crypto.ts");
    selectQueue = [
      [{ instanceId: "i1", staffbaseUrl: "https://co.staffbase.com", apiToken: encrypt("token1") }],
      [{ userId: "user-gone" }],
    ];
    mockFetchResponse = new Response("", { status: 404 });
    const result = await refreshAllUsers();
    expect(result.deleted).toBe(1);
    // cleanupDeletedUser is called via real remote-calls.ts → uses our db mock
  });

  test("handles API errors gracefully", async () => {
    const { encrypt } = await import("../lib/crypto.ts");
    selectQueue = [
      [{ instanceId: "i1", staffbaseUrl: "https://co.staffbase.com", apiToken: encrypt("token1") }],
      [{ userId: "user-err" }],
    ];
    mockFetchResponse = new Response("error", { status: 500 });
    const result = await refreshAllUsers();
    expect(result.fetchErrors).toBe(1);
  });
});

// ── ensureUserInCache ─────────────────────────────────────────────────────────

describe("ensureUserInCache", () => {
  test("no-ops on cache hit — no fetch call when row exists", async () => {
    // select returns an existing user row → should return immediately
    selectQueue = [[{ userId: "user-1" }]];
    await ensureUserInCache("inst1", "user-1");
    // staffbaseFetch should NOT have been called
    expect(fetchCalls.filter((c) => c.startsWith("/api/users/")).length).toBe(0);
    // no insert
    expect(insertCalls.length).toBe(0);
  });

  test("fetches from Staffbase /api/users/:id and upserts on cache miss", async () => {
    // First select: no existing row (miss)
    // Second select (inside getInstanceSettings): returns settings
    selectQueue = [
      [], // no cached user
      [{ instanceId: "inst1", staffbaseUrl: "https://co.staffbase.com", apiToken: null }], // settings lookup (if needed)
    ];
    mockFetchResponse = new Response(
      JSON.stringify({ id: "user-1", profile: { firstName: "Alice", lastName: "B" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    await ensureUserInCache("inst1", "user-1");
    // Should have attempted a fetch to Staffbase
    expect(fetchCalls.some((c) => c.includes("user-1"))).toBe(true);
    // Should have upserted (insert call)
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  test("swallows fetch failures — write completes without throw and no user row inserted", async () => {
    // Cache miss — no existing row
    selectQueue = [[]];
    // Staffbase API is down
    mockFetchResponse = new Response("Service Unavailable", { status: 503 });
    // Must not throw
    await expect(ensureUserInCache("inst1", "user-1")).resolves.toBeUndefined();
    // No upsert should have happened
    expect(insertCalls.length).toBe(0);
  });

  test("swallows upstream non-OK responses (e.g. 404) without throwing", async () => {
    selectQueue = [[]];
    // Simplest: verify no-throw when settings row is missing (returns null staffbaseUrl).
    selectQueue = [
      [], // cache miss
    ];
    mockFetchResponse = new Response("not found", { status: 404 });
    await expect(ensureUserInCache("inst1", "user-ghost")).resolves.toBeUndefined();
  });
});

describe("revalidateAccessor (strict-GDPR)", () => {
  test("TTL hit: returns {deleted:false} without fetching", async () => {
    // Cached row was verified 1 second ago — well inside the 60s TTL default
    selectQueue = [[{ lastVerifiedAt: new Date(Date.now() - 1000) }]];
    const result = await revalidateAccessor("inst1", "user-1");
    expect(result.deleted).toBe(false);
    expect(fetchCalls.filter((c) => c.startsWith("/api/users/")).length).toBe(0);
  });

  test("TTL expired: upstream 200 active → upsert + returns {deleted:false}", async () => {
    // Stale lastVerifiedAt (2 minutes ago, beyond default 60s TTL)
    selectQueue = [[{ lastVerifiedAt: new Date(Date.now() - 2 * 60 * 1000) }]];
    mockFetchResponse = new Response(
      JSON.stringify({ id: "user-1", profile: { firstName: "Alice", lastName: "Smith" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const result = await revalidateAccessor("inst1", "user-1");
    expect(result.deleted).toBe(false);
    expect(fetchCalls.some((c) => c.includes("user-1"))).toBe(true);
    // Upsert ran → at least one insert call
    expect(insertCalls.length).toBeGreaterThan(0);
  });

  test("never verified (lastVerifiedAt=null): forces upstream check", async () => {
    selectQueue = [[{ lastVerifiedAt: null }]];
    mockFetchResponse = new Response(
      JSON.stringify({ id: "user-1", profile: { firstName: "Bob", lastName: "Jones" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const result = await revalidateAccessor("inst1", "user-1");
    expect(result.deleted).toBe(false);
    expect(fetchCalls.some((c) => c.includes("user-1"))).toBe(true);
  });

  test("upstream 404 → cleanupDeletedUser ran, returns {deleted:true}", async () => {
    selectQueue = [[{ lastVerifiedAt: null }]];
    mockFetchResponse = new Response("not found", { status: 404 });
    const result = await revalidateAccessor("inst1", "user-deleted");
    expect(result.deleted).toBe(true);
    // cleanupDeletedUser uses db.delete — verify a delete was issued
    expect(deleteCalls.includes("delete")).toBe(true);
  });

  test("upstream 200 with deleted:true → cleanupDeletedUser, returns {deleted:true}", async () => {
    selectQueue = [[{ lastVerifiedAt: null }]];
    mockFetchResponse = new Response(JSON.stringify({ id: "user-deleted", deleted: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await revalidateAccessor("inst1", "user-deleted");
    expect(result.deleted).toBe(true);
  });

  test("upstream 5xx → fails open, returns {deleted:false}", async () => {
    selectQueue = [[{ lastVerifiedAt: null }]];
    mockFetchResponse = new Response("server error", { status: 503 });
    const result = await revalidateAccessor("inst1", "user-1");
    expect(result.deleted).toBe(false);
    // No cleanup ran
    expect(deleteCalls.includes("delete")).toBe(false);
  });

  test("no row in cache → still revalidates against upstream", async () => {
    selectQueue = [[]]; // cache miss
    mockFetchResponse = new Response(
      JSON.stringify({ id: "user-1", profile: { firstName: "Carol", lastName: "X" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const result = await revalidateAccessor("inst1", "user-1");
    expect(result.deleted).toBe(false);
    expect(fetchCalls.some((c) => c.includes("user-1"))).toBe(true);
  });
});

describe("revalidateReferencedUsers (strict-GDPR, fire-and-forget)", () => {
  test("empty input list short-circuits without DB call", async () => {
    await revalidateReferencedUsers("inst1", []);
    expect(fetchCalls.length).toBe(0);
  });

  test("filters out null/undefined ids and deduplicates", async () => {
    // All ids are fresh — no revalidation needed
    selectQueue = [
      [
        { userId: "u1", lastVerifiedAt: new Date(Date.now() - 1000) },
        { userId: "u2", lastVerifiedAt: new Date(Date.now() - 1000) },
      ],
    ];
    await revalidateReferencedUsers("inst1", ["u1", null, undefined, "u2", "u1", ""]);
    // staffbaseFetch should NOT be called for /api/users/ since both are fresh
    expect(fetchCalls.filter((c) => c.startsWith("/api/users/")).length).toBe(0);
  });

  test("stale rows trigger background revalidation", async () => {
    // u1 stale, u2 fresh
    selectQueue = [
      [
        { userId: "u1", lastVerifiedAt: new Date(Date.now() - 10 * 60 * 1000) }, // 10 min ago
        { userId: "u2", lastVerifiedAt: new Date(Date.now() - 1000) }, // fresh
      ],
      // u1 revalidation: TTL check against cache row (already implied above)
      [{ lastVerifiedAt: new Date(Date.now() - 10 * 60 * 1000) }],
    ];
    mockFetchResponse = new Response(
      JSON.stringify({ id: "u1", profile: { firstName: "U", lastName: "One" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    await revalidateReferencedUsers("inst1", ["u1", "u2"]);
    // Allow microtask queue to flush — fire-and-forget means the inner promise
    // is not awaited; explicit yield via setImmediate equivalent.
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchCalls.some((c) => c.includes("/api/users/u1"))).toBe(true);
  });

  test("ids absent from cache are treated as stale (must verify)", async () => {
    // Cache has no rows for the input ids
    selectQueue = [
      [],
      [[]], // revalidateAccessor inner select for u-new
    ];
    mockFetchResponse = new Response(
      JSON.stringify({ id: "u-new", profile: { firstName: "N", lastName: "U" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    await revalidateReferencedUsers("inst1", ["u-new"]);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchCalls.some((c) => c.includes("/api/users/u-new"))).toBe(true);
  });
});

describe("revalidateAccessor in-flight dedup", () => {
  test("concurrent calls for same (instance,user) share one upstream fetch", async () => {
    selectQueue = [[{ lastVerifiedAt: null }], [{ lastVerifiedAt: null }]];
    mockFetchResponse = new Response(
      JSON.stringify({ id: "u-dup", profile: { firstName: "X", lastName: "Y" } }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
    const [a, b] = await Promise.all([
      revalidateAccessor("inst-dup", "u-dup"),
      revalidateAccessor("inst-dup", "u-dup"),
    ]);
    expect(a.deleted).toBe(false);
    expect(b.deleted).toBe(false);
    expect(fetchCalls.filter((c) => c === "/api/users/u-dup").length).toBe(1);
  });
});
