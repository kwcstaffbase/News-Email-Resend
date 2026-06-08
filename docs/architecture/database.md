# Database

PostgreSQL 16, accessed via [Drizzle ORM](https://orm.drizzle.team/) with the `postgres.js` driver. All tables carry an `instance_id` column for multi-tenant isolation — a single database can serve multiple Staffbase tenant instances without cross-tenant data leakage.

## Contents

- [Schema](#schema)
- [Multi-tenancy](#multi-tenancy)
- [Migrations](#migrations)
- [Connection & configuration](#connection--configuration)
- [Instance reconciliation](#instance-reconciliation)

## Schema

Schema is defined in [`server/src/db/schema.ts`](../../server/src/db/schema.ts). The template ships **four core tables** (users, sessions, settings, changelog) plus one **demo table** (`items`) that backs the worked Admin View. Keep, replace, or delete the demo table — extend with your own plugin-specific tables as you build features.

### `users`

Display-name cache for Staffbase users. Populated by write-through on mutations and refreshed via per-user `GET /api/users/{userId}` calls (`refreshAllUsers()` every `USER_CACHE_REFRESH_HOURS`, default 2.5h). No FK relationships — this is a cache table.

| Column        | Type        | Notes                                |
| ------------- | ----------- | ------------------------------------ |
| `user_id`     | `text`      | Primary key — Staffbase user ID       |
| `instance_id` | `text`      | Tenant isolation                     |
| `first_name`  | `text`      | Nullable                             |
| `last_name`   | `text`      | Nullable                             |
| `status`      | `text`      | Default `"active"`                   |
| `updated_at`  | `timestamp` | Last refresh time                    |

### `sessions`

Server-side auth sessions (Safari ITP bypass). Ephemeral — cleaned every `SESSION_CLEANUP_HOURS` (default 1h). Also cleaned immediately when a user is removed from Staffbase (`cleanupDeletedUser()`). See [sessions.md](sessions.md) for full lifecycle.

| Column                    | Type        | Notes                               |
| ------------------------- | ----------- | ----------------------------------- |
| `id`                      | `text`      | Primary key — `crypto.randomUUID()` |
| `user_id`                 | `text`      | Staffbase user ID                   |
| `instance_id`             | `text`      | Tenant isolation                    |
| `role`                    | `text`      | `"editor"` or `"user"`              |
| `expires_at`              | `timestamp` | Session expiry                      |
| `created_at`              | `timestamp` | Default `NOW()`                     |
| `staffbase_session_hash`  | `text`      | Nullable; from the JWT `sid` claim  |

**Indexes:** `sessions_expires_at_idx`, `sessions_user_id_idx`, `sessions_staffbase_hash_idx (instance_id, staffbase_session_hash)`

### `settings`

Per-instance admin configuration. Stores the Staffbase host URL (auto-populated from the JWT `issuer_domain` claim on every page load) and the AES-256-GCM–encrypted API token. One row per `instance_id`.

| Column           | Type        | Notes                                                                                                                       |
| ---------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `instance_id`    | `text`      | Primary key — Staffbase instance ID                                                                                          |
| `staffbase_url`  | `text`      | Nullable. Base URL, e.g. `https://company.staffbase.com`. Auto-populated from JWT.                                          |
| `api_token`      | `text`      | Nullable. AES-256-GCM ciphertext (`iv_hex:tag_hex:ct_hex`) of the Staffbase API token. Configured by editor via Settings ⚙. |
| `updated_at`     | `timestamp` | Set to `NOW()` on every write                                                                                                |

The API token is **never returned in plaintext** by the API — `GET /api/settings` returns `{ hasApiToken: boolean }` instead. The decryption key is controlled by the `ENCRYPTION_KEY` environment variable (64-char hex / 32 bytes).

### `items` (demo)

Generic example entity that drives the Admin View showcase (table + filter + sort + paginate + segmented tabs + CRUD dialog). Not used by any infrastructure — purely a worked example of how to add a tenant-scoped table with CRUD + audit-log writes. Drop or rename when you build your own domain.

| Column                 | Type        | Notes                                              |
| ---------------------- | ----------- | -------------------------------------------------- |
| `id`                   | `uuid`      | Primary key — `gen_random_uuid()`                  |
| `instance_id`          | `text`      | Tenant isolation                                   |
| `name`                 | `text`      | Display name                                       |
| `description`          | `text?`     | Optional long-form description                     |
| `category`             | `text`      | `general` / `important` / `internal` / `external`  |
| `status`               | `text`      | `active` / `archived` (drives SegmentedControl)    |
| `created_by_user_id`   | `text?`     | Author snapshot                                    |
| `created_at`           | `timestamp` | Default `NOW()`                                    |
| `updated_at`           | `timestamp` | Bumped on every PUT                                |

**Indexes:** `items_instance_id_idx`, `items_instance_status_idx (instance_id, status)`

### `changelog`

Append-only audit log of all admin mutations. One row per action. Never updated — only inserted and (on GDPR delete / instance delete) modified or hard-deleted.

| Column          | Type        | Notes                                                                                                       |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------- |
| `id`            | `uuid`      | Primary key — `gen_random_uuid()`                                                                           |
| `instance_id`   | `text`      | Tenant isolation                                                                                            |
| `user_id`       | `text?`     | Staffbase user ID — set to `NULL` when user is GDPR-deleted                                                 |
| `user_name`     | `text?`     | Display name snapshot at action time; retained after GDPR delete                                            |
| `action`        | `text`      | `settings_updated` / `clear_all` / `user_sync` / `user_deleted` / `item_created` / `item_updated` / `item_deleted` |
| `entity_type`   | `text`      | `settings` / `user` / `system` / `item`                                                                     |
| `entity_id`     | `text?`     | UUID of affected entity (where applicable)                                                                  |
| `entity_name`   | `text?`     | Human-readable name snapshot at action time                                                                 |
| `summary`       | `text`      | One-line human-readable description                                                                         |
| `payload`       | `jsonb?`    | Action-specific detail (changed fields, counts, etc.)                                                       |
| `gdpr_relevant` | `boolean`   | `true` for actions that touch personal data                                                                 |
| `created_at`    | `timestamp` | Default `NOW()`; used for ordering and index                                                                |

> When you rip out the demo `items` table, narrow the `ChangelogAction` and `ChangelogEntityType` unions in both [`server/src/lib/changelog.ts`](../../server/src/lib/changelog.ts) and [`client/src/types/api.ts`](../../client/src/types/api.ts) to drop the `item_*` variants. The `ACTION_PILL_VARIANT` map in [`client/src/components/admin/ChangelogDialog.tsx`](../../client/src/components/admin/ChangelogDialog.tsx) must stay in sync.

**Indexes:** `changelog_instance_id_created_at_idx` on `(instance_id, created_at DESC)`

**GDPR behaviour:** `cleanupDeletedUser()` sets `user_id = NULL` for all rows matching the deleted user's ID (retaining the `user_name` snapshot). `deleteInstance()` deletes all rows for the instance in the same transaction as the other tables.

---

## Multi-tenancy

Every table must carry an `instance_id` column. The CI guard [`server/src/scripts/validate-migrations.ts`](../../server/src/scripts/validate-migrations.ts) refuses any new `CREATE TABLE` without one (except entries in `EXEMPT_TABLES`, used for FK-cascade join tables).

Route handlers query via `c.var.scopedDb.where.<table>` — a pre-built Drizzle predicate set in [`server/src/db/scoped.ts`](../../server/src/db/scoped.ts). When you add a new table, add it to `scoped.ts` so handlers can compose `and(where.foo, eq(foo.id, id))` against it.

---

## Migrations

Migrations live in [`server/src/db/migrations/`](../../server/src/db/migrations/) and are managed by [Drizzle Kit](https://orm.drizzle.team/kit-docs/overview).

The template ships a single `0000_initial_template.sql` that creates all five tables (four core + `items` demo). Generate new migrations with:

```bash
# Apply pending migrations (requires DATABASE_URL)
bun migrate

# Generate a new migration after changing schema.ts
cd server && bun drizzle-kit generate
```

---

## Connection & configuration

**Config:** [`server/drizzle.config.ts`](../../server/drizzle.config.ts)

```ts
{
  dialect: "postgresql",
  schema:  "./src/db/schema.ts",
  out:     "./src/db/migrations",
  dbCredentials: { url: process.env.DATABASE_URL }
}
```

**Client:** [`server/src/db/client.ts`](../../server/src/db/client.ts)

- Uses `postgres.js` driver (max 10 connections)
- Set `LOG_SQL=true` to print every SQL query to stdout (local dev only)

---

## Instance reconciliation

Staffbase sends a `deleteInstance` webhook when a customer permanently deletes a plugin installation (after the 30-day trash grace window). Webhook delivery can fail; orphaned `instance_id` values would otherwise accumulate.

[`server/src/scripts/audit-instances.ts`](../../server/src/scripts/audit-instances.ts) reconciles the DB against the Staffbase API and optionally purges orphaned instances. See the script header for usage; for the template it covers the four core tables (the `items` demo is intentionally **not** in `SCOPED_TABLES` because the audit-instances script's classification logic treats settings/users/sessions/changelog as the canonical signal for "is this instance live or stale" — a demo entity has no place influencing that signal). When you add new scoped tables that *should* contribute to live/stale classification, add them to the `SCOPED_TABLES` registry at the top of the script.

## Local dev seed

[`server/src/seed.ts`](../../server/src/seed.ts) populates the `items` table (and a few sample `users` rows) for local development so the Admin View has something to render. Triggered from the `/dev` page's **Seed sample data** button, the localdev API (`POST /api/localdev/seed` and `/clear` — only mounted when `IS_LOCALDEV=true`), or via the CLI:

```bash
cd server
bun src/seed.ts        # insert
bun src/seed.ts clear  # wipe
```

`INSTANCE_ID` defaults to `dev-instance` (override via `LOCALDEV_INSTANCE_ID`). The seed wipes the target instance first so it is safe to re-run.
