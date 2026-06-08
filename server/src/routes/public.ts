import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "../db/client.ts";
import { settings } from "../db/schema.ts";

export const publicRoute = new Hono();

// Allow cross-origin GET from any Staffbase domain — this route is intentionally
// unauthenticated and returns only non-sensitive instance metadata (IDs + host URLs
// that are already present in publicly shared content links).
publicRoute.use("/instance", cors({ origin: "*", allowMethods: ["GET"], allowHeaders: [] }));

// GET /api/public/instance
// Returns the plugin ID and all known instance IDs with their Staffbase host URLs.
// Intentionally unauthenticated — values are non-sensitive metadata.
publicRoute.get("/instance", async (c) => {
  const pluginId = Bun.env.PLUGIN_ID ?? "";

  const rows = await db
    .select({ instanceId: settings.instanceId, staffbaseUrl: settings.staffbaseUrl })
    .from(settings);

  return c.json({
    pluginId,
    instances: rows.map((r) => ({
      instanceId: r.instanceId,
      staffbaseUrl: r.staffbaseUrl ?? null,
    })),
  });
});
