# Project Notes for AI Agents

## Key Constraints

- **Bun only** — no npm/yarn/pnpm. **Biome only** — no ESLint/Prettier
- Run `bun run check`, `bun test` (server — scoped via `bunfig.toml`), `cd client && bun run test` (client), `cd widget && bun test` (widget), and `bunx playwright test` (E2E) before every commit — 0 errors, 0 warnings, all tests passing
- New server routes **must** have a corresponding test file in `server/src/__tests__/`
- New client pages or components with interactions **should** have a test in `__tests__/` next to the source
- Do NOT commit `.env` — only `.env.example` is committed
- Do NOT remove `instance_id` from any DB query — multi-tenancy requires it on every table
- Prefer `c.var.scopedDb.where.<table>` over hand-written `eq(table.instanceId, instanceId)` in all route queries — compose it with `and()` for additional filters. New `CREATE TABLE` migrations **must** include an `instance_id` column (enforced by CI `validate-migrations`).
- Do NOT simplify the HTML-entity-escaping in `server/src/html.ts` — it prevents XSS (SEC-001)
- Do NOT read `IS_LOCALDEV` from request headers or query params — `Bun.env` only. **The runtime IS_LOCALDEV bypass paths (delete-intercept skip, CORS wildcards, dev routes) additionally require `NODE_ENV === "development"`** via the `IS_REAL_LOCALDEV` allowlist in `server/src/app.ts` — never use `IS_LOCALDEV` alone to gate a bypass; the allowlist has no `?? "development"` fallback. However, `X-Dev-User-Id`, `X-Dev-User-Role`, `X-Dev-Instance-Id`, `X-Dev-Branch-Slug` headers ARE honoured in localdev mode to allow multi-user / multi-tenant testing without restarting.
- Do NOT add `console.log` to production code paths — use `createLogger(module)` from `server/src/lib/logger.ts` instead. Never log raw JWT values, passwords, session IDs, or PII
- Use field name **`msg`** (not `_msg`) for the message string in any hand-rolled JSON log line. `_msg` collides with the VictoriaLogs reserved field and the Staffbase OTel Collector (`transform/logs`) only promotes `msg → message → body` to the VL `_msg` column. Using `_msg` causes the raw JSON line to leak into `_msg` non-deterministically (~22% of entries). LogsQL queries on `_msg:"..."` still work — only the source field name changes. See [`docs/reference/logging.md`](docs/reference/logging.md).
- **Branding boundary** — `brand-*` CSS tokens apply to user-facing views only (`pages/EndUserView`). Admin/Studio components must use Staffbase DS tokens — never `brand-*` there
- **Icons** — use `@staffbase/design` icon components everywhere, never inline SVGs
- **Design system in admin** — every admin-area form control (under `client/src/components/admin/` and `client/src/pages/AdminView.tsx`) must use the Staffbase design system from `@staffbase/design`. The following native HTML elements are forbidden in admin code (replacement in parentheses):
  - `<select>` → `Select.Root` / `SingleSelect` / `SearchableSingleSelect` / `SearchableMultiSelect`
  - `<input type="checkbox">` → `Checkbox` / `CheckboxGroup`
  - `<input type="radio">` → `Radio` / `RadioGroup`
  - `<input type="text|email|url|search|tel|password|number">` → `TextField` (or `NumberStepper` for stepper UX)
  - `<textarea>` → `TextArea`
  - `<hr>` → `Divider`

  Storybook reference: <https://design.staffbase.rocks/>. Enforced by `scripts/lint-design-system.ts` (wired into `bun run check`; standalone: `bun run check:design-system`). Add new bans to `RULES` in that script as drift is spotted — keep the list selective (a blanket `<button>` / `<input>` ban would force gymnastics around legitimate uses like trailing-icon buttons inside `Field.Root` or accessible hidden file inputs wrapped in drag-drop labels).

  End-user views (`client/src/pages/EndUserView`, `layouts/`, etc.) are NOT covered by the lint — they may use native HTML to honour the `brand-*` token boundary noted above.
