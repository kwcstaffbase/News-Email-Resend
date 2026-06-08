import {
  Button,
  Dialog,
  Field,
  SegmentedControl,
  Select,
  TextArea,
  TextField,
} from "@staffbase/design";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api/index.ts";
import { useAdminI18n } from "../../hooks/useAdminI18n.ts";
import { ITEM_CATEGORIES, type Item, type ItemCategory, type ItemStatus } from "../../types/api.ts";
import { toast } from "../studio/ToastProvider.tsx";

interface ItemFormProps {
  item: Item | null;
  isOpen: boolean;
  onClose: () => void;
}

interface FormState {
  name: string;
  description: string;
  category: ItemCategory;
  status: ItemStatus;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  category: "general",
  status: "active",
};

export function ItemForm({ item, isOpen, onClose }: Readonly<ItemFormProps>) {
  const { t } = useAdminI18n();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setForm(
      item
        ? {
            name: item.name,
            description: item.description ?? "",
            category: item.category,
            status: item.status,
          }
        : EMPTY_FORM
    );
    setNameError("");
  }, [item, isOpen]);

  const saveMutation = useMutation({
    mutationFn: (payload: FormState) => {
      const body = {
        name: payload.name.trim(),
        description: payload.description.trim() || null,
        category: payload.category,
        status: payload.status,
      };
      return item
        ? api.put<Item>(`/api/items/${item.id}`, body)
        : api.post<Item>("/api/items", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["items-categories"] });
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
      toast.success(item ? t("item-form.saved-update") : t("item-form.saved-create"));
      onClose();
    },
    onError: () => {
      toast.error(t("item-form.save-error"));
    },
  });

  function handleSave() {
    const trimmed = form.name.trim();
    if (!trimmed) {
      setNameError(t("item-form.name-required"));
      return;
    }
    saveMutation.mutate(form);
  }

  const CATEGORY_LABEL_KEYS = {
    general: "category.general",
    important: "category.important",
    internal: "category.internal",
    external: "category.external",
  } as const satisfies Record<ItemCategory, Parameters<typeof t>[0]>;

  const categoryItems = ITEM_CATEGORIES.map((c) => ({
    value: c,
    label: t(CATEGORY_LABEL_KEYS[c]),
  }));

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Popup className="w-[min(92vw,640px)]!">
        <Dialog.Header>
          <Dialog.Title>
            {item ? t("item-form.title-edit") : t("item-form.title-create")}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <div className="flex flex-col gap-20">
            <Field.Root invalid={!!nameError}>
              <Field.Label>{t("item-form.name-label")}</Field.Label>
              <TextField
                value={form.name}
                onChange={(e) => {
                  setForm((f) => ({ ...f, name: e.target.value }));
                  if (nameError) setNameError("");
                }}
                placeholder={t("item-form.name-placeholder")}
              />
              {nameError && <p className="mt-4 text-body-sm text-red-600">{nameError}</p>}
            </Field.Root>

            <TextArea
              label={t("item-form.description-label")}
              value={form.description}
              handleValueChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder={t("item-form.description-placeholder")}
              limit={2000}
            />

            <Field.Root>
              <Field.Label>{t("item-form.category-label")}</Field.Label>
              <Select.Root
                items={categoryItems}
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v as ItemCategory }))}
              >
                <Select.Trigger>
                  <Select.Value />
                </Select.Trigger>
                <Select.Popup>
                  <Select.List>
                    {categoryItems.map((opt) => (
                      <Select.Item key={opt.value} value={opt.value}>
                        {opt.label}
                      </Select.Item>
                    ))}
                  </Select.List>
                </Select.Popup>
              </Select.Root>
            </Field.Root>

            <Field.Root>
              <Field.Label>{t("item-form.status-label")}</Field.Label>
              <SegmentedControl.Root
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as ItemStatus }))}
                aria-label={t("item-form.status-label")}
              >
                <SegmentedControl.Item value="active">{t("tabs.active")}</SegmentedControl.Item>
                <SegmentedControl.Item value="archived">{t("tabs.archived")}</SegmentedControl.Item>
              </SegmentedControl.Root>
            </Field.Root>
          </div>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="secondary" disabled={saveMutation.isPending} onClick={onClose}>
            {t("item-form.cancel")}
          </Button>
          <Button variant="primary" disabled={saveMutation.isPending} onClick={handleSave}>
            {saveMutation.isPending ? t("item-form.saving") : t("item-form.save")}
          </Button>
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
