import { defineConfig, devices } from "@playwright/test";

// Allow skipping specific browsers locally for faster iteration.
// Example: SKIP_BROWSERS=firefox,webkit bun run test:e2e
const skipBrowsers = new Set(
  (process.env.SKIP_BROWSERS ?? "")
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean)
);

const allProjects = [
  {
    name: "chromium",
    use: { ...devices["Desktop Chrome"] },
  },
  {
    name: "firefox",
    use: { ...devices["Desktop Firefox"] },
  },
  {
    name: "webkit",
    use: { ...devices["Desktop Safari"] },
  },
  {
    name: "MicrosoftEdge",
    use: {
      ...devices["Desktop Edge"],
      channel: "msedge",
    },
  },
];

export default defineConfig({
  testDir: "./e2e/tests",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // 1 retry handles transient infra issues (network, DB warmup) without masking real flake.
  retries: process.env.CI ? 1 : 0,
  // Each matrix leg runs a single browser project (~27 tests). 1 worker keeps
  // DB state predictable; the parallelism comes from the 4 browser jobs running
  // simultaneously in GitHub Actions rather than within a single runner.
  workers: process.env.CI ? 1 : undefined,
  // "list"  → streams pass/fail lines to stdout (visible in the Actions log per browser leg)
  // "html"  → writes the full report for artifact upload
  reporter: [["list"], ["html"]],
  // Hard cap per test (ms). Each spec is simple UI interaction; 30 s is generous.
  // Without this a hung browser/network stall keeps the job alive indefinitely.
  timeout: 30_000,
  expect: {
    // Default assertion timeout — how long waitFor / toBeVisible polls before failing.
    timeout: 10_000,
  },
  use: {
    baseURL: process.env.CI ? "http://localhost:3000" : "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: allProjects.filter((p) => !skipBrowsers.has(p.name)),
  webServer: {
    command: process.env.CI ? "bun run --env-file=.env server/src/index.ts" : "bun run dev",
    url: process.env.CI ? "http://localhost:3000/health" : "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // NODE_ENV must be "development" so app.ts's IS_REAL_LOCALDEV gate
      // mounts /api/localdev/* (which globalSetup hits to seed). `bun run`
      // does not auto-set NODE_ENV (only `bun --hot`/`bun --watch` do), so
      // we set it explicitly here for the Playwright-spawned server.
      NODE_ENV: "development",
      IS_LOCALDEV: "true",
      LOCALDEV_ROLE: "editor",
    },
  },
});
