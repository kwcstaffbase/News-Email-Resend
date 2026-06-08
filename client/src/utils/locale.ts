const AVATAR_COLORS = ["cyan", "pink", "purple", "teal"] as const;
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  const chars = parts.slice(0, 2).map((p) => p[0] ?? "");
  return chars.join("").toUpperCase();
}

export function getOwnerDisplayName(owner: {
  userId: string;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const name = [owner.firstName, owner.lastName].filter(Boolean).join(" ");
  return name || owner.userId;
}

export function getAvatarColor(userId: string): AvatarColor {
  const code = userId.codePointAt(0) ?? 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

/**
 * Hardcoded display names for all Staffbase-supported locale codes.
 * Source: https://developers.staffbase.com/references/languages-and-locale-codes/
 *
 * Regional variants (e.g. ar_AE vs ar_SA) use the region to disambiguate so
 * users can tell them apart in the language selector.
 */
const STAFFBASE_LOCALE_NAMES: Record<string, string> = {
  af_ZA: "Afrikaans",
  sq_AL: "Albanian",
  am_ET: "Amharic",
  ar_AE: "Arabic (UAE)",
  ar_EG: "Arabic (Egypt)",
  ar_SA: "Arabic (Saudi Arabia)",
  eu_ES: "Basque",
  bn_BD: "Bengali",
  bs_BA: "Bosnian",
  bg_BG: "Bulgarian",
  my_MM: "Burmese",
  zh_CN: "Chinese (Simplified)",
  zh_HK: "Chinese (Traditional)",
  hr_HR: "Croatian",
  cs_CZ: "Czech",
  da_DK: "Danish",
  nl_NL: "Dutch",
  en_US: "English",
  et_EE: "Estonian",
  tl_PH: "Filipino",
  fi_FI: "Finnish",
  fr_FR: "French",
  fr_CA: "French (Canada)",
  ka_GE: "Georgian",
  de_DE: "German",
  el_GR: "Greek",
  kl_GL: "Greenlandic",
  gu_IN: "Gujarati",
  he_IL: "Hebrew",
  hi_IN: "Hindi",
  hu_HU: "Hungarian",
  is_IS: "Icelandic",
  id_ID: "Indonesian",
  ga_IE: "Irish",
  it_IT: "Italian",
  ja_JP: "Japanese",
  kn_IN: "Kannada",
  km_KH: "Khmer",
  rw_RW: "Kinyarwanda",
  ko_KR: "Korean",
  lo_LA: "Lao",
  lv_LV: "Latvian",
  lt_LT: "Lithuanian",
  mk_MK: "Macedonian",
  mg_MG: "Malagasy",
  ms_MY: "Malay",
  ml_IN: "Malayalam",
  mr_IN: "Marathi",
  mi_NZ: "Māori",
  mn_MN: "Mongolian",
  ne_NP: "Nepali",
  nl_BE: "Dutch (Belgium)",
  no_NO: "Norwegian",
  ps_AF: "Pashto",
  fa_AF: "Persian (Dari)",
  fa_IR: "Persian (Farsi)",
  pl_PL: "Polish",
  pt_BR: "Portuguese (Brazil)",
  pt_PT: "Portuguese (Portugal)",
  pa_IN: "Punjabi",
  ro_RO: "Romanian",
  ru_RU: "Russian",
  sr_RS: "Serbian",
  si_LK: "Sinhala",
  sk_SK: "Slovak",
  sl_SI: "Slovenian",
  so_SO: "Somali",
  es_ES: "Spanish",
  es_MX: "Spanish (Mexico)",
  sw_TZ: "Swahili",
  sv_SE: "Swedish",
  ta_IN: "Tamil",
  te_IN: "Telugu",
  th_TH: "Thai",
  ti_ER: "Tigrinya",
  tr_TR: "Turkish",
  uk_UA: "Ukrainian",
  ur_PK: "Urdu",
  uz_UZ: "Uzbek",
  vi_VN: "Vietnamese",
  cy_GB: "Welsh",
  zu_ZA: "Zulu",
};

/**
 * Convert a Staffbase locale key (e.g. `en_US`, `de_DE`) to a human-readable
 * English language name.
 *
 * Uses a hardcoded map of all Staffbase-supported locales as the primary source
 * so that exotic locales like `kl_GL` (Greenlandic) or `ti_ER` (Tigrinya) always
 * render a proper name regardless of browser Intl support. Falls back to
 * Intl.DisplayNames for any locale not in the map, then to the raw locale code.
 */
// Instantiated once at module scope to avoid creating a new object on every call
// when rendering a language list. Guarded for environments missing Intl.DisplayNames.
let _intlDisplayNames: Intl.DisplayNames | null = null;
try {
  _intlDisplayNames = new Intl.DisplayNames(["en"], { type: "language" });
} catch {
  // Intl.DisplayNames not supported in this environment
}

export function localeToDisplayName(locale: string): string {
  const hardcoded = STAFFBASE_LOCALE_NAMES[locale];
  if (hardcoded) return hardcoded;
  // replaceAll handles locale codes with more than one underscore safely.
  const bcp47 = locale.replaceAll("_", "-");
  if (_intlDisplayNames) {
    const name = _intlDisplayNames.of(bcp47);
    if (name) return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return locale;
}

export function getLocalized(
  record: Record<string, string> | null | undefined,
  locale: string,
  fallback?: string
): string {
  if (!record) return "";
  const byLocale = record[locale];
  if (byLocale !== undefined) return byLocale;
  const byFallback = fallback === undefined ? undefined : record[fallback];
  if (byFallback !== undefined) return byFallback;
  return Object.values(record)[0] ?? "";
}
