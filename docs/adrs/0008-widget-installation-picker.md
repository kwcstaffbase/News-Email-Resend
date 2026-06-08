# ADR-0008 — Widget binds to a Studio-picked installation

**Status**: Accepted
**Date**: 2026-05

---

## Context

A Staffbase plugin can be installed **multiple times** on the same tenant — once per content area, brand, or team. Each installation has its own UUID, its own settings row, its own data. A widget rendered on a Staffbase page is just a `<plugin-template-widget>` custom element with attributes; it must fetch data scoped to **one** installation.

Three options for picking which installation the widget targets:

1. **Hardcode at build time** — only viable when a plugin ships one-installation-per-customer. Forces a separate widget bundle per tenant. Rejected.
2. **Auto-pick on the viewer side** — call `/api/public/instance` and use the first / only installation. Fails as soon as a customer installs the plugin twice; results are silently wrong instead of empty. Rejected.
3. **Pick at widget-config time** — Studio editor explicitly binds each widget to one installation when placing it on a page. Persists the chosen UUID as the `installation_id` attribute. Viewer scopes all fetches through it. **Chosen.**

## Decision

The widget exposes an `installation_id` attribute (required, validated `minLength: 1`) and ships a custom RJSF `ui:widget` in the Studio configuration dialog ([`widget/src/installation-picker.tsx`](../../widget/src/installation-picker.tsx)) that lets editors pick from the installations they have `manage` permission on.

Resolution chain at editor time:

1. Picker resolves the plugin-server origin from its own `<script src>` ([`widget/src/plugin-url.ts`](../../widget/src/plugin-url.ts)). DOM-scan fallback handles WKWebView loaders that null out `document.currentScript`.
2. Picker calls `${PLUGIN_URL}/api/public/instance` ([`server/src/routes/public.ts`](../../server/src/routes/public.ts)) once to obtain `pluginId`. Caches it for the picker lifetime.
3. Picker calls the Staffbase platform endpoint `/api/plugins/{pluginId}/installations/search?permission=manage` (same-origin, session-cookie auth) to list installations.
4. Editor selects one → `onChange(uuid)` → Studio writes it to the widget's `installation_id` attribute.

Viewer behaviour:

- **No `installation_id`** → render an explicit unconfigured state (amber banner: "Plugin installation not selected"). Editors see this immediately if they forget the picker.
- **Has `installation_id`** → all subsequent viewer fetches scope through it.

## Consequences

- **Positive**: Globally compatible — one bundle works for any tenant, any installation count.
- **Positive**: Picker is editor-only and never reached in the viewer code path, so the `react` dependency is not loaded at viewer time (Bun's tree-shaking + IIFE format separate the picker from the viewer entry).
- **Positive**: The picker can be replaced without touching the viewer. RJSF custom `ui:widget` is a stable extension point.
- **Negative**: Picker requires a real Staffbase tenant to test end-to-end — the `/installations/search` endpoint lives on the Staffbase platform, not the plugin server, so it cannot be mocked in `bun run preview`. Local verification only covers the viewer render path (`bun run preview` + manual `installation_id` input).
- **Negative**: Adds `react@18` + `@types/react@18` to the widget package. Picker is a class component to avoid the JSX-runtime hot path costs in Studio. Bundle stays ~50 KB minified (vs ~8 KB without the picker).
- **Constraint**: When the bundle filename changes ([`widget/scripts/build.ts:bundleBaseName`](../../widget/scripts/build.ts)), update `BUNDLE_FILENAME` in [`widget/src/plugin-url.ts`](../../widget/src/plugin-url.ts) so the DOM-scan fallback still works.

## Why not put the picker on the plugin server?

We considered making the picker a regular `<select>` populated from `/api/public/instance`. Two problems:

1. **Permission scope**: `/api/public/instance` returns every known installation, including ones the current editor cannot manage. The Staffbase `/installations/search?permission=manage` endpoint is the only source of truth for "what can this editor bind to."
2. **Localisation**: Installation titles come from the platform's `config.localization` map. Picking the right title requires the editor's locale, which the picker already has via `formContext`. Replicating that logic on the plugin server would mean keeping the platform's locale-fallback semantics in sync.

## References

- [`widget/src/installation-picker.tsx`](../../widget/src/installation-picker.tsx) — RJSF component
- [`widget/src/api.ts`](../../widget/src/api.ts) — `fetchDiscovery` + `fetchManageableInstallations`
- [`widget/src/configuration-schema.ts`](../../widget/src/configuration-schema.ts) — schema wiring
- [`docs/adrs/0007-widget-shadow-dom.md`](0007-widget-shadow-dom.md) — Shadow DOM widget host
