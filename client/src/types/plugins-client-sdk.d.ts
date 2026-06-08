declare module "@staffbase/plugins-client-sdk" {
  export interface BranchLanguageInfo {
    key: string;
    locale: string;
    name: string;
    localizedName: string;
    direction?: "ltr" | "rtl";
  }

  export function getBranchLanguages(): Promise<Record<string, BranchLanguageInfo>>;
  export function getBranchDefaultLanguage(): Promise<BranchLanguageInfo>;
  export function getUserContentLocale(): Promise<string>;
  export function getInstanceUrl(): Promise<string>;
  export function openLinkExternal(url: string): Promise<unknown>;
  export function isNativeApp(): Promise<boolean>;
  export function isMobileApp(): Promise<boolean>;
}
