import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

// Snapshot real implementations of the modules we mock below so afterAll can
// restore them. bun's `mock.module` is process-global and not auto-restored, so
// without this the stubs leak into later test files (e.g. sessions.test.ts would
// see createSession returning "mock-session-id"). See applaunchpad PR #97.
const realSessions = await import("../lib/sessions.ts");
const realUserCache = await import("../lib/user-cache.ts");

// MockSSOToken: throws for invalid tokens, succeeds for any other value
mock.module("@staffbase/staffbase-plugin-sdk", () => ({
  sso: class MockSSOToken {
    constructor(_audience: string, _appSecret: string, tokenData: string) {
      if (!tokenData || tokenData === "invalid.token.here") {
        throw new Error("Invalid or expired token");
      }
    }
    // All token data methods are on this class directly.
    // getTokenData() returns this so that callers using the sdk-style
    // `ssoToken.getTokenData().getUserId()` pattern work correctly.
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
      return "Test";
    }
    getLastName() {
      return "User";
    }
    getInstanceId() {
      return "test-instance";
    }
    getRole() {
      return "user";
    }
    getLocale() {
      return "en_US";
    }
    getType() {
      return "user";
    }
    getBranchId() {
      return "test-branch";
    }
    getUserExternalId() {
      return null;
    }
  },
}));

// Registry for mocking getSession — individual tests can inject a session row.
// Declared as `let` so tests can replace it; using object wrapper avoids
// Biome's "can only be empty here" static-analysis false-positive on Map/Set.
let sessionLookup: (
  id: string
) => { id: string; userId: string; instanceId: string; role: string; expiresAt: Date } | undefined =
  () => undefined;

mock.module("../lib/sessions.ts", () => ({
  createSession: (_user: unknown) => Promise.resolve("mock-session-id"),
  getSession: (id: string) => Promise.resolve(sessionLookup(id) ?? null),
  extendSession: (_id: string) => Promise.resolve(),
  deleteSession: (_id: string) => Promise.resolve(),
  issueSession: (_userId: string, _instanceId: string, _role: string) =>
    Promise.resolve("mock-session-id"),
  deleteUserSessions: (_userId: string, _instanceId: string) => Promise.resolve(1),
  deleteSessionsByStaffbaseHash: (_hash: string, _instanceId: string) => Promise.resolve(1),
  cleanExpiredSessions: () => Promise.resolve(0),
}));

// Strict-GDPR gate mock — individual tests can flip `mockAccessorDeleted` to
// simulate the upstream having deleted the user. Default = user still exists.
let mockAccessorDeleted = false;
mock.module("../lib/user-cache.ts", () => ({
  revalidateAccessor: (_instanceId: string, _userId: string) =>
    Promise.resolve({ deleted: mockAccessorDeleted }),
  ensureUserInCache: (_instanceId: string, _userId: string) => Promise.resolve(),
  revalidateReferencedUsers: (
    _instanceId: string,
    _userIds: ReadonlyArray<string | null | undefined>
  ) => Promise.resolve(),
  refreshAllUsers: () => Promise.resolve({ total: 0, active: 0, deleted: 0, fetchErrors: 0 }),
  refreshSingleUser: (_userId: string, _instanceId: string) => Promise.resolve("refreshed"),
  upsertUser: (_user: unknown) => Promise.resolve(),
}));

// Minimal DB mock for non-session routes (apps, users, etc. may return 500).
function emptySelect(): Promise<unknown[]> {
  return Promise.resolve([]);
}

mock.module("../db/client.ts", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: emptySelect }) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({ values: () => ({ onConflictDoUpdate: () => Promise.resolve([]) }) }),
    delete: () => ({ where: () => Promise.resolve([]) }),
  },
}));

// Restore the real modules after this file so the global mocks above cannot
// bleed into later test files (sessions.test.ts, user-cache.test.ts).
afterAll(() => {
  mock.module("../lib/sessions.ts", () => ({ ...realSessions }));
  mock.module("../lib/user-cache.ts", () => ({ ...realUserCache }));
});

let app: any;
const originalLocalDev = Bun.env.IS_LOCALDEV;

beforeAll(async () => {
  app = (await import("../app.ts")).app;
});

