# ADR-0002 — Cookie-first session auth with JWT bootstrap

**Status**: Accepted  
**Date**: 2026-04

---

## Context

The Staffbase platform delivers identity via a short-lived signed JWT passed as a `?jwt=` query parameter on every new navigation into the plugin. Relying on the JWT for every authenticated request has several drawbacks:

- JWTs expire quickly (typically ~1 min); passing them on every API call is almost always a race-condition failure
- The `?jwt=` parameter is visible in browser history and may leak via `Referer` headers
- API requests from React cannot always forward the JWT

## Decision

Implement **cookie-first session auth** with JWT bootstrap:

1. On every page load the server validates the incoming JWT (`?jwt=`)
2. A short-lived HTTP-only session is created in the `sessions` table and a `sid-<instanceId>` cookie is set (`HttpOnly; Secure; SameSite=None`)
3. Subsequent API calls from the SPA carry only the session cookie — no JWT forwarded
4. The session cookie is per-instance (`sid-<instanceId>`) to support multiple plugin instances in the same browser tab
5. The JWT itself is HTML-injected as `window.__JWT_TOKEN__` for client-side auth context bootstrapping, then the URL is cleaned (`history.replaceState`)

## Consequences

- **Positive**: Stateless JWTs are not forwarded to the DB or logged
- **Positive**: Session expiry is server-controlled (`SESSION_TTL_HOURS` env var, default 8 h)
- **Positive**: Multiple plugin instances coexist without cookie name collisions
- **Negative**: Requires a sessions table and associated cleanup job
- **Negative**: `SameSite=None` requires `Secure` which requires HTTPS in production
- **Constraint**: The legacy `sid` cookie (without instance suffix) is still accepted for backwards compat (see `sessionCookieName` fallback in `middleware/sso.ts`)

### Bearer session-id fallback (Safari ITP mitigation)

In addition to cookie auth, the `Authorization: Bearer` header now also accepts a session **UUID** (not only a JWT), resolved server-side via `getSession`. The session id is additionally exposed to the client as `window.__SESSION_KEY__` for Safari ITP users whose `SameSite=None` cookie is silently blocked by the browser. The SDK's `apiClient` attaches this value as `Authorization: Bearer <uuid>` automatically when the cookie is unavailable.

The middleware disambiguates Bearer tokens by matching the session UUID shape (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`) before attempting JWT verification — see `SESSION_ID_RE` and `resolveSessionFromBearerKey` in `middleware/sso.ts`. See also [ADR-0005 — Layer 5](0005-jwt-transport-hardening.md).
