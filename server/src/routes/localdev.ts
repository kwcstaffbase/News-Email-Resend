import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import { refreshAllUsers, refreshSingleUser } from "../lib/user-cache.ts";
import { clearAll, seed } from "../seed.ts";
import type { AppEnv } from "../types/hono.ts";

export const localdevRoute = new Hono<AppEnv>();

// Mounted only when IS_LOCALDEV=true (see app.ts).

localdevRoute.get("/ping", (c) => c.json({ ok: true }));

localdevRoute.post("/seed", async (c) => {
  try {
    const message = await seed();
    return c.json({ ok: true, message });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

localdevRoute.post("/clear", async (c) => {
  try {
    const message = await clearAll();
    return c.json({ ok: true, message });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ ok: false, error: message }, 500);
  }
});

// ─── User cache inspection routes (localdev only) ────────────────────────────
// These let you drive the background SCIM refresh on demand and peek at the
// cached rows without waiting for the next interval tick. Useful for verifying
// the loop wiring in server/src/index.ts.

localdevRoute.get("/user-cache", async (c) => {
  const rows = await db.select().from(users).orderBy(users.userId);
  return c.json({ ok: true, rows });
});

localdevRoute.get("/user-cache/stats", async (c) => {
  const rows = await db.select().from(users);
  const total = rows.length;
  const active = rows.filter((r) => r.status === "active").length;
  const deleted = rows.filter((r) => r.status === "deleted").length;
  // stale = not refreshed in the last USER_CACHE_REFRESH_HOURS
  const refreshHours = Number(Bun.env.USER_CACHE_REFRESH_HOURS) || 2.5;
  const staleThreshold = new Date(Date.now() - refreshHours * 60 * 60 * 1000);
  const staleCount = rows.filter((r) => r.updatedAt < staleThreshold).length;
  return c.json({ ok: true, stats: { total, active, deleted, staleCount } });
});

localdevRoute.post("/user-cache/refresh", async (c) => {
  const stats = await refreshAllUsers();
  return c.json({ ok: true, stats });
});

const userIdParam = z.object({ userId: z.string().min(1) });

localdevRoute.post("/user-cache/refresh/:userId", zValidator("param", userIdParam), async (c) => {
  const { userId } = c.req.valid("param");
  const existing = await db.select().from(users).where(eq(users.userId, userId)).limit(1);

  if (existing.length === 0) {
    return c.json({ ok: false, error: "User not found in cache" }, 404);
  }

  const row = existing[0];
  try {
    const outcome = await refreshSingleUser(userId, row.instanceId);
    const updated = await db.select().from(users).where(eq(users.userId, userId)).limit(1);
    return c.json({ ok: true, outcome, row: updated[0] ?? null });
  } catch (err) {
    return c.json({ ok: false, error: (err as Error).message }, 500);
  }
});
