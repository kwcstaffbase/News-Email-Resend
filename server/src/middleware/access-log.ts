/**
 * Structured HTTP access-log middleware.
 *
 * Replaces Hono's built-in `logger()` middleware with output that follows
 * the Staffbase logging standard and OTel semantic conventions.
 *
 * Fields emitted per request:
 *   http.request.method            — GET, POST, DELETE, …
 *   url.path                       — request path (no query string)
 *   http.response.status_code      — integer HTTP status
 *   http.request.duration          — wall-clock time in milliseconds
 *   http.request.header.x-request-id — Istio-injected correlation ID (when present)
 *
 * Uptime probes and Prometheus scrape paths are skipped — these run every
 * 10-30s per pod, carry zero per-request signal, and dominated access-log
 * volume in a 2026-05-22 prod audit.
 */

import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { routePath } from "hono/route";
import { createLogger, redact } from "../lib/logger.ts";
import { incHttpRequests, observeHttpDuration } from "../routes/metrics.ts";

const logger = createLogger("http");

const IS_LOCALDEV = Bun.env.IS_LOCALDEV === "true";

// Drop access-log lines for scanner / probe traffic that reaches the pod:
// anonymous requests that landed in the `/other` bucket (no real handler
// matched) with a 4xx response. Examples observed in prod across all three
// regions: `GET /favicon.ico`, `GET /robots.txt`, `GET /index.php`,
// `GET //pizza:pizza=pizza` variants, `GET /_layouts/15/error.aspx`,
// `GET /api/sonicos/*`, anonymous `GET /` probes. ~70% of prod log volume.
//
// Metrics still recorded so http_requests_total stays accurate — only the
// log emission is skipped. Real-handler 4xx (validation rejects, 403,
// 404 on a real route) keep logging because their route is `/api/*` or a
// specific handler pattern, not `/other`. Real user 401s on `/api/apps`
// keep logging because c.var.user is populated.
//
// Set SILENCE_ANONYMOUS_4XX=false to keep raw access-log volume during
// incident triage; per-env override lives in the mops kustomize overlay.
const SILENCE_ANONYMOUS_4XX = Bun.env.SILENCE_ANONYMOUS_4XX !== "false";

/**
 * Pure helper for the scanner-noise carve-out. Extracted so the silence
 * decision can be unit-tested without bootstrapping a Hono Context.
 *
 * `hasUser` reflects whether an SSO user context is attached to the
 * request (see {@link hasUserContext}); it must NOT be derived from
 * `ssoUser.userId` because `gateAccessor()` deliberately scrubs that
 * field to "" on the `user_deleted` rejection path.
 *
 * Returns `true` when the access-log line should be dropped.
 */
export function shouldSilenceAccessLog(
  status: number,
  route: string,
  hasUser: boolean,
  silenceFlag: boolean
): boolean {
  return silenceFlag && status >= 400 && status < 500 && route === "/other" && !hasUser;
}

/**
 * Returns `true` when an SSO user context is attached to the request.
 *
 * Keyed on `instanceId` rather than `userId` because `gateAccessor()` in
 * `sso.ts` deliberately scrubs `userId` to "" on the `user_deleted`
 * rejection path (defence-in-depth on top of the x-auth-rejected log
 * carve-out). A deleted-then-rejected accessor still has `instanceId`
 * populated and must not be misclassified as anonymous by the silence
 * gate. SSO middleware always sets `instanceId` whenever it populates
 * `c.var.user` (every gateAccessor call site passes a non-empty
 * `session.instanceId` / `user.instanceId`).
 */
export function hasUserContext(
  ssoUser: { userId?: string; instanceId?: string; role?: string } | undefined
): boolean {
  return ssoUser?.instanceId !== undefined && ssoUser.instanceId !== "";
}

// Paths excluded from both the access-log emission and the http metrics:
//   /health, /probe         → uptime / liveness probes (k8s + Cloudflare)
//   /metrics, /api/metrics  → Prometheus scrape endpoints (VMAgent target)
// Adding a real business route at any of these names would silently drop
// its traffic from the access log + http_requests_total — rename it first
// (or split this set into probe-vs-scrape if they ever need to diverge).
const SKIP_PATHS = new Set(["/health", "/probe", "/metrics", "/api/metrics"]);

/**
 * Pure helper for the routeLabel decision. Takes the matched Hono route
 * (from `routePath(c)`, or null/`/*` when nothing matched) and the raw
 * request path. Returns either the matched route or a coarse bucket.
 *
 * Extracted from `routeLabel(c)` so it can be unit-tested without
 * bootstrapping a Hono app or building a mock Context.
 */
export function bucketRouteLabel(matched: string | undefined | null, rawPath: string): string {
  if (matched && matched !== "/*") return matched;
  if (rawPath.startsWith("/assets/")) return "/assets/*";
  if (rawPath.startsWith("/widget/")) return "/widget/*";
  if (rawPath.startsWith("/api/")) return "/api/*";
  return "/other";
}

