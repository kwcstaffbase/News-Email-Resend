import {
  type BranchLanguageInfo,
  getBranchDefaultLanguage,
  getBranchLanguages,
  getUserContentLocale,
} from "@staffbase/plugins-client-sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getToken } from "../token.ts";

interface LanguagesResult {
  languages: string[];
  defaultLanguage: string;
  currentLanguage: string;
  setCurrentLanguage: (lang: string) => void;
}

const DEV_LANGUAGES = (import.meta.env.VITE_DEV_LANGUAGES ?? "en_US")
  .split(",")
  .map((l: string) => l.trim())
  .filter(Boolean) as string[];

const DEV_DEFAULT = DEV_LANGUAGES[0] ?? "en_US";

/**
 * Returns the **content language** configuration for this Staffbase branch.
 *
 * Calls `getBranchLanguages()` and `getBranchDefaultLanguage()` from
 * `@staffbase/plugins-client-sdk` to discover which locales the branch
 * supports for app metadata (name, descriptions, link).  These are jsonb
 * locale keys (`en_US`, `de_DE`, …) — not UI language codes.
 *
 * This hook has nothing to do with the UI language (button labels, error
 * messages, etc.).  UI language is determined separately from the browser via
 * i18next — see `client/src/i18n/init.ts`.
 */
export function useLanguages(): LanguagesResult {
  const isLocalDev = getToken() === "dev";
  // Only call the SDK when the page is embedded in an iframe. Outside of an
  // iframe there is no Staffbase parent frame to respond to postMessage and
  // the handshake would always time out with "No answer from Staffbase App".
  const isEmbedded = globalThis.parent !== globalThis.self;
  // In localdev, __USER__.locale is populated from LOCALDEV_LOCALE (set in .env).
  // This mirrors how production derives the initial content language from the JWT claim.
  // Fallback to import.meta.env.VITE_DEV_LOCALE (baked in by vite.config.ts) so the
  // Vite dev server path (port 5173, no server-side __USER__ injection) also picks up
  // the configured locale.
  const devLocale = isLocalDev
    ? (globalThis.__USER__?.locale ??
      (import.meta.env.VITE_DEV_LOCALE as string | null | undefined) ??
      null)
    : null;
  const devInitial = devLocale && DEV_LANGUAGES.includes(devLocale) ? devLocale : DEV_DEFAULT;
  const [currentLanguage, setCurrentLanguage] = useState<string>(isLocalDev ? devInitial : "en_US");

  const { data } = useQuery({
    queryKey: ["languages"],
    queryFn: async () => {
      const [langsObj, defaultLangObj, userLocaleObj] = await Promise.all([
        getBranchLanguages(),
        getBranchDefaultLanguage(),
        getUserContentLocale(),
      ]);
      // The SDK returns an object keyed by normalized short codes (e.g. "de", "hk"),
      // each value having a `locale` property with the full locale string (e.g. "de_DE").
      // Extract the locale strings to produce the string[] the rest of the app expects.
      const languages = Object.values(langsObj).map((info: BranchLanguageInfo) => info.locale);
      const defaultLanguage = defaultLangObj?.locale ?? "en_US";
      // Priority: user content locale → branch default → browser language → first available.
      // Each step validates the locale is in the branch's language list so the
      // language selector always has a valid selected value.
      const userLanguage = (() => {
        // 1. User's own content locale (must be supported by this branch).
        //    getUserContentLocale() returns a plain string (e.g. "de_DE"), not a
        //    BranchLanguageInfo object, so use it directly.
        if (userLocaleObj && languages.includes(userLocaleObj)) {
          return userLocaleObj;
        }
        // 2. Branch default
        if (languages.includes(defaultLanguage)) {
          return defaultLanguage;
        }
        // 3. Browser/device language — navigator.language is "de-DE" or "de";
        //    branch locales use underscore ("de_DE"), so normalise before matching.
        const nav = navigator.language.replace("-", "_");
        const browserMatch =
          languages.find((l) => l === nav) ??
          languages.find((l) => l.startsWith(`${nav.split("_")[0]}_`));
        if (browserMatch) return browserMatch;
        // 4. First available language in the branch
        return languages[0] ?? defaultLanguage;
      })();
      return { languages, defaultLanguage, userLanguage };
    },
    enabled: !isLocalDev && isEmbedded,
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (data?.userLanguage) {
      setCurrentLanguage(data.userLanguage);
    }
  }, [data?.userLanguage]);

  if (isLocalDev) {
    return {
      languages: DEV_LANGUAGES,
      defaultLanguage: DEV_DEFAULT,
      currentLanguage,
      setCurrentLanguage,
    };
  }

  return {
    languages: data?.languages ?? [],
    defaultLanguage: data?.defaultLanguage ?? "en_US",
    currentLanguage,
    setCurrentLanguage,
  };
}
