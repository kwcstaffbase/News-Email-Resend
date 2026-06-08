# Architecture

## Contents

- [Overview](#overview)
- [Repository structure](#repository-structure)
- [Auth flow](#auth-flow)
- [Role-based access control](#role-based-access-control)
- [Multi-tenancy](#multi-tenancy)
- [Branding architecture](#branding-architecture)
- [Widget](#widget)
- [Production build](#production-build)
- [Security invariants](#security-invariants)

## Overview

**Plugin Template** is a Staffbase Custom Plugin starter — a web application that renders inside a Staffbase iframe. It ships with all the infrastructure already wired up (SSO, sessions, GDPR delete, audit log, per-tenant settings, theme injection) plus a **worked Admin View** built around a generic `items` table (CRUD + filter + sort + paginate + segmented tabs) and an empty End User View, ready for plugin-specific feature work.

**Stack:** Bun 1.x · Hono 4 · React 19 · Vite 8 · PostgreSQL 16 · Drizzle ORM · TypeScript · Tailwind CSS v4 · Biome

---

## Repository structure

Bun workspace with two packages sharing a root `package.json`, plus a standalone `widget/` bundle:

```
cc-custom-plugin-template/
├── server/          # Hono API server (runs on Bun)
│   └── src/
│       ├── app.ts           # Hono app: middleware + route registration
│       ├── index.ts         # Entry point: starts HTTP server, validates env
│       ├── html.ts          # JWT injection into SPA HTML, CSP frame-ancestors
│       ├── db/
│       │   ├── schema.ts    # users, sessions, settings, changelog, items (demo)
│       │   ├── client.ts    # Drizzle + postgres.js
│       │   ├── scoped.ts    # Per-request tenant-scoped where helpers
│       │   ├── migrate.ts   # Drizzle migrator
│       │   └── migrations/  # Generated SQL
│       ├── middleware/      # ssoMiddleware, requireEditor, accessLog
│       ├── routes/          # admin · changelog · health · html · items · localdev · metrics · public · settings · users
│       ├── lib/             # changelog · crypto · logger · remote-calls · sessions · staffbase-api · user-cache
│       ├── seed.ts          # localdev sample data (items + users)
│       ├── scripts/         # validate-migrations · validate-plugin-manifest · audit-instances
│       └── types/           # Hono context type (AppEnv)
├── client/          # React SPA (bundled by Vite → ../dist/public)
│   └── src/
│       ├── App.tsx          # Router: / → EndUserView, /admin → AdminView, /dev → DevView
│       ├── main.tsx         # Boot: extract JWT, clean URL, init i18n, mount React
│       ├── token.ts         # Module-scoped JWT singleton
│       ├── api/             # Typed fetch wrapper (Authorization + X-Instance-Id headers)
│       ├── components/      # ErrorBoundary, studio/* (Pagination, Table, ToastProvider, …), admin/* (AdminLayout, ItemsList, ItemForm, SettingsDialog, ChangelogDialog, RelativeTimestamp)
│       ├── context/         # AuthContext, SessionContext
│       ├── hooks/           # useI18n, useAdminI18n, useClientKind, useInstanceUrl, useLanguages, useInstanceSettings
│       ├── i18n/            # i18next initialization + per-customer override merge
│       ├── locales/         # Translations: 5 languages × 2 namespaces (template, admin)
│       ├── pages/           # AdminView (items demo), EndUserView, DevView (seed/clear)
│       ├── types/           # API types (ChangelogEntry, Item, ItemCategory, …)
│       └── utils/           # cn, formatDate, locale, contentLanguages
├── widget/          # Staffbase custom widget: <plugin-template-widget> Shadow DOM element
│   ├── scripts/
│   │   ├── build.ts         # Bun.build IIFE bundler (virtual meta + SVG plugins)
│   │   └── preview.ts       # Hot-reload preview server on :5174
│   ├── src/
│   │   ├── widget.ts                # Custom element definition (Shadow DOM, no iframe)
│   │   ├── configuration-schema.ts  # ExternalBlockDefinition + JSONSchema + uiSchema for the editor
│   │   ├── installation-picker.tsx  # Custom RJSF ui:widget — editor picks which installation to bind
│   │   ├── api.ts                   # fetchDiscovery + fetchManageableInstallations
│   │   ├── plugin-url.ts            # Resolves plugin-server origin from <script src> at load time
│   │   └── svg.d.ts                 # `*.svg` import declaration
│   ├── assets/icon.svg              # Studio widget icon (32×32)
│   ├── preview/index.html           # Standalone preview shell
│   └── tests/                       # bun test
├── docker/
│   └── Dockerfile           # Multi-stage production build
└── docs/                    # This documentation
    └── adrs/                # Architecture Decision Records (ADR-0001 … ADR-0008)
```

---

## Auth flow

See [`docs/architecture/sessions.md`](sessions.md) for the full auth flow with sequence diagrams covering:

- JWT validation via `staffbase-plugin-sdk` and the `?jwt=` query param
- Per-instance session cookie (`sid-<instanceId>`) and the server-side `sessions` table
- Safari ITP workaround via `window.__SESSION_KEY__` injection
- GDPR delete intercept (`sub === "delete"`) and `deleteInstance()`
- Client-side 401 → session-expired overlay handling

---

## Role-based access control

JWT carries a `role` claim (`editor` or `user`). The server enforces this via `requireEditor` middleware on admin routes; the client mirrors it via `useAuth().isEditor` and redirects non-editors away from `/admin`.

In local development, set `LOCALDEV_ROLE=editor` in `.env` to act as an editor, or `LOCALDEV_ROLE=user` to act as a regular user.

---

## Multi-tenancy

Every DB table carries an `instance_id` column (enforced by [`server/src/scripts/validate-migrations.ts`](../../server/src/scripts/validate-migrations.ts)). Route handlers query through `c.var.scopedDb.where.<table>` — a pre-built Drizzle predicate that scopes every query to the current tenant.

Adding a new table:

1. Add the table to [`server/src/db/schema.ts`](../../server/src/db/schema.ts) with an `instance_id text NOT NULL` column.
2. Add the predicate to [`server/src/db/scoped.ts`](../../server/src/db/scoped.ts) so handlers can compose it via `and(where.foo, eq(foo.id, id))`.
3. Run `cd server && bun drizzle-kit generate` to produce a migration.
4. List the table in [`plugin.json`](../../plugin.json) `storage.tables`.
5. Add the table to [`server/src/lib/remote-calls.ts`](../../server/src/lib/remote-calls.ts) `deleteInstance()` so it's purged on GDPR deletion.

---

## Branding architecture

Per-customer theme CSS (`--brand-*` variables) is injected server-side into the SPA HTML before paint to avoid FOUC. Source: `client/public/customers/{branch_slug}/theme.css` (the `_default` slot is shipped; add new slugs as needed).

The branding boundary applies only to user-facing views (`pages/EndUserView`). Admin/Studio components must use Staffbase Design System tokens (`text-neutral-strong`, `bg-elevated`, etc.), never `brand-*`. They must also use design-system **components** (`Select` / `Checkbox` / `Radio` / `TextField` / `TextArea` / `Divider`, …) from `@staffbase/design`, not native HTML controls — enforced by `bun run check:design-system` (part of `bun run check`); see [`docs/guides/extending.md#styling-admin-or-studio-components`](../guides/extending.md#styling-admin-or-studio-components) for the full mapping table.

Per-customer locale overrides ride the same channel: drop a `{branch_slug}/locales/{lang}/{namespace}.json` file and `client/src/i18n/init.ts` merges it on top of the defaults at startup.

---

## Widget

The `widget/` folder is an independent Bun bundle producing a single IIFE that registers a Shadow DOM custom element via `@staffbase/widget-sdk`. The default template widget (`<plugin-template-widget>`) renders a placeholder message — replace the body of `widget/src/widget.ts` with your plugin-specific UI.

The widget is built separately from the SPA (see `scripts.build:widget` in the root `package.json`); the bundle is copied into `dist/public/widget/` and served at `/widget/*.min.js` with ETag-based conditional responses.

### Installation picker

A plugin can be installed multiple times on the same Staffbase tenant — every widget instance must bind to a specific installation so its viewer-side fetches scope to the correct data. The template ships a custom RJSF `ui:widget` ([`widget/src/installation-picker.tsx`](../../widget/src/installation-picker.tsx)) that renders inside the Studio config dialog and writes the chosen installation UUID into the `installation_id` attribute.

Resolution flow:

1. Picker calls `${PLUGIN_URL}/api/public/instance` ([`server/src/routes/public.ts`](../../server/src/routes/public.ts)) to obtain `pluginId`. `PLUGIN_URL` is resolved at module-load time from the bundle's own `<script src>` ([`widget/src/plugin-url.ts`](../../widget/src/plugin-url.ts)).
2. Picker calls the Staffbase platform `/api/plugins/{pluginId}/installations/search?permission=manage` (same-origin, session-cookie auth) to list installations the editor can manage.
3. Editor picks one; `onChange` writes the UUID to the form, which Studio persists onto the widget's `installation_id` attribute.
4. Viewer-side `_render()` reads the attribute and routes all subsequent fetches through it.

If `installation_id` is unset the viewer renders an "unconfigured" amber state so editors notice the binding is missing.

See [`docs/adrs/0007-widget-shadow-dom.md`](../adrs/0007-widget-shadow-dom.md) and [`docs/adrs/0008-widget-installation-picker.md`](../adrs/0008-widget-installation-picker.md) for the decision records.

---

## Production build

Multi-stage Dockerfile (`docker/Dockerfile`): alpine builder runs `bun install` + `bun run build` (client + widget), then a distroless runtime image runs `bun run server/src/index.ts` as user `nonroot`.

Required runtime env:

- `PLUGIN_ID` — assigned by Staffbase per environment
- `PUBLIC_KEY` — RSA public key from Staffbase (PEM format)
- `ENCRYPTION_KEY` — 64-hex-char string (`openssl rand -hex 32`)
- `DATABASE_URL` — Postgres connection string
- `CORS_ORIGINS` — comma-separated allowed origins
- `PORT` — defaults to 3000

See [ADR-0006](../adrs/0006-gitops-deployment.md) for the deployment model.

---

## Security invariants

- JWT signature is validated by `staffbase-plugin-sdk` on every request via `ssoMiddleware`.
- Raw JWT (`c.var.rawToken`) is never logged.
- HTML-entity escaping in `server/src/html.ts` prevents XSS in injected `window.__USER__` and `window.__JWT_TOKEN__` values (SEC-001).
- API tokens are AES-256 encrypted in the DB via [`server/src/lib/crypto.ts`](../../server/src/lib/crypto.ts), decrypted only when forwarding to Staffbase Platform.
- CSP `frame-ancestors` is derived from the JWT `issuer_domain` claim so only the originating Staffbase instance can iframe the plugin.
- GDPR delete intercept in `app.ts` runs **before** session issuance — a `sub === "delete"` JWT triggers `deleteInstance()` and never gets a session cookie.
