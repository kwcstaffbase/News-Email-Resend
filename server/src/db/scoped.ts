/**
 * Tenant-scoped query helpers.
 *
 * Every table that carries an `instance_id` column must be filtered to the
 * current tenant on every query.  Relying on every developer remembering to
 * add `.where(eq(table.instanceId, instanceId))` is fragile; this module makes
 * the predicate a first-class object that is built once and composed into
 * queries with Drizzle's `and()` helper.
 *
 * Usage in a route handler:
 *
 *   const { where } = c.var.scopedDb;
 *   const rows = await db.select().from(settings).where(where.settings);
 *
 * The `scopedDb` object is set on every authenticated request by `ssoMiddleware`
 * (including the IS_LOCALDEV bypass path), so it is always available inside any
 * route that sits behind `ssoMiddleware`.
 */

import { eq, type SQL } from "drizzle-orm";
import { changelog, items, sessions, settings, users } from "./schema.ts";

export type ScopedDb = {
  /** Current tenant identifier — use this instead of `c.var.user.instanceId` for DB operations. */
  readonly instanceId: string;
  /**
   * Pre-built Drizzle `eq()` predicates for every tenant-scoped table.
   * Compose with `and()` when you need additional filters.
   */
  readonly where: {
    readonly users: SQL;
    readonly sessions: SQL;
    readonly settings: SQL;
    readonly items: SQL;
    readonly changelog: SQL;
  };
};

/**
 * Build a ScopedDb for the given instance.
 * Called once per request by ssoMiddleware and stored on the Hono context.
 */
export function createScopedDb(instanceId: string): ScopedDb {
  return {
    instanceId,
    where: {
      users: eq(users.instanceId, instanceId),
      sessions: eq(sessions.instanceId, instanceId),
      settings: eq(settings.instanceId, instanceId),
      items: eq(items.instanceId, instanceId),
      changelog: eq(changelog.instanceId, instanceId),
    },
  };
}
