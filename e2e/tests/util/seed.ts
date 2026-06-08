/**
 * Re-usable seed utility.
 *
 * The template ships with no seed data — `reseed()` is a no-op. When you add
 * plugin-specific tables, wire this up to your localdev seed endpoint (e.g.
 * `POST /api/localdev/seed`) and call it from `e2e/global-setup.ts` and any
 * mutating describe blocks.
 */
export async function reseed(): Promise<void> {
  // no-op
}
