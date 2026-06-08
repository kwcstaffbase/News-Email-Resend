import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useI18n } from "../useI18n.ts";

describe("useI18n", () => {
  it("returns a t function", () => {
    const { result } = renderHook(() => useI18n());
    expect(typeof result.current.t).toBe("function");
  });

  it("returns the key as-is (mock setup returns keys)", () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.t("placeholder.user-title")).toBe("placeholder.user-title");
  });

  it("exposes i18n instance with language", () => {
    const { result } = renderHook(() => useI18n());
    expect(result.current.i18n.language).toBe("en");
  });
});
