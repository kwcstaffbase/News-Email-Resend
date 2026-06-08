import {
  Button,
  Dialog,
  EmptyState,
  Skeleton,
  Tabs,
} from "@staffbase/design";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/index.ts";
import { useAdminI18n } from "../../hooks/useAdminI18n.ts";
import type {
  AcknowledgementStatus,
  AcknowledgementUser,
  NewsPost,
  SendReminderResponse,
} from "../../types/api.ts";
import { toast } from "../studio/ToastProvider.tsx";

interface AcknowledgementDrawerProps {
  post: NewsPost;
  postTitle: string;
  isOpen: boolean;
  onClose: () => void;
}

function UserRow({ user }: Readonly<{ user: AcknowledgementUser }>) {
  const { t } = useAdminI18n({ keyPrefix: "news" });
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || t("unknown-user");

  return (
    <div className="flex items-center gap-8 py-10 px-4 border-b border-neutral-weak last:border-0">
      <div className="min-w-0 flex-1">
        <p className="text-body-sm font-medium text-neutral-strong truncate">{displayName}</p>
        {user.email ? (
          <p className="text-body-xs text-neutral-medium truncate">{user.email}</p>
        ) : (
          <p className="text-body-xs text-neutral-weak italic">{t("no-email")}</p>
        )}
      </div>
    </div>
  );
}

export function AcknowledgementDrawer({
  post,
  postTitle,
  isOpen,
  onClose,
}: Readonly<AcknowledgementDrawerProps>) {
  const { t } = useAdminI18n({ keyPrefix: "news" });
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("not-acknowledged");

  // ── Fetch acknowledgement status ─────────────────────────────────────
  const {
    data: status,
    isLoading,
    isError,
  } = useQuery<AcknowledgementStatus>({
    queryKey: ["ack-status", post.id],
    queryFn: () =>
      api
        .get<AcknowledgementStatus>(`/api/news/posts/${post.id}/acknowledgement-status`)
        .then((r) => r.data),
    enabled: isOpen,
    staleTime: 60_000,
  });

  // ── Send reminder mutation ────────────────────────────────────────────
  const reminderMutation = useMutation({
    mutationFn: (userIds: string[]) =>
      api
        .post<SendReminderResponse>(`/api/news/posts/${post.id}/send-reminder`, {
          userIds,
          subject: `Reminder: Please read "${postTitle}"`,
          postUrl: status?.postUrl ?? post.links?.detail_view?.href,
          postTitle,
        })
        .then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
      if (data.skipped > 0) {
        toast.success(t("reminder-sent-skipped", { sent: data.sent, skipped: data.skipped }));
      } else {
        toast.success(t("reminder-sent", { count: data.sent }));
      }
    },
    onError: () => {
      toast.error(t("reminder-error"));
    },
  });

  function handleSendToAll() {
    const ids = (status?.notAcknowledgedUsers ?? []).map((u) => u.userId);
    if (ids.length > 0) reminderMutation.mutate(ids);
  }

  function handleOpenChange(open: boolean) {
    if (!open) onClose();
  }

  const notAckedUsers = status?.notAcknowledgedUsers ?? [];
  const ackedUsers = status?.acknowledgedUsers ?? [];
  const totalRecipients = status?.totalRecipients ?? 0;
  const ackedCount = ackedUsers.length;
  const showFooterSend = !isLoading && !isError && status && notAckedUsers.length > 0;

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
      <Dialog.Popup className="w-[min(92vw,560px)]! flex flex-col max-h-[80vh]!">
        <Dialog.Header>
          <Dialog.Title>{t("status-title")}</Dialog.Title>
          <p className="mt-2 text-body-sm text-neutral-medium truncate">{postTitle}</p>
        </Dialog.Header>

        <Dialog.Body className="p-0! flex flex-col min-h-0 flex-1">
          {/* Summary bar */}
          {!isLoading && !isError && status && (
            <div className="px-24 py-12 border-b border-neutral-weak bg-neutral-soft shrink-0">
              <p className="text-body-sm text-neutral-medium">
                {t("status-subtitle", {
                  acknowledged: ackedCount,
                  total: totalRecipients,
                })}
              </p>
              <div className="mt-8 h-6 w-full rounded-full bg-neutral-weak overflow-hidden">
                <div
                  className="h-full rounded-full bg-success-strong transition-all"
                  style={{
                    width:
                      totalRecipients > 0
                        ? `${Math.round((ackedCount / totalRecipients) * 100)}%`
                        : "0%",
                  }}
                />
              </div>
            </div>
          )}

          {/* Loading skeleton */}
          {isLoading && (
            <div className="flex flex-col gap-12 px-24 py-20">
              <p className="text-body-sm text-neutral-medium">{t("loading-status")}</p>
              {[1, 2, 3, 4].map((i) => (
                <Skeleton.Text key={i} lines={2} />
              ))}
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="flex items-center justify-center p-48">
              <EmptyState title={t("status-title")} body={t("status-error")} />
            </div>
          )}

          {/* Tabs + user lists */}
          {!isLoading && !isError && status && (
            <Tabs.Root
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex flex-col flex-1 min-h-0"
            >
              <Tabs.List className="shrink-0 px-8">
                <Tabs.Trigger value="not-acknowledged">
                  {t("not-acknowledged-tab", { count: notAckedUsers.length })}
                </Tabs.Trigger>
                <Tabs.Trigger value="acknowledged">
                  {t("acknowledged-tab", { count: ackedUsers.length })}
                </Tabs.Trigger>
              </Tabs.List>

              <Tabs.Content value="not-acknowledged" className="overflow-y-auto flex-1 pt-0">
                {notAckedUsers.length === 0 ? (
                  <div className="flex items-center justify-center p-40">
                    <EmptyState
                      title={t("empty-not-acknowledged-title")}
                      body={t("empty-not-acknowledged-body")}
                    />
                  </div>
                ) : (
                  <div className="px-8">
                    {notAckedUsers.map((user) => (
                      <UserRow key={user.userId} user={user} />
                    ))}
                  </div>
                )}
              </Tabs.Content>

              <Tabs.Content value="acknowledged" className="overflow-y-auto flex-1 pt-0">
                {ackedUsers.length === 0 ? (
                  <div className="flex items-center justify-center p-40">
                    <EmptyState
                      title={t("empty-acknowledged-title")}
                      body={t("empty-acknowledged-body")}
                    />
                  </div>
                ) : (
                  <div className="px-8">
                    {ackedUsers.map((user) => (
                      <UserRow key={user.userId} user={user} />
                    ))}
                  </div>
                )}
              </Tabs.Content>
            </Tabs.Root>
          )}
        </Dialog.Body>

        <Dialog.Footer>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {showFooterSend && (
            <Button
              variant="primary"
              disabled={reminderMutation.isPending}
              onClick={handleSendToAll}
            >
              {reminderMutation.isPending
                ? t("sending")
                : t("send-reminder-all-btn", { count: notAckedUsers.length })}
            </Button>
          )}
        </Dialog.Footer>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
