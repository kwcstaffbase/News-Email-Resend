import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

mock.module("@staffbase/staffbase-plugin-sdk", () => ({
  sso: class MockSSOToken {
    constructor(_audience: string, _appSecret: string, tokenData: string) {
      if (!tokenData || tokenData === "invalid.token.here") {
        throw new Error("Invalid or expired token");
      }
    }
    // getTokenData() returns this so that ssoToken.getTokenData().getUserId() works.
    getTokenData() {
      return this;
    }
    getUserId() {
      return "user-1";
    }
    getUserName() {
      return "Test User";
    }
    getFirstName() {
      return null;
    }
    getLastName() {
      return null;
    }
    getInstanceId() {
      return "test-instance";
    }
    getRole() {
      return "user";
    }
    getLocale() {
      return null;
    }
    getType() {
      return "user";
    }
    getBranchId() {
      return null;
    }
    getUserExternalId() {
      return null;
    }
  },
}));

let mockDeleteResult: { id: string }[] = [];

mock.module("../db/client.ts", () => ({
  db: {
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(mockDeleteResult),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve([]),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    }),
  },
}));

let app: any;
const originalLocalDev = Bun.env.IS_LOCALDEV;

beforeAll(async () => {
  app = (await import("../app.ts")).app;
});

afterEach(() => {
  Bun.env.IS_LOCALDEV = originalLocalDev;
  mockDeleteResult = [];
});

// Build a minimal JWT-like string whose payload contains the given claims.
// The SDK is mocked so signature/expiry are not validated — only the payload
// base64 is decoded by extractSidClaim / parseTokenUser.
function makeJwtWithClaims(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `header.${payload}.sig`;
}

describe("DELETE /api/users/session", () => {
  test("returns 200 OK in localdev mode (no sid claim needed)", async () => {
    Bun.env.IS_LOCALDEV = "true";
    const res = await app.request("/api/users/session", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  test("returns 401 without auth and IS_LOCALDEV=false", async () => {
    Bun.env.IS_LOCALDEV = "false";
    const res = await app.request("/api/users/session", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  test("returns 200 OK and deletes sessions matching staffbase hash", async () => {
    Bun.env.IS_LOCALDEV = "false";
    mockDeleteResult = [{ id: "session-abc" }, { id: "session-def" }];
    const jwt = makeJwtWithClaims({
      instance_id: "test-instance",
      sid: "abc123hash",
    });
    const res = await app.request(`/api/users/session?jwt=${jwt}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  test("returns 200 OK even when sid claim is absent (warns but does not error)", async () => {
    Bun.env.IS_LOCALDEV = "false";
    // JWT with no sid claim — anonymous token without platform session hash
    const jwt = makeJwtWithClaims({ instance_id: "test-instance" });
    const res = await app.request(`/api/users/session?jwt=${jwt}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });
});
