# ADR-0007 — Shadow DOM widget (no iframe, Bun.build IIFE)

**Status**: Accepted (reference architecture)  
**Date**: 2026-04

> **Template note:** this ADR captures the canonical widget architecture from the
> reference plugins. The template **ships only the placeholder widget** bound to
> `installation_id` (`widget/src/widget.ts`). The fuller data path described below —
> the `/api/widget/catalog` route, `?jwt=` service-token auth, `themeVars` /
> `translationOverrides` — is **not implemented here**; add it per-plugin when your
> widget needs to fetch backend data. The Shadow-DOM / no-iframe / Bun.build IIFE
> decisions DO apply to the shipped placeholder.

---

## Context

The plugin needs a Staffbase custom widget that renders the authenticated user's favorites list inline on any Staffbase page. The options considered were:

1. **Iframe widget (v1)** — `<iframe src="/favorites">` loaded inside the Web Component. Simple but adds a full page-load round-trip, poor scroll integration, fixed height issues, and doubles the session/auth complexity.
2. **React + webpack (v1.5)** — Bundle the full React SPA as a widget. Too heavy (~300 KB+); webpack config adds maintenance overhead; pulls in Staffbase DS polymer components that conflict with the shadow root.
3. **Shadow DOM + Bun.build IIFE (v2, chosen)** — A zero-framework Web Component that renders HTML strings into a shadow root. Bundled as a single IIFE by `Bun.build` at ~8.7 KB.

## Decision

Implement the widget as a **Shadow DOM Web Component** bundled with **Bun.build** into a single IIFE JS file.

Key design choices:

- **No iframe** — the custom element renders directly into a shadow root. Avoids double auth, fixed-height hacks, and scroll-jank.
- **No React/Vue/framework** — render functions (`render.ts`) return plain HTML strings set on `shadow.innerHTML`. All interactivity is via `<a href>` links (no click handlers needed for the favorites list use-case).
- **Bun.build IIFE** — the build script (`widget/scripts/build.ts`) uses `Bun.build` with two virtual plugins: one that injects build-time metadata (`PLUGIN_URL`, `BUILD_SHA`) and one that base64-encodes SVG assets. Output is a self-contained `staffbase.plugin-template-widget.min.js`.
- **Auth via service token** — the widget's `installation_id` attribute (a Staffbase installation UUID) is **required** and is the sole source of truth for which installation to bind to. `widget.ts` validates the UUID shape and calls `GET {staffbaseUrl}/api/installations/{installationId}/service/token` once; `staffbaseUrl` is the absolute Staffbase frontend origin from `widgetApi.getBranchInformation().webUrl` (see ADR-0009 Issue 3 — required for Capacitor native apps where `window.location.origin` is `https://localhost`). Without a valid `installation_id` the widget renders an error and makes no network call. The resulting RS256 JWT is forwarded as `?jwt=` to the plugin's `/api/widget/catalog` route, avoiding any exposure of the shared plugin secret to the browser. Note: `installationId` is the per-plugin-per-instance UUID (exposed as the `instance_id` JWT claim), not the plugin reverse-DNS id.
- **Editor-picked installation (required)** — the widget configuration dialog includes an `installation_id` field rendered by a custom RJSF `ui:widget` (`src/installation-picker.tsx`). It calls `GET /api/plugins/{pluginId}/installations/search?permission=manage` to list installations the editor can manage and writes the selected UUID into the widget attribute. `pluginId` is resolved once via the plugin server's `GET /api/public/instance` endpoint. The editor preview (`renderBlockInEditor`) is not overridden — the SDK default is used.
- **Customer theming / overrides** — the catalog response includes `themeVars` (per-customer `theme.css` with `:root` → `:host` rewrite) and `translationOverrides` (per-customer `i18n.json`, `widget` namespace extracted). These use the same `customers/{branchSlug}/` source files as the React client, keeping a single source of truth. The namespaced JSON format (`{ locale: { widget: { key: value } } }`) leaves room to add overrides for other plugin areas in the same file in the future.
- **`--app-*` token chain** — widget styles define `--app-primary: var(--brand-color-primary, #1b2559)` etc., so both injected `themeVars` and platform-injected `:root` themes work automatically via CSS custom property inheritance.

## Consequences

- **Positive**: Tiny bundle (~8.7 KB gzipped); loads instantly with no framework overhead.
- **Positive**: Full test coverage (68 widget unit tests + 6 server API tests) with no browser or DOM environment needed.
- **Positive**: Customer theming and i18n override mechanism is identical to the React client — no separate maintenance path.
- **Positive**: Bun.build replaces webpack; no webpack config files, no npm devDependencies for loaders.
- **Negative**: HTML string rendering means no declarative reactivity; adding complex interactivity (e.g., inline favorite toggle) requires manual DOM manipulation or a re-render pattern.
- **Constraint**: `@font-face` inside shadow roots requires Chrome 105+ / Firefox 110+ (acceptable \u2014 modern browsers only; older browsers fall back to system fonts silently).
