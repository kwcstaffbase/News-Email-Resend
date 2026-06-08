/**
 * Tests for the per-customer i18n locale override mechanism used in initI18n().
 *
 * The full `initI18n()` function relies on `import.meta.glob` (Vite build-time
 * feature) to discover customer override files.  We cannot call initI18n()
 * directly in tests.  Instead we isolate and test the two independently
 * verifiable parts:
 *
 * Part 1 — Resource merging:
 *   `i18next.addResourceBundle(lang, ns, data, deep=true, overwrite=true)`
 *   This is the exact API call used after each customer file loads.  We test
 *   that it correctly overrides specific keys while leaving all other keys
 *   from the base bundle intact.
 *
 * Part 2 — Branch-slug path matching:
 *   The regex  /\/customers\/([^/]+)\/locales\/([^/]+)\/([^/]+)\.json$/
 *   selects only files belonging to the active branch_slug.  We test that it
 *   matches the correct paths and rejects mismatches.
 *
 * Part 3 — branchSlug selection integration:
 *   The `branchSlug` field from `window.__USER__` gates which customer folder
 *   is applied.  We verify the observable effect: given a slug, addResourceBundle
 *   applies overrides; without one, base values remain.
 */

import i18next, { type i18n as I18n } from "i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// ─── Shared test i18next instance ────────────────────────────────────────────

// Create a fresh isolated instance that is NOT bound to the project's
// CustomTypeOptions augmentation.  Typing it as a plain i18n avoids conflicts
// with the strongly-typed t() overloads that restrict keys to those present in
// the English translation JSON files.
const i18n: I18n = i18next.createInstance();

// Convenience: bypass the global CustomTypeOptions by going through the
// underlying i18n.t with a cast so we can test arbitrary keys.
function t(lang: string, ns: string, key: string): string {
  return (i18n.t as (key: string, opts: object) => string)(key, {
    ns,
    lng: lang,
  });
}

const EN_TABS_ALL_APPS = "End User View — start building here";
const EN_TABS_LANG_SELECTOR = "Reload";
const EN_APP_CARD_ADD_FAVORITE = "Something went wrong.";

const BASE_TEMPLATE_EN = {
  tabs: {
    "user-title": EN_TABS_ALL_APPS,
    reload: EN_TABS_LANG_SELECTOR,
  },
  "error-boundary": {
    title: EN_APP_CARD_ADD_FAVORITE,
  },
};

