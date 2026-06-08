import { defineConfig, devices } from "@playwright/test";
import baseConfig from "./playwright.config.ts";

export default defineConfig({
  ...baseConfig,
  testDir: "./e2e/a11y",
  testMatch: /.*\.a11y\.spec\.ts$/,
  // A11y runs on Chromium only — axe-core output is identical across browsers
  // and this keeps the job fast (< 2 min). Accessibility failures are browser-
  // agnostic DOM/ARIA issues, not rendering differences.
  projects: [{ name: "chromium-a11y", use: { ...devices["Desktop Chrome"] } }],
});
