import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

// ── Mock DB ────────────────────────────────────────────────────────────────────

let mockInsertResult: unknown[] = [];
let mockSelectResult: unknown[] = [];
let mockUpdateResult: unknown[] = [];
let mockDeleteResult: { id: string }[] = [];

mock.module("../db/client.ts", () => ({
  db: {
    insert: () => ({
      values: () => Promise.resolve(mockInsertResult),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mockSelectResult),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(mockUpdateResult),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(mockDeleteResult),
      }),
    }),
  },
}));

let createSession: (user: { userId: string; instanceId: string; role: string }) => Promise<string>;
let getSession: (sessionId: string) => Promise<unknown>;
let extendSession: (sessionId: string) => Promise<void>;
let cleanExpiredSessions: () => Promise<number>;

const originalSessionTtl = Bun.env.SESSION_TTL_HOURS;
const originalSessionSliding = Bun.env.SESSION_SLIDING;

beforeAll(async () => {
  // Force a fresh evaluation of sessions.ts so it binds to OUR mocked
  // `../db/client.ts` rather than a cached copy. sso.test.ts mocks
  // `../lib/sessions.ts` at module level and (in CI) runs before this file;
  // bun's `mock.module` is process-global and its restore does not re-evaluate
  // consumer bindings, so a plain `await import("../lib/sessions.ts")` here can
  // return sso's stub (createSession → "mock-session-id"). A unique query
  // string makes bun treat this as a new module record and re-parse the real
  // file with the current db mock in place. See applaunchpad PR #97.
  const mod = await import(`../lib/sessions.ts?fresh=${Date.now()}`);
  createSession = mod.createSession;
  getSession = mod.getSession;
  extendSession = mod.extendSession;
  cleanExpiredSessions = mod.cleanExpiredSessions;
});

afterEach(() => {
  Bun.env.SESSION_TTL_HOURS = originalSessionTtl;
  Bun.env.SESSION_SLIDING = originalSessionSliding;
  mockInsertResult = [];
  mockSelectResult = [];
  mockUpdateResult = [];
  mockDeleteResult = [];
});

// ── createSession ──────────────────────────────────────────────────────────────

describe("createSession", () => {
  test("returns a UUID session ID", async () => {
    const sessionId = await createSession({
      userId: "user-1",
      instanceId: "inst-1",
      role: "editor",
    });
    expect(typeof sessionId).toBe("string");
    // UUID v4 format
    expect(sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

// ── getSession ─────────────────────────────────────────────────────────────────

describe("getSession", () => {
  test("returns session object when found and not expired", async () => {
    const mockSession = {
      id: "sess-1",
      userId: "user-1",
      instanceId: "inst-1",
      role: "editor",
      expiresAt: new Date(Date.now() + 3600_000),
    };
    mockSelectResult = [mockSession];
    const result = await getSession("sess-1");
    expect(result).not.toBeNull();
    expect((result as any).id).toBe("sess-1");
    expect((result as any).userId).toBe("user-1");
  });

  test("returns null when session not found or expired", async () => {
    mockSelectResult = [];
    const result = await getSession("nonexistent");
    expect(result).toBeNull();
  });
});

// ── extendSession ──────────────────────────────────────────────────────────────

describe("extendSession", () => {
  test("does not throw when SESSION_SLIDING is enabled (default)", async () => {
    Bun.env.SESSION_SLIDING = undefined;
    await expect(extendSession("sess-1")).resolves.toBeUndefined();
  });

  test("skips update when SESSION_SLIDING=false", async () => {
    Bun.env.SESSION_SLIDING = "false";
    // Should return early without calling db.update
    await expect(extendSession("sess-1")).resolves.toBeUndefined();
  });
});

// ── cleanExpiredSessions ───────────────────────────────────────────────────────

describe("cleanExpiredSessions", () => {
  test("returns count of deleted sessions", async () => {
    mockDeleteResult = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
    const count = await cleanExpiredSessions();
    expect(count).toBe(3);
  });

  test("returns 0 when no expired sessions", async () => {
    mockDeleteResult = [];
    const count = await cleanExpiredSessions();
    expect(count).toBe(0);
  });
});
