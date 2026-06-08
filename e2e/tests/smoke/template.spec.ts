import { expect, test } from "../util/fixtures.ts";
import { gotoAdmin, gotoEndUserView } from "../util/navigation.ts";

test.describe("@smoke template shell", () => {
  test("end-user view renders placeholder", async ({ editorPage: page }) => {
    await gotoEndUserView(page);
    await expect(page.getByTestId("end-user-view")).toBeVisible();
  });

  test("admin view renders shell for editor", async ({ editorPage: page }) => {
    await gotoAdmin(page);
    await expect(page.getByTestId("admin-tabs")).toBeVisible();
  });

  test("non-editor is redirected away from /admin", async ({ userPage: page }) => {
    await page.goto("/admin");
    await expect(page.getByTestId("end-user-view")).toBeVisible();
  });
});