afterEach(() => {
  Bun.env.IS_LOCALDEV = originalLocalDev;
  sessionLookup = () => undefined;
  mockAccessorDeleted = false;
});

describe("SSO middleware", () => {
  test("returns 401 when no token provided and IS_LOCALDEV=false", async () => {
    Bun.env.IS_LOCALDEV = "false";
    const res = await app.request("/api/apps", { method: "GET" });
    expect(res.status).toBe(401);
  });

  test("returns 401 for invalid ?jwt= param", async () => {
    Bun.env.IS_LOCALDEV = "false";
    const res = await app.request("/api/apps?jwt=invalid.token.here", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });

  test("passes through auth with IS_LOCALDEV=true (no 401)", async () => {
    Bun.env.IS_LOCALDEV = "true";
    const res = await app.request("/api/apps", { method: "GET" });
    // Auth passed; DB mock may cause 500 but must not return 401
    expect(res.status).not.toBe(401);
  });

  test("strict-GDPR gate: returns 401 user_deleted when upstream confirms deletion (JWT path)", async () => {
    Bun.env.IS_LOCALDEV = "false";
    mockAccessorDeleted = true;
    const res = await app.request("/api/apps?jwt=valid.token.payload", { method: "GET" });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("user_deleted");
  });

  test("strict-GDPR gate: allows request when upstream confirms user exists (JWT path)", async () => {
    Bun.env.IS_LOCALDEV = "false";
    mockAccessorDeleted = false;
    const res = await app.request("/api/apps?jwt=valid.token.payload", { method: "GET" });
    // Auth passed the gate — handler may return non-200 due to DB mock but must
    // never be 401.
    expect(res.status).not.toBe(401);
  });

  test("strict-GDPR gate: cookie/session path also gated by revalidateAccessor", async () => {
    Bun.env.IS_LOCALDEV = "false";
    const sessionId = "b1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const expiresAt = new Date(Date.now() + 30_000);
    sessionLookup = (id) =>
      id === sessionId
        ? {
            id: sessionId,
            userId: "user-1",
            instanceId: "test-instance",
            role: "user",
            expiresAt,
          }
        : undefined;
    mockAccessorDeleted = true;
    const res = await app.request("/api/apps", {
      method: "GET",
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("user_deleted");
  });

  test("GDPR delete intercept is skipped under IS_LOCALDEV — widget POST with sentinel ?jwt=dev does not 401", async () => {
    Bun.env.IS_LOCALDEV = "true";
    // A POST that would normally hit the delete-intercept arrives with the
    // localdev sentinel ?jwt=dev. parseTokenUser cannot validate "dev", so
    // without the IS_LOCALDEV bypass this would 401. With the bypass it
    // falls through to ssoMiddleware, which honours IS_LOCALDEV.
    const res = await app.request("/api/apps?jwt=dev", { method: "POST" });
    expect(res.status).not.toBe(401);
  });

  test("returns 200 when Bearer is a valid session UUID (ITP fallback)", async () => {
    Bun.env.IS_LOCALDEV = "false";
    const sessionId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const expiresAt = new Date(Date.now() + 30_000);
    // Seed the session mock: getSession(sessionId) returns a valid session row
    const sessionData = {
      id: sessionId,
      userId: "user-1",
      instanceId: "test-instance",
      role: "user",
      expiresAt,
      staffbaseSessionHash: null,
    };
    sessionLookup = (id) => (id === sessionId ? sessionData : undefined);
    const res = await app.request("/api/apps", {
      method: "GET",
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    sessionLookup = () => undefined; // reset
    // Auth passed; DB mock for apps may cause non-200 but must not be 401
    expect(res.status).not.toBe(401);
  });
});

describe("parseTokenUser", () => {
  test("returns branchId from JWT when present", async () => {
    // Use the already-imported sso.ts (getSSOToken mock returns branchId="test-branch")
    const { parseTokenUser } = await import("../middleware/sso.ts");
    const result = parseTokenUser("some.valid.jwt.token");
    // Should parse successfully with branchId populated
    expect(result).not.toBeNull();
    expect(result?.branchId).toBe("test-branch");
    expect(result?.instanceId).toBe("test-instance");
  });
});