/**
 * Normalize a request path into a stable route label for Prometheus metrics.
 *
 * Without this the `path` label on http_requests_total is the raw URI, which
 * produces unbounded cardinality once dynamic IDs and scanner-crafted URIs
 * flow in. A 2026-05-22 prod audit found ~3700 polluted series across this
 * plugin's three prod envs (de1=2200, au1=1405, us1=112), almost entirely
 * from scanner traffic.
 */
function routeLabel(c: Context): string {
  return bucketRouteLabel(routePath(c), c.req.path);
}

// Captures JSON request body for mutation methods under localdev only.
// Hono caches the parsed body so route handlers still receive it normally.
async function captureRequestBodyIfLocalDev(c: Context, method: string): Promise<unknown> {
  if (!IS_LOCALDEV) return undefined;
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return undefined;
  const ct = c.req.header("content-type") ?? "";
  if (!ct.includes("application/json")) return undefined;
  return c.req.json().catch(() => undefined);
}

// SSO middleware populates c.var.user before next() returns; for
// unauthenticated routes (public/health) the assertion is `undefined`
// and we skip these fields rather than logging "anonymous" placeholders.
//
// GDPR carve-out: when the gate rejects with 401 user_deleted, c.var.user
// is already populated but the request is being refused precisely because
// the upstream said this user no longer exists. Emitting their
// identifiers into the access log would persist deleted-PII in log
// retention. We still log instanceId/role for incident triage; userId
// is dropped.
function addUserFields(
  ctx: Record<string, unknown>,
  user: { userId?: string; instanceId?: string; role?: string } | undefined,
  isUserDeletedReject: boolean
): void {
  if (user?.userId && !isUserDeletedReject) ctx.userId = user.userId;
  if (user?.instanceId) ctx.instanceId = user.instanceId;
  if (user?.role) ctx.role = user.role;
}

async function addLocalDevBodyFields(
  c: Context,
  ctx: Record<string, unknown>,
  reqBody: unknown,
  status: number
): Promise<void> {
  if (!IS_LOCALDEV) return;
  if (reqBody !== undefined) ctx["http.request.body"] = reqBody;
  if (status < 400) return;
  const snippet = await c.res
    .clone()
    .text()
    .catch(() => "");
  if (snippet) ctx["http.response.body"] = snippet.slice(0, 1000);
}

function emitTraceHeaders(c: Context, path: string, method: string): void {
  logger.trace("Request headers.", {
    "url.path": path,
    "http.request.method": method,
    headers: Object.fromEntries(
      [...c.req.raw.headers.entries()].map(([k, v]) =>
        k.toLowerCase() === "authorization" || k.toLowerCase() === "cookie"
          ? [k, redact(v)]
          : [k, v]
      )
    ),
    ...(c.req.query("jwt") ? { "query.jwt": redact(c.req.query("jwt") as string) } : {}),
  });
}

export const accessLog = createMiddleware(async (c, next) => {
  const path = c.req.path;

  // Skip chatty probe/scraper endpoints (uptime probes + Prometheus scrape).
  if (SKIP_PATHS.has(path)) {
    return next();
  }

  const method = c.req.method;
  const reqBody = await captureRequestBodyIfLocalDev(c, method);

  const t0 = Date.now();
  await next();
  const ms = Date.now() - t0;

  const status = c.res.status;
  const route = routeLabel(c);

  // Scanner-noise carve-out: drop the access-log line for anonymous 4xx
  // hits on the `/other` bucket. "Anonymous" means no SSO user context
  // attached — a deleted-user 401 (userId scrubbed by gateAccessor,
  // instanceId still populated) is treated as authenticated and gets
  // logged. Metrics still recorded below so http_requests_total stays
  // accurate. See hasUserContext + shouldSilenceAccessLog jsdoc.
  const ssoUser = c.var.user as { userId?: string; instanceId?: string; role?: string } | undefined;
  if (shouldSilenceAccessLog(status, route, hasUserContext(ssoUser), SILENCE_ANONYMOUS_4XX)) {
    incHttpRequests(method, route, status);
    observeHttpDuration(method, route, ms);
    return;
  }

  const requestId = c.req.header("x-request-id");
  const responseLength = c.res.headers.get("content-length");

  // Emit structured access-log entry. The msg field is built to be
  // self-describing so a Grafana row shows the request at a glance without
  // having to expand the structured fields:
  //   "GET /api/apps → 200 (12ms)"
  const ctx: Record<string, unknown> = {
    "http.request.method": method,
    "url.path": path,
    "http.route": route,
    "http.response.status_code": status,
    "http.request.duration": ms,
  };
  if (requestId) ctx["http.request.header.x-request-id"] = requestId;
  if (responseLength) ctx["http.response.body.size"] = Number(responseLength);
  const isUserDeletedReject =
    status === 401 && c.res.headers.get("x-auth-rejected") === "user_deleted";
  addUserFields(ctx, ssoUser, isUserDeletedReject);
  await addLocalDevBodyFields(c, ctx, reqBody, status);
  logger.info(`${method} ${route} → ${status} (${ms}ms)`, ctx);

  emitTraceHeaders(c, path, method);

  // Update in-process metrics. Same route label as the log line above so
  // cardinality on http_requests_total stays bounded.
  incHttpRequests(method, route, status);
  observeHttpDuration(method, route, ms);
});
