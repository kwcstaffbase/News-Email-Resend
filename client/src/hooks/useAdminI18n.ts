import type { KeyPrefix } from "i18next";
import { type UseTranslationOptions, useTranslation } from "react-i18next";

/**
 * Typed translation hook scoped to the "admin" namespace.
 *
 * Controls **UI language** for the admin panel (form labels, dialog titles,
 * confirm buttons, etc.). Language is detected from the browser (`navigator`)
 * via i18next — not from the Staffbase SDK. Not related to content language
 * (which locales an app's metadata supports); see `useLanguages()` for that.
 *
 * Usage:
 *   const { t } = useAdminI18n();
 *   const { t } = useAdminI18n({ keyPrefix: "app-form" });
 */
export function useAdminI18n<TKPrefix extends KeyPrefix<"admin"> = undefined>(
  options?: UseTranslationOptions<TKPrefix>
) {
  return useTranslation<"admin", TKPrefix>("admin", options);
}
