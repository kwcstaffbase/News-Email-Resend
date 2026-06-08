import type { Option } from "@staffbase/design";
import {
  Button,
  Dialog,
  EmptyState,
  Filter,
  FilterIcon,
  InfoIcon,
  LockIcon,
  Pill,
  Popover,
  SearchInput,
  TooltipNew,
} from "@staffbase/design";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { api } from "../../api/index.ts";
import { useAdminI18n } from "../../hooks/useAdminI18n.ts";
import { getToken } from "../../token.ts";
import type { ChangelogAction, ChangelogEntityType, PaginatedChangelog } from "../../types/api.ts";
import { formatDateTime } from "../../utils/formatDate.ts";

import { Pagination } from "../studio/Pagination.tsx";
import Table from "../studio/Table.tsx";
import { toast } from "../studio/ToastProvider.tsx";

interface ChangelogDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const ENTITY_TYPE_OPTIONS: Array<{
  id: ChangelogEntityType;
  labelKey: string;
}> = [
  { id: "settings", labelKey: "filter-settings" },
  { id: "item", labelKey: "filter-items" },
  { id: "user", labelKey: "filter-users" },
  { id: "system", labelKey: "filter-system" },
];

// Pill only supports: 'red' | 'yellow' | 'blue' | 'green' | 'grey'
const ACTION_PILL_VARIANT: Record<ChangelogAction, "red" | "yellow" | "blue" | "green" | "grey"> = {
  settings_updated: "blue",
  clear_all: "red",
  user_deleted: "red",
  user_sync: "yellow",
  item_created: "green",
  item_updated: "blue",
  item_deleted: "red",
};

const LIMITS = [25, 50, 100] as const;

function formatPayloadValue(val: unknown): string {
  if (val === null || val === undefined) return "—";
  return String(val as string | number | boolean);
}

