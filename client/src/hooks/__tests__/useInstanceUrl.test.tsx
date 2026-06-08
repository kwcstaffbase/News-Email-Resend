import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useInstanceUrl } from "../useInstanceUrl.ts";

describe("useInstanceUrl", () => {
  it("returns empty string when not running in an iframe", () => {
    // In jsdom, parent === self (no iframe)
    const { result } = renderHook(() => useInstanceUrl());
    expect(result.current).toBe("");
  });

  it("returns a string type", () => {
    const { result } = renderHook(() => useInstanceUrl());
    expect(typeof result.current).toBe("string");
  });
});
