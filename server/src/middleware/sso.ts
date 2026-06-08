// @ts-expect-error — @staffbase/staffbase-plugin-sdk is a private package; install with NPM_TOKEN
import { sso as SSOToken } from "@staffbase/staffbase-plugin-sdk";
import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { createScopedDb } from "../db/scoped.ts";
import { createLogger, redact } from "../lib/logger.ts";
import type { Session } from "../lib/sessions.ts";
import { deleteSession, extendSession, getSession } from "../lib/sessions.ts";
import { upsertStaffbaseUrl } from "../lib/staffbase-api.ts";
import { revalidateAccessor } from "../lib/user-cache.ts";
import type { AppEnv } from "../types/hono.ts";

const PLUGIN_ID = Bun.env.PLUGIN_ID ?? "";
// Staffbase provides the public key as a raw base64 string. The SDK's SSOToken
// constructor passes it to jsonwebtoken.verify() which requires PEM format.
// The SDK's own Express middleware calls helpers.transformKeyToFormat() — we
// replicate that logic here to avoid CJS/ESM import issues with the helpers module.
function toPem(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  // Already PEM-wrapped
  if (trimmed.includes("-----BEGIN PUBLIC KEY-----")) return trimmed;
  // Raw base64 — wrap in PEM headers with 64-char line breaks
  const lines = trimmed.match(/.{1,64}/g) ?? [];
  return ["-----BEGIN PUBLIC KEY-----", ...lines, "-----END PUBLIC KEY-----"].join("\n");
}

const PUBLIC_KEY = toPem(Bun.env.PUBLIC_KEY ?? "");

// ── Shared helpers (also used by html.ts) ─────────────────────────────────────

/**
 * Derive a per-instance session cookie name from the instance ID.
 *
 * Cookie names are shared across all iframes that load the same plugin origin,
 * so a single "sid" cookie would be overwritten every time a new instance
 * initialises — causing all instances to run under whichever instanceId last
 * set the cookie.  Scoping the name to the instance ID lets each instance
 * maintain its own session in the browser.
 *
 * RFC 6265 restricts cookie names to US-ASCII visible chars minus separators;
 * we replace anything outside [a-zA-Z0-9_-] to stay safely within that range.
 */
