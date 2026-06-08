import { and, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { changelog, items, sessions, settings, users } from "../db/schema.ts";
import { createLogger } from "./logger.ts";

const remoteLogger = createLogger("remote-call");

/**
 * Clean up all data belonging to a deleted user — scoped to one instance.
 *
 * Called by the SCIM refresh cycle when a userId is no longer returned by
 * Staffbase, and by the deleteInstance path for every user in the instance.
 *
 * **Transactional**: every statement runs inside a single `db.transaction(...)`
 * — either every step commits or none do. Without this, a partial failure
 * (e.g. DB connection drop mid-delete) would leave inconsistent state such as
 * a `users` row removed but `changelog.user_id` still referencing the dead
 * userId. `revalidateAccessor` retries cleanly because the transaction is
 * all-or-nothing.
 *
 * Every WHERE clause is scoped by BOTH `instanceId` AND `userId`. The DB
 * schema does not have a UNIQUE(instance_id, user_id) composite key on
 * `users` — `users.user_id` is a single-column PRIMARY KEY — but defence-
 * in-depth is cheap: scoping by instanceId guarantees we cannot touch
 * another tenant's rows even if the schema ever grows multi-tenant data
 * on tables that share user_id values.
 *
 * - Removes the user's active sessions in this instance
 * - Removes the user row from the display-name cache for this instance
 * - Nullifies user_id in changelog (keep user_name snapshot for audit trail context)
 *
 * When you add plugin-specific tables that reference user_id, extend the
 * transaction to clean those rows up too — scoped by (instanceId, userId).
 */
export async function cleanupDeletedUser(instanceId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(sessions)
      .where(and(eq(sessions.instanceId, instanceId), eq(sessions.userId, userId)));
    await tx.delete(users).where(and(eq(users.instanceId, instanceId), eq(users.userId, userId)));
    await tx
      .update(changelog)
      .set({ userId: null })
      .where(and(eq(changelog.instanceId, instanceId), eq(changelog.userId, userId)));
  });
}

/**
 * Delete ALL data for a plugin instance (GDPR: remote deleteInstance call from Staffbase).
 *
 * Staffbase platform sends a JWT with `sub === "delete"` (userId === "delete")
 * to the plugin URL. The plugin must purge all instance data and return HTTP 200.
 * On failure (HTTP 500) Staffbase will retry.
 *
 * Runs inside a single DB transaction — all-or-nothing.
 * Returns true on success, false on any error (caller should return 500).
 *
 * When you add plugin-specific tables, extend the transaction to delete them
 * for this instance too. The order matters for tables with foreign keys.
 */
export async function deleteInstance(instanceId: string): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await tx.delete(items).where(eq(items.instanceId, instanceId));
      await tx.delete(settings).where(eq(settings.instanceId, instanceId));
      await tx.delete(users).where(eq(users.instanceId, instanceId));
      await tx.delete(sessions).where(eq(sessions.instanceId, instanceId));
      await tx.delete(changelog).where(eq(changelog.instanceId, instanceId));
    });
    remoteLogger.info("deleteInstance: purged all data for instance.", {
      instanceId,
    });
    return true;
  } catch (err) {
    remoteLogger.error("deleteInstance failed.", {
      instanceId,
      message: (err as Error).message,
    });
    return false;
  }
}
