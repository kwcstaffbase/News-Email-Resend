import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@staffbase/staffbase-plugin-sdk", () => ({
  sso: class {
    constructor(_a: string, _b: string, t: string) {
      if (!t || t === "invalid") throw new Error("Invalid token");
    }
    getTokenData() {
      return {
        getUserId: () => "editor-1",
        getFullName: () => "Editor User",
        getFirstName: () => "Editor",
        getLastName: () => "User",
        getInstanceId: () => "dev-instance",
        getRole: () => "editor",
        getLocale: () => "en_US",
        getType: () => "user",
        getBranchId: () => null,
        getUserExternalId: () => null,
        getUserUsername: () => "editoruser",
      };
    }
  },
}));

const TEST_ENCRYPTION_KEY = "a".repeat(64);

// ── DB mock ────────────────────────────────────────────────────────────────

let selectQueue: unknown[][] = [];

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
      return () => chainResult(value);
    },
  });
}

mock.module("../db/client.ts", () => ({
  db: {
    select: () => chainResult(nextSelectResult()),
    selectDistinctOn: () => chainResult(nextSelectResult()),
    insert: () => chainResult([]),
    update: () => chainResult([]),
    delete: () => chainResult([]),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: () => chainResult([]),
        delete: () => chainResult([]),
        update: () => chainResult([]),
      };
      return cb(tx);
    },
  },
}));

// ── Fetch mock ─────────────────────────────────────────────────────────────

type MockFetchResponse = { ok: boolean; status: number; body: unknown };
let fetchQueue: MockFetchResponse[] = [];

function nextFetchResponse(): MockFetchResponse {
  return fetchQueue.shift() ?? { ok: false, status: 503, body: { error: "no mock queued" } };
}

const originalFetch = globalThis.fetch;

// ── App bootstrap ──────────────────────────────────────────────────────────

let app: any;
let encrypt: (p: string) => string;
const originalLocalDev = Bun.env.IS_LOCALDEV;

beforeAll(async () => {
  Bun.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const crypto = await import("../lib/crypto.ts");
  encrypt = crypto.encrypt;
  app = (await import("../app.ts")).app;
});

beforeEach(() => {
  Bun.env.IS_LOCALDEV = "true";
  // Replace fetch with a queue-based mock
  globalThis.fetch = async (_url: string | URL | Request, _init?: RequestInit) => {
    const mock = nextFetchResponse();
    return {
      ok: mock.ok,
      status: mock.status,
      json: async () => mock.body,
      text: async () => JSON.stringify(mock.body),
      clone: () => ({ json: async () => mock.body, text: async () => JSON.stringify(mock.body) }),
    } as unknown as Response;
  };
});

afterEach(() => {
  Bun.env.IS_LOCALDEV = originalLocalDev;
  selectQueue = [];
  fetchQueue = [];
  globalThis.fetch = originalFetch;
});

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(path: string, opts?: RequestInit) {
  return new Request(`http://localhost${path}`, {
    headers: {
      Authorization: "Bearer valid-token",
      "X-Instance-Id": "dev-instance",
      ...((opts?.headers as Record<string, string>) ?? {}),
    },
    ...opts,
  });
}

