import { isMobileApp, isNativeApp } from "@staffbase/plugins-client-sdk";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetCacheForTest, useClientKind } from "../useClientKind.ts";

// @staffbase/plugins-client-sdk is mocked in setup.ts:
//   isNativeApp: vi.fn().mockResolvedValue(false)
//   isMobileApp: vi.fn().mockResolvedValue(false)
// Override per-test with .mockResolvedValueOnce() / .mockRejectedValueOnce().

beforeEach(() => {
  // Reset module-level promise cache before each test so SDK mocks are called fresh.
  _resetCacheForTest();
});

afterEach(() => {
  // Restore jsdom default: parent === self (standalone).
  Object.defineProperty(globalThis, "parent", {
    get: () => globalThis.self,
    configurable: true,
  });
});

function simulateIframe(): void {
  Object.defineProperty(globalThis, "parent", {
    get: () => ({}) as Window,
    configurable: true,
  });
}

// ── Standalone path (jsdom default: parent === self) ──────────────────────────

describe("useClientKind — standalone (no parent iframe)", () => {
  it("returns { ready: true } immediately without calling the SDK", () => {
    vi.mocked(isNativeApp).mockClear();
    vi.mocked(isMobileApp).mockClear();

    const { result } = renderHook(() => useClientKind());

    // Lazy useState initializer resolves synchronously; no SDK needed.
    expect(result.current).toEqual({ isNative: false, isMobile: false, ready: true });
    expect(vi.mocked(isNativeApp)).not.toHaveBeenCalled();
    expect(vi.mocked(isMobileApp)).not.toHaveBeenCalled();
  });
});

// ── Embedded path (inside a Staffbase iframe) ─────────────────────────────────

describe("useClientKind — embedded (inside iframe)", () => {
  beforeEach(() => simulateIframe());

  it("resolves to desktop defaults when both SDK calls return false", async () => {
    const { result } = renderHook(() => useClientKind());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current).toEqual({ isNative: false, isMobile: false, ready: true });
  });

  it("resolves isNative:true when running in the Staffbase native app", async () => {
    vi.mocked(isNativeApp).mockResolvedValueOnce(true);

    const { result } = renderHook(() => useClientKind());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current).toEqual({ isNative: true, isMobile: false, ready: true });
  });

  it("resolves isMobile:true when running in the mobile web app", async () => {
    vi.mocked(isMobileApp).mockResolvedValueOnce(true);

    const { result } = renderHook(() => useClientKind());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current).toEqual({ isNative: false, isMobile: true, ready: true });
  });

  it("falls back to desktop defaults when the SDK handshake rejects", async () => {
    vi.mocked(isNativeApp).mockRejectedValueOnce(new Error("No answer from Staffbase App"));

    const { result } = renderHook(() => useClientKind());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current).toEqual({ isNative: false, isMobile: false, ready: true });
  });

  it("calls the SDK only once even when multiple instances mount", async () => {
    vi.mocked(isNativeApp).mockClear();
    vi.mocked(isMobileApp).mockClear();

    const { result: r1 } = renderHook(() => useClientKind());
    renderHook(() => useClientKind());
    renderHook(() => useClientKind());

    await waitFor(() => expect(r1.current.ready).toBe(true));

    // All three instances share the same cached promise — exactly one SDK call pair.
    expect(vi.mocked(isNativeApp)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(isMobileApp)).toHaveBeenCalledTimes(1);
  });
});
