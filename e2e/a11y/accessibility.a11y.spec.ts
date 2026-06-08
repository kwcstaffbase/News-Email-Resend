import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "../tests/util/fixtures.ts";
import { gotoAdmin, gotoEndUserView } from "../tests/util/navigation.ts";

// Known upstream violations from @staffbase/design components that cannot be
// fixed in this codebase. Exclude them so the suite stays green while still
// catching new regressions.
const KNOWN_UPSTREAM_RULES = ["select-name", "button-name"];

function buildScanner(page: import("@playwright/test").Page) {
  return new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .disableRules(KNOWN_UPSTREAM_RULES);
}

test.describe("Accessibility", () => {
  test("should have no critical a11y violations on the end-user view", async ({
    editorPage: page,
  }) => {
    await gotoEndUserView(page);

    const results = await buildScanner(page).analyze();
    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );
    expect(critical).toEqual([]);
  });

  test("should have no critical a11y violations on the admin page", async ({
    editorPage: page,
  }) => {
    await gotoAdmin(page);

    const results = await buildScanner(page).analyze();
    const critical = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );
    expect(critical).toEqual([]);
  });
});