export function sessionCookieName(instanceId: string): string {
  return `sid-${instanceId.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/**
 * Decode the instance_id claim from a JWT payload without verifying the
 * signature or expiry.  Used only to identify which per-instance session
 * cookie to look for when the Bearer JWT itself is already expired.
 * Never use the returned value for authorisation — validate the session
 * from the database before trusting it.
 */
function decodeJwtInstanceId(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    // Staffbase JWTs carry the instance ID under the `instance_id` claim.
    const value = payload.instance_id;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/**
 * Extract raw JWT from the ?jwt= query param.
 *
 * The Staffbase platform delivers the JWT via ?jwt= on the initial page load.
 * Subsequent API calls are authenticated primarily via the Authorization:
 * Bearer header (the client resends the page-load JWT with every request)
 * and fall back to the per-instance session cookie when the JWT has expired.
 *
 * Staffbase appends &eyosso=<token> to the same query string. If the &
 * is percent-encoded (%26), URL parsing merges both values into the jwt
 * parameter. JWTs only contain base64url chars (A-Za-z0-9, -, _, .) so
 * we strip everything from the first & to isolate the real token.
 */
export function extractRawToken(c: Context<AppEnv>): string | undefined {
  const raw = c.req.query("jwt");
  if (!raw) return undefined;
  const ampIdx = raw.indexOf("&");
  return ampIdx >= 0 ? raw.substring(0, ampIdx) : raw;
}

/**
 * Validate a raw JWT with Staffbase's SSOToken and extract the role.
 * Returns null on validation failure (expired, invalid signature, etc.).
 */
export function parseTokenRole(rawToken: string): "editor" | "user" | null {
  try {
    const ssoToken = new SSOToken(PLUGIN_ID, PUBLIC_KEY, rawToken);
    const tokenData = ssoToken.getTokenData();
    const rawRole = tokenData.getRole?.() ?? "user";
    return rawRole === "editor" ? "editor" : "user";
  } catch {
    return null;
  }
}

/**
 * Decode the issuer_domain claim directly from the raw JWT payload.
 * The Staffbase SDK does not expose this claim through its typed getters, so we
 * decode the middle (payload) segment ourselves — after the SDK has already
 * validated the signature, audience, and expiry.
 */
function extractIssuerDomain(rawToken: string): string | null {
  try {
    const parts = rawToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.issuer_domain === "string" ? payload.issuer_domain : null;
  } catch {
    return null;
  }
}

/**
 * Decode the branch_slug claim directly from the raw JWT payload.
 * Used to select per-customer branding and locale overrides at runtime.
 */
function extractBranchSlug(rawToken: string): string | null {
  try {
    const parts = rawToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const value = payload.branch_slug;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/**
 * Decode the `sid` claim from a raw JWT payload without verifying the signature.
 *
 * For page-load JWTs this is `createHash(accessorId + installationId + sessionId)`
 * as set by `EyoSSOFacade.generateToken`. For invalidation tokens sent by
 * `InvalidateSessionJob` it carries the same hash so we can match the stored
 * `staffbase_session_hash` column without knowing the user's sub.
 *
 * Exported so that the `DELETE /api/users/session` handler can read the claim
 * from the already-validated `rawToken` stored in `c.var.rawToken`.
 */
export function extractSidClaim(rawToken: string): string | null {
  try {
    const parts = rawToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const value = payload.sid;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/**
 * Validate a raw JWT and return the full user object, or null on failure.
 * Used by html.ts to populate session data on page load.
 */
export function parseTokenUser(rawToken: string): {
  userId: string;
  userName: string;
  firstName: string | null;
  lastName: string | null;
  instanceId: string;
  role: "editor" | "user";
  locale: string | null;
  type: string | null;
  branchId: string | null;
  externalId: string | null;
  issuerDomain: string | null;
  branchSlug: string | null;
  staffbaseSessionHash: string | null;
} | null {
  try {
    const ssoToken = new SSOToken(PLUGIN_ID, PUBLIC_KEY, rawToken);
    const td = ssoToken.getTokenData();
    const userId = td.getUserId() ?? "";
    const userName = td.getFullName?.() ?? td.getUserUsername?.() ?? "";
    const firstName = td.getFirstName?.() ?? null;
    const lastName = td.getLastName?.() ?? null;
    const instanceId = td.getInstanceId() ?? "";
    // Reject tokens that carry no instance_id — an empty instanceId would make all
    // such requests share a single "null instance" row, leaking data across tenants.
    if (!instanceId) return null;
    const rawRole = td.getRole?.() ?? "user";
    const role: "editor" | "user" = rawRole === "editor" ? "editor" : "user";
    const locale = td.getLocale?.() ?? null;
    const type = td.getType?.() ?? null;
    const branchId = td.getBranchId?.() ?? null;
    if (!branchId) {
      ssoLogger.warn(
        "JWT is missing the branch_id claim — branch-specific features will degrade.",
        {
          event: "jwt.branch_id.missing",
          instanceId,
          userId,
        }
      );
    }
    const externalId = td.getUserExternalId?.() ?? null;
    const issuerDomain = extractIssuerDomain(rawToken);
    const branchSlug = extractBranchSlug(rawToken);
    const staffbaseSessionHash = extractSidClaim(rawToken);
    ssoLogger.trace("JWT validated.", {
      userId,
      instanceId,
      role,
      branchId,
      issuerDomain,
      jwt: redact(rawToken),
    });
    return {
      userId,
      userName,
      firstName,
      lastName,
      instanceId,
      role,
      locale,
      type,
      branchId,
      externalId,
      issuerDomain,
      branchSlug,
      staffbaseSessionHash,
    };
  } catch {
    return null;
  }
}

// ── Middleware ─────────────────────────────────────────────────────────────────

/**
 * Try to resolve a valid session from the per-instance (or legacy) session
 * cookie.  Returns the session only if its instanceId matches instanceIdHint
 * (when provided). Extracts the matched cookie ID via out-param for TTL extension.
 */
async function resolveSessionUser(
  c: Parameters<typeof getCookie>[0],
  instanceIdHint: string | null
): Promise<{ session: Session; sid: string } | null> {
  if (!instanceIdHint) return null;
  const sid = getCookie(c, sessionCookieName(instanceIdHint));
  if (!sid) return null;
  const session = await getSession(sid);
  if (!session) return null;
  // Reject sessions belonging to a different instance (defence in depth).
  if (session.instanceId !== instanceIdHint) return null;
  return { session, sid };
}

/**
 * UUID-shape pattern — 8-4-4-4-12 lowercase hex with hyphens.
 * Does not enforce RFC 4122 version/variant bits; it only needs to distinguish
 * a Bearer session-id (UUID-shaped) from a Bearer JWT (dot-separated).
 */
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Attempt to resolve a session directly from a Bearer session-id (UUID).
 * The client sends `window.__SESSION_KEY__` as `Authorization: Bearer <uuid>`
 * when the SameSite=None session cookie is blocked (Safari ITP).
 * Returns `{ session, sid }` on success, null when the token is not a UUID or
 * the session has expired.
 */
async function resolveSessionFromBearerKey(
  bearerToken: string | undefined
): Promise<{ session: Session; sid: string } | null> {
  if (!bearerToken || !SESSION_ID_RE.test(bearerToken)) return null;
  const session = await getSession(bearerToken);
  if (!session) return null;
  return { session, sid: bearerToken };
}

const ssoLogger = createLogger("sso");

/**
 * Strict-GDPR gate. After any successful auth resolution, confirm the accessor
 * still exists in the upstream Staffbase instance. Called on every
 * authenticated request from {@link ssoMiddleware}; relies on
 * {@link revalidateAccessor}'s in-flight-dedup + per-user
 * `users.last_verified_at` TTL gate (env `USER_ACCESSOR_REVALIDATE_SECONDS`,
 * default 60s) so most calls short-circuit without a DB or upstream
 * round-trip.
 *
 * Behaviour:
 * - Returns `null` when the accessor is still valid → caller continues.
 * - Returns a 401 Response with body `{ error: "user_deleted" }` and header
 *   `x-auth-rejected: user_deleted` when the upstream reports deletion. The
 *   header signals {@link accessLog} to drop the deleted user's identifier
 *   from log retention (ADR-0013 carve-out).
 *
 * Side effects on rejection (in order):
 * 1. Clears the deleted user's identifier from `c.var.user` so any downstream
 *    middleware that reads `c.var.user.userId` cannot accidentally persist
 *    the identifier (defence-in-depth on top of the x-auth-rejected gate).
 * 2. Calls `deleteSession(sid)` when `sid` is provided (cookie + bearer-key
 *    paths) so the deleted user cannot retry with the same cookie. JWT auth
 *    paths intentionally pass no `sid` — JWT is stateless, the ~1-minute
 *    token lifetime bounds the retry window (see ADR-0012).
 *
 * Fail-open: `revalidateAccessor()` catches transient errors internally and
 * returns `{ deleted: false }`, so a Staffbase outage cannot lock out users.
 *
 * Sub-claim `"delete"` (instance-purge handshake from the platform) is
 * skipped — that userId is a synthetic value, not a real accessor.
 */
async function gateAccessor(
  c: Context<AppEnv>,
  instanceId: string,
  userId: string,
  sid?: string
): Promise<Response | null> {
  if (!userId || userId === "delete") return null;
  // revalidateAccessor fails open internally (any thrown error becomes
  // { deleted: false } at the trace logger), so no outer try/catch is needed.
  const { deleted } = await revalidateAccessor(instanceId, userId);
  if (deleted) {
    // Clear the deleted user's identifier from the per-request context before
    // returning 401 (defence-in-depth on top of the x-auth-rejected log
    // carve-out).
    const existingUser = c.get("user");
    if (existingUser) {
      c.set("user", { ...existingUser, userId: "" });
    }
    // ADR-0013: do NOT include userId in this structured log — the deleted
    // user's identifier must not be persisted in log retention.
    ssoLogger.warn("Request rejected: accessor deleted upstream.", {
      event: "auth.user_deleted",
      instanceId,
      "url.path": c.req.path,
    });
    // Hard-invalidate THIS specific session immediately so the deleted user
    // cannot retry with the same cookie within the TTL window.
    // cleanupDeletedUser does purge every session for (instanceId, userId)
    // transactionally, but only runs when gateAccessor reaches the upstream
    // (i.e. after the per-user TTL gate expires). Calling deleteSession(sid)
    // here drops the active sid up-front so the 401 takes effect before the
    // next TTL refresh would otherwise re-confirm the now-deleted user.
    if (sid) {
      try {
        await deleteSession(sid);
      } catch (err) {
        ssoLogger.error("Failed to delete session on deleted-user gate.", {
          event: "auth.user_deleted.session_delete_failed",
          instanceId,
          message: (err as Error).message,
        });
      }
    }
    // Header is set at construction time — mutating Response.headers after
    // c.json() is not guaranteed to survive in every runtime (Fetch spec
    // allows immutable headers depending on Response init path).
    return c.json({ error: "user_deleted" }, 401, { "x-auth-rejected": "user_deleted" });
  }
  return null;
}

export const ssoMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  // 1. Local dev bypass — IS_LOCALDEV is checked from Bun.env only (SEC-002).
  //    Per-request X-Dev-* headers may override individual identity fields to
  //    simplify testing multi-user / multi-tenant scenarios without restarting.
  //    Header overrides are ONLY honoured when IS_LOCALDEV === "true".
  const isLocalDev = Bun.env.IS_LOCALDEV === "true";
  if (isLocalDev) {
    const instanceId = c.req.header("X-Dev-Instance-Id") ?? "dev-instance";
    const role =
      (c.req.header("X-Dev-User-Role") ?? Bun.env.LOCALDEV_ROLE) === "editor" ? "editor" : "user";
    c.set("user", {
      userId: c.req.header("X-Dev-User-Id") ?? Bun.env.LOCALDEV_USER_ID ?? "local-user-1",
      userName: Bun.env.LOCALDEV_USER_NAME ?? "Local Dev User",
      instanceId,
      pluginId: PLUGIN_ID || "dev-plugin",
      role,
      firstName: null,
      lastName: null,
      locale: null,
      type: "user",
      branchId: null,
      externalId: null,
      issuerDomain: null,
      branchSlug: c.req.header("X-Dev-Branch-Slug") ?? Bun.env.LOCALDEV_BRANCH_SLUG ?? "_default",
      staffbaseSessionHash: null,
    });
    c.set("rawToken", "dev");
    c.set("scopedDb", createScopedDb(instanceId));
    // Seed staffbaseUrl for local dev so real Staffbase API calls work.
    // Strip any trailing slash and the https:// scheme to get the domain.
    const localDevUrl = Bun.env.LOCALDEV_STAFFBASE_URL;
    if (localDevUrl) {
      const domain = localDevUrl.replace(/^https:\/\//, "").replace(/\/$/, "");
      void upsertStaffbaseUrl(instanceId, domain);
    }
    return next();
  }

  // 2. Per-instance session cookie — primary auth path for API calls.
  // The client sends X-Instance-Id (from window.__USER__) to select the right
  // per-instance cookie. Falls back to decoding the instanceId from the Bearer
  // JWT payload (without signature verification) when the header is absent.
  const instanceIdHeader = c.req.header("X-Instance-Id") ?? null;
  const bearerHeader = c.req.header("Authorization");
  const bearerToken = bearerHeader?.startsWith("Bearer ") ? bearerHeader.slice(7) : undefined;
  const instanceIdHint =
    instanceIdHeader ?? (bearerToken ? decodeJwtInstanceId(bearerToken) : null);
  const resolved = await resolveSessionUser(c, instanceIdHint);
  if (resolved) {
    const { session, sid } = resolved;
    c.set("user", {
      userId: session.userId,
      userName: "", // names resolve from users cache via JOIN; not stored in sessions
      instanceId: session.instanceId,
      pluginId: PLUGIN_ID,
      role: session.role as "editor" | "user",
      firstName: null,
      lastName: null,
      locale: null,
      type: null,
      branchId: null,
      externalId: null,
      issuerDomain: null,
      branchSlug: null, // not available via session; only set on JWT-authenticated page loads
      staffbaseSessionHash: null, // not re-read from session; only present on JWT-authenticated page loads
    });
    c.set("rawToken", "session");
    c.set("scopedDb", createScopedDb(session.instanceId));
    // Gate FIRST — if the upstream user is deleted, do not bump the session
    // TTL (would refresh a session that gateAccessor is about to invalidate).
    const gate = await gateAccessor(c, session.instanceId, session.userId, sid);
    if (gate) return gate;
    // Extend TTL on activity (SESSION_SLIDING, default true)
    await extendSession(sid);
    ssoLogger.debug("auth.success", {
      event: "auth.success",
      authPath: "cookie",
      userId: session.userId,
      instanceId: session.instanceId,
      role: session.role,
    });
    return next();
  }

  // 3. Bearer session-id — Safari ITP fallback when SameSite=None cookie is
  // blocked. The client injects window.__SESSION_KEY__ (a UUID) on page load
  // and sends it as Authorization: Bearer <sessionId>. A UUID is 36 chars of
  // [0-9a-f-] and contains no dots, so it is unambiguous vs a JWT.
  const resolvedByKey = await resolveSessionFromBearerKey(bearerToken);
  if (resolvedByKey) {
    const { session, sid } = resolvedByKey;
    c.set("user", {
      userId: session.userId,
      userName: "",
      instanceId: session.instanceId,
      pluginId: PLUGIN_ID,
      role: session.role as "editor" | "user",
      firstName: null,
      lastName: null,
      locale: null,
      type: null,
      branchId: null,
      externalId: null,
      issuerDomain: null,
      branchSlug: null,
      staffbaseSessionHash: null,
    });
    c.set("rawToken", "session");
    c.set("scopedDb", createScopedDb(session.instanceId));
    // Gate FIRST — same rationale as the cookie-session path above.
    const gate = await gateAccessor(c, session.instanceId, session.userId, sid);
    if (gate) return gate;
    await extendSession(sid);
    ssoLogger.debug("auth.success", {
      event: "auth.success",
      authPath: "bearer_session_id",
      userId: session.userId,
      instanceId: session.instanceId,
      role: session.role,
    });
    return next();
  }

  // 4. Bearer JWT — fallback when both cookie and session-id Bearer are missing.
  // Only useful while the JWT is still valid (~1 min lifetime).
  if (bearerToken) {
    const user = parseTokenUser(bearerToken);
    if (user) {
      c.set("user", { ...user, pluginId: PLUGIN_ID });
      c.set("rawToken", bearerToken);
      c.set("scopedDb", createScopedDb(user.instanceId));
      // No `sid` argument — JWT auth is stateless; there is no per-instance
      // session row to invalidate. The ~1-minute JWT lifetime bounds the
      // window during which a just-deleted upstream user could replay the
      // same JWT before signature expiry. If JWT lifetime is ever lengthened,
      // gateAccessor must grow a parallel JWT-revocation mechanism (e.g. a
      // denylist keyed on jti) — see ADR-0012.
      const gate = await gateAccessor(c, user.instanceId, user.userId);
      if (gate) return gate;
      ssoLogger.debug("auth.success", {
        event: "auth.success",
        authPath: "bearer_jwt",
        userId: user.userId,
        instanceId: user.instanceId,
        role: user.role,
      });
      return next();
    }
  }

  // 5. Extract JWT from query param (REQ-001) — used by HTML page-load routes
  const rawToken = extractRawToken(c);
  if (!rawToken) return c.text("Unauthorized", 401);

  // 6. Validate with SSOToken and extract full user profile (REQ-002, REQ-003)
  try {
    const user = parseTokenUser(rawToken);
    if (!user) return c.text("Unauthorized", 401);
    c.set("user", { ...user, pluginId: PLUGIN_ID });
    c.set("rawToken", rawToken);
    c.set("scopedDb", createScopedDb(user.instanceId));
    // No `sid` — same rationale as the Bearer-JWT path above (stateless auth).
    const gate = await gateAccessor(c, user.instanceId, user.userId);
    if (gate) return gate;
    ssoLogger.debug("auth.success", {
      event: "auth.success",
      authPath: "query_jwt",
      userId: user.userId,
      instanceId: user.instanceId,
      role: user.role,
    });
    return next();
  } catch (err) {
    // SEC-001: log the error message only, never the token value
    ssoLogger.warn("SSO token validation failed.", {
      "url.path": c.req.path,
      "http.request.header.x-request-id": c.req.header("x-request-id"),
      message: (err as Error).message,
      jwt: redact(rawToken),
    });
    return c.text("Unauthorized", 401);
  }
});

export const requireEditor = createMiddleware<AppEnv>(async (c, next) => {
  // c.var.user is populated by ssoMiddleware, which must be registered on the
  // route before this middleware runs. Do NOT re-invoke ssoMiddleware here.
  const user = c.var.user;
  if (user?.role !== "editor") {
    return c.text("Forbidden", 403);
  }
  return next();
});
