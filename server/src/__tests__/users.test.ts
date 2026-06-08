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

let mockGetInstanceSettings = () => Promise.resolve({ staffbaseUrl: null, apiToken: null } as any);
let mockStaffbaseFetchResponse: Response | null = null;

mock.module("../lib/staffbase-api.ts", () => ({
  upsertStaffbaseUrl: () => Promise.resolve(),
  getApiToken: () => Promise.resolve(null),
  getInstanceSettings: () => mockGetInstanceSettings(),
  staffbaseFetch: () =>
    mockStaffbaseFetchResponse
      ? Promise.resolve(mockStaffbaseFetchResponse)
      : Promise.reject(new Error("No mock response")),
  extractTraceHeaders: () => ({}),
}));

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
    select: () => chainResult([]),
    selectDistinctOn: () => chainResult([]),
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
const originalLocalDev = Bun.env.IS_LOCALDEV;
const originalRole = Bun.env.LOCALDEV_ROLE;

beforeAll(async () => {
  app = (await import("../app.ts")).app;
});

afterEach(() => {
  Bun.env.IS_LOCALDEV = originalLocalDev;
  Bun.env.LOCALDEV_ROLE = originalRole;
  mockGetInstanceSettings = () => Promise.resolve({ staffbaseUrl: null, apiToken: null } as any);
  mockStaffbaseFetchResponse = null;
});

// ── GET /api/users/search ──────────────────────────────────────────────────────

describe("GET /api/users/search", () => {
  beforeEach(() => {
    Bun.env.IS_LOCALDEV = "true";
    Bun.env.LOCALDEV_ROLE = "editor";
  });

  test("returns mock users in localdev when no credentials", async () => {
    const res = await app.request("/api/users/search?query=", {
      method: "GET",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("entries");
    expect(body.total).toBeGreaterThan(0);
  });

  test("filters mock users by query in localdev", async () => {
    const res = await app.request("/api/users/search?query=Robert", {
      method: "GET",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBeGreaterThan(0);
    expect(body.entries[0].data.firstName).toBe("Robert");
  });

  test("returns 403 for non-editor", async () => {
    Bun.env.LOCALDEV_ROLE = "user";
    const res = await app.request("/api/users/search?query=test", {
      method: "GET",
    });
    expect(res.status).toBe(403);
  });

  test("returns 401 when not authenticated", async () => {
    Bun.env.IS_LOCALDEV = "false";
    const res = await app.request("/api/users/search?query=test", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/users/session ──────────────────────────────────────────────────

describe("DELETE /api/users/session", () => {
  test("returns 200 OK when session is invalidated", async () => {
    Bun.env.IS_LOCALDEV = "true";
    const res = await app.request("/api/users/session", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("OK");
  });
});
