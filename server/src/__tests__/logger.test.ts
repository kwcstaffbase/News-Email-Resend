import { afterEach, beforeEach, describe, expect, test } from "bun:test";

/**
 * Tests for logger.ts — TRACE level, LOG_SECRETS hard-gate, and redact().
 *
 * logger.ts reads Bun.env at call time (not at module-load time), so mutating
 * Bun.env before calling redact()/allowSecrets()/log() is enough for isolation.
 * The dynamic import() calls here are an artefact of the original approach and
 * return the cached module; they work correctly because the module itself is
 * call-time dynamic. Each describe block snapshots and restores the env.
 */

const SAVED_ENV: Record<string, string | undefined> = {};

function saveEnv(...keys: string[]) {
  for (const k of keys) SAVED_ENV[k] = Bun.env[k as keyof typeof Bun.env];
}

function restoreEnv(...keys: string[]) {
  for (const k of keys) {
    const v = SAVED_ENV[k];
    if (v === undefined) {
      delete (Bun.env as Record<string, string | undefined>)[k];
    } else {
      (Bun.env as Record<string, string | undefined>)[k] = v;
    }
  }
}

// A fake JWT with three dot-separated segments (base64url-encoded)
const FAKE_JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("redact()", () => {
  beforeEach(() => saveEnv("IS_LOCALDEV", "LOG_SECRETS", "LOG_LEVEL"));
  afterEach(() => restoreEnv("IS_LOCALDEV", "LOG_SECRETS", "LOG_LEVEL"));

  test("returns <redacted> when LOG_SECRETS is not set", async () => {
    delete (Bun.env as Record<string, string | undefined>).IS_LOCALDEV;
    delete (Bun.env as Record<string, string | undefined>).LOG_SECRETS;
    const { redact } = await import("../lib/logger.ts");
    expect(redact(FAKE_JWT)).toBe("<redacted>");
  });

  test("returns <redacted> when LOG_SECRETS=true but IS_LOCALDEV is not set", async () => {
    delete (Bun.env as Record<string, string | undefined>).IS_LOCALDEV;
    (Bun.env as Record<string, string | undefined>).LOG_SECRETS = "true";
    const { redact } = await import("../lib/logger.ts");
    expect(redact(FAKE_JWT)).toBe("<redacted>");
  });

  test("returns <redacted> when IS_LOCALDEV=true but LOG_SECRETS is not set", async () => {
    (Bun.env as Record<string, string | undefined>).IS_LOCALDEV = "true";
    delete (Bun.env as Record<string, string | undefined>).LOG_SECRETS;
    const { redact } = await import("../lib/logger.ts");
    expect(redact(FAKE_JWT)).toBe("<redacted>");
  });

  test("returns raw value when both IS_LOCALDEV=true AND LOG_SECRETS=true", async () => {
    (Bun.env as Record<string, string | undefined>).IS_LOCALDEV = "true";
    (Bun.env as Record<string, string | undefined>).LOG_SECRETS = "true";
    const { redact } = await import("../lib/logger.ts");
    expect(redact(FAKE_JWT)).toBe(FAKE_JWT);
  });
});

describe("allowSecrets guard", () => {
  beforeEach(() => saveEnv("IS_LOCALDEV", "LOG_SECRETS"));
  afterEach(() => restoreEnv("IS_LOCALDEV", "LOG_SECRETS"));

  test("allowSecrets is false when IS_LOCALDEV is absent", async () => {
    delete (Bun.env as Record<string, string | undefined>).IS_LOCALDEV;
    (Bun.env as Record<string, string | undefined>).LOG_SECRETS = "true";
    const { allowSecrets } = await import("../lib/logger.ts");
    expect(allowSecrets()).toBe(false);
  });

  test("allowSecrets is false when LOG_SECRETS is absent", async () => {
    (Bun.env as Record<string, string | undefined>).IS_LOCALDEV = "true";
    delete (Bun.env as Record<string, string | undefined>).LOG_SECRETS;
    const { allowSecrets } = await import("../lib/logger.ts");
    expect(allowSecrets()).toBe(false);
  });

  test("allowSecrets is true only when both flags are set", async () => {
    (Bun.env as Record<string, string | undefined>).IS_LOCALDEV = "true";
    (Bun.env as Record<string, string | undefined>).LOG_SECRETS = "true";
    const { allowSecrets } = await import("../lib/logger.ts");
    expect(allowSecrets()).toBe(true);
  });
});

describe("TRACE level", () => {
  beforeEach(() => saveEnv("IS_LOCALDEV", "LOG_LEVEL", "LOG_FORMAT"));
  afterEach(() => restoreEnv("IS_LOCALDEV", "LOG_LEVEL", "LOG_FORMAT"));

  test("createLogger exposes a trace() method", async () => {
    (Bun.env as Record<string, string | undefined>).LOG_LEVEL = "TRACE";
    (Bun.env as Record<string, string | undefined>).IS_LOCALDEV = "true";
    const { createLogger } = await import("../lib/logger.ts");
    const logger = createLogger("test");
    expect(typeof logger.trace).toBe("function");
  });

  test("trace() emits output when LOG_LEVEL=TRACE", async () => {
    (Bun.env as Record<string, string | undefined>).LOG_LEVEL = "TRACE";
    (Bun.env as Record<string, string | undefined>).LOG_FORMAT = "json";
    const { createLogger } = await import("../lib/logger.ts");
    const logger = createLogger("test");

    const lines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      lines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    };
    try {
      logger.trace("trace test message.", { key: "value" });
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(entry.level).toBe("TRACE");
    expect(entry.msg).toBe("trace test message.");
    expect(entry.key).toBe("value");
  });

  test("trace() is suppressed at default INFO level", async () => {
    (Bun.env as Record<string, string | undefined>).LOG_LEVEL = "INFO";
    (Bun.env as Record<string, string | undefined>).LOG_FORMAT = "json";
    const { createLogger } = await import("../lib/logger.ts");
    const logger = createLogger("test");

    const lines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      lines.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    };
    try {
      logger.trace("should not appear.");
    } finally {
      process.stdout.write = originalWrite;
    }

    expect(lines.length).toBe(0);
  });
});
