export type ChangelogAction =
  | "settings_updated"
  | "clear_all"
  | "user_sync"
  | "user_deleted"
  | "item_created"
  | "item_updated"
  | "item_deleted"
  | "post_acknowledging_enabled"
  | "reminder_sent";

export type ChangelogEntityType = "settings" | "user" | "system" | "item" | "post";

export interface ChangelogEntry {
  id: string;
  instanceId: string;
  userId: string | null;
  userName: string | null;
  action: ChangelogAction;
  entityType: ChangelogEntityType;
  entityId: string | null;
  entityName: string | null;
  summary: string;
  payload: Record<string, unknown> | null;
  gdprRelevant: boolean;
  createdAt: string;
}

export interface PaginatedChangelog {
  data: ChangelogEntry[];
  total: number;
  page: number;
  limit: number;
}

export const ITEM_CATEGORIES = ["general", "important", "internal", "external"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const ITEM_STATUSES = ["active", "archived"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const ITEM_SORT_OPTIONS = [
  { value: "name_asc" as const, label: "Name (A → Z)" },
  { value: "name_desc" as const, label: "Name (Z → A)" },
  { value: "newest" as const, label: "Newest" },
  { value: "oldest" as const, label: "Oldest" },
  { value: "last_edited" as const, label: "Last edited" },
] as const;
export type ItemSortOrder = (typeof ITEM_SORT_OPTIONS)[number]["value"];

export interface Item {
  id: string;
  instanceId: string;
  name: string;
  description: string | null;
  category: ItemCategory;
  status: ItemStatus;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedItems {
  data: Item[];
  total: number;
  page: number;
  limit: number;
}

export interface ItemCategoryCount {
  id: ItemCategory;
  count: number;
}

export interface ItemCategoriesResponse {
  categories: ItemCategoryCount[];
}

// ── News Acknowledgement types ─────────────────────────────────────────────

export interface NewsPost {
  id: string;
  contents?: Record<string, { title?: string; teaser?: string }>;
  channelID?: string;
  acknowledgingEnabled?: boolean;
  acknowledgements?: { total?: number };
  published?: string;
  planned?: string;
  links?: { detail_view?: { href?: string } };
}

export interface NewsPostsResponse {
  data: NewsPost[];
  total: number;
}

export interface AcknowledgementUser {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}

export interface AcknowledgementStatus {
  postId: string;
  acknowledgingEnabled: boolean;
  totalRecipients: number;
  acknowledgedUsers: AcknowledgementUser[];
  notAcknowledgedUsers: AcknowledgementUser[];
  postUrl: string | null;
  postTitle: string | null;
}

export interface SendReminderResponse {
  success: boolean;
  sent: number;
  skipped: number;
  message?: string;
}

export interface EnableAcknowledgingResponse {
  success: boolean;
}
