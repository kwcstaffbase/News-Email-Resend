import { and, asc, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db/client.ts";
import { items } from "../db/schema.ts";
import { buildUserName, logChange } from "../lib/changelog.ts";
import { requireEditor, ssoMiddleware } from "../middleware/sso.ts";
import type { AppEnv } from "../types/hono.ts";

export const itemsRoute = new Hono<AppEnv>();

itemsRoute.use(ssoMiddleware);

const SORT_VALUES = ["name_asc", "name_desc", "newest", "oldest", "last_edited"] as const;
type SortOrder = (typeof SORT_VALUES)[number];

const STATUS_VALUES = ["active", "archived"] as const;
type ItemStatus = (typeof STATUS_VALUES)[number];

const CATEGORY_VALUES = ["general", "important", "internal", "external"] as const;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(250).optional().default(25),
  search: z.string().max(200).optional().default(""),
  sort: z.enum(SORT_VALUES).optional().default("name_asc"),
  status: z.enum(STATUS_VALUES).optional().default("active"),
  category: z.string().optional().default(""),
});

const itemBodySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  category: z.enum(CATEGORY_VALUES),
  status: z.enum(STATUS_VALUES).optional().default("active"),
});

function orderByFor(sort: SortOrder) {
  switch (sort) {
    case "name_asc":
      return asc(items.name);
    case "name_desc":
      return desc(items.name);
    case "newest":
      return desc(items.createdAt);
    case "oldest":
      return asc(items.createdAt);
    case "last_edited":
      return desc(items.updatedAt);
  }
}

// GET /api/items — paginated list with search/sort/filter
itemsRoute.get("/", async (c) => {
  const { where } = c.var.scopedDb;

  const parsed = listQuerySchema.safeParse({
    page: c.req.query("page"),
    limit: c.req.query("limit"),
    search: c.req.query("search"),
    sort: c.req.query("sort"),
    status: c.req.query("status"),
    category: c.req.query("category"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid query parameters" }, 400);
  }

  const { page, limit, search, sort, status, category } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [where.items, eq(items.status, status)];

  if (search) {
    const term = `%${search}%`;
    const matcher = or(ilike(items.name, term), ilike(items.description, term)) as SQL;
    conditions.push(matcher);
  }

  if (category) {
    const list = category.split(",").filter(Boolean);
    if (list.length === 1) {
      conditions.push(eq(items.category, list[0]));
    } else if (list.length > 1) {
      conditions.push(inArray(items.category, list));
    }
  }

  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

  const [{ total }] = await db.select({ total: count() }).from(items).where(whereClause);

  const rows = await db
    .select()
    .from(items)
    .where(whereClause)
    .orderBy(orderByFor(sort))
    .limit(limit)
    .offset(offset);

  return c.json({ data: rows, total, page, limit });
});

// GET /api/items/categories — count of items per category, scoped to current status
// (drives the category filter dropdown). Always returns all known categories so
// the dropdown options stay stable as items move between statuses.
itemsRoute.get("/categories", async (c) => {
  const { where } = c.var.scopedDb;
  const status = (c.req.query("status") as ItemStatus | undefined) ?? "active";

  const rows = await db
    .select({ category: items.category, total: count() })
    .from(items)
    .where(and(where.items, eq(items.status, status)))
    .groupBy(items.category);

  const counts = new Map<string, number>(rows.map((r) => [r.category, Number(r.total)]));
  return c.json({
    categories: CATEGORY_VALUES.map((id) => ({ id, count: counts.get(id) ?? 0 })),
  });
});

// POST /api/items — create
itemsRoute.post("/", requireEditor, async (c) => {
  const { instanceId } = c.var.scopedDb;
  const { userId, firstName, lastName, userName: fullName } = c.var.user;

  const body = await c.req.json<unknown>();
  const parsed = itemBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid item body", details: parsed.error.flatten() }, 400);
  }

  const now = new Date();
  const [inserted] = await db
    .insert(items)
    .values({
      instanceId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      category: parsed.data.category,
      status: parsed.data.status ?? "active",
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  void logChange({
    instanceId,
    userId,
    userName: buildUserName(userId, firstName, lastName, fullName),
    action: "item_created",
    entityType: "item",
    entityId: inserted.id,
    entityName: inserted.name,
    summary: `Created item "${inserted.name}"`,
    payload: { category: inserted.category, status: inserted.status },
  });

  return c.json(inserted, 201);
});

// PUT /api/items/:id — update
itemsRoute.put("/:id", requireEditor, async (c) => {
  const { instanceId, where } = c.var.scopedDb;
  const { userId, firstName, lastName, userName: fullName } = c.var.user;
  const id = c.req.param("id");

  const body = await c.req.json<unknown>();
  const parsed = itemBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid item body", details: parsed.error.flatten() }, 400);
  }

  const now = new Date();
  const [updated] = await db
    .update(items)
    .set({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      category: parsed.data.category,
      status: parsed.data.status ?? "active",
      updatedAt: now,
    })
    .where(and(where.items, eq(items.id, id)))
    .returning();

  if (!updated) return c.json({ error: "Item not found" }, 404);

  void logChange({
    instanceId,
    userId,
    userName: buildUserName(userId, firstName, lastName, fullName),
    action: "item_updated",
    entityType: "item",
    entityId: updated.id,
    entityName: updated.name,
    summary: `Updated item "${updated.name}"`,
    payload: { category: updated.category, status: updated.status },
  });

  return c.json(updated);
});

// DELETE /api/items/:id — delete
itemsRoute.delete("/:id", requireEditor, async (c) => {
  const { instanceId, where } = c.var.scopedDb;
  const { userId, firstName, lastName, userName: fullName } = c.var.user;
  const id = c.req.param("id");

  const [deleted] = await db
    .delete(items)
    .where(and(where.items, eq(items.id, id)))
    .returning();

  if (!deleted) return c.json({ error: "Item not found" }, 404);

  void logChange({
    instanceId,
    userId,
    userName: buildUserName(userId, firstName, lastName, fullName),
    action: "item_deleted",
    entityType: "item",
    entityId: deleted.id,
    entityName: deleted.name,
    summary: `Deleted item "${deleted.name}"`,
  });

  return c.body(null, 204);
});
