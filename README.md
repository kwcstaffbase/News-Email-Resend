# cc-custom-plugin-template

Production-grade starter template for **Staffbase custom plugins**.

Ships with all the boring-but-critical infrastructure already wired up — SSO, GDPR delete handling, session management (with Safari ITP workaround), per-tenant settings with encrypted API tokens, audit log, structured logging, multi-tenant DB isolation, multi-language i18n, error boundary, theme injection, CSP frame-ancestors — plus a working **demo Admin View** built around a generic `items` table (CRUD + filter + sort + paginate + segmented tabs) you can rip out and replace with your own domain, an empty **End User View**, and a **widget** with a working **installation picker** so editors can bind the widget to the right plugin installation when one tenant has multiple.

Clone this template, rename, and start building. You should not need to think about auth, sessions, GDPR, or multi-tenancy.

---

## What's included

### Backend (`server/`)
- **[Bun](https://bun.sh)** runtime + **[Hono](https://hono.dev)** web framework
- **[Drizzle ORM](https://orm.drizzle.team)** with PostgreSQL — 5 tables (users, sessions, settings, changelog, **items** demo), all `instance_id`-scoped via [`scopedDb`](server/src/db/scoped.ts)
- **Staffbase SSO** via `@staffbase/plugins-sdk` — JWT validation, role extraction, per-instance session cookies
- **GDPR data-deletion intercept** — `sub === "delete"` JWTs trigger a full `deleteInstance()` before any session is issued
- **Audit log** with GDPR-relevance flag — every admin mutation appended via `logChange()`
- **Encrypted API token storage** — AES-256 via `crypto.ts`, decrypted only when forwarding to Staffbase Platform API
- **Background tasks** — expired session purge, SCIM user-cache refresh
- **Structured logging** — pino-style logger with module tags and instance context
- **Health/metrics/public** routes — Prometheus-format metrics, liveness probe
- **Demo `items` CRUD route** ([server/src/routes/items.ts](server/src/routes/items.ts)) — list (search + sort + filter + paginate), create, update, delete; writes to changelog. Treat it as a worked example for adding your own domain.
- **Localdev seed** ([server/src/seed.ts](server/src/seed.ts)) — `POST /api/localdev/seed` and `/clear` (mounted only when `IS_LOCALDEV=true`), CLI: `cd server && bun src/seed.ts [seed|clear]`

### Frontend (`client/`)
- **React 19** + **React Router 7** + **React Query 5** + **Vite 8**
- **Tailwind CSS 4** with the **[Staffbase Design System](https://design.staffbase.com)** preset
- **i18next** with 5 default languages (en, de, es, fr, pl) and per-customer override loading
- **Per-customer theme injection** — server-side CSS-variable injection (`--brand-*`) before paint to avoid FOUC
- **Session-expired overlay** with automatic 401-detection
- **Auth context** reading from `window.__USER__` (server-injected) or `VITE_DEV_*` env vars (Vite dev path)
- **Staffbase plugins-client-sdk** integration for content language + instance URL detection
- **Error boundary** with translated fallback UI
- **Worked Admin View** ([client/src/pages/AdminView.tsx](client/src/pages/AdminView.tsx)) showcasing the Design System: `Table`, `Pagination`, `SearchInput`, `Filter` dropdown, `Select` sort, `SegmentedControl` tabs, `Pill`, `Menu`, `AlertDialog`, `Dialog`, `EmptyState`, `Skeleton`, `Field`, `TextArea`, `TextField`. Drop the items domain, keep the patterns.

### Quality tooling
- **[Biome 2](https://biomejs.dev)** — formatter + linter (no ESLint/Prettier)
- **[Vitest](https://vitest.dev)** — client unit tests with **MSW** mocking, jsdom env
- **[Bun test](https://bun.sh/docs/cli/test)** — server unit tests
- **[Playwright](https://playwright.dev)** — E2E + accessibility tests (axe-core)
- **Strict TypeScript** across both workspaces with `@/*` path aliases
- **Pre-commit hooks** (Biome check)

### Widget (`widget/`)
- **Shadow DOM** custom-element widget scaffolding via `@staffbase/widget-sdk`
- **Standalone Bun build** that produces a minified IIFE bundle + Studio manifest
- **Hot-reload preview server** (`bun run preview` inside `widget/`) on port `5174`
- **Installation picker** ([widget/src/installation-picker.tsx](widget/src/installation-picker.tsx)) — custom RJSF `ui:widget` rendered in the Studio config dialog. Lets editors pick *which* plugin installation this widget instance binds to when the same plugin is installed multiple times on one tenant. Reads `pluginId` from `/api/public/instance`, lists installations via `/api/plugins/{pluginId}/installations/search?permission=manage` (Staffbase platform endpoint, session-cookie auth). Selected UUID is persisted to the `installation_id` widget attribute and consumed by the viewer-side render.
- Placeholder render in [widget/src/widget.ts](widget/src/widget.ts) — replace with your plugin-specific UI. Reads `installation_id` and scopes all subsequent fetches to that installation.

### Ops
- **Docker** multi-stage build (alpine builder → distroless runner, non-root)
- **GitHub Actions** workflows
- **Backstage** catalog descriptor (`catalog-info.yaml`)
- **mkdocs-techdocs-core** documentation site

---

## Quickstart

Prerequisites: Bun ≥ 1.0, Docker (for local Postgres), Node ≥ 24 (for engines check), `NPM_TOKEN` with read access to `@staffbase` private packages.

```bash
git clone <this-repo> my-plugin
cd my-plugin
export NPM_TOKEN=<your-token>
cp .env.example .env
bun install
bun run dev
```

`bun run dev` (driven by [`scripts/dev.ts`](scripts/dev.ts)) brings up Postgres via Docker Compose, runs migrations, starts the Hono server on `:3000`, and starts the Vite dev server on `:5173`.

Open:
- `http://localhost:5173/` — End User View placeholder
- `http://localhost:5173/admin` — Admin View with the items demo (only visible with `LOCALDEV_ROLE=editor`)
- `http://localhost:5173/dev` — Dev tools: **Seed sample data** + **Clear all data** buttons (20 generic items)
- `http://localhost:3000/health` — server liveness probe
- `http://localhost:8081` — pgweb (Postgres web UI)

First-time admin demo: click **Seed sample data** on `/dev`, then open `/admin` — table shows 17 active items, segmented tab switches to 3 archived, search/category-filter/sort all reactive.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  Staffbase Host App (iframe)                                │
│   │                                                         │
│   ▼                                                         │
│  Hono Server (server/)                                      │
│   ├─ /            → SPA HTML with injected user/session/CSP │
│   ├─ /admin       → SPA HTML (editor-only by client guard)  │
│   ├─ /api/*       → SSO-gated JSON API                      │
│   │    ├─ /api/admin/clear-all  ── GDPR/danger zone         │
│   │    ├─ /api/changelog        ── audit log                │
│   │    ├─ /api/settings         ── per-instance config      │
│   │    ├─ /api/items            ── demo CRUD (list/create…) │
│   │    └─ /api/users/me         ── user identity            │
│   └─ /health · /api/metrics · /api/public  ── unauthenticated │
│      (/api/localdev/*  ── only when IS_LOCALDEV=true)        │
│                                                             │
│  Postgres (5 tables, all instance_id-scoped)                │
│   ├─ users    · SCIM cache                                  │
│   ├─ sessions · per-instance session UUIDs                  │
│   ├─ settings · staffbase_url, encrypted api_token          │
│   ├─ items    · demo entity for the worked Admin View       │
│   └─ changelog · append-only audit trail                    │
└─────────────────────────────────────────────────────────────┘
```

Detailed docs in [`docs/`](docs/):
- [`docs/architecture/architecture.md`](docs/architecture/architecture.md) — full structure + component hierarchy
- [`docs/architecture/sessions.md`](docs/architecture/sessions.md) — auth flow, session lifecycle, GDPR, JWT, transport hardening
- [`docs/architecture/database.md`](docs/architecture/database.md) — schema, migrations
- [`docs/architecture/i18n.md`](docs/architecture/i18n.md) — UI vs content language
- [`docs/guides/extending.md`](docs/guides/extending.md) — **how to add routes, tables, pages, translations** ← start here when building features
- [`docs/guides/local-development.md`](docs/guides/local-development.md) — env vars, Docker, Vite proxy
- [`docs/guides/testing.md`](docs/guides/testing.md) — three-tier test suite
- [`docs/reference/api.md`](docs/reference/api.md) — full API reference
- [`docs/reference/logging.md`](docs/reference/logging.md) — field conventions, VictoriaLogs queries
- [`docs/adrs/`](docs/adrs/) — ADR-0001 through ADR-0008 (0007: widget shadow DOM, 0008: widget installation picker)

---

## Where to extend

| You want to add… | Edit |
|---|---|
| End-user UI | [client/src/pages/EndUserView.tsx](client/src/pages/EndUserView.tsx) |
| Admin UI | [client/src/pages/AdminView.tsx](client/src/pages/AdminView.tsx) (built around `ItemsList` + `ItemForm` + `AdminLayout` — keep the layout shell, swap the domain) |
| A new server route | Add file to [server/src/routes/](server/src/routes/), mount in [server/src/app.ts](server/src/app.ts), add test in [server/src/__tests__/](server/src/__tests__/). See [server/src/routes/items.ts](server/src/routes/items.ts) for the list-search-sort-filter-paginate + CRUD recipe. |
| A new DB table | Add to [server/src/db/schema.ts](server/src/db/schema.ts) (always include `instance_id`), update [server/src/db/scoped.ts](server/src/db/scoped.ts), run `cd server && bun drizzle-kit generate`, list in `plugin.json` `storage.tables`, extend [server/src/lib/remote-calls.ts:deleteInstance](server/src/lib/remote-calls.ts) so GDPR purges it. |
| A new client hook | Add to [client/src/hooks/](client/src/hooks/), add `__tests__/` next to it |
| A new locale string | Add key to all 5 locale folders under [client/src/locales/](client/src/locales/) (`template.json` for user-facing, `admin.json` for admin) |
| A new ADR | Add to [docs/adrs/](docs/adrs/), register in [mkdocs.yml](mkdocs.yml) |
| Widget UI | Edit [widget/src/widget.ts](widget/src/widget.ts) and [widget/src/configuration-schema.ts](widget/src/configuration-schema.ts); preview with `cd widget && bun run preview`. The `installation_id` picker is already wired — additional config fields go in `configurationSchema.properties` + the `WIDGET_ATTRS` array + the manifest. |
| Seed sample data shape | Edit [server/src/seed.ts](server/src/seed.ts) (`SEED_ITEMS` / `SAMPLE_USERS`) |

See [`docs/guides/extending.md`](docs/guides/extending.md) for full step-by-step recipes.

---

## Rename checklist (when forking this template)

The template ships with the name `cc-custom-plugin-template`. To rebrand it for your plugin:

1. **Project name** — find/replace `cc-custom-plugin-template` → your-plugin-slug across:
   - [package.json](package.json) `"name"`
   - [server/package.json](server/package.json) `"name"`
   - [client/package.json](client/package.json) `"name"`
   - [docker-compose.yml](docker-compose.yml) `POSTGRES_DB` + `PGWEB_DATABASE_URL`
   - [.env.example](.env.example) `DATABASE_URL`
   - [docker/Dockerfile](docker/Dockerfile) image-name comment
   - [catalog-info.yaml](catalog-info.yaml) `metadata.name` (both Resource and Component)
2. **Display name** — edit [plugin.json](plugin.json):
   - `name`, `title.en_US`, `title.de_DE`, `description`
   - `widgets[0]` — `tagName`, `title`, `description`, `module`, `configAttributes`
   - Also edit [widget/package.json](widget/package.json) (`name`, `label`), [widget/manifest.json](widget/manifest.json), and the `WIDGET_TAG` + `bundleBaseName` in [widget/src/widget.ts](widget/src/widget.ts) + [widget/scripts/build.ts](widget/scripts/build.ts)
3. **Backstage entity** — edit [catalog-info.yaml](catalog-info.yaml) `metadata.title` and `metadata.description`
4. **GitHub project slug** — edit [catalog-info.yaml](catalog-info.yaml) `github.com/project-slug`
5. **i18n namespace** (optional) — if you want to rename the `template` namespace, edit:
   - [client/src/i18n/init.ts](client/src/i18n/init.ts) `defaultNS`
   - [client/src/i18next.d.ts](client/src/i18next.d.ts) namespace types
   - [client/src/hooks/useI18n.ts](client/src/hooks/useI18n.ts) namespace argument
   - Rename `client/src/locales/<lang>/template.json` files
6. **Docs site name** — edit [mkdocs.yml](mkdocs.yml) `site_name`
7. **README** — replace this file with one describing your plugin

---

## Production deployment

The plugin is designed to be deployed as a single Docker container behind the Staffbase platform's reverse proxy.

Required env vars in production:
```
PLUGIN_ID=<assigned by Staffbase platform>
PUBLIC_KEY=<RSA public key from Staffbase, PEM format>
ENCRYPTION_KEY=<64-char hex string, from openssl rand -hex 32>
DATABASE_URL=postgresql://...
CORS_ORIGINS=https://yourcompany.staffbase.com,https://app.staffbase.com
PORT=3000
LOG_FORMAT=json
LOG_LEVEL=INFO
```

See [`docs/adrs/0006-gitops-deployment.md`](docs/adrs/0006-gitops-deployment.md) for the deployment model and [`docs/architecture/sessions.md`](docs/architecture/sessions.md) for the JWT/PUBLIC_KEY contract.

---

## Operational Links

> Fork-customize: replace `<PLUGIN_NAME>` and per-env URLs with the real
> values once the plugin is deployed.

| Resource | dev/de1 | stage/de1 | prod/de1 | prod/au1 | prod/us1 |
|---|---|---|---|---|---|
| Backstage | [`<PLUGIN_NAME>` component](https://backstage.staffbase.com/catalog/default/component/<PLUGIN_NAME>) | — | — | — | — |
| Grafana | [dashboard](https://observatory-dev-de1.staffbase.com/d/<plugin-uid>) | [dashboard](https://observatory-stage-de1.staffbase.com/d/<plugin-uid>) | [dashboard](https://observatory-de1.staffbase.com/d/<plugin-uid>) | [dashboard](https://observatory-au1.staffbase.com/d/<plugin-uid>) | [dashboard](https://observatory-us1.staffbase.com/d/<plugin-uid>) |
| VictoriaLogs | [explore](https://observatory-dev-de1.staffbase.com/explore?...&namespace=<PLUGIN_NAME>) | [explore](https://observatory-stage-de1.staffbase.com/explore?...&namespace=<PLUGIN_NAME>) | [explore](https://observatory-de1.staffbase.com/explore?...&namespace=<PLUGIN_NAME>) | [explore](https://observatory-au1.staffbase.com/explore?...&namespace=<PLUGIN_NAME>) | [explore](https://observatory-us1.staffbase.com/explore?...&namespace=<PLUGIN_NAME>) |
| Vault path | `de1/dev/<PLUGIN_NAME>/` | `de1/stage/<PLUGIN_NAME>/` | `de1/prod/<PLUGIN_NAME>/` | `au1/prod/<PLUGIN_NAME>/` | `us1/prod/<PLUGIN_NAME>/` |
| Customer Control | [staging](https://customer-control.stage.staffbase.dev/) — feature flags, branches | (same) | (same) | (same) | (same) |
| Mops manifests | `mops/kubernetes/namespaces/<PLUGIN_NAME>/dev/de1/` | `.../stage/de1/` | `.../prod/de1/` | `.../prod/au1/` | `.../prod/us1/` |
| Infrastructure | `infrastructure/github/staffbase/repositories/teams/cs-tech/<PLUGIN_NAME>.yml` | — | — | — | — |

See [`docs/guides/deployment-handoff.md`](docs/guides/deployment-handoff.md) for the seeding workflow.

---

## Test suite

```bash
bun run check                       # Biome lint + format
bun test                            # server unit tests (scoped via bunfig.toml)
cd client && bun run test           # client unit tests (Vitest + MSW)
bun run test:e2e                    # Playwright E2E
bun run test:e2e:smoke              # @smoke-tagged subset, Chromium only
bun run test:e2e:a11y               # axe-core accessibility tests
```

See [`docs/guides/testing.md`](docs/guides/testing.md) for layout and patterns.

---

## Troubleshooting

- **`bun install` fails with `403`** — `NPM_TOKEN` is unset or doesn't have access to the `@staffbase` org. Generate a GitHub token with `read:packages` and export it.
- **Migration fails with `relation "settings" does not exist`** — Postgres container isn't running. `docker compose up -d postgres`.
- **Vite dev server shows blank page** — check the browser console; usually a missing `VITE_DEV_*` env var. Copy `.env.example` → `.env` and re-run.
- **`/admin` redirects to `/` immediately** — `LOCALDEV_ROLE` is set to `user` in `.env`. Change to `editor`.
- **E2E tests time out on first run** — `bunx playwright install` to download browser binaries.

---

## License

Internal — Staffbase only.
