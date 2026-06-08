#!/usr/bin/env bun
/**
 * One-shot Playwright capture for docs/assets/screenshots/.
 * Run: bun scripts/capture-docs-screenshots.ts
 *
 * Preconditions:
 *   1. `bun run dev` must already be running (Vite :5173 + Hono :3000 + pgweb :8081).
 *   2. `cd widget && bun run preview` running on :5274 for widget shots.
 *      (Widget preview defaults to 5274 to avoid colliding with sibling
 *      custom plugins — see AGENTS.md "widget/".)
 *   3. The server must have `IS_LOCALDEV=true` AND `LOCALDEV_ROLE=editor` in its
 *      `.env` for the admin shots to succeed — the `window.__USER__` injected
 *      below only affects client-side rendering; `/api/*` auth is decided
 *      server-side. If the server runs with `LOCALDEV_ROLE=user` the admin
 *      route returns 403 and every admin shot breaks.
 *   4. Sample data seeded — `curl -X POST http://localhost:3000/api/localdev/seed`
 *      (or click "Seed sample data" in /dev) so admin tables render with content.
 *      The script also issues a seed call pre-flight, but a manual seed is the
 *      easiest way to confirm DB state.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";

const ROOT = path.resolve(import.meta.dir, "..");
const OUT = path.join(ROOT, "docs/assets/screenshots");
mkdirSync(OUT, { recursive: true });

const USER_EDITOR = {
  userId: "editor-1",
  userName: "Alice Editor",
  instanceId: "dev-instance",
  pluginId: "dev-plugin",
  role: "editor",
  firstName: "Alice",
  lastName: "Editor",
  locale: "en_US",
  type: "user",
  branchId: null,
  externalId: null,
  issuerDomain: null,
  branchSlug: "_default",
};

const USER_END = {
  ...USER_EDITOR,
  userId: "user-1",
  userName: "Bob User",
  role: "user",
  firstName: "Bob",
  lastName: "User",
};

async function newPage(
  browser: Browser,
  viewport: { width: number; height: number },
  role: typeof USER_EDITOR
) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript((u) => {
    Object.defineProperty(globalThis, "__USER__", {
      value: u,
      writable: false,
      configurable: false,
    });
  }, role);
  return page;
}

/**
 * Run a shot in its own browser context with guaranteed cleanup. Wraps the
 * shot body in try/finally so a thrown locator / waitFor / screenshot error
 * cannot leak a Chromium context for the lifetime of the parent browser.
 */
async function withShot<T>(
  browser: Browser,
  viewport: { width: number; height: number },
  role: typeof USER_EDITOR,
  fn: (page: Page) => Promise<T>
): Promise<T> {
  const page = await newPage(browser, viewport, role);
  try {
    return await fn(page);
  } finally {
    await page.context().close();
  }
}

async function capture(page: Page, file: string) {
  const out = path.join(OUT, file);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`✓ ${file}`);
}

/** Seed the local DB once up-front so screenshots are populated. Fire-and-forget. */
async function seedIfPossible(browser: Browser) {
  const page = await newPage(browser, { width: 1024, height: 768 }, USER_EDITOR);
  try {
    await page.request.post("http://localhost:3000/api/localdev/seed").catch(() => null);
  } finally {
    await page.context().close();
  }
}

// ── Scenarios ───────────────────────────────────────────────────────────────

type Scenario = {
  id: string;
  description: string;
  /** Path to navigate to under the dev server (Vite :5173). */
  url: string;
  /** Output file name written into docs/assets/screenshots/. */
  file: string;
  /** Viewport size for the capture. */
  viewport: { width: number; height: number };
  /** Which seeded user the page should render as. */
  role: typeof USER_EDITOR;
  /** Optional pre-screenshot interaction. */
  setup?: (page: Page) => Promise<void>;
};

// CUSTOMIZE PER PLUGIN: each entry describes one screenshot to capture.
// Replace the placeholder below with real scenarios when forking this template.
// See docs/reference/visual-tour.md for the rendering target. Typical entries
// drive Playwright through a flow (tab click, form open, hover, etc.) before
// calling `page.screenshot(...)` — wire that into `setup` per scenario.
const SCENARIOS: Scenario[] = [
  {
    id: "example-landing",
    description: "Replace this placeholder with a real scenario.",
    url: "/",
    file: "01-example-landing.png",
    viewport: { width: 1440, height: 900 },
    role: USER_END,
    // setup: async (page) => { /* interact with the page here */ },
  },
];

async function runScenario(browser: Browser, scenario: Scenario) {
  await withShot(browser, scenario.viewport, scenario.role, async (page) => {
    await page.goto(`http://localhost:5173${scenario.url}`);
    await page.waitForLoadState("networkidle");
    if (scenario.setup) await scenario.setup(page);
    await page.waitForTimeout(800);
    await capture(page, scenario.file);
  });
}

/**
 * Run a batch of scenarios concurrently. Every scenario opens its own browser
 * context, so they're independent — the dev server is the only shared
 * resource, and Vite + Hono handle multiple concurrent requests fine.
 *
 * BATCH_SIZE is tuned conservatively (4) so all shots fit on a laptop without
 * spawning 20+ Chromium contexts at once. Raise it on CI with more RAM.
 */
const BATCH_SIZE = 4;

async function runBatched(browser: Browser, scenarios: Scenario[]) {
  for (let i = 0; i < scenarios.length; i += BATCH_SIZE) {
    const slice = scenarios.slice(i, i + BATCH_SIZE);
    await Promise.all(slice.map((s) => runScenario(browser, s)));
  }
}

async function main() {
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    // Seed up-front so admin tables + populated views have content.
    await seedIfPossible(browser);
    await runBatched(browser, SCENARIOS);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
