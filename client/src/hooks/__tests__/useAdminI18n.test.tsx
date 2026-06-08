import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAdminI18n } from "../useAdminI18n.ts";

describe("useAdminI18n", () => {
  it("returns a t function", () => {
    const { result } = renderHook(() => useAdminI18n());
    expect(typeof result.current.t).toBe("function");
  });

  it("returns the key as-is (mock setup returns keys)", () => {
    const { result } = renderHook(() => useAdminI18n());
    expect(result.current.t("placeholder.admin-title")).toBe("placeholder.admin-title");
  });

  it("exposes i18n instance with language", () => {
    const { result } = renderHook(() => useAdminI18n());
    expect(result.current.i18n.language).toBe("en");
  });
});
