import type { Option } from "@staffbase/design";
import {
  Banner,
  Button,
  CloseIcon,
  Filter,
  FilterIcon,
  GhostButton,
  SearchInput,
  Select,
  SettingsIcon,
  SortIcon,
  Tabs,
} from "@staffbase/design";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "../../api/index.ts";
import { useAdminI18n } from "../../hooks/useAdminI18n.ts";
import {
  ITEM_CATEGORIES,
  ITEM_SORT_OPTIONS,
  type ItemCategoriesResponse,
  type ItemCategory,
  type ItemSortOrder,
  type ItemStatus,
} from "../../types/api.ts";
import StudioHeader from "../studio/StudioHeader.tsx";

interface AdminLayoutProps {
  children: ReactNode;
  status: ItemStatus;
  onStatusChange: (next: ItemStatus) => void;
  onOpenSettings: () => void;
  onCreateItem: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  itemCount: number;
  sort: ItemSortOrder;
  onSortChange: (next: ItemSortOrder) => void;
  categoryFilter: ItemCategory[];
  onCategoryFilterChange: (next: ItemCategory[]) => void;
}

export function AdminLayout({
  children,
  status,
  onStatusChange,
  onOpenSettings,
  onCreateItem,
  search,
  onSearchChange,
  onSearchClear,
  itemCount,
  sort,
  onSortChange,
  categoryFilter,
  onCategoryFilterChange,
}: Readonly<AdminLayoutProps>) {
  const { t } = useAdminI18n();

  const { data: settingsData } = useQuery<{ hasApiToken: boolean }>({
    queryKey: ["settings"],
    queryFn: () => api.get<{ hasApiToken: boolean }>("/api/settings").then((r) => r.data),
  });

  const { data: categoryData } = useQuery<ItemCategoriesResponse>({
    queryKey: ["items-categories", status],
    queryFn: () =>
      api.get<ItemCategoriesResponse>(`/api/items/categories?status=${status}`).then((r) => r.data),
  });

  const showSetupWarning = settingsData !== undefined && !settingsData.hasApiToken;

  const SORT_LABEL_KEYS = {
    name_asc: "sort.name-asc",
    name_desc: "sort.name-desc",
    newest: "sort.newest",
    oldest: "sort.oldest",
    last_edited: "sort.last-edited",
  } as const satisfies Record<ItemSortOrder, Parameters<typeof t>[0]>;

  const translatedSortOptions = ITEM_SORT_OPTIONS.map((opt) => ({
    ...opt,
    label: t(SORT_LABEL_KEYS[opt.value]),
  }));

  const CATEGORY_LABEL_KEYS = {
    general: "category.general",
    important: "category.important",
    internal: "category.internal",
    external: "category.external",
  } as const satisfies Record<ItemCategory, Parameters<typeof t>[0]>;

  const categoryOptions: Option[] = ITEM_CATEGORIES.map((id) => {
    const count = categoryData?.categories.find((c) => c.id === id)?.count ?? 0;
    return {
      id,
      label: `${t(CATEGORY_LABEL_KEYS[id])} (${count})`,
      selected: categoryFilter.includes(id),
    };
  });

  return (
    <Tabs.Root
      data-testid="admin-tabs"
      value={status}
      onValueChange={(v) => onStatusChange(v as ItemStatus)}
      className="flex h-full flex-col"
    >
      <StudioHeader>
        {/* Compact header: status tabs + Settings share one navigation row. */}
        <StudioHeader.TierNavigation className="justify-between py-12!">
          <Tabs.List aria-label={t("status-tabs-aria")}>
            <Tabs.Trigger value="active">{t("tabs.active")}</Tabs.Trigger>
            <Tabs.Trigger value="archived">{t("tabs.archived")}</Tabs.Trigger>
          </Tabs.List>
          <GhostButton variant="secondary" icon={<SettingsIcon />} onClick={onOpenSettings}>
            {t("settings-btn")}
          </GhostButton>
        </StudioHeader.TierNavigation>

        <StudioHeader.TierTwo className="flex-wrap gap-y-3">
          <StudioHeader.Area className="items-center flex-wrap gap-y-3">
            <SearchInput
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onClear={onSearchClear}
              placeholder={t("search-items")}
              cancelButtonTitle={t("search-cancel")}
            />
            <div className="[&_button]:h-10 [&_button]:px-5">
              <Filter
                triggerLabel={t("category-filter-trigger")}
                triggerIcon={<FilterIcon />}
                badgeA11yDescription={t("category-filter-badge-a11y")}
                searchInputPlaceholder={t("category-filter-search-placeholder")}
                emptyResultText={t("category-filter-empty")}
                clearButtonText={t("category-filter-clear")}
                applyButtonText={t("category-filter-apply")}
                placement="bottom-start"
                options={categoryOptions}
                onApply={(options) => {
                  const selected = options
                    .filter((o) => o.selected)
                    .map((o) => String(o.id) as ItemCategory);
                  onCategoryFilterChange(selected);
                }}
              />
            </div>
            {categoryFilter.length > 0 && (
              <GhostButton icon={<CloseIcon />} onClick={() => onCategoryFilterChange([])}>
                {t("category-filter-reset")}
              </GhostButton>
            )}
          </StudioHeader.Area>

          {/* Primary "Add" action lives on the per-tab filter/count row, not the header. */}
          <StudioHeader.Area className="items-center flex-wrap gap-y-3">
            <span className="text-body-sm text-neutral-medium">
              {t("item-count", { count: itemCount })}
            </span>
            <Select.Root
              items={translatedSortOptions}
              value={sort}
              onValueChange={(v) => onSortChange(v as ItemSortOrder)}
            >
              <Select.Trigger className="min-w-50" leadingIcon={<SortIcon />}>
                <Select.Value className="whitespace-nowrap" />
              </Select.Trigger>
              <Select.Popup>
                <Select.List>
                  {translatedSortOptions.map((opt) => (
                    <Select.Item key={opt.value} value={opt.value} className="whitespace-nowrap">
                      {opt.label}
                    </Select.Item>
                  ))}
                </Select.List>
              </Select.Popup>
            </Select.Root>
            <Button onClick={onCreateItem}>{t("add-item-btn")}</Button>
          </StudioHeader.Area>
        </StudioHeader.TierTwo>
      </StudioHeader>

      {showSetupWarning && (
        <Banner
          variant="warning"
          layout="bleed"
          className="flex items-center justify-between gap-8"
        >
          <span className="flex items-center gap-8">{t("settings.setup-warning")}</span>
          <GhostButton variant="secondary" onClick={onOpenSettings}>
            {t("settings-btn")}
          </GhostButton>
        </Banner>
      )}

      {/* Both panels render the same status-scoped children; Radix mounts only
          the active one, but mounting both keeps each trigger's aria-controls
          target real. */}
      <main className="flex flex-1 flex-col gap-24 overflow-auto bg-neutral-base px-40 py-24">
        <Tabs.Content value="active" className="flex flex-1 flex-col">
          {children}
        </Tabs.Content>
        <Tabs.Content value="archived" className="flex flex-1 flex-col">
          {children}
        </Tabs.Content>
      </main>
    </Tabs.Root>
  );
}
