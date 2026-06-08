import { describe, expect, test } from "bun:test";
import { TtlCache } from "../lib/ttl-cache.ts";

describe("TtlCache", () => {
  test("get returns undefined for missing key", () => {
    const c = new TtlCache<string, number>(60, 10);
    expect(c.get("nope")).toBeUndefined();
  });

  test("set + get round-trips a value within TTL", () => {
    const c = new TtlCache<string, number>(60, 10);
    c.set("k", 42);
    expect(c.get("k")).toBe(42);
  });

  test("get returns undefined after the TTL elapses", async () => {
    const c = new TtlCache<string, number>(0.01, 10); // 10 ms TTL
    c.set("k", 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(c.get("k")).toBeUndefined();
  });

  test("set on existing key refreshes the expiry (move-to-end)", async () => {
    const c = new TtlCache<string, number>(0.05, 10); // 50 ms
    c.set("k", 1);
    await new Promise((r) => setTimeout(r, 30));
    c.set("k", 2); // refresh
    await new Promise((r) => setTimeout(r, 30));
    expect(c.get("k")).toBe(2); // would have expired without the refresh
  });

  test("delete removes a key", () => {
    const c = new TtlCache<string, number>(60, 10);
    c.set("k", 1);
    c.delete("k");
    expect(c.get("k")).toBeUndefined();
  });

  test("clear removes all keys", () => {
    const c = new TtlCache<string, number>(60, 10);
    c.set("a", 1);
    c.set("b", 2);
    c.clear();
    expect(c.size()).toBe(0);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeUndefined();
  });

  test("max-entries eviction drops oldest insertion", () => {
    const c = new TtlCache<string, number>(60, 2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // evicts "a"
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
    expect(c.size()).toBe(2);
  });

  test("eviction preserves insertion order — replacing a key counts as fresh", () => {
    const c = new TtlCache<string, number>(60, 2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 10); // re-insert "a" — should move it to end
    c.set("c", 3); // evicts the oldest, which is now "b"
    expect(c.get("a")).toBe(10);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe(3);
  });
});
