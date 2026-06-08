import { describe, expect, it, vi } from "vitest";
import { postLocaldev } from "../DevView.tsx";

describe("postLocaldev", () => {
  it("throws a clear HTTP-status error (not a JSON parse crash) when the endpoint returns a non-JSON body", async () => {
    // Reproduces the real bug: when /api/localdev is not mounted (NODE_ENV !==
    // "development"), the server returns a plain-text "404 Not Found" body.
    // JSON.parse("404 Not Found") throws "Unexpected non-whitespace character
    // after JSON at position 4" — a useless message. We want a clear status error.
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("404 Not Found", {
        status: 404,
        headers: { "content-type": "text/plain" },
      })
    );

    await expect(postLocaldev("seed", fetchFn as unknown as typeof fetch)).rejects.toThrow(
      /HTTP 404/
    );
    await expect(postLocaldev("seed", fetchFn as unknown as typeof fetch)).rejects.not.toThrow(
      /JSON|position/i
    );
  });

  it("returns the parsed result on a 200 JSON ok response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, message: "Seeded 20 items." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const result = await postLocaldev("seed", fetchFn as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    expect(result.message).toBe("Seeded 20 items.");
  });

  it("throws body.error when the server returns ok:false", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "seed boom" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(postLocaldev("clear", fetchFn as unknown as typeof fetch)).rejects.toThrow(
      "seed boom"
    );
  });
});
