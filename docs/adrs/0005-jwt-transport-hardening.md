# ADR-0005 — Multi-layer JWT transport hardening (IA-5740)

**Status**: Accepted  
**Date**: 2026-04

---

## Context

The Staffbase platform delivers identity via a `?jwt=` query parameter appended to the plugin URL on each new navigation. This is a platform constraint — there is currently no header-based delivery alternative.

Risk IA-5740 identified that the raw JWT appearing in the browser URL history and potentially in `Referer` headers on subresource requests constitutes an unnecessary exposure window. A JWT captured from a URL could be used to re-authenticate as that user until it expires.

## Decision

Implement defence in depth with five complementary layers:

| Layer | Location | What it does |
|---|---|---|
| 1 – One-time consumption | `routes/html.ts` | JWT is validated exactly once on page load; session cookie is issued. Subsequent API calls use the cookie, never the JWT. |
| 2 – Referrer-Policy header | `app.ts` (`secureHeaders`) | `Referrer-Policy: no-referrer` prevents the browser from forwarding the `?jwt=` URL in `Referer` headers to any subresource (CDN assets, third-party analytics, etc.). |
| 3 – History clean-up | `client/src/main.tsx` | `history.replaceState` removes `?jwt=` from the browser URL and history stack immediately after the token is read from `window.__JWT_TOKEN__`. |
| 4 – Dynamic frame-ancestors CSP | `routes/html.ts` (`buildFrameAncestors`) | Per the [Staffbase HTTP header guide](https://developers.staffbase.com/references/http-header-settings/) (legacy CSP headers deprecated Q1 2026): `Content-Security-Policy: frame-ancestors 'self' https://<parent> https://<issuerDomain> http://staffbase.com capacitor://<parent> capacitor://staffbase.com https://localhost`. The parent domain is derived by stripping the first DNS label from `issuer_domain` (e.g. `myapp.company.com` → `company.com`), covering both the exact subdomain and its customer-owned apex across https and Capacitor native-app schemes. When `issuer_domain` is absent the header falls back to `https://*.staffbase.com https://*.staffbase.dev https://*.staffbase.rocks` plus the platform literals. |
| 5 – Session-key HTML injection | `routes/html.ts` + `html.ts` (`injectSessionKey`) | The freshly issued session UUID is embedded as `window.__SESSION_KEY__` before `</head>`. Safari ITP users whose `SameSite=None` cookie is silently blocked can still authenticate by sending the session id as `Authorization: Bearer <uuid>`. The session UUID is HTML-entity-escaped (`&`, `<`, `>`, `"`, `'`) identically to `window.__JWT_TOKEN__`. |

Layers 3, 4, and 5 all depend on the JWT being successfully validated on page load. Layer 4 additionally uses `issuerDomain` (`issuer_domain` claim) when present; if absent, the hardcoded Staffbase domain allow-list plus platform literals (`http://staffbase.com capacitor://staffbase.com https://localhost`) are used so the iframe still renders on all supported clusters including native Capacitor apps.

### Dev/prod parity guard

A startup-time check in `server/src/index.ts` throws before `serve(...)` is called when `NODE_ENV=production` is combined with `IS_LOCALDEV=true`:

> `IS_LOCALDEV=true is not allowed when NODE_ENV=production. Remove IS_LOCALDEV or set it to false before deploying.`

This prevents the SSO bypass (synthetic user, no JWT validation) from being accidentally enabled in any production deployment. The guard is covered by `server/src/__tests__/localdev-guard.test.ts`.

## Consequences

- **Positive**: Even if a JWT URL is leaked (e.g. via browser extension or proxy log), it cannot be replayed from a different origin (Layer 4) and is no longer present in the URL bar after the initial load (Layer 3)
- **Positive**: Safari users with aggressive ITP (who silently lose `SameSite=None` cookies) can still authenticate via Layer 5 without falling back to forwarding the JWT on every request
- **Positive**: Parity guard makes it structurally impossible to ship a build with `IS_LOCALDEV=true` enabled to production clusters
- **Positive**: Layer 2 is stateless and covers all environments with a single middleware config change
- **Positive**: No platform team changes required — all mitigations are within the plugin server
- **Negative**: `Content-Security-Policy: frame-ancestors` with `'self'` means the admin panel **cannot** be opened directly in a browser tab in production (only from the Staffbase iframe) — acceptable because the admin panel requires a valid JWT anyway
- **Residual risk**: The JWT is still visible in the URL for the instant between page load and `history.replaceState` execution. The platform team has been notified; a header-based alternative (e.g. `POST` with JWT in body) would eliminate this residual risk entirely but is outside this project's scope.
- **Monitoring**: The `issuerDomain` from each JWT is stored in `settings.staffbase_url`; anomalous domain changes can be detected by monitoring that column.
