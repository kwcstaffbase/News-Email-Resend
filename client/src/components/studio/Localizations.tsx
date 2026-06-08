import { Badge, Divider, Tabs } from "@staffbase/design";
import { Fragment, type ReactNode, useState } from "react";
import { getLanguageDisplayName, toIsoLocale } from "../../utils/contentLanguages.ts";
import { LocalizationsActions } from "./LocalizationsActions.tsx";

/**
 * Tab-based language switcher with add/remove actions and error badge support.
 * Adapted from experience-studio/libs/components/src/localizations/Localizations.tsx
 * Adaptation: uses Dialog-based LocalizationsActions instead of deprecated Modal/SandboxMultiselect.
 */

interface LocalizationsProps {
  activeLanguages: string[];
  availableLanguages: string[];
  onLanguagesChange: (languages: string[], copyFromLocale: string | null) => void;
  hasErrors: (locale: string) => boolean;
  children: (locale: string) => ReactNode;
  disabled?: boolean;
}

export function Localizations({
  activeLanguages,
  availableLanguages,
  onLanguagesChange,
  hasErrors,
  children,
  disabled,
}: Readonly<LocalizationsProps>) {
  const [activeTab, setActiveTab] = useState<string>(activeLanguages[0] ?? "en_US");

  function handleAdd(locales: string[], copyFromLocale: string | null) {
    const next = [...activeLanguages, ...locales.filter((l) => !activeLanguages.includes(l))];
    // en_US must always be first
    const sorted = ["en_US", ...next.filter((l) => l !== "en_US")];
    onLanguagesChange(sorted, copyFromLocale);
    if (locales[0]) {
      setActiveTab(locales[0]);
    }
  }

  function handleRemove(locales: string[]) {
    const next = activeLanguages.filter((l) => !locales.includes(l) || l === "en_US");
    onLanguagesChange(next, null);
    if (locales.includes(activeTab)) {
      setActiveTab("en_US");
    }
  }

  return (
    <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
      <div className="flex w-full items-center gap-8 border-b border-neutral-weak pb-0">
        <Tabs.List className="flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
          {activeLanguages.map((locale, index) => (
            <Fragment key={locale}>
              <Tabs.Trigger value={locale} disabled={disabled}>
                <span className="whitespace-nowrap">{getLanguageDisplayName(locale)}</span>
                <span className="pl-4 text-body-xs text-neutral-medium uppercase">
                  {toIsoLocale(locale)}
                </span>
                {hasErrors(locale) ? (
                  <Badge
                    variant="critical"
                    a11yDescription="Error"
                    className="absolute top-4 -right-4"
                  />
                ) : null}
              </Tabs.Trigger>
              {index < activeLanguages.length - 1 ? (
                <Divider
                  dividerPosition="vertical"
                  padding={2}
                  className="h-6 bg-neutral-weak self-center"
                />
              ) : null}
            </Fragment>
          ))}
        </Tabs.List>
        <div className="flex shrink-0 items-center gap-4 pl-4">
          <LocalizationsActions
            activeLanguages={activeLanguages}
            availableLanguages={availableLanguages}
            onAdd={handleAdd}
            onRemove={handleRemove}
            disabled={disabled}
          />
        </div>
      </div>

      {activeLanguages.map((locale) => (
        <Tabs.Content key={locale} value={locale} className="pt-4">
          {children(locale)}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
