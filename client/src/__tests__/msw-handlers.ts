import { HttpResponse, http } from "msw";
import type {
  ChangelogEntry,
  Item,
  ItemCategoriesResponse,
  PaginatedChangelog,
  PaginatedItems,
} from "../types/api.ts";

const mockChangelogEntry: ChangelogEntry = {
  id: "changelog-1",
  instanceId: "test-instance",
  userId: "user-1",
  userName: "Alice Smith",
  action: "settings_updated",
  entityType: "settings",
  entityId: null,
  entityName: null,
  summary: "Updated settings (staffbaseUrl)",
  payload: { changedFields: ["staffbaseUrl"] },
  gdprRelevant: false,
  createdAt: "2026-01-01T00:00:00Z",
};

const mockItem: Item = {
  id: "item-1",
  instanceId: "test-instance",
  name: "Welcome onboarding checklist",
  description: "Steps every new hire completes during their first week.",
  category: "important",
  status: "active",
  createdByUserId: "user-1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
};

export { mockChangelogEntry, mockItem };

export const handlers = [
  // Settings
  http.get("/api/settings", () =>
    HttpResponse.json({
      staffbaseUrl: "https://co.staffbase.com",
      hasApiToken: true,
    })
  ),

  // Changelog
  http.get("/api/changelog", () =>
    HttpResponse.json({
      data: [mockChangelogEntry],
      total: 1,
      page: 1,
      limit: 50,
    } satisfies PaginatedChangelog)
  ),

  // Items
  http.get("/api/items", () =>
    HttpResponse.json({
      data: [mockItem],
      total: 1,
      page: 1,
      limit: 25,
    } satisfies PaginatedItems)
  ),

  http.get("/api/items/categories", () =>
    HttpResponse.json({
      categories: [
        { id: "general", count: 1 },
        { id: "important", count: 1 },
        { id: "internal", count: 0 },
        { id: "external", count: 0 },
      ],
    } satisfies ItemCategoriesResponse)
  ),
];
