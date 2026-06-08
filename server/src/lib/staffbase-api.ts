import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { settings } from "../db/schema.ts";
import { decrypt } from "./crypto.ts";
import { createLogger, redact } from "./logger.ts";

const apiLogger = createLogger("api");

/**
 * Upserts the Staffbase host URL for the given instance, derived from the
 * issuer_domain claim in the JWT. Only updates staffbase_url and updated_at so
 * an existing api_token is never overwritten.
 */
export async function upsertStaffbaseUrl(instanceId: string, issuerDomain: string): Promise<void> {
  const staffbaseUrl = `https://${issuerDomain}`;
  const now = new Date();
  await db
    .insert(settings)
    .values({ instanceId, staffbaseUrl, updatedAt: now })
    .onConflictDoUpdate({
      target: settings.instanceId,
      set: { staffbaseUrl, updatedAt: now },
    });
}

/**
 * Retrieves and decrypts the API token for the given instance from the
 * settings table. Returns null if not configured or if decryption fails.
 *
 * The token is stored as a `btoa("installations/{instanceId}:{secret}")` Basic
 * auth value — the same format the Staffbase Platform API expects.
 */
export async function getApiToken(instanceId: string): Promise<string | null> {
  const [row] = await db
    .select({ apiToken: settings.apiToken })
    .from(settings)
    .where(eq(settings.instanceId, instanceId))
    .limit(1);

  const encrypted = row?.apiToken;
  if (!encrypted) return null;
  return decrypt(encrypted);
}

/**
 * Retrieves both the Staffbase host URL and the decrypted API token for the
 * given instance in a single database round-trip.
 *
 * Returns null for either field when it is not configured.
 */
export async function getInstanceSettings(
  instanceId: string
): Promise<{ staffbaseUrl: string | null; apiToken: string | null }> {
  const [row] = await db
    .select({
      staffbaseUrl: settings.staffbaseUrl,
      apiToken: settings.apiToken,
    })
    .from(settings)
    .where(eq(settings.instanceId, instanceId))
    .limit(1);

  const apiToken = row?.apiToken ? decrypt(row.apiToken) : null;
  return { staffbaseUrl: row?.staffbaseUrl ?? null, apiToken };
}

/**
 * Thin wrapper around fetch() for Staffbase Platform API calls.
 *
 * The base URL and the pre-computed Basic auth token are both provided by the
 * caller. Use getApiToken(instanceId) to obtain the token from the settings table.
 *
 * Set LOG_API=true to print every outgoing request and its response status.
 *
 * @param path        Absolute path starting with "/" e.g. "/api/users/search?query=…"
 * @param instanceUrl Staffbase instance base URL, e.g. "https://company.staffbase.com"
 * @param token       Basic auth token (btoa("installations/{instanceId}:{secret}"))
 * @param init        Optional fetch init (headers are merged, not replaced)
 */
export async function staffbaseFetch(
  path: string,
  instanceUrl: string,
  token: string,
  init?: RequestInit
): Promise<Response> {
  const logApi = Bun.env.LOG_API === "true";
  const { headers: extraHeaders, ...restInit } = init ?? {};
  const method = restInit.method ?? "GET";

  if (logApi) {
    apiLogger.debug("Outgoing API request.", {
      "http.request.method": method,
      url: `${instanceUrl}${path}`,
    });
  }

  const t0 = Date.now();
  const res = await fetch(`${instanceUrl}${path}`, {
    ...restInit,
    headers: {
      ...extraHeaders,
      Authorization: `Basic ${token}`,
    },
  });

  if (logApi) {
    const debugCtx: Record<string, unknown> = {
      "http.request.method": method,
      "url.path": path,
      "http.response.status_code": res.status,
      "http.request.duration": Date.now() - t0,
    };
    // In local dev also log the response body so API shapes are visible without a debugger
    if (Bun.env.IS_LOCALDEV === "true") {
      const body = await res
        .clone()
        .text()
        .catch(() => "");
      if (body) debugCtx.body = body.slice(0, 2000);
    }
    apiLogger.debug("API response.", debugCtx);
  } else if (!res.ok) {
    apiLogger.warn("API response error.", {
      "http.request.method": method,
      "url.path": path,
      "http.response.status_code": res.status,
      instanceUrl,
    });
  }

  // TRACE: full request + response for deep debugging (bodies capped at 4KB).
  // Authorization header is always passed through redact() regardless of LOG_SECRETS.
  apiLogger.trace("API call detail.", {
    "http.request.method": method,
    url: `${instanceUrl}${path}`,
    authorization: redact(`Basic ${token}`),
    "http.response.status_code": res.status,
    "http.request.duration": Date.now() - t0,
    ...(init?.body ? { "request.body": JSON.stringify(init.body).slice(0, 4096) } : {}),
  });

  return res;
}

/**
 * Extracts W3C trace context headers and x-request-id from an incoming request
 * so they can be forwarded to upstream Staffbase API calls for end-to-end tracing.
 * Only includes headers that are actually present on the request.
 */
export function extractTraceHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  const xRequestId = req.headers.get("x-request-id");
  if (xRequestId) headers["x-request-id"] = xRequestId;
  const traceparent = req.headers.get("traceparent");
  if (traceparent) headers.traceparent = traceparent;
  const tracestate = req.headers.get("tracestate");
  if (tracestate) headers.tracestate = tracestate;
  return headers;
}
