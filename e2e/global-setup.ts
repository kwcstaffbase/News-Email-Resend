import type { FullConfig } from "@playwright/test";

/**
 * Pre-test setup: wait for the server to be ready.
 * The template ships with no seed data — when you add plugin-specific tables,
 * extend this script (and `tests/util/seed.ts`) with the seed call.
 */
export default async function globalSetup(_config: FullConfig) {
  const apiBase = "http://localhost:3000";

  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${apiBase}/health`);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // Readiness never succeeded — fail loudly here so CI reports the real cause
  // instead of letting the suite proceed and fail later with opaque
  // navigation/API errors.
  throw new Error(
    `globalSetup: server at ${apiBase} not ready after 30s (GET /health never returned ok)`
  );
}
