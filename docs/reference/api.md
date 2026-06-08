# API Reference

All endpoints below are mounted in [`server/src/app.ts`](../../server/src/app.ts). Routes under `/api/*` require SSO via `ssoMiddleware`; the `requireEditor` middleware is layered on admin-only routes.

## Authentication

The server validates the Staffbase JWT on every request via `@staffbase/staffbase-plugin-sdk`. The JWT carries:

- `userId` — Staffbase user ID
- `instance_id` — tenant identifier (always required; multi-tenancy boundary)
- `role` — `editor` or `user`
- `sub` — `"delete"` for GDPR delete intercepts; otherwise the user ID
- `issuer_domain` — Staffbase host URL, used to derive CSP `frame-ancestors`

Once validated, the server issues a per-instance session cookie (`sid-<instanceId>`) and injects `window.__USER__` and `window.__SESSION_KEY__` into the SPA HTML. See [`docs/architecture/sessions.md`](../architecture/sessions.md) for the full flow.

In local development (`IS_LOCALDEV=true`), SSO is bypassed and a synthetic user is constructed from `LOCALDEV_*` env vars and the optional `X-Dev-*` request headers.

---

## Public routes (no SSO)

### `GET /health`

Liveness probe. Returns `{ "status": "ok" }`.

### `GET /api/metrics`

Prometheus-format process metrics. Used by Kubernetes for monitoring.

### `GET /api/public/instance`

Returns the plugin ID and the list of known instance IDs with their Staffbase host URLs.

**Response:**

```json
{
  "pluginId": "<configured PLUGIN_ID env var>",
  "instances": [
    { "instanceId": "abc123", "staffbaseUrl": "https://company.staffbase.com" }
  ]
}
```

CORS: `*`. Intentionally unauthenticated — values are non-sensitive metadata.

### `GET /` · `GET /admin` · `GET /dev`

Serve the SPA HTML with injected user/session/CSP. `/admin` returns 403 to non-editors. `/dev` is mounted only when `IS_LOCALDEV=true`.

---

## Settings

### `GET /api/settings`

Returns the current instance's settings. The API token is **never returned in plaintext** — only a boolean indicating whether one is configured.

**Response:**

```json
{
  "staffbaseUrl": "https://company.staffbase.com",
  "hasApiToken": true
}
```

### `GET /api/settings/token` (editor only)

Returns the decrypted API token for verification in the admin Settings dialog.

**Response:** `{ "apiToken": "<plaintext>" | null }`

### `PUT /api/settings` (editor only)

Updates the instance settings. Pass any subset of `{ staffbaseUrl?, apiToken? }`. Passing `null` for `apiToken` clears it; omitting a field leaves it unchanged.

**Validation:**

- `staffbaseUrl` must be a valid HTTPS URL.
- `apiToken` must be a string or `null`.

**Response:** same shape as `GET /api/settings`.

The API token is encrypted via AES-256-GCM ([`server/src/lib/crypto.ts`](../../server/src/lib/crypto.ts)) before being stored. The encryption key is read from `ENCRYPTION_KEY` (64-hex-char string).

Every mutation here writes a `settings_updated` entry to the changelog with `gdprRelevant: true` when the API token is changed.

---

## Users

### `GET /api/users/search?query=<q>&limit=<n>` (editor only)

Searches Staffbase users via the configured API token. In local dev without a token, returns a mock dataset.

**Response:**

```json
{
  "total": 5,
  "entries": [
    { "data": { "id": "u1", "firstName": "Alice", "lastName": "Smith", "email": "a@x.com", "userName": "asmith" } }
  ]
}
```

Returns `503` when no API token is configured (and not in localdev mock mode).

### `DELETE /api/users/session`

Called by Staffbase's `InvalidateSessionJob` when a user session is destroyed. Authenticates via `?jwt=` query param; uses the `sid` JWT claim to identify the session hash. Deletes all matching session rows for the instance. Always returns `200 OK`.

### `DELETE /api/users/:userId/cache` (editor only)

Re-fetches the user from Staffbase and refreshes the local display-name cache row. Returns `{ outcome: "refreshed" | "deleted" | ... }`.

---

## Changelog (editor only)

### `GET /api/changelog`

Paginated activity log. Filter by `action`, `entityType` (comma-separated), and free-text `search` (matches `summary` and `entity_name`).

**Query params:**