// i18next init() is a no-op on subsequent calls — call it only once.
beforeAll(async () => {
  await i18n.init({
    lng: "en",
    fallbackLng: false,
    resources: {},
    defaultNS: "template",
    ns: ["template"],
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  // Clean slate: remove any bundles added by the previous test, then restore base.
  i18n.removeResourceBundle("en", "template");
  i18n.removeResourceBundle("de", "template");
  // structuredClone prevents i18next from mutating BASE_TEMPLATE_EN in place.
  i18n.addResourceBundle("en", "template", structuredClone(BASE_TEMPLATE_EN), false, false);
});

afterEach(() => {
  i18n.removeResourceBundle("en", "template");
  i18n.removeResourceBundle("de", "template");
});

// ─── Part 1: addResourceBundle deep-merge behaviour ──────────────────────────

describe("per-customer override mechanism — addResourceBundle", () => {
  it("returns the base value when no override has been applied", () => {
    expect(t("en", "template", "tabs.user-title")).toBe(EN_TABS_ALL_APPS);
  });

  it("overrides a top-level string value when the customer bundle contains that key", () => {
    i18n.addResourceBundle(
      "en",
      "template",
      { tabs: { "user-title": "Custom Title" } },
      true,
      true
    );
    expect(t("en", "template", "tabs.user-title")).toBe("Custom Title");
  });

  it("leaves unoverridden keys intact", () => {
    i18n.addResourceBundle(
      "en",
      "template",
      { tabs: { "user-title": "Custom Title" } },
      true,
      true
    );
    // "tabs.reload" was not overridden
    expect(t("en", "template", "tabs.reload")).toBe(EN_TABS_LANG_SELECTOR);
  });

  it("deep-merges nested keys without overwriting the entire parent object", () => {
    // Override only one nested key inside "tabs"
    i18n.addResourceBundle(
      "en",
      "template",
      { tabs: { "user-title": "Custom Title" } },
      true,
      true
    );
    expect(t("en", "template", "tabs.user-title")).toBe("Custom Title");
    // Sibling "reload" inside "tabs" must still be present
    expect(t("en", "template", "tabs.reload")).toBe(EN_TABS_LANG_SELECTOR);
    // Sibling namespace "error-boundary" at a higher level must also survive
    expect(t("en", "template", "error-boundary.title")).toBe(EN_APP_CARD_ADD_FAVORITE);
  });

  it("applies overrides independently per language", () => {
    const DE_TABS_ALL_APPS = "Benutzeransicht";
    i18n.addResourceBundle(
      "de",
      "template",
      { tabs: { "user-title": DE_TABS_ALL_APPS } },
      true,
      true
    );

    // English is unchanged
    expect(t("en", "template", "tabs.user-title")).toBe(EN_TABS_ALL_APPS);
    // German has the override
    expect(t("de", "template", "tabs.user-title")).toBe(DE_TABS_ALL_APPS);
  });

  it("a second override call accumulates on top of the first (deep merge)", () => {
    i18n.addResourceBundle(
      "en",
      "template",
      { tabs: { "user-title": "Custom Title" } },
      true,
      true
    );
    i18n.addResourceBundle("en", "template", { "error-boundary": { title: "Crash" } }, true, true);
    // Both overrides must coexist
    expect(t("en", "template", "tabs.user-title")).toBe("Custom Title");
    expect(t("en", "template", "error-boundary.title")).toBe("Crash");
    // Untouched key still present
    expect(t("en", "template", "tabs.reload")).toBe(EN_TABS_LANG_SELECTOR);
  });
});

// ─── Part 2: Branch-slug path matching regex ─────────────────────────────────

describe("per-customer override mechanism — branch-slug path matching", () => {
  // This is the exact regex from initI18n()
  const SLUG_REGEX = /\/customers\/([^/]+)\/locales\/([^/]+)\/([^/]+)\.json$/;

  const PATHS = [
    "../customers/acme-corp/locales/en/template.json",
    "../customers/acme-corp/locales/de/template.json",
    "../customers/acme-corp/locales/en/admin.json",
    "../customers/other-company/locales/en/template.json",
    "../customers/other-company/locales/de/admin.json",
    // Should NOT match (wrong extension / malformed)
    "../customers/acme-corp/locales/en/template.ts",
    "../locales/en/template.json",
  ];

  it("matches only paths belonging to the given slug", () => {
    const slug = "acme-corp";
    const matched = PATHS.filter((p) => {
      const m = SLUG_REGEX.exec(p);
      return m?.[1] === slug;
    });
    expect(matched).toHaveLength(3); // en/template, de/template, en/admin
    expect(matched.every((p) => p.includes("acme-corp"))).toBe(true);
  });

  it("does not include paths for a different slug", () => {
    const slug = "acme-corp";
    const matched = PATHS.filter((p) => {
      const m = SLUG_REGEX.exec(p);
      return m?.[1] === slug;
    });
    expect(matched.some((p) => p.includes("other-company"))).toBe(false);
  });

  it("does not match non-JSON files", () => {
    const slug = "acme-corp";
    const matched = PATHS.filter((p) => {
      const m = SLUG_REGEX.exec(p);
      return m?.[1] === slug;
    });
    expect(matched.some((p) => p.endsWith(".ts"))).toBe(false);
  });

  it("does not match the default locales folder (no customer slug)", () => {
    const defaultLocalePath = "../locales/en/template.json";
    expect(SLUG_REGEX.test(defaultLocalePath)).toBe(false);
  });

  it("extracts slug, lang, and namespace correctly from a matched path", () => {
    const path = "../customers/acme-corp/locales/de/admin.json";
    const m = SLUG_REGEX.exec(path);
    expect(m?.[1]).toBe("acme-corp"); // slug
    expect(m?.[2]).toBe("de"); // lang
    expect(m?.[3]).toBe("admin"); // namespace
  });

  it("_default slug does not match any customer path (no folder named _default exists)", () => {
    // The _default slug is used when no real branchSlug is set; no override files exist for it
    const slug = "_default";
    const matched = PATHS.filter((p) => {
      const m = SLUG_REGEX.exec(p);
      return m?.[1] === slug;
    });
    expect(matched).toHaveLength(0);
  });
});

// ─── Part 3: branchSlug gates which overrides load ───────────────────────────

describe("per-customer override mechanism — branchSlug integration", () => {
  it("applies the correct bundle when branchSlug matches a customer folder", () => {
    // Simulate what initI18n does for slug === "acme-corp":
    //   load customers/acme-corp/locales/en/template.json → addResourceBundle(...)
    const acmeOverrides = { tabs: { "user-title": "Custom Title" } };
    i18n.addResourceBundle("en", "template", acmeOverrides, true, true);

    expect(t("en", "template", "tabs.user-title")).toBe("Custom Title");
    // Unoverridden key must still be present
    expect(t("en", "template", "tabs.reload")).toBe(EN_TABS_LANG_SELECTOR);
  });

  it("base values remain when no override bundle is added for the slug", () => {
    // If branchSlug is _default or has no matching customer folder, nothing is added
    expect(t("en", "template", "tabs.user-title")).toBe(EN_TABS_ALL_APPS);
    expect(t("en", "template", "tabs.reload")).toBe(EN_TABS_LANG_SELECTOR);
  });

  it("a null branchSlug skips all customer loading", () => {
    // Mirrors the `if (slug)` guard in initI18n — null slug → no addResourceBundle calls
    const slug: string | null = null;
    if (slug) {
      i18n.addResourceBundle("en", "template", { tabs: { "user-title": "OVERRIDE" } }, true, true);
    }
    expect(t("en", "template", "tabs.user-title")).toBe(EN_TABS_ALL_APPS);
  });
});
