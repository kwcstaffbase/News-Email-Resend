import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { useInstanceSettings } from "../useInstanceSettings.ts";

const defaultSettings = {
  staffbaseUrl: "https://co.staffbase.com",
  hasApiToken: true,
};

const server = setupServer(http.get("/api/settings", () => HttpResponse.json(defaultSettings)));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe("useInstanceSettings", () => {
  it("returns loaded settings from API", async () => {
    const { result } = renderHook(() => useInstanceSettings(), { wrapper });
    await waitFor(() => expect(result.current.hasApiToken).toBe(true));
    expect(result.current.staffbaseUrl).toBe("https://co.staffbase.com");
  });

  it("returns safe defaults while loading (before API response)", () => {
    const { result } = renderHook(() => useInstanceSettings(), { wrapper });
    // Before the query resolves, safe defaults should be returned
    expect(result.current.hasApiToken).toBe(false);
    expect(result.current.staffbaseUrl).toBeNull();
  });

  it("returns hasApiToken=false when server returns false", async () => {
    server.use(
      http.get("/api/settings", () => HttpResponse.json({ staffbaseUrl: null, hasApiToken: false }))
    );
    const { result } = renderHook(() => useInstanceSettings(), { wrapper });
    await waitFor(() => expect(result.current.hasApiToken).toBe(false));
    expect(result.current.staffbaseUrl).toBeNull();
  });
});
