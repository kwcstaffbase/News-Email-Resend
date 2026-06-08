import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

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

let txDeleteCalls: string[] = [];

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
      txDeleteCalls = [];
      const tx = {
        insert: () => chainResult([]),
        delete: () => {
          txDeleteCalls.push("delete");
          return chainResult([]);
        },
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
  txDeleteCalls = [];
});

// ── DELETE /api/admin/clear-all ────────────────────────────────────────────────

describe("DELETE /api/admin/clear-all", () => {
  test("returns 204 for editor (clears all instance data)", async () => {
    Bun.env.IS_LOCALDEV = "true";
    Bun.env.LOCALDEV_ROLE = "editor";
    const res = await app.request("/api/admin/clear-all", { method: "DELETE" });
    expect(res.status).toBe(204);
    // Transaction should have called delete twice: items + settings
    expect(txDeleteCalls.length).toBe(2);
  });

  test("returns 403 for non-editor", async () => {
    Bun.env.IS_LOCALDEV = "true";
    Bun.env.LOCALDEV_ROLE = "user";
    const res = await app.request("/api/admin/clear-all", { method: "DELETE" });
    expect(res.status).toBe(403);
  });

  test("returns 401 when not authenticated", async () => {
    Bun.env.IS_LOCALDEV = "false";
    const res = await app.request("/api/admin/clear-all", { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});
