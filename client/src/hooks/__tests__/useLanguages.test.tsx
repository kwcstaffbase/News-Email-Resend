import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as tokenModule from "../../token.ts"; // kept: used in the embedded-path describe block
import { useLanguages } from "../useLanguages.ts";

// useLanguages calls getBranchLanguages/getBranchDefaultLanguage from the SDK
// (mocked in setup.ts to return { en: {locale:"en_US"}, de: {locale:"de_DE"} }).
// Two paths exist:
//   - localdev:  getToken() === "dev"         → reads VITE_DEV_LANGUAGES env, skips SDK
//   - embedded:  getToken() !== "dev" AND parent !== self → fires SDK query

vi.mock("../../token.ts", () => ({
  getToken: vi.fn().mockReturnValue("dev"),
  setToken: vi.fn(),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ─── Localdev path ────────────────────────────────────────────────────────────

describe("useLanguages — localdev path (getToken() === 'dev')", () => {
  it("returns dev languages without calling the SDK", () => {
    const { result } = renderHook(() => useLanguages(), { wrapper });
    // VITE_DEV_LANGUAGES defaults to "en_US" when not set in the test environment
    expect(result.current.languages).toContain("en_US");
    expect(result.current.defaultLanguage).toBe("en_US");
  });

  it("exposes currentLanguage state and setCurrentLanguage setter", () => {
    const { result } = renderHook(() => useLanguages(), { wrapper });
    expect(typeof result.current.currentLanguage).toBe("string");
    expect(typeof result.current.setCurrentLanguage).toBe("function");
  });

  it("initialises currentLanguage to the first dev language", () => {
    const { result } = renderHook(() => useLanguages(), { wrapper });
    // First entry of VITE_DEV_LANGUAGES (or fallback "en_US")
    expect(result.current.currentLanguage).toBe(result.current.defaultLanguage);
  });

  it("updates currentLanguage when setCurrentLanguage is called", async () => {
    const { result } = renderHook(() => useLanguages(), { wrapper });
    act(() => {
      result.current.setCurrentLanguage("de_DE");
    });
    await waitFor(() => expect(result.current.currentLanguage).toBe("de_DE"));
  });
});

// ─── Embedded (SDK) path ──────────────────────────────────────────────────────

describe("useLanguages — embedded path (SDK active)", () => {
  // vi.mock() hoists the mock, so importing the module here gives the mocked version.
  const getToken = vi.mocked(tokenModule.getToken);

  // Simulate running inside an iframe so isEmbedded = true
  beforeEach(() => {
    getToken.mockReturnValue("eyJhbGciOiJIUzI1NiJ9.e30.signature"); // non-"dev" token
    Object.defineProperty(globalThis, "parent", {
      get: () => ({}) as Window, // parent !== self → isEmbedded = true
      configurable: true,
    });
  });

  afterEach(() => {
    getToken.mockReturnValue("dev"); // restore default for other tests
    Object.defineProperty(globalThis, "parent", {
      get: () => globalThis.self,
      configurable: true,
    });
  });

  it("derives languages from getBranchLanguages() SDK response", async () => {
    const { result } = renderHook(() => useLanguages(), { wrapper });
    await waitFor(() => expect(result.current.languages).toHaveLength(2));
    expect(result.current.languages).toContain("en_US");
    expect(result.current.languages).toContain("de_DE");
  });

  it("derives defaultLanguage from getBranchDefaultLanguage() SDK response", async () => {
    const { result } = renderHook(() => useLanguages(), { wrapper });
    await waitFor(() => expect(result.current.defaultLanguage).toBe("en_US"));
  });

  it("sets currentLanguage to defaultLanguage once SDK data loads", async () => {
    const { result } = renderHook(() => useLanguages(), { wrapper });
    await waitFor(() => expect(result.current.currentLanguage).toBe("en_US"));
  });

  it("reflects a different defaultLanguage when the SDK returns de_DE as default", async () => {
    const { getBranchDefaultLanguage, getUserContentLocale } = await import(
      "@staffbase/plugins-client-sdk"
    );
    vi.mocked(getBranchDefaultLanguage).mockResolvedValueOnce({
      locale: "de_DE",
      key: "de",
      name: "Deutsch",
      localizedName: "German",
    });
    // User's content locale also de_DE — currentLanguage should follow getUserContentLocale
    vi.mocked(getUserContentLocale).mockResolvedValueOnce("de_DE");

    const { result } = renderHook(() => useLanguages(), { wrapper });
    await waitFor(() => expect(result.current.currentLanguage).toBe("de_DE"));
    expect(result.current.defaultLanguage).toBe("de_DE");
  });

  it("sets currentLanguage from getUserContentLocale() independent of branch default", async () => {
    const { getUserContentLocale } = await import("@staffbase/plugins-client-sdk");
    // Branch default stays en_US (global mock), but user prefers de_DE
    vi.mocked(getUserContentLocale).mockResolvedValueOnce("de_DE");

    const { result } = renderHook(() => useLanguages(), { wrapper });
    await waitFor(() => expect(result.current.currentLanguage).toBe("de_DE"));
    expect(result.current.defaultLanguage).toBe("en_US"); // branch default unchanged
  });

  it("falls back to branch default when user locale is not in branch languages", async () => {
    const { getUserContentLocale } = await import("@staffbase/plugins-client-sdk");
    // User has es_ES but branch only has en_US + de_DE
    vi.mocked(getUserContentLocale).mockResolvedValueOnce("es_ES");

    const { result } = renderHook(() => useLanguages(), { wrapper });
    // Falls back to branch default (en_US)
    await waitFor(() => expect(result.current.currentLanguage).toBe("en_US"));
  });

  it("falls back to browser language when user locale is absent and branch default is unsupported", async () => {
    const { getBranchDefaultLanguage, getBranchLanguages, getUserContentLocale } = await import(
      "@staffbase/plugins-client-sdk"
    );
    // Branch only has de_DE and fr_FR; default is fr_FR but browser says "de-DE"
    vi.mocked(getBranchLanguages).mockResolvedValueOnce({
      de: { locale: "de_DE", key: "de", name: "Deutsch", localizedName: "German" },
      fr: { locale: "fr_FR", key: "fr", name: "Français", localizedName: "French" },
    });
    vi.mocked(getBranchDefaultLanguage).mockResolvedValueOnce({
      locale: "xx_XX", // unsupported default (edge case)
      key: "xx",
      name: "Unknown",
      localizedName: "Unknown",
    });
    vi.mocked(getUserContentLocale).mockResolvedValueOnce("xx_XX"); // unsupported user locale
    // Simulate browser language = German
    Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });

    const { result } = renderHook(() => useLanguages(), { wrapper });
    await waitFor(() => expect(result.current.currentLanguage).toBe("de_DE"));
  });
});