export function ChangelogDialog({ isOpen, onClose }: Readonly<ChangelogDialogProps>) {
  const { t } = useAdminI18n({ keyPrefix: "changelog" });

  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(50);
  const [entityTypes, setEntityTypes] = useState<ChangelogEntityType[]>([]);
  const [search, setSearch] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const { data, isLoading, isFetching, isError } = useQuery<PaginatedChangelog>({
    queryKey: ["changelog", page, limit, entityTypes, search],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (entityTypes.length > 0) params.set("entityType", entityTypes.join(","));
      if (search) params.set("search", search);
      return api.get<PaginatedChangelog>(`/api/changelog?${params}`).then((r) => r.data);
    },
    enabled: isOpen,
    placeholderData: keepPreviousData,
  });

  function handleOpenChange(open: boolean) {
    if (!open) {
      setPage(1);
      setEntityTypes([]);
      setSearch("");
      onClose();
    }
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  const entityTypeFilterOptions: Option[] = ENTITY_TYPE_OPTIONS.map((opt) => ({
    id: opt.id,
    label: t(opt.labelKey as any),
    selected: entityTypes.includes(opt.id),
  }));

  async function handleExportAuditLog() {
    setIsExporting(true);
    try {
      const headers: Record<string, string> = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const instanceId = globalThis.__USER__?.instanceId;
      if (instanceId) headers["X-Instance-Id"] = instanceId;

      const response = await fetch("/api/changelog/export", {
        headers,
        credentials: "include",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `audit-log-${date}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success(t("export-success"));
    } catch {
      toast.error(t("export-error"));
    } finally {
      setIsExporting(false);
    }
  }

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const totalPages = Math.ceil(total / limit);

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      {/*
       * Wide + height-capped: 90vw up to 1100px; height capped at the smaller of 80vh or 720px
       * so the dialog stays usable inside a constrained iframe without overflowing.
       */}
      <Dialog.Popup className="w-[min(90vw,1100px)]! max-w-none! flex flex-col max-h-[min(80vh,720px)]!">
        <Dialog.Header>
          <Dialog.Title>{t("title")}</Dialog.Title>
        </Dialog.Header>

        <Dialog.Body className="flex flex-col gap-16 p-0! min-h-0 overflow-hidden">
          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-8 px-24 pt-16 shrink-0">
            <div className="[&_button]:h-10 [&_button]:px-5">
              <Filter
                triggerLabel={t("filter-trigger")}
                triggerIcon={<FilterIcon />}
                badgeA11yDescription={t("filter-badge-a11y")}
                searchInputPlaceholder={t("filter-search-placeholder")}
                emptyResultText={t("filter-empty")}
                clearButtonText={t("filter-clear")}
                applyButtonText={t("filter-apply")}
                placement="bottom-start"
                options={entityTypeFilterOptions}
                onApply={(opts) => {
                  const selected = opts
                    .filter((o) => o.selected)
                    .map((o) => o.id as ChangelogEntityType);
                  setEntityTypes(selected);
                  setPage(1);
                }}
              />
            </div>
            <div className="grow">
              <SearchInput
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                onClear={() => handleSearchChange("")}
                placeholder={t("search-placeholder")}
              />
            </div>
            <Button
              variant="secondary"
              disabled={isExporting}
              onClick={() => void handleExportAuditLog()}
            >
              {isExporting ? t("export-loading") : t("export-btn")}
            </Button>
          </div>

          {/* Table */}
          <Table.Wrap
            className={`flex-1 overflow-auto min-h-0${isFetching && !isLoading ? " opacity-60 transition-opacity" : ""}`}
          >
            <Table>
              <Table.Header>
                <Table.Row>
                  <Table.HeaderCell className="w-44 px-12 py-8">
                    {t("col-timestamp")}
                  </Table.HeaderCell>
                  <Table.HeaderCell className="w-48 px-12 py-8">{t("col-user")}</Table.HeaderCell>
                  <Table.HeaderCell className="w-36 px-12 py-8">{t("col-action")}</Table.HeaderCell>
                  <Table.HeaderCell className="w-40 px-12 py-8">{t("col-entity")}</Table.HeaderCell>
                  <Table.HeaderCell className="px-12 py-8">{t("col-summary")}</Table.HeaderCell>
                  <Table.HeaderCell className="w-12 px-12 py-8 text-center">
                    {t("col-changes")}
                  </Table.HeaderCell>
                  <Table.HeaderCell className="w-12 px-12 py-8 text-start!">
                    {t("col-gdpr")}
                  </Table.HeaderCell>
                </Table.Row>
              </Table.Header>

              {isError && (
                <Table.ErrorRow>
                  <Table.Cell colSpan={7}>Failed to load activity log.</Table.Cell>
                </Table.ErrorRow>
              )}

              {!isLoading && rows.length === 0 && (
                <Table.Empty>
                  <EmptyState title={t("empty")} />
                </Table.Empty>
              )}

              {isLoading && (
                <Table.Body>
                  {["sk1", "sk2", "sk3", "sk4", "sk5", "sk6", "sk7", "sk8"].map((k) => (
                    <Table.Row key={k}>
                      {["a", "b", "c", "d", "e", "f", "g"].map((c) => (
                        <Table.Cell key={c} className="px-12 py-8">
                          <div className="h-16 animate-pulse rounded-4 bg-neutral-medium opacity-20" />
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  ))}
                </Table.Body>
              )}

              {!isLoading && rows.length > 0 && (
                <Table.Body>
                  {rows.map((entry) => (
                    <Table.Row key={entry.id}>
                      {/* Timestamp */}
                      <Table.Cell className="w-44 px-12 py-6">
                        <span className="text-label-sm text-neutral-strong whitespace-nowrap">
                          {formatDateTime(entry.createdAt)}
                        </span>
                      </Table.Cell>

                      {/* User */}
                      <Table.Cell className="px-12 py-6">
                        <div className="flex flex-col min-w-0">
                          {entry.userName && (
                            <span className="text-body-sm text-neutral-strong truncate">
                              {entry.userName}
                            </span>
                          )}
                          {!entry.userName && entry.userId && (
                            <span className="font-mono text-body-xs text-neutral-medium select-all">
                              {entry.userId}
                            </span>
                          )}
                          {!entry.userName && !entry.userId && (
                            <span className="text-body-sm text-neutral-weak">
                              {t("unknown-user")}
                            </span>
                          )}
                        </div>
                      </Table.Cell>

                      {/* Action */}
                      <Table.Cell className="px-12 py-6">
                        <Pill variant={ACTION_PILL_VARIANT[entry.action] ?? "grey"}>
                          {t(`action-${entry.action.replaceAll("_", "-")}` as any)}
                        </Pill>
                      </Table.Cell>

                      {/* Entity */}
                      <Table.Cell className="px-12 py-6 max-w-40">
                        <div className="flex flex-col min-w-0">
                          <span className="text-label-xs text-neutral-weak">
                            {t(
                              (ENTITY_TYPE_OPTIONS.find((o) => o.id === entry.entityType)
                                ?.labelKey ?? "filter-system") as any
                            )}
                          </span>
                          {entry.entityName && (
                            <span className="text-body-sm font-medium text-neutral-strong truncate">
                              {entry.entityName}
                            </span>
                          )}
                        </div>
                      </Table.Cell>

                      {/* Summary */}
                      <Table.Cell className="px-12 py-6">
                        <span className="text-body-sm text-neutral-strong">{entry.summary}</span>
                      </Table.Cell>

                      {/* Changes popover */}
                      <Table.Cell className="px-12 py-6 text-center">
                        {entry.payload && Object.keys(entry.payload).length > 0 && (
                          <Popover.Root>
                            <Popover.Trigger
                              aria-label={t("col-changes")}
                              className="inline-flex cursor-pointer appearance-none border-0 bg-transparent p-0 align-middle"
                            >
                              <InfoIcon className="text-neutral-medium" width={14} height={14} />
                            </Popover.Trigger>
                            <Popover.Content
                              side="left"
                              align="center"
                              className="z-50 min-w-64 max-w-96 rounded-8 border border-neutral-soft bg-elevated p-16 shadow-lg"
                            >
                              <p className="mb-8 text-label-sm font-semibold text-neutral-strong">
                                {t("col-changes")}
                              </p>
                              <dl className="grid grid-cols-[auto_1fr] gap-x-12 gap-y-2 font-mono text-body-xs">
                                {Object.entries(entry.payload).map(([key, val]) => (
                                  <Fragment key={key}>
                                    <dt className="whitespace-nowrap font-semibold text-neutral-medium">
                                      {key}
                                    </dt>
                                    <dd className="break-all text-neutral-strong">
                                      {typeof val === "object" && val !== null
                                        ? JSON.stringify(val, null, 2)
                                        : formatPayloadValue(val)}
                                    </dd>
                                  </Fragment>
                                ))}
                              </dl>
                            </Popover.Content>
                          </Popover.Root>
                        )}
                      </Table.Cell>

                      {/* GDPR */}
                      <Table.Cell className="px-12 py-6 text-start!">
                        {entry.gdprRelevant && (
                          <TooltipNew.Root>
                            <TooltipNew.Trigger>
                              <LockIcon
                                className="text-icon-warning-strong"
                                aria-label={t("gdpr-badge")}
                              />
                            </TooltipNew.Trigger>
                            <TooltipNew.Content is="description">
                              {t("gdpr-tooltip")}
                            </TooltipNew.Content>
                          </TooltipNew.Root>
                        )}
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              )}
            </Table>
          </Table.Wrap>

          {/* Pagination */}
          {total > 0 && (
            <Pagination className="shrink-0 px-24 pb-8">
              <div className="flex items-center gap-12">
                <Pagination.Info from={from} to={to} total={total} />
                <Pagination.Limit
                  options={LIMITS}
                  value={limit}
                  onChange={(next) => {
                    setLimit(next);
                    setPage(1);
                  }}
                />
              </div>
              <Pagination.Controls page={page} totalPages={totalPages} onPageChange={setPage} />
            </Pagination>
          )}
        </Dialog.Body>

        <Dialog.Footer>
          <Button variant="secondary" onClick={onClose}>
            {t("details-close")}
          </Button>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
