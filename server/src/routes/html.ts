import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { UserProfile } from "../html.ts";
import { createLogger, redact } from "../lib/logger.ts";

const htmlLogger = createLogger("html");

import {
  buildFrameAncestors,
  injectSessionKey,
  injectTheme,
  injectToken,
  injectUser,
  readCustomerTheme,
  readIndexHtml,
} from "../html.ts";
import { createSession, deleteSession, extendSession, getSession } from "../lib/sessions.ts";
import { upsertStaffbaseUrl } from "../lib/staffbase-api.ts";
import { upsertUser } from "../lib/user-cache.ts";
import { extractRawToken, parseTokenUser, sessionCookieName } from "../middleware/sso.ts";
import type { AppEnv } from "../types/hono.ts";

const error401Page =
  "<!DOCTYPE html><html><head><title>Unauthorized</title></head><body><h1>401 Unauthorized</h1><p>A valid Staffbase JWT is required.</p></body></html>";

const error403Page =
  "<!DOCTYPE html><html><head><title>Forbidden</title></head><body><h1>403 Forbidden</h1><p>Editor role required to access this page.</p></body></html>";

function isLocalDev(): boolean {
  return Bun.env.IS_LOCALDEV === "true";
}

export const htmlRoutes = new Hono<AppEnv>();

/** Validate JWT and return full user object, or null on failure. */
function resolveUser(c: Context<AppEnv>): (UserProfile & { rawToken: string }) | null {
  const rawToken = extractRawToken(c);
  if (!rawToken) return null;
  const user = parseTokenUser(rawToken);
  if (!user) return null;
  return { ...user, pluginId: Bun.env.PLUGIN_ID ?? "", rawToken };
}

/**
 * Build the synthetic dev user for IS_LOCALDEV=true page loads.
 * Per-request X-Dev-* headers override the corresponding env var defaults so
 * that multi-user / multi-tenant scenarios can be exercised without a server
 * restart. Header overrides are ONLY read when IS_LOCALDEV=true (checked by
 * the caller — never in production).
 */
function buildDevUser(c: Context<AppEnv>): UserProfile {
  const instanceId = c.req.header("X-Dev-Instance-Id") ?? "dev-instance";
  const roleRaw = c.req.header("X-Dev-User-Role") ?? Bun.env.LOCALDEV_ROLE;
  return {
    userId: c.req.header("X-Dev-User-Id") ?? Bun.env.LOCALDEV_USER_ID ?? "local-user-1",
    userName: Bun.env.LOCALDEV_USER_NAME ?? "Local Dev User",
    instanceId,
    pluginId: Bun.env.PLUGIN_ID ?? "dev-plugin",
    role: roleRaw === "editor" ? "editor" : "user",
    firstName: null,
    lastName: null,
    locale: Bun.env.LOCALDEV_LOCALE ?? null,
    type: "user",
    branchId: null,
    externalId: null,
    issuerDomain: null,
    branchSlug: c.req.header("X-Dev-Branch-Slug") ?? Bun.env.LOCALDEV_BRANCH_SLUG ?? "_default",
    staffbaseSessionHash: null,
  };
}

/**
 * After JWT validation: upsert user cache, reuse or (re)create server-side
 * session, set per-instance sid cookie.
 *
 * On every page load Staffbase delivers a fresh JWT. Rather than inserting a
 * new session row on every load we check whether there is already a valid
 * session that belongs to this user+instance+role+platformSession combination
 * and reuse it (slide its TTL). A new row is only created when:
 *   - no sid cookie is present, OR
 *   - the cookie points to an expired / unknown session, OR
 *   - the stored session's userId, instanceId, role, or staffbaseSessionHash
 *     no longer match the fresh JWT claims (role change, re-login on platform).
 *
 * Returns the session ID so callers can inject it as window.__SESSION_KEY__
 * for the Safari ITP fallback path.
 */
