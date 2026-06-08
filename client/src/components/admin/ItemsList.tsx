import {
  AlertDialog,
  AlertIcon,
  BinIcon,
  EditIcon,
  EllipsisIcon,
  EmptyState,
  GhostButton,
  IconGhostButton,
  Menu,
  Pill,
  Skeleton,
} from "@staffbase/design";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api/index.ts";
import { useAdminI18n } from "../../hooks/useAdminI18n.ts";
import type {
  Item,
  ItemCategory,
  ItemSortOrder,
  ItemStatus,
  PaginatedItems,
} from "../../types/api.ts";
import { formatDateTime } from "../../utils/formatDate.ts";
import { Pagination } from "../studio/Pagination.tsx";
import Table from "../studio/Table.tsx";
import { toast } from "../studio/ToastProvider.tsx";
import { RelativeTimestamp } from "./RelativeTimestamp.tsx";

interface ItemsListProps {
  status: ItemStatus;
  search: string;
  sort: ItemSortOrder;
  categoryFilter: ItemCategory[];
  onCountChange: (count: number) => void;
  onEdit: (item: Item) => void;
  onAdd: () => void;
}

const PAGE_LIMIT_OPTIONS = [25, 50, 100] as const;
type PageLimit = (typeof PAGE_LIMIT_OPTIONS)[number];
const SKELETON_ROW_KEYS = ["r1", "r2", "r3", "r4", "r5", "r6"];

const CATEGORY_PILL_VARIANT: Record<ItemCategory, "red" | "yellow" | "blue" | "green" | "grey"> = {
  general: "grey",
  important: "red",
  internal: "blue",
  external: "green",
};

