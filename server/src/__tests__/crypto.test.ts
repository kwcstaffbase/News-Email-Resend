import { afterEach, beforeAll, describe, expect, test } from "bun:test";

// These tests exercise crypto.ts directly — no mocking needed.
// We set ENCRYPTION_KEY to a known 64-char hex.

const TEST_KEY = "a".repeat(64); // 32 bytes of 0xAA
const _originalKey = Bun.env.ENCRYPTION_KEY;

let encrypt: (p: string) => string;
let decrypt: (c: string) => string | null;

beforeAll(async () => {
  Bun.env.ENCRYPTION_KEY = TEST_KEY;
  const mod = await import("../lib/crypto.ts");
  encrypt = mod.encrypt;
  decrypt = mod.decrypt;
});

afterEach(() => {
  Bun.env.ENCRYPTION_KEY = TEST_KEY;
});

describe("encrypt", () => {
  test("produces iv:tag:cipher format", () => {
    const ct = encrypt("hello");
    const parts = ct.split(":");
    expect(parts).toHaveLength(3);
    // IV is 12 bytes = 24 hex chars
    expect(parts[0]).toHaveLength(24);
    // Auth tag is 16 bytes = 32 hex chars
    expect(parts[1]).toHaveLength(32);
    // Ciphertext hex is non-empty
    expect(parts[2].length).toBeGreaterThan(0);
  });

  test("produces different ciphertexts for the same input (random IV)", () => {
    const a = encrypt("repeat");
    const b = encrypt("repeat");
    expect(a).not.toBe(b);
  });

  test("works with empty string", () => {
    const ct = encrypt("");
    const parts = ct.split(":");
    expect(parts).toHaveLength(3);
  });

  test("works with unicode", () => {
    const ct = encrypt("日本語テスト 🚀");
    expect(ct.split(":")).toHaveLength(3);
  });
});

describe("decrypt", () => {
  test("roundtrips correctly", () => {
    expect(decrypt(encrypt("secret token 123"))).toBe("secret token 123");
  });

  test("roundtrips empty string", () => {
    expect(decrypt(encrypt(""))).toBe("");
  });

  test("roundtrips unicode", () => {
    const text = "日本語テスト 🚀";
    expect(decrypt(encrypt(text))).toBe(text);
  });

  test("returns null for tampered ciphertext", () => {
    const ct = encrypt("sensitive");
    const parts = ct.split(":");
    // XOR the first byte so the tamper is always different from the original,
    // regardless of what value the random IV produced.
    const firstByte = Number.parseInt(parts[2].slice(0, 2), 16);
    const flippedByte = (firstByte ^ 0xff).toString(16).padStart(2, "0");
    const tampered = `${parts[0]}:${parts[1]}:${flippedByte}${parts[2].slice(2)}`;
    expect(decrypt(tampered)).toBeNull();
  });

  test("returns null for tampered auth tag", () => {
    const ct = encrypt("sensitive");
    const parts = ct.split(":");
    const tampered = `${parts[0]}:${"00".repeat(16)}:${parts[2]}`;
    expect(decrypt(tampered)).toBeNull();
  });

  test("returns null for malformed input (wrong number of parts)", () => {
    expect(decrypt("just:two")).toBeNull();
    expect(decrypt("one")).toBeNull();
    expect(decrypt("a:b:c:d")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(decrypt("")).toBeNull();
  });

  test("returns null for wrong IV length", () => {
    const ct = encrypt("test");
    const parts = ct.split(":");
    // Shorten IV
    expect(decrypt(`aa:${parts[1]}:${parts[2]}`)).toBeNull();
  });
});

describe("getKey validation", () => {
  test("throws when ENCRYPTION_KEY is missing", () => {
    Bun.env.ENCRYPTION_KEY = "";
    expect(() => encrypt("fail")).toThrow("ENCRYPTION_KEY must be a 64-character hex string");
  });

  test("throws when ENCRYPTION_KEY is too short", () => {
    Bun.env.ENCRYPTION_KEY = "abcd";
    expect(() => encrypt("fail")).toThrow("ENCRYPTION_KEY must be a 64-character hex string");
  });

  test("throws when ENCRYPTION_KEY is 64 chars but not valid hex", () => {
    // 64 non-hex chars: passes a length-only check but Buffer.from(_, "hex")
    // silently yields a wrong-length key and fails later in createCipheriv with
    // an unclear error. getKey must reject it up front with the config message.
    Bun.env.ENCRYPTION_KEY = "z".repeat(64);
    expect(() => encrypt("fail")).toThrow("ENCRYPTION_KEY must be a 64-character hex string");
  });
});
