/**
 * Language display name mapping.
 * Sourced from experience-studio/libs/i18n/src/available-content-languages.ts
 */

export type ContentLanguage = {
  locale: string;
  isoLocale: string;
  name: string;
};

export const availableContentLanguages: ContentLanguage[] = [
  { locale: "af_ZA", isoLocale: "af-ZA", name: "Afrikaans" },
  { locale: "am_ET", isoLocale: "am-ET", name: "አማርኛ" },
  {
    locale: "ar_SA",
    isoLocale: "ar-SA",
    name: "العربية (المملكة العربية السعودية)",
  },
  {
    locale: "ar_AE",
    isoLocale: "ar-AE",
    name: "العربية (الإمارات العربية المتحدة)",
  },
  { locale: "ar_EG", isoLocale: "ar-EG", name: "العربية (مصر)" },
  { locale: "bg_BG", isoLocale: "bg-BG", name: "български" },
  { locale: "bn_BD", isoLocale: "bn-BD", name: "বাংলা" },
  { locale: "bs_BA", isoLocale: "bs-BA", name: "Bosanski" },
  { locale: "cs_CZ", isoLocale: "cs-CZ", name: "Čeština" },
  { locale: "cy_GB", isoLocale: "cy-GB", name: "Cymraeg" },
  { locale: "da_DK", isoLocale: "da-DK", name: "Dansk" },
  { locale: "de_DE", isoLocale: "de-DE", name: "Deutsch" },
  { locale: "el_GR", isoLocale: "el-GR", name: "Ελληνικά" },
  { locale: "en_US", isoLocale: "en-US", name: "English (United States)" },
  { locale: "en_GB", isoLocale: "en-GB", name: "English (United Kingdom)" },
  { locale: "es_ES", isoLocale: "es-ES", name: "Español (España)" },
  { locale: "es_MX", isoLocale: "es-MX", name: "Español (México)" },
  { locale: "eu_ES", isoLocale: "eu-ES", name: "Euskara (Espainia)" },
  { locale: "et_EE", isoLocale: "et-EE", name: "Eesti keel" },
  { locale: "fa_IR", isoLocale: "fa-IR", name: "فارسی" },
  { locale: "fa_AF", isoLocale: "fa-AF", name: "دري" },
  { locale: "fi_FI", isoLocale: "fi-FI", name: "Suomi" },
  { locale: "fr_FR", isoLocale: "fr-FR", name: "Français (France)" },
  { locale: "fr_CA", isoLocale: "fr-CA", name: "Français (Canada)" },
  { locale: "ga_IE", isoLocale: "ga-IE", name: "Gaeilge" },
  { locale: "gu_IN", isoLocale: "gu-IN", name: "ગુજરાતી" },
  { locale: "he_IL", isoLocale: "he-IL", name: "עִבְרִית" },
  { locale: "hi_IN", isoLocale: "hi-IN", name: "हिन्दी" },
  { locale: "zh_HK", isoLocale: "zh-HK", name: "繁體中文" },
  { locale: "ht_HT", isoLocale: "ht-HT", name: "kreyòl ayisyen" },
  { locale: "hr_HR", isoLocale: "hr-HR", name: "Hrvatski" },
  { locale: "hu_HU", isoLocale: "hu-HU", name: "Magyar" },
  { locale: "id_ID", isoLocale: "id-ID", name: "Bahasa Indonesia" },
  { locale: "is_IS", isoLocale: "is-IS", name: "Íslenska" },
  { locale: "it_IT", isoLocale: "it-IT", name: "Italiano" },
  { locale: "ja_JP", isoLocale: "ja-JP", name: "日本語" },
  { locale: "ka_GE", isoLocale: "ka-GE", name: "ქართული ენა" },
  { locale: "kl_GL", isoLocale: "kl-GL", name: "Kalaallisut" },
  { locale: "km_KH", isoLocale: "km-KH", name: "ខ្មែរ" },
  { locale: "kn_IN", isoLocale: "kn-IN", name: "ಕನ್ನಡ" },
  { locale: "ko_KR", isoLocale: "ko-KR", name: "한국어" },
  { locale: "lo_LA", isoLocale: "lo-LA", name: "ລາວ" },
  { locale: "lt_LT", isoLocale: "lt-LT", name: "Lietuvių" },
  { locale: "lv_LV", isoLocale: "lv-LV", name: "Latviešu" },
  { locale: "mg_MG", isoLocale: "mg-MG", name: "Malagasy" },
  { locale: "mk_MK", isoLocale: "mk-MK", name: "Македонски" },
  { locale: "mh_MH", isoLocale: "mh-MH", name: "Kajin M̧ajeļ" },
  { locale: "mi_NZ", isoLocale: "mi-NZ", name: "Māori" },
  { locale: "ml_IN", isoLocale: "ml-IN", name: "മലയാളം" },
  { locale: "mn_MN", isoLocale: "mn-MN", name: "монгол" },
  { locale: "mr_IN", isoLocale: "mr-IN", name: "मराठी" },
  { locale: "ms_MY", isoLocale: "ms-MY", name: "Bahasa Melayu" },
  { locale: "my_MM", isoLocale: "my-MM", name: "Burmese" },
  { locale: "ne_NP", isoLocale: "ne-NP", name: "नेपाली" },
  { locale: "nl_NL", isoLocale: "nl-NL", name: "Nederlands" },
  { locale: "nl_BE", isoLocale: "nl-BE", name: "Vlaams" },
  { locale: "no_NO", isoLocale: "no-NO", name: "Norsk" },
  { locale: "pa_IN", isoLocale: "pa-IN", name: "ਪੰਜਾਬੀ" },
  { locale: "pl_PL", isoLocale: "pl-PL", name: "Polski" },
  { locale: "ps_AF", isoLocale: "ps-AF", name: "پښتو" },
  { locale: "pt_PT", isoLocale: "pt-PT", name: "Português (Portugal)" },
  { locale: "pt_BR", isoLocale: "pt-BR", name: "Português (Brasil)" },
  { locale: "ro_RO", isoLocale: "ro-RO", name: "Română" },
  { locale: "ru_RU", isoLocale: "ru-RU", name: "Русский" },
  { locale: "rw_RW", isoLocale: "rw-RW", name: "Kinyarwanda" },
  { locale: "si_LK", isoLocale: "si-LK", name: "සිංහල" },
  { locale: "sk_SK", isoLocale: "sk-SK", name: "Slovenský" },
  { locale: "sl_SI", isoLocale: "sl-SI", name: "Slovenščina" },
  { locale: "sq_AL", isoLocale: "sq-AL", name: "Shqip" },
  { locale: "sr_RS", isoLocale: "sr-RS", name: "Српски" },
  { locale: "so_SO", isoLocale: "so-SO", name: "Af-Soomaali" },
  { locale: "sv_SE", isoLocale: "sv-SE", name: "Svenska" },
  { locale: "sw_TZ", isoLocale: "sw-TZ", name: "Swahili" },
  { locale: "ta_IN", isoLocale: "ta-IN", name: "தமிழ்" },
  { locale: "te_IN", isoLocale: "te-IN", name: "తెలుగు" },
  { locale: "ti_ER", isoLocale: "ti-ER", name: "ትግሪኛ" },
  { locale: "tl_PH", isoLocale: "tl-PH", name: "Filipino" },
  { locale: "th_TH", isoLocale: "th-TH", name: "ภาษาไทย" },
  { locale: "tr_TR", isoLocale: "tr-TR", name: "Türkçe" },
  { locale: "uk_UA", isoLocale: "uk-UA", name: "Українська" },
  { locale: "ur_PK", isoLocale: "ur-PK", name: "اُردُو" },
  { locale: "uz_UZ", isoLocale: "uz-UZ", name: "o'zbek (lotin)" },
  { locale: "vi_VN", isoLocale: "vi-VN", name: "Tiếng Việt" },
  { locale: "zh_CN", isoLocale: "zh-CN", name: "简体中文" },
  { locale: "zu_ZA", isoLocale: "zu-ZA", name: "isiZulu" },
];

const langMap = new Map<string, ContentLanguage>(
  availableContentLanguages.map((l) => [l.locale, l])
);

/** Returns the human-readable display name for a locale (e.g. "en_US" → "English (United States)"). */
export function getLanguageDisplayName(locale: string): string {
  return langMap.get(locale)?.name ?? locale;
}

/** Converts a Java-style locale (e.g. "de_DE") to BCP 47 / ISO format (e.g. "de-DE"). */
export function toIsoLocale(locale: string): string {
  return langMap.get(locale)?.isoLocale ?? locale.replace("_", "-");
}
