import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Navigate to the end-user view (`/`) and wait until the placeholder is rendered.
 */
export async function gotoEndUserView(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("end-user-view")).toBeVisible();
}

/**
 * Navigate to the admin view and wait until the admin shell is visible.
 */
export async function gotoAdmin(page: Page): Promise<void> {
  await page.goto("/admin");
  await expect(page.getByTestId("admin-tabs")).toBeVisible();
}
