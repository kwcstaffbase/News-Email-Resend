import i18next from "i18next";
import { useEffect } from "react";
import { useI18n } from "../hooks/useI18n.ts";

export default function EndUserView() {
  const { t } = useI18n();

  // Switch UI language to user's Staffbase locale on mount
  useEffect(() => {
    const locale =
      globalThis.__USER__?.locale ??
      (import.meta.env.VITE_DEV_LOCALE as string | null | undefined) ??
      null;
    if (!locale) return;
    const lang = locale.split(/[_-]/)[0];
    if (lang && lang !== i18next.language) {
      void i18next.changeLanguage(lang);
    }
  }, []);

  return (
    <div
      data-testid="end-user-view"
      data-layout="user"
      className="min-h-screen bg-white font-brand"
    >
      <main className="mx-auto max-w-5xl px-24 py-48">
        <h1 className="text-heading-lg font-semibold text-neutral-strong">
          {t("placeholder.user-title")}
        </h1>
        <p className="mt-16 text-body-md text-neutral-medium">{t("placeholder.user-body")}</p>
      </main>
    </div>
  );
}
