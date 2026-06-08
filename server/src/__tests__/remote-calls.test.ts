import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

// ── Mock DB ────────────────────────────────────────────────────────────────────

let txDeleteCallArgs: string[] = [];
let txUpdateCallArgs: { table: string; field: string }[] = [];
let txShouldThrow = false;

// All cleanup operations (cleanupDeletedUser + deleteInstance) now run inside a
// single db.transaction(...). The mock exposes the same `delete` / `update` /
// `select` surface on the `tx` argument that the real Drizzle client provides.
function makeTx() {
  return {
    delete: (table: { _: { name: string } } | string) => {
      const name = typeof table === "string" ? table : ((table as any)?._?.name ?? "unknown");
      txDeleteCallArgs.push(name);
      return {
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      };
    },
    update: (table: { _: { name: string } } | string) => {
      const name = typeof table === "string" ? table : ((table as any)?._?.name ?? "unknown");
      return {
        set: (fields: Record<string, unknown>) => {
          txUpdateCallArgs.push({ table: name, field: Object.keys(fields)[0] });
          return {
            where: () => Promise.resolve([]),
          };
        },
      };
    },
  };
}

mock.module("../db/client.ts", () => ({
  db: {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      if (txShouldThrow) throw new Error("DB transaction failed");
      return callback(makeTx());
    },
  },
}));

let cleanupDeletedUser: (instanceId: string, userId: string) => Promise<void>;
let deleteInstance: (instanceId: string) => Promise<boolean>;

beforeAll(async () => {
  const mod = await import("../lib/remote-calls.ts");
  cleanupDeletedUser = mod.cleanupDeletedUser;
  deleteInstance = mod.deleteInstance;
});

afterEach(() => {
  txDeleteCallArgs = [];
  txUpdateCallArgs = [];
  txShouldThrow = false;
});

// ── cleanupDeletedUser ─────────────────────────────────────────────────────────

describe("cleanupDeletedUser", () => {
  test("deletes sessions and users rows inside tx", async () => {
    await cleanupDeletedUser("inst-1", "user-to-delete");
    expect(txDeleteCallArgs.length).toBeGreaterThanOrEqual(2);
  });

  test("nullifies userId in changelog inside tx", async () => {
    await cleanupDeletedUser("inst-1", "user-to-delete");
    expect(txUpdateCallArgs.length).toBeGreaterThanOrEqual(1);
  });

  test("does not throw on success", async () => {
    await expect(cleanupDeletedUser("inst-1", "user-to-delete")).resolves.toBeUndefined();
  });

  test("propagates transaction failure (atomic — no partial cleanup)", async () => {
    txShouldThrow = true;
    await expect(cleanupDeletedUser("inst-1", "user-to-delete")).rejects.toThrow();
  });
});

// ── deleteInstance ──────────────────────────────────────────────────────────────

describe("deleteInstance", () => {
  test("returns true on successful transaction", async () => {
    const result = await deleteInstance("inst-to-delete");
    expect(result).toBe(true);
  });

  test("deletes items, settings, users, sessions, changelog within transaction", async () => {
    await deleteInstance("inst-to-delete");
    expect(txDeleteCallArgs.length).toBe(5);
  });

  test("returns false when transaction throws", async () => {
    txShouldThrow = true;
    const result = await deleteInstance("inst-to-delete");
    expect(result).toBe(false);
  });
});