- `page` (default `1`)
- `limit` (default `50`, max `250`)
- `action` — single action value
- `entityType` — comma-separated list
- `search` — free-text

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "userId": "u1",
      "userName": "Alice Smith",
      "action": "settings_updated",
      "entityType": "settings",
      "summary": "Updated settings (apiToken)",
      "payload": { "changedFields": ["apiToken"] },
      "gdprRelevant": true,
      "createdAt": "2026-01-01T00:00:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 50
}
```

### `GET /api/changelog/export`

Returns the full changelog as NDJSON.

**Response:** `200 OK` with `Content-Type: application/json` and `Content-Disposition: attachment; filename="audit-log-{date}.json"`.

---

## Items (demo CRUD)

The `/api/items` route powers the worked Admin View. Treat it as a worked example — list-with-search-sort-filter-paginate + CRUD + audit-log writes in one file ([`server/src/routes/items.ts`](../../server/src/routes/items.ts)). Drop or rename when you replace the `items` table with your own domain.

### `GET /api/items`

Paginated list. Filter by status, category, free-text search; sort by name, created-at, or last-edited.

**Query params:**

| Name       | Type    | Default     | Notes                                                                                    |
| ---------- | ------- | ----------- | ---------------------------------------------------------------------------------------- |
| `page`     | int     | `1`         | 1-indexed                                                                                |
| `limit`    | int     | `25`        | Max `250`                                                                                |
| `search`   | string  | `""`        | Case-insensitive `ILIKE` against `name` and `description`                                |
| `sort`     | enum    | `name_asc`  | `name_asc` \| `name_desc` \| `newest` \| `oldest` \| `last_edited`                       |
| `status`   | enum    | `active`    | `active` \| `archived` — drives the SegmentedControl tabs                                |
| `category` | string  | `""`        | Comma-separated list. Each value must be `general` \| `important` \| `internal` \| `external` |

**Response:**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Welcome onboarding checklist",
      "description": "Steps every new hire completes during their first week.",
      "category": "important",
      "status": "active",
      "createdByUserId": "user-alice",
      "createdAt": "2026-05-09T00:00:00Z",
      "updatedAt": "2026-05-09T00:00:00Z"
    }
  ],
  "total": 17,
  "page": 1,
  "limit": 25
}
```

### `GET /api/items/categories?status=<status>`

Returns the four known categories with item counts scoped to the given status. Drives the category filter dropdown — counts stay stable as users move between Active/Archived tabs.

**Response:**

```json
{
  "categories": [
    { "id": "general",   "count": 4 },
    { "id": "important", "count": 4 },
    { "id": "internal",  "count": 5 },
    { "id": "external",  "count": 4 }
  ]
}
```

### `POST /api/items` (editor only)

Create. Writes `item_created` to the changelog.

**Body:** `{ name, description?, category, status? }` (zod-validated, `name` 1–120 chars).

**Response:** `201 Created` with the inserted row.

### `PUT /api/items/:id` (editor only)

Update. Writes `item_updated`.

**Body:** same shape as create.

**Response:** `200 OK` with the updated row, or `404` if not found in this instance.

### `DELETE /api/items/:id` (editor only)

Delete. Writes `item_deleted`.

**Response:** `204 No Content`, or `404` if not found.

---

## Admin

### `DELETE /api/admin/clear-all` (editor only)

Deletes all `items` and the `settings` row for the current instance, in a single transaction. Extend the transaction in [`server/src/routes/admin.ts`](../../server/src/routes/admin.ts) when you add plugin-specific tables.

Writes a `clear_all` changelog entry with `gdprRelevant: true`.

**Response:** `204 No Content`.

---

## GDPR delete intercept

Staffbase sends a POST request to any plugin URL with a JWT where `sub === "delete"` to trigger full instance deletion. The intercept lives at the top of [`server/src/app.ts`](../../server/src/app.ts) — it runs **before** session issuance, calls [`deleteInstance(instanceId)`](../../server/src/lib/remote-calls.ts) (which purges all five tables — items, settings, users, sessions, changelog — in a single transaction), and returns `200 OK`.

A POST with a valid JWT but a non-`delete` subject returns `401`. A POST without a JWT falls through to the normal route handling.

When you add plugin-specific tables, extend the `deleteInstance` transaction so it purges them too.

---

## Localdev-only routes

Mounted only when `IS_LOCALDEV=true`.

### `GET /api/localdev/ping`

Returns `{ ok: true }`. Use as a connectivity probe.

### `POST /api/localdev/seed`

Calls [`seed()`](../../server/src/seed.ts): wipes `items` / `changelog` / `users` / `settings` for the seed instance, then inserts 20 generic items + 3 sample users. Wired to the **Seed sample data** button on `/dev`.

**Response:** `{ ok: true, message: "Seeded 20 items for instance \"dev-instance\"." }` or `{ ok: false, error: "<message>" }` with a 500.

### `POST /api/localdev/clear`

Calls [`clearAll()`](../../server/src/seed.ts): same wipe as above, no insert. Wired to the **Clear all data** button.

**Response:** `{ ok: true, message: "Cleared all data for instance \"dev-instance\"." }`.

Add your own localdev tooling (fixture downloads, cache inspection, etc.) to [`server/src/routes/localdev.ts`](../../server/src/routes/localdev.ts) and wire them up from `DevView.tsx` for a UI affordance.

---

## Static assets

- `/assets/*` — Vite-built SPA assets, served with `immutable, max-age=31536000` cache headers and `Cross-Origin-Resource-Policy: same-origin`.
- `/widget/*` — widget bundle from `dist/public/widget/`, served with ETag-based conditional responses (`If-None-Match` → `304`) and `Cross-Origin-Resource-Policy: cross-origin` so Staffbase Studio can load it.
- `/*` — SPA catch-all (`serveStatic` from `dist/public`), always last.