/** Push a settings row into the DB select queue (staffbaseUrl + apiToken configured). */
function queueConfiguredSettings() {
  selectQueue.push([
    {
      staffbaseUrl: "https://example.staffbase.com",
      apiToken: encrypt("test-token"),
      emailServiceUrl: "https://email-service.example.com/api/emails",
    },
  ]);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/news/posts", () => {
  test("returns 400 when channelId is missing", async () => {
    const res = await app.fetch(makeRequest("/api/news/posts"));
    expect(res.status).toBe(400);
  });

  test("returns 503 when settings not configured", async () => {
    selectQueue.push([]); // empty settings row
    const res = await app.fetch(makeRequest("/api/news/posts?channelId=chan-1"));
    expect(res.status).toBe(503);
  });

  test("proxies channel posts from Staffbase API", async () => {
    queueConfiguredSettings();
    fetchQueue.push({
      ok: true,
      status: 200,
      body: { data: [{ id: "post-1", contents: { en_US: { title: "Test Post" } } }], total: 1 },
    });
    const res = await app.fetch(makeRequest("/api/news/posts?channelId=chan-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe("post-1");
  });

  test("forwards non-OK Staffbase response as error", async () => {
    queueConfiguredSettings();
    fetchQueue.push({ ok: false, status: 404, body: { error: "not found" } });
    const res = await app.fetch(makeRequest("/api/news/posts?channelId=chan-xyz"));
    expect(res.status).toBe(404);
  });
});

describe("GET /api/news/posts/:postId/acknowledgement-status", () => {
  test("returns 503 when settings not configured", async () => {
    selectQueue.push([]);
    const res = await app.fetch(makeRequest("/api/news/posts/post-1/acknowledgement-status"));
    expect(res.status).toBe(503);
  });

  test("returns acknowledgement status with acknowledged and not-acknowledged lists", async () => {
    queueConfiguredSettings();

    // 1. GET /api/posts/post-1
    fetchQueue.push({
      ok: true,
      status: 200,
      body: {
        id: "post-1",
        channelID: "chan-1",
        acknowledgingEnabled: true,
        contents: { en_US: { title: "My Post" } },
        acknowledgements: { total: 1 },
        links: { detail_view: { href: "https://example.staffbase.com/content/news/post-1" } },
      },
    });
    // 2. GET /api/posts/post-1/acknowledgements (page 1)
    fetchQueue.push({
      ok: true,
      status: 200,
      body: { data: [{ userID: "user-1" }], total: 1 },
    });
    // 3. GET /api/channels/chan-1
    fetchQueue.push({
      ok: true,
      status: 200,
      body: {
        accessors: { groups: { data: [{ id: "group-1" }] } },
      },
    });
    // 4. GET /api/groups/group-1
    fetchQueue.push({
      ok: true,
      status: 200,
      body: {
        users: {
          total: 2,
          data: [
            {
              id: "user-1",
              firstName: "Alice",
              lastName: "Smith",
              publicEmailAddress: "alice@example.com",
              status: "activated",
            },
            {
              id: "user-2",
              firstName: "Bob",
              lastName: "Jones",
              publicEmailAddress: "bob@example.com",
              status: "activated",
            },
          ],
        },
      },
    });

    const res = await app.fetch(
      makeRequest("/api/news/posts/post-1/acknowledgement-status")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.acknowledgingEnabled).toBe(true);
    expect(body.totalRecipients).toBe(2);
    expect(body.acknowledgedUsers).toHaveLength(1);
    expect(body.acknowledgedUsers[0].userId).toBe("user-1");
    expect(body.notAcknowledgedUsers).toHaveLength(1);
    expect(body.notAcknowledgedUsers[0].userId).toBe("user-2");
  });
});

describe("POST /api/news/posts/:postId/enable-acknowledging", () => {
  test("returns 503 when settings not configured", async () => {
    selectQueue.push([]);
    const res = await app.fetch(
      makeRequest("/api/news/posts/post-1/enable-acknowledging", { method: "POST" })
    );
    expect(res.status).toBe(503);
  });

  test("enables acknowledging on the post", async () => {
    queueConfiguredSettings();
    fetchQueue.push({ ok: true, status: 200, body: { id: "post-1", acknowledgingEnabled: true } });
    const res = await app.fetch(
      makeRequest("/api/news/posts/post-1/enable-acknowledging", { method: "POST" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

describe("POST /api/news/posts/:postId/send-reminder", () => {
  test("returns 400 when body is invalid", async () => {
    const res = await app.fetch(
      makeRequest("/api/news/posts/post-1/send-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [] }), // empty array — fails min(1)
      })
    );
    expect(res.status).toBe(400);
  });

  test("returns 503 when emailServiceUrl not configured", async () => {
    // Settings without emailServiceUrl
    selectQueue.push([
      {
        staffbaseUrl: "https://example.staffbase.com",
        apiToken: encrypt("test-token"),
        emailServiceUrl: null,
      },
    ]);
    // User lookup for user-2
    fetchQueue.push({
      ok: true,
      status: 200,
      body: {
        id: "user-2",
        firstName: "Bob",
        lastName: "Jones",
        publicEmailAddress: "bob@example.com",
      },
    });
    const res = await app.fetch(
      makeRequest("/api/news/posts/post-1/send-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: ["user-2"] }),
      })
    );
    expect(res.status).toBe(503);
  });

  test("sends reminder and returns sent count", async () => {
    queueConfiguredSettings();
    // User lookup for user-2
    fetchQueue.push({
      ok: true,
      status: 200,
      body: {
        id: "user-2",
        firstName: "Bob",
        lastName: "Jones",
        publicEmailAddress: "bob@example.com",
      },
    });
    // Email service response
    fetchQueue.push({ ok: true, status: 200, body: { messageId: "abc123" } });

    const res = await app.fetch(
      makeRequest("/api/news/posts/post-1/send-reminder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: ["user-2"],
          subject: "Please read this post",
          postUrl: "https://example.staffbase.com/content/news/post-1",
          postTitle: "My Post",
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sent).toBe(1);
    expect(body.skipped).toBe(0);
  });
});