export function ItemsList({
  status,
  search,
  sort,
  categoryFilter,
  onCountChange,
  onEdit,
  onAdd,
}: Readonly<ItemsListProps>) {
  const { t } = useAdminI18n();
  const queryClient = useQueryClient();

  const [deletingItem, setDeletingItem] = useState<Item | null>(null);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<PageLimit>(25);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [status, search, sort, categoryFilter, limit]);

  const { data, isLoading } = useQuery<PaginatedItems>({
    queryKey: ["items", status, search, sort, categoryFilter, page, limit],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        sort,
        status,
      });
      if (search) params.set("search", search);
      if (categoryFilter.length > 0) params.set("category", categoryFilter.join(","));
      return api.get<PaginatedItems>(`/api/items?${params}`).then((r) => r.data);
    },
  });

  useEffect(() => {
    onCountChange(data?.total ?? 0);
  }, [data?.total, onCountChange]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/items/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["items-categories"] });
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
      toast.success(t("items-list.item-deleted"));
      setDeletingItem(null);
    },
    onError: () => {
      toast.error(t("items-list.item-delete-error"));
      setDeletingItem(null);
    },
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (!isLoading && data !== undefined && total === 0 && !search && categoryFilter.length === 0) {
    return (
      <>
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-16">
            <EmptyState
              title={t(`items-list.empty-${status}-title` as const)}
              body={t(`items-list.empty-${status}-body` as const)}
            />
            {status === "active" && (
              <GhostButton variant="primary" onClick={onAdd}>
                {t("add-item-btn")}
              </GhostButton>
            )}
          </div>
        </div>
        <DeleteDialog
          item={deletingItem}
          onCancel={() => setDeletingItem(null)}
          onConfirm={(id) => deleteMutation.mutate(id)}
        />
      </>
    );
  }

  return (
    <>
      <Table.Wrap>
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>{t("items-list.col-name")}</Table.HeaderCell>
              <Table.HeaderCell className="w-40 whitespace-nowrap">
                {t("items-list.col-category")}
              </Table.HeaderCell>
              <Table.HeaderCell className="w-40 whitespace-nowrap">
                {t("items-list.col-created-at")}
              </Table.HeaderCell>
              <Table.HeaderCell className="w-[56px] min-w-0">
                {t("items-list.col-actions")}
              </Table.HeaderCell>
            </Table.Row>
          </Table.Header>

          {isLoading && (
            <Table.Body>
              {SKELETON_ROW_KEYS.map((k) => (
                <Table.Row key={k}>
                  <Table.Cell>
                    <Skeleton.Text lines={1} />
                  </Table.Cell>
                  <Table.Cell className="w-40">
                    <Skeleton.Text lines={1} />
                  </Table.Cell>
                  <Table.Cell className="w-40">
                    <Skeleton.Text lines={1} />
                  </Table.Cell>
                  <Table.Cell className="min-w-0 w-[56px]" />
                </Table.Row>
              ))}
            </Table.Body>
          )}

          {!isLoading && rows.length === 0 && (
            <Table.Empty>
              <EmptyState
                title={t("items-list.empty-search-title")}
                body={t("items-list.empty-search-body")}
              />
            </Table.Empty>
          )}

          {!isLoading && rows.length > 0 && (
            <Table.Body>
              {rows.map((item) => (
                <Table.Row key={item.id}>
                  <Table.Cell className="text-14 font-semibold leading-20 text-neutral-strong">
                    <div className="flex flex-col gap-4">
                      <button
                        type="button"
                        onClick={() => onEdit(item)}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          margin: 0,
                          font: "inherit",
                        }}
                        className="w-fit cursor-pointer text-left text-neutral-strong hover:text-sbBlue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                      >
                        {item.name}
                      </button>
                      {item.description && (
                        <span className="line-clamp-1 text-body-sm font-normal text-neutral-medium">
                          {item.description}
                        </span>
                      )}
                      <span className="flex gap-1 text-body-xs text-neutral-medium font-normal italic">
                        {t("items-list.updated")}
                        <RelativeTimestamp isoString={item.updatedAt} />
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap">
                    <Pill variant={CATEGORY_PILL_VARIANT[item.category]}>
                      {t(`category.${item.category}` as const)}
                    </Pill>
                  </Table.Cell>
                  <Table.Cell className="whitespace-nowrap text-body-xs text-neutral-medium">
                    {formatDateTime(item.createdAt)}
                  </Table.Cell>
                  <Table.Cell className="min-w-0 w-[56px]">
                    <Menu.Root>
                      <Menu.Trigger>
                        <IconGhostButton
                          icon={<EllipsisIcon />}
                          aria-label={t("items-list.item-actions")}
                        />
                      </Menu.Trigger>
                      <Menu.Popup>
                        <Menu.Item onClick={() => onEdit(item)} leadingIcon={<EditIcon />}>
                          {t("items-list.edit")}
                        </Menu.Item>
                        <Menu.Item
                          onClick={() => setDeletingItem(item)}
                          leadingIcon={<BinIcon />}
                          variant="critical"
                        >
                          {t("items-list.delete")}
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Root>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          )}
        </Table>
        {!isLoading && rows.length > 0 && (
          <Pagination>
            <Pagination.Limit
              options={PAGE_LIMIT_OPTIONS}
              value={limit}
              onChange={(next) => setLimit(next as PageLimit)}
            />
            <Pagination.Controls page={page} totalPages={totalPages} onPageChange={setPage} />
          </Pagination>
        )}
      </Table.Wrap>

      <DeleteDialog
        item={deletingItem}
        onCancel={() => setDeletingItem(null)}
        onConfirm={(id) => deleteMutation.mutate(id)}
      />
    </>
  );
}

interface DeleteDialogProps {
  item: Item | null;
  onCancel: () => void;
  onConfirm: (id: string) => void;
}

function DeleteDialog({ item, onCancel, onConfirm }: Readonly<DeleteDialogProps>) {
  const { t } = useAdminI18n();
  return (
    <AlertDialog.Root open={item !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Popup>
        <AlertDialog.Icon>
          <AlertIcon />
        </AlertDialog.Icon>
        <AlertDialog.Title>{t("items-list.delete-dialog-title")}</AlertDialog.Title>
        <AlertDialog.Description>
          {t("items-list.delete-dialog-body", { name: item?.name ?? "" })}
        </AlertDialog.Description>
        <AlertDialog.Action variant="critical" onClick={() => item && onConfirm(item.id)}>
          {t("items-list.delete-dialog-confirm")}
        </AlertDialog.Action>
        <AlertDialog.Cancel>{t("items-list.delete-dialog-cancel")}</AlertDialog.Cancel>
      </AlertDialog.Popup>
    </AlertDialog.Root>
  );
}
