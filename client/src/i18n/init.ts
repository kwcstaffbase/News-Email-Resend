import i18next, { type BackendModule, type CallbackError } from "i18next";
import LanguageDetector, { type DetectorOptions } from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

// Glob-import all locale JSON files; Vite will create lazy chunks per file.
// Path is relative to this file: src/i18n/ → src/locales/
const locales = import.meta.glob<Record<string, unknown>>("../locales/*/*.json", {
  import: "default",
});

// Glob-import all per-customer locale override files.
// Pattern: public/customers/{branch_slug}/locales/{lang}/{namespace}.json
// Single source of truth for both the React client and the widget server.
// Only keys present in these files override the defaults — missing keys fall through.
const customerLocales = import.meta.glob<Record<string, unknown>>(
  "../../public/customers/*/locales/*/*.json",
  { import: "default" }
);

// Admin pages always use the browser / device language (the admin chooses their own
// browser locale independently of the Staffbase user-locale JWT claim).
// End-user facing pages (EndUserView) override i18next language at mount time
// based on window.__USER__.locale.
const detection: DetectorOptions = import.meta.env.DEV
  ? { order: ["querystring", "navigator"], lookupQuerystring: "lang" }
  : { order: ["navigator"] };

export async function initI18n(): Promise<void> {
  await i18next
    .use(initReactI18next)
    .use<BackendModule>({
      type: "backend",
      init: () => {
        // no-op
      },
      read: (language, namespace, cb) => {
        const key = `../locales/${language}/${namespace}.json`;
        const loader = locales[key];
        if (loader) {
          loader()
            .then((data) => cb(null, data))
            .catch((e) => cb(e as CallbackError, null));
        } else {
          cb(null, null);
        }
      },
    })
    .use(new LanguageDetector(null, { ...detection }))
    .init({
      supportedLngs: ["de", "en", "fr", "es", "pl"],
      // In dev, fall back to English to surface missing keys; in prod leave it
      // to the user's own language so we don't silently hide untranslated text.
      fallbackLng: import.meta.env.DEV ? "en" : false,
      nonExplicitSupportedLngs: true,
      defaultNS: "template",
      ns: ["template", "admin"],
      interpolation: {
        // React already escapes output; no need to double-escape.
        escapeValue: false,
      },
    });

  // Keep the HTML lang attribute in sync with the active language.
  i18next.on("languageChanged", (lng) => {
    document.documentElement.setAttribute("lang", lng);
  });

  // Merge per-customer locale overrides on top of the defaults loaded above.
  // The branch_slug from window.__USER__ selects which customer folder to use.
  // In local dev (Vite port 5173) __USER__ is never injected by the server, so fall
  // back to VITE_DEV_BRANCH_SLUG which Vite bakes in from LOCALDEV_BRANCH_SLUG.
  // Only keys present in the override file are changed; everything else falls through.
  const slug = globalThis.__USER__?.branchSlug ?? import.meta.env.VITE_DEV_BRANCH_SLUG ?? null;
  if (slug) {
    for (const [path, loader] of Object.entries(customerLocales)) {
      // path shape: ../../public/customers/{slug}/locales/{lang}/{namespace}.json
      const match = /\/customers\/([^/]+)\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
      if (!match || match[1] !== slug) continue;
      const [, , lang, ns] = match;
      // widget.json is consumed server-side for the Web Component; skip it here.
      if (ns === "widget") continue;
      const data = await loader();
      i18next.addResourceBundle(lang, ns, data, /* deep */ true, /* overwrite */ true);
    }
  }
}
