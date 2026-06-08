import { Hono } from "hono";
import { db } from "../db/client.ts";
import { settings } from "../db/schema.ts";
import { buildUserName, logChange } from "../lib/changelog.ts";
import { decrypt, encrypt } from "../lib/crypto.ts";
import { invalidateInstanceSettingsCache } from "../lib/user-cache.ts";
import { requireEditor, ssoMiddleware } from "../middleware/sso.ts";
import type { AppEnv } from "../types/hono.ts";

export const settingsRoute = new Hono<AppEnv>();

settingsRoute.use(ssoMiddleware);

// GET /api/settings
// Returns the current instance's settings.
// apiToken is never returned in plaintext — only a boolean indicating whether one is configured.
settingsRoute.get("/", async (c) => {
  const { where } = c.var.scopedDb;

  const [row] = await db.select().from(settings).where(where.settings).limit(1);

  return c.json({
    staffbaseUrl: row?.staffbaseUrl ?? null,
    hasApiToken: Boolean(row?.apiToken),
    emailServiceUrl: row?.emailServiceUrl ?? null,
  });
});

// GET /api/settings/token
// Editor-only. Returns the decrypted API token for this instance so an admin
// can verify which token is currently stored.
settingsRoute.get("/token", requireEditor, async (c) => {
  const { where } = c.var.scopedDb;

  const [row] = await db.select().from(settings).where(where.settings).limit(1);

  const plaintext = row?.apiToken ? decrypt(row.apiToken) : null;
  return c.json({ apiToken: plaintext });
});

// PUT /api/settings
// Editor-only. Saves Staffbase host URL, API token, and/or email service URL.
// Accepts any subset of: { staffbaseUrl?, apiToken?, emailServiceUrl? }.
// Passing null clears a field. Omitting a field leaves it unchanged.
settingsRoute.put("/", requireEditor, async (c) => {
  const { instanceId, where } = c.var.scopedDb;
  const body = await c.req.json<Record<string, unknown>>();

  const staffbaseUrlResult = parseStaffbaseUrl(body);
  if (staffbaseUrlResult.error) {
    return c.json({ error: staffbaseUrlResult.error }, 400);
  }

  const apiTokenResult = parseApiToken(body);
  if (apiTokenResult.error) {
    return c.json({ error: apiTokenResult.error }, 400);
  }

  const emailServiceUrlResult = parseEmailServiceUrl(body);
  if (emailServiceUrlResult.error) {
    return c.json({ error: emailServiceUrlResult.error }, 400);
  }

  const [existing] = await db.select().from(settings).where(where.settings).limit(1);

  const now = new Date();
  const newStaffbaseUrl = staffbaseUrlResult.value ?? existing?.staffbaseUrl ?? null;
  const newApiToken = apiTokenResult.value ?? existing?.apiToken ?? null;
  const newEmailServiceUrl = emailServiceUrlResult.value ?? existing?.emailServiceUrl ?? null;

  await db
    .insert(settings)
    .values({
      instanceId,
      staffbaseUrl: newStaffbaseUrl,
      apiToken: newApiToken,
      emailServiceUrl: newEmailServiceUrl,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settings.instanceId,
      set: {
        staffbaseUrl: newStaffbaseUrl,
        apiToken: newApiToken,
        emailServiceUrl: newEmailServiceUrl,
        updatedAt: now,
      },
    });

  // Drop the per-instance settings memo + every warm ACCESSOR_VERIFIED_CACHE
  // entry for this instance so a credential rotation (apiToken revocation) or
  // staffbaseUrl change takes effect on the very next request, instead of
  // waiting up to REVALIDATE_SECONDS for the gate to expire.
  invalidateInstanceSettingsCache(instanceId);

  const changedFields: string[] = [];
  if ("staffbaseUrl" in body) changedFields.push("staffbaseUrl");
  if ("apiToken" in body) changedFields.push("apiToken");
  if ("emailServiceUrl" in body) changedFields.push("emailServiceUrl");

  const { userId, firstName, lastName, userName: fullName } = c.var.user;
  void logChange({
    instanceId,
    userId,
    userName: buildUserName(userId, firstName, lastName, fullName),
    action: "settings_updated",
    entityType: "settings",
    summary: `Updated settings (${changedFields.join(", ")})`,
    payload: { changedFields },
    gdprRelevant: changedFields.includes("apiToken"),
  });

  return c.json({
    staffbaseUrl: newStaffbaseUrl,
    hasApiToken: Boolean(newApiToken),
    emailServiceUrl: newEmailServiceUrl,
  });
});

type ParseResult<T> = { value: T; error?: never } | { value?: never; error: string };

// Returns the validated URL string, null (clear), or undefined (field absent).
function parseStaffbaseUrl(body: Record<string, unknown>): ParseResult<string | null | undefined> {
  if (!("staffbaseUrl" in body)) return { value: undefined };
  const raw = body.staffbaseUrl;
  if (raw === null) return { value: null };
  if (typeof raw === "string") {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { error: "staffbaseUrl must be a valid URL" };
    }
    if (parsed.protocol === "https:") return { value: raw };
    return { error: "staffbaseUrl must use HTTPS" };
  }
  return { error: "staffbaseUrl must be a string or null" };
}

// Returns the encrypted token, null (clear), or undefined (field absent).
function parseApiToken(body: Record<string, unknown>): ParseResult<string | null | undefined> {
  if (!("apiToken" in body)) return { value: undefined };
  const raw = body.apiToken;
  if (raw === null || raw === "") return { value: null };
  if (typeof raw === "string") return { value: encrypt(raw) };
  return { error: "apiToken must be a string or null" };
}

// Returns the validated email service URL string, null (clear), or undefined (field absent).
function parseEmailServiceUrl(
  body: Record<string, unknown>
): ParseResult<string | null | undefined> {
  if (!("emailServiceUrl" in body)) return { value: undefined };
  const raw = body.emailServiceUrl;
  if (raw === null || raw === "") return { value: null };
  if (typeof raw === "string") {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return { error: "emailServiceUrl must be a valid URL" };
    }
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return { value: raw };
    return { error: "emailServiceUrl must use HTTP or HTTPS" };
  }
  return { error: "emailServiceUrl must be a string or null" };
}
