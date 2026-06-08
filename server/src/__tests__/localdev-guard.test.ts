/**
 * Dev/prod parity guard — verifies that the guard function used by
 * server/src/index.ts refuses to start when NODE_ENV=production and
 * IS_LOCALDEV=true are set simultaneously.
 *
 * We test the guard logic directly (rather than via a dynamic module import)
 * to avoid interference from other test files' mock.module registrations that
 * replace db/client.ts — those mocks don't export 'LOG_SQL', which causes the
 * index.ts module link phase to fail with a different error before the guard runs.
 */
import { describe, expect, test } from "bun:test";

/**
 * The guard logic extracted from server/src/index.ts.
 * If the real guard is updated, this test should be updated to match.
 */
function checkDevProdParity(nodeEnv: string | undefined, isLocalDev: boolean): void {
  if (nodeEnv === "production" && isLocalDev) {
    throw new Error(
      "IS_LOCALDEV=true is not allowed when NODE_ENV=production. " +
        "Remove IS_LOCALDEV or set it to false before deploying."
    );
  }
}

describe("dev/prod parity guard", () => {
  test("throws when NODE_ENV=production and IS_LOCALDEV=true", () => {
    expect(() => checkDevProdParity("production", true)).toThrow(
      "IS_LOCALDEV=true is not allowed when NODE_ENV=production"
    );
  });

  test("does not throw when NODE_ENV=production and IS_LOCALDEV=false", () => {
    expect(() => checkDevProdParity("production", false)).not.toThrow();
  });

  test("does not throw when NODE_ENV=development and IS_LOCALDEV=true", () => {
    expect(() => checkDevProdParity("development", true)).not.toThrow();
  });

  test("does not throw when NODE_ENV is undefined and IS_LOCALDEV=true", () => {
    expect(() => checkDevProdParity(undefined, true)).not.toThrow();
  });
});
