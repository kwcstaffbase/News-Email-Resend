import { and, count, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.ts";
import { changelog } from "../db/schema.ts";
import { requireEditor, ssoMiddleware } from "../middleware/sso.ts";
import type { AppEnv } from "../types/hono.ts";

export const changelogRoute = new Hono<AppEnv>();

changelogRoute.use(ssoMiddleware);

const changelogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(250).optional().default(50),
  action: z.string().optional(),
  entityType: z.string().optional(),
  search: z.string().max(200).optional().default(""),
});

// GET /api/changelog — paginated admin activity log (editor-only)
changelogRoute.get("/", requireEditor, async (c) => {
  const { where } = c.var.scopedDb;

  const queryResult = changelogQuerySchema.safeParse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
    action: c.req.query("action"),
    entityType: c.req.query("entityType"),
    search: c.req.query("search"),
  });

  if (!queryResult.success) {
    return c.json({ error: "Invalid query parameters" }, 400);
  }

  const { page, limit, action, entityType, search } = queryResult.data;
  const offset = (page - 1) * limit;

  const conditions = [where.changelog];

  if (action) {
    conditions.push(eq(changelog.action, action));
  }
  if (entityType) {
    const types = entityType.split(",").filter(Boolean);
    if (types.length === 1) {
      conditions.push(eq(changelog.entityType, types[0]));
    } else if (types.length > 1) {
      conditions.push(inArray(changelog.entityType, types));
    }
  }
  if (search) {
    const term = `%${search}%`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conditions.push(or(ilike(changelog.summary, term), ilike(changelog.entityName, term)) as any);
  }

  const filterWhere = conditions.length === 1 ? conditions[0] : and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(changelog).where(filterWhere);

  const rows = await db
    .select()
    .from(changelog)
    .where(filterWhere)
    .orderBy(desc(changelog.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ data: rows, total, page, limit });
});

// GET /api/changelog/export — download the full changelog as NDJSON (editor-only)
changelogRoute.get("/export", requireEditor, async (c) => {
  const { where } = c.var.scopedDb;

  const rows = await db
    .select()
    .from(changelog)
    .where(where.changelog)
    .orderBy(desc(changelog.createdAt));

  const lines = rows.map((r) => JSON.stringify(r)).join("\n");
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", `attachment; filename="audit-log-${dateStr}.json"`);
  return c.body(lines);
});
