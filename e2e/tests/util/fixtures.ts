import { test as base, type Page } from "@playwright/test";

/**
 * Injects a `window.__USER__` object before the page JS executes so that
 * `AuthProvider` picks up the desired role without restarting the server.
 *
 * The Hono server is always started with `LOCALDEV_ROLE=editor` (see
 * playwright.config.ts `webServer.env`), so API calls succeed regardless
 * of the client-side role override.  These fixtures test the **UI layer**
 * — admin redirects, edit-button visibility, etc.
 */
function injectRole(role: "editor" | "user") {
  return async ({ page }: { page: Page }, use: (p: Page) => Promise<void>) => {
    await page.addInitScript((r: string) => {
      // Use Object.defineProperty so the server-injected <script>window.__USER__ = …</script>
      // (present only when Hono serves the built SPA in CI) cannot overwrite the fixture value.
      Object.defineProperty(globalThis, "__USER__", {
        value: {
          userId: r === "editor" ? "editor-1" : "user-1",
          userName: r === "editor" ? "Alice Editor" : "Bob User",
          instanceId: "dev-instance",
          pluginId: "dev-plugin",
          role: r,
          firstName: r === "editor" ? "Alice" : "Bob",
          lastName: r === "editor" ? "Editor" : "User",
          locale: "en_US",
          type: "user",
          branchId: null,
          externalId: null,
          issuerDomain: null,
          branchSlug: "_default",
        },
        writable: false,
        configurable: false,
      });
    }, role);
    await use(page);
  };
}

/** Playwright test with `editorPage` and `userPage` fixtures. */
export const test = base.extend<{
  editorPage: Page;
  userPage: Page;
}>({
  editorPage: injectRole("editor"),
  userPage: injectRole("user"),
});

export { expect } from "@playwright/test";
