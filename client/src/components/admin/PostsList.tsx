import {
  Button,
  EmptyState,
  ExternalLinkIcon,
  GhostButton,
  Pill,
  Skeleton,
  TextField,
} from "@staffbase/design";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/index.ts";
import { useAdminI18n } from "../../hooks/useAdminI18n.ts";
import type {
  EnableAcknowledgingResponse,
  NewsPost,
  NewsPostsResponse,
} from "../../types/api.ts";
import { formatDateTime } from "../../utils/formatDate.ts";
import Table from "../studio/Table.tsx";
import { toast } from "../studio/ToastProvider.tsx";
import { AcknowledgementDrawer } from "./AcknowledgementDrawer.tsx";

const SKELETON_ROW_KEYS = ["r1", "r2", "r3", "r4", "r5"];

function getPostTitle(post: NewsPost): string {
  if (!post.contents) return post.id;
  const locales = Object.values(post.contents);
  return locales.find((l) => l.title)?.title ?? post.id;
}

export function PostsList() {
  const { t } = useAdminI18n({ keyPrefix: "news" });
  const queryClient = useQueryClient();

  const [channelIdInput, setChannelIdInput] = useState("");
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [selectedPost, setSelectedPost] = useState<NewsPost | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // ── Posts query ────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery<NewsPostsResponse>({
    queryKey: ["news-posts", activeChannelId],
    queryFn: () =>
      api
        .get<NewsPostsResponse>(`/api/news/posts?channelId=${encodeURIComponent(activeChannelId!)}`)
        .then((r) => r.data),
    enabled: Boolean(activeChannelId),
  });

  // ── Enable acknowledging mutation ──────────────────────────────────────
  const enableMutation = useMutation({
    mutationFn: (postId: string) =>
      api.post<EnableAcknowledgingResponse>(`/api/news/posts/${postId}/enable-acknowledging`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["news-posts", activeChannelId] });
      queryClient.invalidateQueries({ queryKey: ["changelog"] });
      toast.success(t("enable-success"));
    },
    onError: () => {
      toast.error(t("enable-error"));
    },
  });

  // ── View status ────────────────────────────────────────────────────────
  function handleViewStatus(post: NewsPost) {
    setSelectedPost(post);
    setIsDrawerOpen(true);
  }

  function handleDrawerClose() {
    setIsDrawerOpen(false);
    setSelectedPost(null);
  }

  function handleLoad() {
    const trimmed = channelIdInput.trim();
    if (!trimmed) return;
    setActiveChannelId(trimmed);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const posts = data?.data ?? [];
  const showEmpty = !isLoading && !isError && activeChannelId && posts.length === 0;
  const showError = isError && activeChannelId;

  return (
    <>
      {/* Channel ID input */}
      <div className="flex items-end gap-8 px-24 py-16 border-b border-neutral-weak">
        <div className="flex-1 max-w-md">
          <label
            htmlFor="channel-id-input"
            className="mb-4 block text-body-sm font-semibold text-neutral-strong"
          >
            {t("channel-id-label")}
          </label>
          <TextField
            id="channel-id-input"
            value={channelIdInput}
            onChange={(e) => setChannelIdInput(e.target.value)}
            placeholder={t("channel-id-placeholder")}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLoad();
            }}
          />
        </div>
        <Button
          variant="primary"
          disabled={!channelIdInput.trim() || isLoading}
          onClick={handleLoad}
        >
          {t("load-posts-btn")}
        </Button>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <Table.Head>
            <Table.HeadRow>
              <Table.HeadCell>{t("col-title")}</Table.HeadCell>
              <Table.HeadCell>{t("col-published")}</Table.HeadCell>
              <Table.HeadCell>{t("col-acknowledged")}</Table.HeadCell>
              <Table.HeadCell>{t("col-acknowledging")}</Table.HeadCell>
              <Table.HeadCell>{t("col-actions")}</Table.HeadCell>
            </Table.HeadRow>
          </Table.Head>
          <Table.Body>
            {isLoading &&
              SKELETON_ROW_KEYS.map((key) => (
                <Table.Row key={key}>
                  <Table.Cell><Skeleton.Text lines={1} /></Table.Cell>
                  <Table.Cell><Skeleton.Text lines={1} /></Table.Cell>
                  <Table.Cell><Skeleton.Text lines={1} /></Table.Cell>
                  <Table.Cell><Skeleton.Text lines={1} /></Table.Cell>
                  <Table.Cell><Skeleton.Text lines={1} /></Table.Cell>
                </Table.Row>
              ))}

            {!isLoading &&
              posts.map((post) => {
                const title = getPostTitle(post);
                const publishedDate = post.published ?? post.planned;
                const ackCount = post.acknowledgements?.total ?? 0;
                const ackEnabled = post.acknowledgingEnabled ?? false;

                return (
                  <Table.Row key={post.id}>
                    <Table.Cell>
                      <div className="flex items-center gap-8">
                        <span className="font-medium text-neutral-strong truncate max-w-xs">
                          {title}
                        </span>
                        {post.links?.detail_view?.href && (
                          <a
                            href={post.links.detail_view.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t("open-post-link")}
                          >
                            <ExternalLinkIcon className="h-14 w-14 text-neutral-medium" />
                          </a>
                        )}
                      </div>
                    </Table.Cell>

                    <Table.Cell>
                      <span className="text-body-sm text-neutral-medium">
                        {publishedDate ? formatDateTime(publishedDate) : "—"}
                      </span>
                    </Table.Cell>

                    <Table.Cell>
                      <span className="text-body-sm font-semibold">{ackCount}</span>
                    </Table.Cell>

                    <Table.Cell>
                      {ackEnabled ? (
                        <Pill variant="green">{t("acknowledging-enabled")}</Pill>
                      ) : (
                        <Pill variant="grey">{t("acknowledging-disabled")}</Pill>
                      )}
                    </Table.Cell>

                    <Table.Cell>
                      <div className="flex items-center gap-8">
                        {!ackEnabled && (
                          <GhostButton
                            disabled={enableMutation.isPending}
                            onClick={() => enableMutation.mutate(post.id)}
                          >
                            {enableMutation.isPending ? t("enabling") : t("enable-acknowledging-btn")}
                          </GhostButton>
                        )}
                        {ackEnabled && (
                          <Button
                            variant="secondary"
                            onClick={() => handleViewStatus(post)}
                          >
                            {t("view-status-btn")}
                          </Button>
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
          </Table.Body>
        </Table>

        {/* Empty / error states */}
        {!activeChannelId && (
          <div className="flex items-center justify-center p-48">
            <EmptyState title={t("empty-posts-title")} body={t("empty-posts-body")} />
          </div>
        )}

        {showEmpty && (
          <div className="flex items-center justify-center p-48">
            <EmptyState title={t("empty-posts-title")} body={t("empty-posts-search-body")} />
          </div>
        )}

        {showError && (
          <div className="flex items-center justify-center p-48">
            <EmptyState title={t("empty-posts-title")} body={t("posts-load-error")} />
          </div>
        )}
      </div>

      {/* Acknowledgement drawer */}
      {selectedPost && (
        <AcknowledgementDrawer
          post={selectedPost}
          postTitle={getPostTitle(selectedPost)}
          isOpen={isDrawerOpen}
          onClose={handleDrawerClose}
        />
      )}
    </>
  );
}
