import {
  AddIcon,
  Banner,
  BinIcon,
  Button,
  Dialog,
  Divider,
  IconGhostButton,
  RadioGroup,
  SearchableMultiSelect,
  Select,
} from "@staffbase/design";
import { useMemo, useState } from "react";
import { useAdminI18n } from "../../hooks/useAdminI18n.ts";
import { getLanguageDisplayName, toIsoLocale } from "../../utils/contentLanguages.ts";

/**
 * Add/remove language buttons with Dialog-based multi-select.
 * Adapted from experience-studio/libs/components/src/localizations/LocalizationsActions.tsx
 * Adaptation: uses Dialog (not deprecated Modal) and SearchableMultiSelect matching this
 * codebase's conventions.
 */

interface LanguageItem {
  id: string;
  name: string;
  isoLocale: string;
}

type CopyChoice = "copy" | "empty";

interface LocalizationsActionsProps {
  activeLanguages: string[];
  availableLanguages: string[];
  onAdd: (locales: string[], copyFromLocale: string | null) => void;
  onRemove: (locales: string[]) => void;
  disabled?: boolean;
}

export function LocalizationsActions({
  activeLanguages,
  availableLanguages,
  onAdd,
  onRemove,
  disabled,
}: Readonly<LocalizationsActionsProps>) {
  const { t } = useAdminI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<"add" | "remove">("add");
  const [selectedLocales, setSelectedLocales] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [copyChoice, setCopyChoice] = useState<CopyChoice>("copy");
  const [copyFromLocale, setCopyFromLocale] = useState<string>("en_US");

  // Languages available to add: in branch list but not yet active
  const addableLanguages = availableLanguages.filter((l) => !activeLanguages.includes(l));

  // Languages available to remove: active but not en_US (which is always required)
  const removableLanguages = activeLanguages.filter((l) => l !== "en_US");

  const allItems = useMemo<LanguageItem[]>(
    () =>
      (type === "add" ? addableLanguages : removableLanguages).map((locale) => ({
        id: locale,
        name: getLanguageDisplayName(locale),
        isoLocale: toIsoLocale(locale),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, removableLanguages, addableLanguages]
  );

  const filteredItems = useMemo<LanguageItem[]>(
    () =>
      query.trim() === ""
        ? allItems
        : allItems.filter(
            (item) =>
              item.name.toLowerCase().includes(query.toLowerCase()) ||
              item.isoLocale.toLowerCase().includes(query.toLowerCase())
          ),
    [allItems, query]
  );

  function openDialog(actionType: "add" | "remove") {
    setType(actionType);
    setSelectedLocales([]);
    setQuery("");
    setCopyChoice("copy");
    setCopyFromLocale(activeLanguages[0] ?? "en_US");
    setIsOpen(true);
  }

  function closeDialog() {
    setIsOpen(false);
    setSelectedLocales([]);
    setQuery("");
    setCopyChoice("copy");
    setCopyFromLocale("en_US");
  }

  function handleConfirm() {
    if (selectedLocales.length === 0) {
      closeDialog();
      return;
    }
    if (type === "add") {
      onAdd(selectedLocales, copyChoice === "copy" ? copyFromLocale : null);
    } else {
      onRemove(selectedLocales);
    }
    closeDialog();
  }

  return (
    <>
      <IconGhostButton
        icon={<AddIcon />}
        title={t("localizations.add-label")}
        variant="secondary"
        disabled={disabled ?? addableLanguages.length === 0}
        onClick={() => openDialog("add")}
      />

      {removableLanguages.length > 0 && (
        <>
          <Divider dividerPosition="vertical" padding={4} className="h-6 bg-neutral-weak" />
          <IconGhostButton
            icon={<BinIcon />}
            title={t("localizations.remove-label")}
            variant="critical"
            disabled={disabled}
            onClick={() => openDialog("remove")}
          />
        </>
      )}

      <Dialog.Root open={isOpen} onOpenChange={(open) => !open && closeDialog()}>
        <Dialog.Popup className="max-w-md">
          <Dialog.Header>
            <Dialog.Title>
              {type === "add" ? t("localizations.add-title") : t("localizations.remove-title")}
            </Dialog.Title>
          </Dialog.Header>

          <Dialog.Body>
            {allItems.length === 0 ? (
              <p className="text-body-sm text-neutral-medium py-4">
                {t("localizations.no-available")}
              </p>
            ) : (
              <div className="flex flex-col gap-12">
                <SearchableMultiSelect.Root
                  filteredItems={filteredItems}
                  inputValue={query}
                  onInputValueChange={setQuery}
                  open={isPopupOpen}
                  onOpenChange={setIsPopupOpen}
                  value={selectedLocales}
                  onValueChange={setSelectedLocales}
                >
                  <SearchableMultiSelect.Value>
                    {(ids: string[]) => (
                      <>
                        {ids.map((id) => (
                          <SearchableMultiSelect.Chip
                            key={id}
                            aria-label={getLanguageDisplayName(id)}
                          >
                            {getLanguageDisplayName(id)}
                          </SearchableMultiSelect.Chip>
                        ))}
                        <SearchableMultiSelect.Input
                          placeholder={ids.length ? "" : t("localizations.search-placeholder")}
                        />
                      </>
                    )}
                  </SearchableMultiSelect.Value>

                  <SearchableMultiSelect.Popup sideOffset={8}>
                    <SearchableMultiSelect.Empty>
                      {t("localizations.no-results")}
                    </SearchableMultiSelect.Empty>
                    <SearchableMultiSelect.List>
                      {(item: LanguageItem) => (
                        <SearchableMultiSelect.Item
                          key={item.id}
                          value={item.id}
                          className="flex flex-1 items-center justify-between gap-3"
                        >
                          <span className="text-body-sm">{item.name}</span>
                          <span className="text-body-xs text-neutral-medium shrink-0">
                            {item.isoLocale}
                          </span>
                        </SearchableMultiSelect.Item>
                      )}
                    </SearchableMultiSelect.List>
                  </SearchableMultiSelect.Popup>
                </SearchableMultiSelect.Root>

                {type === "add" && (
                  <div className="flex flex-col gap-12">
                    <RadioGroup
                      groupLabel={t("localizations.content-choice-label")}
                      onChange={(e) => setCopyChoice(e.target.value as CopyChoice)}
                      options={[
                        {
                          label: t("localizations.choice-copy"),
                          description: t("localizations.choice-copy-desc"),
                          value: "copy",
                          name: "addLangCopyChoice",
                          checked: copyChoice === "copy",
                        },
                        {
                          label: t("localizations.choice-empty"),
                          description: t("localizations.choice-empty-desc"),
                          value: "empty",
                          name: "addLangCopyChoice",
                          checked: copyChoice === "empty",
                        },
                      ]}
                    />

                    {copyChoice === "copy" && (
                      <div className="flex flex-col gap-4">
                        <span className="text-label-sm">{t("localizations.copy-from-label")}</span>
                        <Select.Root
                          value={copyFromLocale}
                          onValueChange={(value) => {
                            if (value !== null) setCopyFromLocale(value);
                          }}
                          disabled={activeLanguages.length <= 1}
                        >
                          <Select.Trigger className="w-full">
                            {copyFromLocale
                              ? `${getLanguageDisplayName(copyFromLocale)} (${toIsoLocale(copyFromLocale)})`
                              : "\u2026"}
                          </Select.Trigger>
                          <Select.Popup>
                            <Select.List>
                              {activeLanguages.map((locale) => (
                                <Select.Item key={locale} value={locale}>
                                  {getLanguageDisplayName(locale)}
                                  <span className="text-body-xs text-neutral-medium ml-8">
                                    {toIsoLocale(locale)}
                                  </span>
                                </Select.Item>
                              ))}
                            </Select.List>
                          </Select.Popup>
                        </Select.Root>
                      </div>
                    )}

                    <Banner variant="info" size="sm">
                      {copyChoice === "copy"
                        ? t("localizations.copy-info")
                        : t("localizations.empty-info")}
                    </Banner>
                  </div>
                )}
              </div>
            )}
          </Dialog.Body>

          <Dialog.Footer>
            <div className="flex justify-end gap-8">
              <Button variant="secondary" type="button" onClick={closeDialog}>
                {t("localizations.cancel")}
              </Button>
              <Button
                variant={type === "remove" ? "critical" : "primary"}
                type="button"
                disabled={selectedLocales.length === 0}
                onClick={handleConfirm}
              >
                {type === "add" ? t("localizations.add-label") : t("localizations.remove-label")}
              </Button>
            </div>
          </Dialog.Footer>
        </Dialog.Popup>
      </Dialog.Root>
    </>
  );
}
