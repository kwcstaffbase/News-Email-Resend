let _token = "";

export function setToken(t: string): void {
  _token = t;
}

export function getToken(): string {
  return _token;
}

/**
 * Read the session token for SDK initialisation.
 * Prefers window.__SESSION_KEY__ (server-injected, bypasses Safari ITP) over
 * the window.__JWT_TOKEN__ fallback.
 *
 * __SESSION_KEY__ is a UUID backed by the server-side sessions table and
 * remains valid for the full session TTL (default 8 h), even when the
 * SameSite=None session cookie is blocked by Safari ITP.
 *
 * __JWT_TOKEN__ is retained as a fallback for the Vite dev-server (port 5173),
 * where the server does not inject __SESSION_KEY__, and for any widget-API
 * contexts that require the raw JWT.
 */
export function readServerToken(): string {
  const g = globalThis as Record<string, unknown>;
  const sessionKey = typeof g.__SESSION_KEY__ === "string" ? g.__SESSION_KEY__ : "";
  if (sessionKey) return sessionKey;
  return typeof g.__JWT_TOKEN__ === "string" ? g.__JWT_TOKEN__ : "";
}