async function issueSession(c: Context<AppEnv>, user: UserProfile): Promise<string> {
  await upsertUser({
    userId: user.userId,
    instanceId: user.instanceId,
    userName: user.userName,
    firstName: user.firstName,
    lastName: user.lastName,
  });

  const ttlSeconds = (Number(Bun.env.SESSION_TTL_HOURS) || 8) * 3600;
  const cookieName = sessionCookieName(user.instanceId);

  // --- Try to reuse an existing session -----------------------------------------------
  const existingSid = getCookie(c, cookieName);
  if (existingSid) {
    const existing = await getSession(existingSid);
    if (existing) {
      const hashMatches =
        user.staffbaseSessionHash === null || // no hash in token (edge case) → skip hash check
        existing.staffbaseSessionHash === user.staffbaseSessionHash;

      if (
        existing.userId === user.userId &&
        existing.instanceId === user.instanceId &&
        existing.role === user.role &&
        hashMatches
      ) {
        // Valid, matching session — slide the TTL and refresh the cookie Max-Age.
        await extendSession(existingSid);
        // When SESSION_SLIDING=true the DB expiry was just reset to NOW()+TTL, so
        // the full ttlSeconds is correct. When SESSION_SLIDING=false extendSession
        // is a no-op, so cap the cookie to the actual remaining DB lifetime to
        // avoid sending a cookie that appears valid long after the session expires.
        const sliding = Bun.env.SESSION_SLIDING !== "false";
        const cookieMaxAge = sliding
          ? ttlSeconds
          : Math.max(1, Math.ceil((existing.expiresAt.getTime() - Date.now()) / 1000));
        setCookie(c, cookieName, existingSid, {
          httpOnly: true,
          secure: true,
          sameSite: "None",
          path: "/",
          maxAge: cookieMaxAge,
        });
        return existingSid;
      }

      // Session exists but something changed — delete stale row before creating a new one.
      await deleteSession(existingSid);
    }
  }

  // --- Create a fresh session ----------------------------------------------------------
  const sessionId = await createSession({
    userId: user.userId,
    instanceId: user.instanceId,
    role: user.role,
    staffbaseSessionHash: user.staffbaseSessionHash,
  });

  // Use a per-instance cookie name so that two instances of the same plugin
  // loaded in the same browser do not share a session cookie.  The middleware
  // also checks the legacy "sid" cookie for backwards compatibility.
  setCookie(c, cookieName, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/",
    maxAge: ttlSeconds,
  });
  return sessionId;
}

htmlRoutes.get("/", async (c) => {
  if (isLocalDev()) {
    const devUser = buildDevUser(c);
    const html = await readIndexHtml();
    const themeCss = await readCustomerTheme(devUser.branchSlug ?? "_default");
    const themed = themeCss ? injectTheme(html, themeCss) : html;
    c.header("Cache-Control", "no-store");
    return c.html(injectUser(injectToken(themed, "dev"), devUser));
  }

  const result = resolveUser(c);
  if (!result) return c.html(error401Page, 401);

  htmlLogger.trace("SSO page load.", {
    route: "/",
    userId: result.userId,
    instanceId: result.instanceId,
    role: result.role,
    branchId: result.branchId,
    jwt: redact(result.rawToken),
  });

  const sessionId = await issueSession(c, result);
  if (result.issuerDomain) void upsertStaffbaseUrl(result.instanceId, result.issuerDomain);
  const html = await readIndexHtml();
  const themeCss = await readCustomerTheme(result.branchSlug ?? "_default");
  const themed = themeCss ? injectTheme(html, themeCss) : html;
  c.header("Cache-Control", "no-store");
  c.header("Content-Security-Policy", buildFrameAncestors(result.issuerDomain));
  return c.html(
    injectSessionKey(injectUser(injectToken(themed, result.rawToken), result), sessionId)
  );
});

htmlRoutes.get("/admin", async (c) => {
  if (isLocalDev()) {
    const devUser = buildDevUser(c);
    if (devUser.role !== "editor") return c.html(error403Page, 403);
    const html = await readIndexHtml();
    const themeCss = await readCustomerTheme(devUser.branchSlug ?? "_default");
    const themed = themeCss ? injectTheme(html, themeCss) : html;
    c.header("Cache-Control", "no-store");
    return c.html(injectUser(injectToken(themed, "dev"), devUser));
  }

  const result = resolveUser(c);
  if (!result) return c.html(error401Page, 401);
  if (result.role !== "editor") return c.html(error403Page, 403);

  htmlLogger.trace("SSO page load.", {
    route: "/admin",
    userId: result.userId,
    instanceId: result.instanceId,
    role: result.role,
    branchId: result.branchId,
    jwt: redact(result.rawToken),
  });

  const sessionId = await issueSession(c, result);
  if (result.issuerDomain) void upsertStaffbaseUrl(result.instanceId, result.issuerDomain);
  const html = await readIndexHtml();
  const themeCss = await readCustomerTheme(result.branchSlug ?? "_default");
  const themed = themeCss ? injectTheme(html, themeCss) : html;
  c.header("Cache-Control", "no-store");
  c.header("Content-Security-Policy", buildFrameAncestors(result.issuerDomain));
  return c.html(
    injectSessionKey(injectUser(injectToken(themed, result.rawToken), result), sessionId)
  );
});

htmlRoutes.get("/dev", async (c) => {
  if (!isLocalDev()) return c.notFound();

  const devUser = buildDevUser(c);
  const html = await readIndexHtml();
  const themeCss = await readCustomerTheme(devUser.branchSlug ?? "_default");
  const themed = themeCss ? injectTheme(html, themeCss) : html;
  return c.html(injectUser(injectToken(themed, "dev"), devUser));
});
