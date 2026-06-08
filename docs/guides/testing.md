# Testing

Four-tier test suite: **server unit/API** (Bun test), **widget unit** (Bun test), **client component** (Vitest + React Testing Library + MSW), and **Playwright E2E**.

## Contents

- [Quick reference](#quick-reference)
- [Tier 1: Server Unit & API Tests](#tier-1-server-unit--api-tests)
- [Tier 2: Widget Unit Tests](#tier-2-widget-unit-tests)
- [Tier 3: Client Component Tests](#tier-3-client-component-tests)
- [Tier 4: Playwright E2E Tests](#tier-4-playwright-e2e-tests)
- [Manual verification](#manual-verification)

---

## Quick reference

```bash
# Server tests
bun test

# Widget tests
cd widget && bun test

# Client tests
cd client && bun run test
cd client && bun run test:coverage

# E2E tests (requires docker-compose up + bun run dev)
bunx playwright test
bunx playwright test --project=chromium
```

---

## Tier 1: Server Unit & API Tests

**Location:** `server/src/__tests__/`
**Runner:** `bun:test` (Bun native), scoped to `server/src` via `bunfig.toml`
**Pattern:** Mock DB with `chainResult()` proxy + `selectQueue` FIFO, mock SSO SDK, test routes via `app.request()`

### Test inventory (template baseline)

| File                     | What it covers                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `health.test.ts`         | GET /health                                                                                                                                     |
| `public.test.ts`         | GET /api/public/instance                                                                                                                        |
| `sso.test.ts`            | SSO middleware auth flow (cookie, Bearer session-id, Bearer JWT, `?jwt=` fallback)                                                              |
| `html.test.ts`           | HTML serving (localdev)                                                                                                                         |
| `html-prod.test.ts`      | HTML serving (production auth, `window.__SESSION_KEY__` injection, CSP `frame-ancestors`)                                                       |
| `sessions.test.ts`       | Session lifecycle                                                                                                                               |
| `remote-calls.test.ts`   | GDPR cleanup, deleteInstance                                                                                                                    |
| `admin.test.ts`          | Clear-all transaction                                                                                                                           |
| `changelog.test.ts`      | Pagination, filters, NDJSON                                                                                                                     |
| `settings.test.ts`       | Settings CRUD, encryption                                                                                                                       |
| `users.test.ts`          | User search, session invalidation                                                                                                               |
| `crypto.test.ts`         | AES-256-GCM encrypt/decrypt                                                                                                                     |
| `user-cache.test.ts`     | User upsert, background refresh, `refreshSingleUser()` single-entry invalidation                                                                |
| `localdev-guard.test.ts` | Dev/prod parity guard: boot refuses when `NODE_ENV=production` + `IS_LOCALDEV=true`                                                             |
| `audit-instances.test.ts`| Instance reconciliation script                                                                                                                  |
| `logger.test.ts`         | Structured logger                                                                                                                               |
| `users-session.test.ts`  | DELETE /api/users/session                                                                                                                       |

> **Demo only:** the items CRUD route does not currently have a dedicated test file. The pattern is well-covered by the existing route tests — when you fork the template and rename the entity, write the test alongside (it's a CI requirement for any new route, enforced by AGENTS.md).

When you add a new route, add a corresponding test file here (enforced by AGENTS.md).

### Key patterns

**DB mocking — `chainResult` proxy:**

```ts
function chainResult(value: unknown): unknown {
  const promise = Promise.resolve(value);
  return new Proxy(promise as object, {
    get(target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally")
        return (target as any)[prop].bind(target);
      return () => chainResult(value);
    },
  });
}
```

**Sequential selects — `selectQueue` FIFO:**

```ts
let selectQueue: unknown[][] = [];
mock.module("../db/client.ts", () => ({
  db: {
    select: () => chainResult(selectQueue.shift() ?? []),
    insert: () => chainResult([]),
    update: () => chainResult([]),
    delete: () => chainResult([]),
  },
}));
```

**Auth control:**

```ts
Bun.env.IS_LOCALDEV = "true"; // bypass SSO
Bun.env.LOCALDEV_ROLE = "editor"; // or "user"
```

### Important gotchas

- **`mock.module()` is process-wide in Bun** — mocking `../lib/sessions.ts` in one test file overrides it for ALL files in the same run. Only mock `db/client.ts` and external packages.
- **`IS_LOCALDEV` must be a function** — routes that read env at module load time prevent test-time env switching. Use `function isLocalDev()` in routes that need it.
- **`selectQueue` ordering** — each `db.select()` call pops the next array. Order must match the route's query sequence.

### Adding a server test

1. Create `server/src/__tests__/my-route.test.ts`
2. Mock `@staffbase/staffbase-plugin-sdk` and `../db/client.ts`
3. Import app via `const { app } = await import("../app.ts")`
4. Set env vars in `beforeEach`, clean up in `afterEach`
5. Test with `app.request("/api/...", { method: "GET" })`

---

## Tier 2: Widget Unit Tests

**Location:** `widget/tests/`
**Runner:** `bun:test` (Bun native), scoped to the `widget/` package
**Pattern:** `globalThis.defineBlock` stub, no DOM framework

The template ships a single smoke test (`widget.test.ts`) that imports the widget bundle and asserts the registered block definition shape (tag name, `installation_id` attribute, non-null `uiSchema`). It mocks `virtual:widget-meta` (`mock.module`) and the SVG icon import. Expand as you add render logic, API calls, helpers.

For the installation picker, prefer testing the underlying `api.ts` helpers (`fetchDiscovery`, `fetchManageableInstallations`) with `fetch` stubs rather than mounting the React class component — React class components in JSDOM-less Bun tests have edge cases that aren't worth the maintenance.

### Running

```bash
cd widget && bun test
```

### Visual preview (no Staffbase Studio needed)

```bash
cd widget && bun run preview
# http://localhost:5174
```

`widget/scripts/preview.ts` builds the bundle, watches `src/`, and serves `widget/preview/index.html` with a placeholder control. Use this to verify rendering without a full Staffbase Studio.

---

## Tier 3: Client Component Tests

**Location:** `client/src/**/__tests__/`
**Runner:** Vitest 4 + jsdom
**Setup:** `client/vitest.config.ts`, `client/src/__tests__/setup.ts`

### Test inventory (template baseline)

| File                                        | What it covers                                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `context/__tests__/AuthContext.test.tsx`    | User data, role handling                                                                                                |
| `components/__tests__/ErrorBoundary.test.tsx` | Child rendering, error fallback                                                                                       |
| `hooks/__tests__/useI18n.test.tsx`          | Namespace wiring                                                                                                        |
| `hooks/__tests__/useAdminI18n.test.tsx`     | Admin namespace wiring                                                                                                  |
| `hooks/__tests__/useLanguages.test.tsx`     | Localdev path, embedded/SDK path, `currentLanguage` init                                                                |
| `hooks/__tests__/useClientKind.test.ts`     | Native / mobile / desktop classification + SDK call caching                                                             |
| `hooks/__tests__/useInstanceUrl.test.tsx`   | SDK call path, localdev fallback                                                                                        |
| `hooks/__tests__/useInstanceSettings.test.tsx` | Returns `{ staffbaseUrl, hasApiToken }` shape, default fallback                                                      |
| `utils/__tests__/locale.test.ts`            | `getLocalized()` — locale match, explicit fallback, first-value fallback, null/undefined/empty record                   |
| `i18n/__tests__/customer-overrides.test.ts` | Per-customer override deep-merge, branch-slug regex, `branchSlug` guard                                                 |
| `components/admin/__tests__/RelativeTimestamp.test.tsx` | `RelativeTimestamp` formatting                                                                              |

### Key patterns

- **Rendering:** Use `renderWithProviders()` from `test-utils.tsx` which wraps with `QueryClientProvider` + `AuthProvider`
- **API mocking:** MSW (Mock Service Worker) with handlers in [`msw-handlers.ts`](../../client/src/__tests__/msw-handlers.ts). Default mocks cover `/api/settings`, `/api/changelog`, `/api/items`, `/api/items/categories`. Export `mockChangelogEntry` and `mockItem` are available for direct reuse in component tests.
- **Auth:** `globalThis.__USER__` set in `setup.ts` with editor role
- **i18n:** Mocked via `vi.mock("react-i18next")` — `t(key)` returns the key string as-is, so assertions must use the raw key
- **SDK:** `getBranchLanguages`, `getBranchDefaultLanguage`, `getInstanceUrl`, `isNativeApp`, `isMobileApp` are mocked in `setup.ts`

### Adding a client test

1. Create `client/src/<dir>/__tests__/MyComponent.test.tsx`
2. Import `renderWithProviders` from `../../__tests__/test-utils.tsx`
3. Use MSW server for API calls, override handlers per test if needed
4. Use `screen.getByText()`, `screen.getByRole()` for assertions

---

## Tier 4: Playwright E2E Tests

**Location:** `e2e/tests/` (specs), `e2e/a11y/` (accessibility)
**Runner:** Playwright (Chromium, Firefox, WebKit — 3 browser projects)
**Config:** `playwright.config.ts` (all tests), `playwright.a11y.config.ts` (a11y only)
**Global setup:** `e2e/global-setup.ts` — waits for `/health` (extend with seed call when you add localdev data)

### Role-based fixtures

Tests use custom fixtures from `e2e/tests/util/fixtures.ts` that inject `window.__USER__` via `page.addInitScript()` before React mounts:

- **`editorPage`** — page with `role: "editor"` (full admin access)
- **`userPage`** — page with `role: "user"` (read-only, no admin)

The Hono server runs with `LOCALDEV_ROLE=editor` so API calls succeed for both roles. The fixtures test the **client-side UI layer** — redirects, button visibility, conditional rendering. Server-side role enforcement is covered by Tier 1 unit tests.

```ts
import { expect, test } from "../util/fixtures.ts";
import { gotoEndUserView } from "../util/navigation.ts";

test("end-user view renders for editors", async ({ editorPage: page }) => {
  await gotoEndUserView(page);
  await expect(page.getByTestId("end-user-view")).toBeVisible();
});

test("non-editor is redirected away from /admin", async ({ userPage: page }) => {
  await page.goto("/admin");
  await expect(page.getByTestId("end-user-view")).toBeVisible();
});
```

### Test inventory (template baseline)

| File                                | What it covers                                              |
| ----------------------------------- | ----------------------------------------------------------- |
| `tests/smoke/template.spec.ts`      | End-user view + admin view render; non-editor redirect      |
| `a11y/accessibility.a11y.spec.ts`   | No critical axe violations on / and /admin                  |

### Running E2E locally

```bash
bun run dev                              # Start full stack (Docker + server + client)
bunx playwright test                     # Run all tests across browsers
bunx playwright test --project=chromium  # Chromium only
bunx playwright test --grep @smoke       # Smoke subset
bunx playwright show-report              # View HTML report
```

The `playwright.config.ts` `webServer` option auto-starts `bun run dev` and reuses an existing server if one is already running.

### Adding an E2E test

1. Create `e2e/tests/<feature>/my-flow.spec.ts` (feature-folder layout)
2. Import `{ test, expect }` from `"../util/fixtures.ts"` (not from `@playwright/test`)
3. Use `editorPage` for editor-only features, `userPage` for user-role assertions
4. Wait for content via the navigation helper: `await gotoEndUserView(page)` — **never** use
   `waitForLoadState("networkidle")` (prohibited for SPAs)
5. Prefer semantic locators: `page.getByRole()`, `page.getByLabel()`, `page.getByText()`;
   fall back to `page.getByTestId()` only for containers without a semantic role
6. See `.claude/agents/e2e-test-writer.md` for the full pattern guide and locator priority

### Accessibility (axe-core) coverage

`e2e/a11y/accessibility.a11y.spec.ts` runs `@axe-core/playwright` against the end-user view and the admin page. It asserts that **no `critical` or `serious` violations** are reported — which in practice gates WCAG 2 AA colour-contrast (4.5:1 for small text).

If you change `_default/theme.css` or any customer `theme.css`, or introduce new `bg-*` / `text-*` combinations in user-facing components, this test enforces that the resulting contrast still passes.

---

## Manual verification

These areas are not covered by automated tests and require manual testing:

- **Native app embedding** — The plugin renders inside a Staffbase iframe. Test on iOS and Android Staffbase apps to verify JWT handshake, session persistence, and layout.
- **Real SSO flow** — Localdev bypasses JWT validation. Test with a real Staffbase instance to verify token parsing, role extraction, and session creation.
- **Staffbase API integration** — User search proxies to the Staffbase API. Test with real credentials to verify proxy headers, error handling, and rate limiting.
- **Accessibility** — Screen reader testing, keyboard navigation, focus management in dialogs.
