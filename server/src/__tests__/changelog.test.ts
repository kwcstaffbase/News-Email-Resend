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

const mockEntry = {
  id: "c0000000-0000-4000-8000-000000000001",
  instanceId: "dev-instance",
  userId: "user-1",
  userName: "Test User",
  action: "app_created",
  entityType: "app",
  entityId: "a0000000-0000-4000-8000-000000000001",
  entityName: "My App",
  summary: 'Created app "My App"',
  payload: null,
  gdprRelevant: false,
  createdAt: new Date().toISOString(),
};

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
const originalLocalDev = Bun.env.IS_LOCALDEV;
const originalRole = Bun.env.LOCALDEV_ROLE;

beforeAll(async () => {
  app = (await import("../app.ts")).app;
});

afterEach(() => {
  Bun.env.IS_LOCALDEV = originalLocalDev;
  Bun.env.LOCALDEV_ROLE = originalRole;
  selectQueue = [];
});

// ── GET /api/changelog ─────────────────────────────────────────────────────────

describe("GET /api/changelog", () => {
  beforeEach(() => {
    Bun.env.IS_LOCALDEV = "true";
    Bun.env.LOCALDEV_ROLE = "editor";
  });

  test("returns paginated changelog entries", async () => {
    // First select → total count; second select → data rows
    selectQueue = [[{ total: 1 }], [mockEntry]];
    const res = await app.request("/api/changelog", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page");
    expect(body).toHaveProperty("limit");
  });

  test("accepts page and limit query params", async () => {
    selectQueue = [[{ total: 0 }], []];
    const res = await app.request("/api/changelog?page=2&limit=10", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.page).toBe(2);
    expect(body.limit).toBe(10);
  });

  test("accepts action filter", async () => {
    selectQueue = [[{ total: 1 }], [mockEntry]];
    const res = await app.request("/api/changelog?action=app_created", { method: "GET" });
    expect(res.status).toBe(200);
  });

  test("accepts entityType filter", async () => {
    selectQueue = [[{ total: 1 }], [mockEntry]];
    const res = await app.request("/api/changelog?entityType=app", { method: "GET" });
    expect(res.status).toBe(200);
  });

  test("accepts search filter", async () => {
    selectQueue = [[{ total: 1 }], [mockEntry]];
    const res = await app.request("/api/changelog?search=My+App", { method: "GET" });
    expect(res.status).toBe(200);
  });

  test("returns 403 for non-editor", async () => {
    Bun.env.LOCALDEV_ROLE = "user";
    const res = await app.request("/api/changelog", { method: "GET" });
    expect(res.status).toBe(403);
  });
});

// ── GET /api/changelog/export ──────────────────────────────────────────────────

describe("GET /api/changelog/export", () => {
  beforeEach(() => {
    Bun.env.IS_LOCALDEV = "true";
    Bun.env.LOCALDEV_ROLE = "editor";
  });

  test("returns NDJSON with content-disposition header", async () => {
    selectQueue = [[mockEntry]];
    const res = await app.request("/api/changelog/export", { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const disposition = res.headers.get("Content-Disposition");
    expect(disposition).toContain("attachment");
    expect(disposition).toContain("audit-log-");
  });

  test("returns empty body when changelog is empty", async () => {
    selectQueue = [[]];
    const res = await app.request("/api/changelog/export", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe("");
  });

  test("returns 403 for non-editor", async () => {
    Bun.env.LOCALDEV_ROLE = "user";
    const res = await app.request("/api/changelog/export", { method: "GET" });
    expect(res.status).toBe(403);
  });
});
