import { Hono } from "hono";
import { db } from "../db/client.ts";
import { items, settings } from "../db/schema.ts";
import { buildUserName, logChange } from "../lib/changelog.ts";
import { requireEditor, ssoMiddleware } from "../middleware/sso.ts";
import type { AppEnv } from "../types/hono.ts";

export const adminRoute = new Hono<AppEnv>();

adminRoute.use(ssoMiddleware);

// DELETE /api/admin/clear-all
// Permanently deletes the settings + items rows for the current instance.
// Extend this transaction with additional table deletes when you add plugin-
// specific tables.
adminRoute.delete("/clear-all", requireEditor, async (c) => {
  const { instanceId, where } = c.var.scopedDb;
  const { userId, firstName, lastName } = c.var.user;

  await db.transaction(async (tx) => {
    await tx.delete(items).where(where.items);
    await tx.delete(settings).where(where.settings);
  });

  void logChange({
    instanceId,
    userId,
    userName: buildUserName(userId, firstName, lastName, c.var.user.userName),
    action: "clear_all",
    entityType: "system",
    summary: "Cleared all data",
    gdprRelevant: true,
  });

  return c.body(null, 204);
});
