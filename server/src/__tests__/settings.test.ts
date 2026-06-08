import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@staffbase/staffbase-plugin-sdk", () => ({
  sso: class {
    constructor(_a: string, _b: string, t: string) {
      if (!t || t === "invalid") throw new Error("Invalid token");
    }
    getTokenData() {
      return {
        getUserId: () => "user-1",
        getFullName: () => "Test User",
        getFirstName: () => "Test",
        getLastName: () => "User",
        getInstanceId: () => "dev-instance",
        getRole: () => "editor",
        getLocale: () => "en_US",
        getType: () => "user",
        getBranchId: () => null,
        getUserExternalId: () => null,
        getUserUsername: () => "testuser",
      };
    }
  },
}));

const TEST_ENCRYPTION_KEY = "a".repeat(64);

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

let app: any;
let encrypt: (p: string) => string;
const originalLocalDev = Bun.env.IS_LOCALDEV;
const originalRole = Bun.env.LOCALDEV_ROLE;

beforeAll(async () => {
  Bun.env.ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const crypto = await import("../lib/crypto.ts");
  encrypt = crypto.encrypt;
  app = (await import("../app.ts")).app;
});

afterEach(() => {
  Bun.env.IS_LOCALDEV = originalLocalDev;
  Bun.env.LOCALDEV_ROLE = originalRole;
  selectQueue = [];
});

// ── GET /api/settings ──────────────────────────────────────────────────────────

describe("GET /api/settings", () => {
  beforeEach(() => {
    Bun.env.IS_LOCALDEV = "true";
  });

  test("returns staffbaseUrl and hasApiToken flag", async () => {
    selectQueue = [[{ staffbaseUrl: "https://example.staffbase.com", apiToken: encrypt("abc") }]];
    const res = await app.request("/api/settings", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staffbaseUrl).toBe("https://example.staffbase.com");
    expect(body.hasApiToken).toBe(true);
  });

  test("returns null URL and false token when no settings exist", async () => {
    selectQueue = [[]];
    const res = await app.request("/api/settings", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staffbaseUrl).toBeNull();
    expect(body.hasApiToken).toBe(false);
  });

  test("never returns the plaintext API token", async () => {
    selectQueue = [[{ staffbaseUrl: null, apiToken: encrypt("secret") }]];
    const res = await app.request("/api/settings", { method: "GET" });
    const body = await res.json();
    expect(body.apiToken).toBeUndefined();
    expect(body.hasApiToken).toBe(true);
  });
});

// ── GET /api/settings/token ────────────────────────────────────────────────────

describe("GET /api/settings/token", () => {
  beforeEach(() => {
    Bun.env.IS_LOCALDEV = "true";
    Bun.env.LOCALDEV_ROLE = "editor";
  });

  test("returns decrypted API token for editor", async () => {
    selectQueue = [[{ apiToken: encrypt("my-secret-token") }]];
    const res = await app.request("/api/settings/token", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiToken).toBe("my-secret-token");
  });

  test("returns null when no token stored", async () => {
    selectQueue = [[{ apiToken: null }]];
    const res = await app.request("/api/settings/token", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.apiToken).toBeNull();
  });

  test("returns 403 for non-editor", async () => {
    Bun.env.LOCALDEV_ROLE = "user";
    const res = await app.request("/api/settings/token", { method: "GET" });
    expect(res.status).toBe(403);
  });
});

// ── PUT /api/settings ──────────────────────────────────────────────────────────

describe("PUT /api/settings", () => {
  beforeEach(() => {
    Bun.env.IS_LOCALDEV = "true";
    Bun.env.LOCALDEV_ROLE = "editor";
  });

  test("updates staffbaseUrl and returns 200", async () => {
    selectQueue = [[{ staffbaseUrl: null, apiToken: null }]];
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffbaseUrl: "https://my-company.staffbase.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.staffbaseUrl).toBe("https://my-company.staffbase.com");
  });

  test("rejects non-HTTPS staffbaseUrl", async () => {
    selectQueue = [[]];
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffbaseUrl: "http://insecure.com" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects invalid URL", async () => {
    selectQueue = [[]];
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffbaseUrl: "not a url" }),
    });
    expect(res.status).toBe(400);
  });

  test("stores encrypted API token", async () => {
    selectQueue = [[{ staffbaseUrl: "https://co.staffbase.com", apiToken: null }]];
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiToken: "new-token-123" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasApiToken).toBe(true);
  });

  test("clears API token when null is passed (no existing token)", async () => {
    selectQueue = [[{ staffbaseUrl: "https://co.staffbase.com", apiToken: null }]];
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiToken: null }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasApiToken).toBe(false);
  });

  test("returns 403 for non-editor", async () => {
    Bun.env.LOCALDEV_ROLE = "user";
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffbaseUrl: "https://x.staffbase.com" }),
    });
    expect(res.status).toBe(403);
  });
});
