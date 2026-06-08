/**
 * Test-data helpers that produce unique names to avoid cross-test state leakage.
 *
 * Extend with plugin-specific generators as you add tables.
 */

export function uniqueName(prefix = "entity"): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
