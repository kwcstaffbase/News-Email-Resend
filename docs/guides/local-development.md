# Local Development

## Contents

- [Quick start](#quick-start)
- [Docker services](#docker-services)
- [Environment variables](#environment-variables)
- [SSO bypass](#sso-bypass)
- [Seeding sample data](#seeding-sample-data)
- [URL parameters (client)](#url-parameters-client)
- [Vite proxy](#vite-proxy)
- [Widget standalone preview](#widget-standalone-preview)
- [Testing the Activity Log (changelog) locally](#testing-the-activity-log-changelog-locally)
- [Commands reference](#commands-reference)

## Quick start

```bash
# 1. Set your npm token (required for @staffbase/* packages)
export NPM_TOKEN=<your-staffbase-npm-token>

# 2. Start everything — handles install, Docker, migrations, and dev servers
bun run dev
```

`bun run dev` automatically:

- installs dependencies (and re-installs after `git pull` if `bun.lock` changed)
- copies `.env.example` → `.env` if no `.env` exists yet
- checks Docker is running and starts `docker-compose up -d` if postgres is not already up
- waits for the postgres healthcheck to pass
- applies any pending database migrations
- starts the Hono server on `:3000` and Vite client on `:5173` in parallel

```mermaid
flowchart LR
    A([bun run dev]) --> B[docker-compose up -d<br/>postgres + pgweb]
    B --> C[bun migrate<br/>apply pending SQL]
    C --> D[Hono server<br/>localhost:3000]
    C --> E[Vite dev server<br/>localhost:5173]
    E -->|"/api/* proxy"| D
    D --> F[(PostgreSQL 16<br/>localhost:5432)]
    F2[pgweb<br/>localhost:8081] --> F
```

Press `Ctrl+C` to stop the dev servers (Docker containers keep running for fast restarts).

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/api/*` to the Hono backend at `:3000` automatically.

> **Browser URLs:** Always open `http://localhost:5173` (Vite), `http://localhost:5173/admin`, or `http://localhost:5173/dev` in the browser. Port `:3000` is the API server only.

---

## Docker services

Defined in [`docker-compose.yml`](../../docker-compose.yml).

| Service    | Image                   | Port   | Purpose                   |
| ---------- | ----------------------- | ------ | ------------------------- |
| `postgres` | `postgres:16-alpine`    | `5432` | Primary database          |
| `pgweb`    | `sosedoff/pgweb:latest` | `8081` | Browser-based DB explorer |

Credentials are intentionally hardcoded for local dev only (`dev` / `dev`). The `DATABASE_URL` in `.env.example` already points to these.

---

## Environment variables

Copy `.env.example` to `.env`. All variables work without modification for local dev.

### Server-side (read by Hono at runtime)

| Variable             | Example                                                         | Required | Description                                                                                                                                                                              |
| -------------------- | --------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IS_LOCALDEV`        | `true`                                                          | Yes      | Bypasses SSO validation; enables `/api/localdev/*` routes                                                                                                                                |
| `DATABASE_URL`       | `postgresql://dev:dev@localhost:5432/cc-custom-plugin-template` | Yes      | Drizzle ORM + migrations                                                                                                                                                                 |
| `PORT`               | `3000`                                                          | No       | Server listen port (default: `3000`)                                                                                                                                                     |
| `LOCALDEV_ROLE`      | `editor` \| `user`                                              | No       | Synthetic JWT role (default: `user`)                                                                                                                                                     |
| `LOCALDEV_USER_ID`   | `local-user-1`                                                  | No       | Synthetic user ID                                                                                                                                                                        |
| `LOCALDEV_USER_NAME` | `Local Dev User`                                                | No       | Synthetic display name                                                                                                                                                                   |
| `LOG_SQL`            | `true`                                                          | No       | Print every SQL query to stdout                                                                                                                                                          |
| `LOG_API`            | `true`                                                          | No       | Print every outgoing Staffbase API request and its status                                                                                                                                |
| `LOG_FORMAT`         | `pretty`                                                        | No       | `pretty` — coloured human-readable output (default in local dev); `json` — newline-delimited JSON (default in production). See [logging.md](../reference/logging.md).                    |
| `LOG_LEVEL`          | `INFO`                                                          | No       | Minimum log level: `DEBUG` \| `INFO` \| `WARN` \| `ERROR` (default: `INFO`).                                                                                                             |
| `ENCRYPTION_KEY`     | `0000...0000` (64 zeroes)                                       | No       | 32-byte AES key as 64 hex chars. In local dev the zero placeholder is fine. In production, generate with `openssl rand -hex 32`. Used to encrypt the API token stored in the `settings` table. |
| `CORS_ORIGINS`       | `http://localhost:5173`                                         | No       | Comma-separated allowed origins                                                                                                                                                          |

> **Production-only:** `PLUGIN_ID`, `PUBLIC_KEY`, and a non-zero `ENCRYPTION_KEY` are required in production. `PLUGIN_ID` and `PUBLIC_KEY` control JWT validation.
>
> The Staffbase API token itself is configured through the admin Settings dialog (⚙) after first deploy — it is stored AES-256-GCM encrypted in the `settings` table, not as an environment variable.

### Client-side (injected at Vite build time)

Vite reads these from the root `.env` (via `envDir: ".."` in `vite.config.ts`) and bakes them in as `import.meta.env.*` at build time. They are only used when `window.__JWT_TOKEN__ === "dev"` (i.e. the Vite dev server index.html).

`LOCALDEV_USER_ID`, `LOCALDEV_USER_NAME`, and `LOCALDEV_ROLE` are shared with the server section above — `vite.config.ts` maps them to the `VITE_DEV_*` build-time substitution keys automatically.

| Variable               | Example                         | Description                                                    |
| ---------------------- | ------------------------------- | -------------------------------------------------------------- |
| `VITE_DEV_INSTANCE_ID` | `dev-instance`                  | Tenant ID used for all DB queries                              |
| `VITE_DEV_LANGUAGES`   | `en_US,de_DE,es_ES,fr_FR,pl_PL` | Comma-separated locales available for content language         |

---

## SSO bypass

When `IS_LOCALDEV=true`, the `ssoMiddleware` skips all JWT validation. User context is injected entirely from the server-side env vars above. The JWT from the client is never inspected.

> **Parity guard:** The server refuses to boot when `NODE_ENV=production` and `IS_LOCALDEV=true` are both set, throwing before `serve(...)` is called. This makes it structurally impossible to ship an SSO-bypassed build to a production cluster. See `server/src/index.ts` and `server/src/__tests__/localdev-guard.test.ts`.

Change `LOCALDEV_ROLE` in `.env` and restart the server to test different roles.

---

## Seeding sample data

The template ships a demo `items` table that backs the worked Admin View. On a fresh dev DB the table is empty — seed it so the table, filters, pagination, and SegmentedControl tabs all have data to render:

| Trigger                              | What it does                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| Click **Seed sample data** on `/dev` | UI path. POSTs `/api/localdev/seed`. Calls into [`server/src/seed.ts`](../../server/src/seed.ts) which wipes the target instance and inserts 20 generic items (mix of categories + statuses) + 3 sample users. |
| Click **Clear all data** on `/dev`   | UI path. POSTs `/api/localdev/clear`. Drops everything for the target instance.        |
| `curl -X POST :3000/api/localdev/seed` / `…/clear` | Same as buttons, useful from a script.                                          |
| `cd server && bun src/seed.ts`       | CLI path. Same behaviour. Accepts `clear` as the first arg to wipe.                     |

The `/api/localdev/*` routes are **only mounted when `IS_LOCALDEV=true`** ([`server/src/app.ts`](../../server/src/app.ts)) so they can never reach production. `INSTANCE_ID` for the seed defaults to `dev-instance`; override via `LOCALDEV_INSTANCE_ID`.

To change what gets seeded, edit `SEED_ITEMS` and `SAMPLE_USERS` in [`server/src/seed.ts`](../../server/src/seed.ts).

---

## URL parameters (client)

### UI language

In development mode only, append `?lang=<code>` to switch the interface language:

```
http://localhost:5173/?lang=de          # German UI
http://localhost:5173/?lang=fr          # French UI
http://localhost:5173/admin?lang=es     # Spanish admin UI
```

Supported codes: `en`, `de`, `es`, `fr`, `pl`.

### JWT injection (production flow simulation)

In production, Staffbase passes the JWT as a `?jwt=<token>` query param in the iframe URL. The server reads it, validates it, injects the raw token into the HTML response, then the client strips the param from `window.location` on boot.

In local dev this entire flow is bypassed — no `?jwt=` param is needed.

---

## Vite proxy

The Vite dev server proxies all `/api/*` requests to `http://localhost:3000` (the Hono server). This means the client code never needs to know about different hosts in dev vs production.

Defined in [`client/vite.config.ts`](../../client/vite.config.ts):

```ts
server: {
  proxy: {
    "/api": { target: "http://localhost:3000", changeOrigin: true }
  }
}
```

---

## Widget standalone preview

The widget has its own isolated preview server that renders the `<plugin-template-widget>` custom element without needing a Staffbase Studio instance.

```bash
cd widget && bun run preview   # http://localhost:5174
```

The preview HTML shows the widget inside a styled frame and exposes a single `installation_id` text input that re-renders the shadow root on change. Edit `widget/preview/index.html` to add controls as you add attributes to your widget.

The preview server watches `widget/src/` and rebuilds on save.

> **Installation picker limitation**: the picker calls the Staffbase platform endpoint `/api/plugins/{pluginId}/installations/search?permission=manage`. The preview server cannot mock that endpoint, so the picker UI is not exercised locally — only viewer-side rendering is. For full picker E2E you need a real Staffbase tenant where the plugin is installed; upload the built bundle through Studio. See README "Where to extend → Widget UI" for the deployment flow.

---

## Testing the Activity Log (changelog) locally

All admin mutations (settings changes, clear-all, user sync, user delete) are recorded by `logChange()` in [`server/src/lib/changelog.ts`](../../server/src/lib/changelog.ts). To verify the audit trail:

```bash
# View recent entries (replace SESSION_COOKIE with a localdev session ID from the DB)
curl -s "http://localhost:3000/api/changelog?limit=5" \
  -H "Cookie: sb_session=<SESSION_COOKIE>" | jq .

# Filter by action type
curl -s "http://localhost:3000/api/changelog?action=settings_updated" \
  -H "Cookie: sb_session=<SESSION_COOKIE>" | jq '.data[].summary'

# Filter by entity type
curl -s "http://localhost:3000/api/changelog?entityType=settings" \
  -H "Cookie: sb_session=<SESSION_COOKIE>" | jq .

# Download NDJSON export
curl -s "http://localhost:3000/api/changelog/export" \
  -H "Cookie: sb_session=<SESSION_COOKIE>" \
  -o audit-log.ndjson && wc -l audit-log.ndjson
```

The Activity Log is accessible from the Settings dialog in the admin panel: click ⚙ **Settings** → **View Activity Log**.

---

## Commands reference

```bash
bun run dev        # Full bootstrap: Docker → migrations → server + client (hot reload)
bun run dev:apps   # Start server + client only (skips Docker/migration orchestration)
bun run build      # Production build: Vite → dist/public, then server bundle
bun run build:widget   # Build the standalone widget bundle
bun run check                  # Biome lint + format + design-system guard (run before every commit)
bun run check:design-system    # Only the design-system guard (scripts/lint-design-system.ts)
biome check --write server/src/ client/src/ scripts/   # Auto-fix Biome lint/format issues

# Widget standalone preview (http://localhost:5174)
cd widget && bun run preview

# Server tests (Bun test — scoped to server/src via bunfig.toml)
bun test
bun test --coverage

# Widget unit tests (Bun test)
cd widget && bun test

# Client tests (Vitest)
cd client && bun run test
cd client && bun run test:coverage

# E2E tests (Playwright — requires bun run dev)
bunx playwright test
bunx playwright test --grep @smoke

# Database
bun migrate
cd server && bun drizzle-kit generate   # Generate a new migration after schema.ts changes
```

### Running E2E tests locally

E2E tests require the full stack running in localdev mode:

1. Start the dev server: `bun run dev` (handles Docker + migrations automatically)
2. Run Playwright: `bunx playwright test` (runs on Chromium, Firefox, WebKit)

`globalSetup` in `e2e/global-setup.ts` waits for `/health` and is otherwise a no-op. `e2e/tests/util/seed.ts` is a stub — wire it to `POST /api/localdev/seed` when you start writing E2E specs that need pre-populated `items` data. The Playwright config auto-starts `bun run dev` and reuses an existing server if one is already running.

Tests use role-based fixtures (`editorPage` / `userPage`) from `e2e/fixtures.ts` to verify UI behaviour for both editor and regular user roles. See [`testing.md`](testing.md) for details.