- **widget/** — separate Bun-driven build (not part of the Bun workspace). Install deps with `bun install --cwd widget`, build with `cd widget && bun run build`, preview viewer-side render with `bun run preview` (port 5174). Widget ships an **installation picker** (`widget/src/installation-picker.tsx`) bound to the `installation_id` config attribute — every viewer fetch must scope to that UUID. Picker fetches `pluginId` from `${PLUGIN_URL}/api/public/instance` and installations from the Staffbase platform `/api/plugins/{pluginId}/installations/search?permission=manage`. Do NOT bypass the picker — the widget must remain compatible with multi-installation tenants. When adding new widget config fields, register them in `configurationSchema.properties` + `WIDGET_ATTRS` + `manifest.json:bundles[0].attributes`.
- **Widget API surface (when added)** — when forking, the widget should talk to the backend through a single `server/src/routes/widget-api.ts` file mounted at `/api/widget/*` in `app.ts` BEFORE the global `ssoMiddleware`, so the route applies its own (more permissive) SSO + CORS rules. CORS is `origin: "*"` because auth flows through `?jwt=` (a one-time service token), not cookies. Do NOT mount widget endpoints under `/api/*` — that would attach the global cookie SSO and break cross-origin embedding. Template currently has no widget endpoints; this rule applies once you add them.
- **Widget content rendering** — `widget.ts` is hand-written DOM (no React, no JSX). The widget MUST escape every dynamic value through `escHtml()` / `escAttr()` before inserting into `shadow.innerHTML`. Do NOT skip this — dynamic content can come from user input.
- **Per-instance API token (SCIM sync)** — every installation has an editor-supplied Staffbase API token (`settings.apiToken`, encrypted at rest via `server/src/lib/crypto.ts`). Without it the background SCIM refresh + per-render user-name lookups silently skip. Editors enter it via `SettingsDialog` (`client/src/components/admin/SettingsDialog.tsx`); the server-side `GET /api/settings` MUST NEVER echo the plaintext token (test enforced). Background loop is `refreshAllUsers()` in `server/src/lib/user-cache.ts`, period controlled by `USER_CACHE_REFRESH_HOURS`.
- **GDPR per-request user gate** — `gateAccessor()` in `server/src/middleware/sso.ts` runs after every successful auth; it calls `revalidateAccessor()` in `server/src/lib/user-cache.ts` to confirm the authenticated user has not been deleted in the platform (TTL-bounded; default 60s, env `USER_ACCESSOR_REVALIDATE_SECONDS`). `revalidateReferencedUsers()` (env `USER_REFERENCE_REVALIDATE_SECONDS`, default 300s) bounds the stale-PII window in list renders. Do NOT bypass the gate — fail-open is reserved for transient Staffbase outages only.
- **Demo `items` table** — the template ships a worked CRUD example you can keep, replace, or delete. If you rip it out, also drop: schema entry, scopedDb predicate, `remote-calls.deleteInstance` clause, `admin.ts:clear-all` clause, route file, MSW handler, client types, `AdminLayout`/`ItemsList`/`ItemForm`, locale `items-list.*` + `item-form.*` + `category.*` + `tabs.*` + `sort.*` keys, seed entries. Audit log unions in `lib/changelog.ts` and `client/src/types/api.ts` must drop `item_*` actions / `item` entity in lockstep.
- **Changelog / audit log** — every admin mutation must call `logChange()` from `server/src/lib/changelog.ts`. `logChange` is fire-and-forget and never throws. GDPR-related mutations (`settings_updated` with API token, `clear_all`, `user_deleted`) must have `gdprRelevant: true`. Do NOT add `user_id` uniqueness constraints to the `changelog` table — it is append-only. Do NOT delete individual changelog entries (only `cleanupDeletedUser` nullifies `user_id`; `deleteInstance` bulk-deletes)
- **Version fields are auto-bumped — never edit by hand.** The `version` fields in `plugin.json` + `client/package.json` + `server/package.json` + `widget/package.json` and the `Version **X.Y.Z**.` banner in `README.md` are rewritten on every push to `main` by the `sync_version_in_repo` job in `.github/workflows/update-release-draft.yml` (port this workflow when scaffolding from this template). They always carry the next **calver** tag (`2026.YY.Z`), not a semver. Manual edits get clobbered on the next merge. The semver release identifier (`1.0.1`, `1.0.2`, etc.) lives **only** in CHANGELOG `[X.Y.Z]` headings + PR titles + GitHub Release notes. When opening a release PR: bump CHANGELOG heading + PR title; leave the JSON `version` fields and README banner alone.

## Non-obvious wiring

- `ssoMiddleware` must run before `requireEditor` — never reverse the order
- `sub === "delete"` in JWT signals a GDPR deleteInstance call — intercept lives in `server/src/app.ts` as a top-level `app.use("*", …)` middleware that runs before SSO/session issuance, never create a session for these requests. The intercept is **narrowly skipped only when `IS_REAL_LOCALDEV=true` AND the request is `POST` AND `?jwt=dev`** — any other ?jwt= value still goes through real JWT validation, and `IS_REAL_LOCALDEV` requires `NODE_ENV === "development"` (strict allowlist, no fallback) so a misconfigured `IS_LOCALDEV=true` in CI/prod cannot disable the gate. The delete-sentinel JWT contract is **split across two files**: the top-level `app.ts` intercept catches POSTs (the platform's actual delete handshake), and the `gateAccessor()` check in `server/src/middleware/sso.ts` short-circuits any non-POST request whose authenticated `userId === "delete"` before the GDPR gate runs.
- The raw JWT (`c.var.rawToken`) is never logged — do not add logging of it
- **Two language systems** must stay separate: **UI language** (i18next, `template`/`admin` namespaces) vs **content language** (jsonb locale keys via `getLocalized()`). Do not conflate them
- `@staffbase/plugins-client-sdk` is used **only** for content language (`getBranchLanguages`, `getBranchDefaultLanguage`). Do not add other SDK calls

## Editing these docs

Keep `AGENTS.md`, `CLAUDE.md`, and `README.md` lean. Do NOT add information that is discoverable from source code (inline comments, `package.json` scripts, `biome.json`, `schema.ts`, `.env.example`) or already covered in `docs/`. These files should contain only guardrails, non-obvious constraints, and links — never duplicate what a tool call can reveal.

## Reference docs

- [`docs/architecture/sessions.md`](docs/architecture/sessions.md) — auth flow, session lifecycle, GDPR, JWT claims, transport hardening
- [`docs/architecture/architecture.md`](docs/architecture/architecture.md) — project structure, component hierarchy, branding
- [`docs/reference/logging.md`](docs/reference/logging.md) — structured logging, field conventions, env vars, VictoriaLogs queries
- [`docs/guides/extending.md`](docs/guides/extending.md) — how to add routes, tables, pages, translations
- [`docs/architecture/database.md`](docs/architecture/database.md) — schema, migrations
- [`docs/reference/api.md`](docs/reference/api.md) — full API reference
- [`docs/architecture/i18n.md`](docs/architecture/i18n.md) — UI vs content language, adding locales
- [`docs/guides/local-development.md`](docs/guides/local-development.md) — Docker setup, env vars, Vite proxy
- [`docs/guides/testing.md`](docs/guides/testing.md) — three-tier test suite (server · client · E2E), patterns, inventory
- [`docs/adrs/`](docs/adrs/) — Architecture Decision Records

## E2E tests

When writing or reviewing Playwright E2E tests, use the agent spec at
[`.claude/agents/e2e-test-writer.md`](.claude/agents/e2e-test-writer.md).
It documents the folder layout, locator priority, flake-prevention idioms,
page-object guidance, `@smoke` tagging, and run commands specific to this repo.

Key guardrails (enforced by convention; `bun run check` catches syntax but not these patterns):
- **Never** use `waitForLoadState("networkidle")` — use explicit `expect(locator).toBeVisible()` waits
- **Never** use `waitForTimeout()` — use `expect.toPass()` or `expect.poll()`
- Locator priority: `getByRole > getByLabel > getByText > getByTestId > CSS`
- New specs go in `e2e/tests/<feature>/`, a11y specs in `e2e/a11y/`
- Run locally: `bun run test:e2e` · smoke: `bun run test:e2e:smoke` · a11y: `bun run test:e2e:a11y`
