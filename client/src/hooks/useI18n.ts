import type { KeyPrefix } from "i18next";
import { type UseTranslationOptions, useTranslation } from "react-i18next";

/**
 * Typed translation hook scoped to the "template" namespace.
 *
 * Controls **UI language** (button labels, tab names, error messages, etc.).
 * Language is sourced from:
 *   - **End-user pages** (`EndUserView`): switches to the Staffbase user locale
 *     (`window.__USER__.locale` from the JWT) on mount, so interface labels
 *     match the user's chosen Staffbase language.
 *   - **Admin pages**: purely browser/device language via i18next `LanguageDetector`
 *     (`navigator`). Admins manage their own browser locale independently.
 * Available languages: `de`, `en`, `es`, `fr`, `pl` (extendable in `init.ts`).
 * Customers can override individual keys via `client/public/customers/{slug}/locales/`.
 *
 * Usage:
 *   const { t } = useI18n();
 *   const { t } = useI18n({ keyPrefix: "placeholder" });
 */
export function useI18n<TKPrefix extends KeyPrefix<"template"> = undefined>(
  options?: UseTranslationOptions<TKPrefix>
) {
  return useTranslation<"template", TKPrefix>("template", options);
}
