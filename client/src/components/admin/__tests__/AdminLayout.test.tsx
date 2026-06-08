import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ItemCategory, ItemSortOrder, ItemStatus } from "../../../types/api.ts";
import { AdminLayout } from "../AdminLayout.tsx";

const server = setupServer(
  http.get("/api/settings", () => HttpResponse.json({ hasApiToken: true })),
  http.get("/api/items/categories", () => HttpResponse.json({ categories: [] }))
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderAdminLayout(overrides: Partial<Parameters<typeof AdminLayout>[0]> = {}) {
  const props = {
    children: <div>items table</div>,
    status: "active" as ItemStatus,
    onStatusChange: vi.fn(),
    onOpenSettings: vi.fn(),
    onCreateItem: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    onSearchClear: vi.fn(),
    itemCount: 5,
    sort: "name_asc" as ItemSortOrder,
    onSortChange: vi.fn(),
    categoryFilter: [] as ItemCategory[],
    onCategoryFilterChange: vi.fn(),
    ...overrides,
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AdminLayout {...props} />
    </QueryClientProvider>
  );
  return props;
}

describe("AdminLayout header", () => {
  it("renders the active/archived switcher as Tabs (tablist + 2 tabs)", () => {
    renderAdminLayout();
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(screen.getByRole("tab", { name: "tabs.active" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "tabs.archived" })).toBeInTheDocument();
  });

  it("calls onStatusChange when a different tab is selected", async () => {
    const onStatusChange = vi.fn();
    renderAdminLayout({ onStatusChange });
    await userEvent.click(screen.getByRole("tab", { name: "tabs.archived" }));
    expect(onStatusChange).toHaveBeenCalledWith("archived");
  });

  it("renders the Add item button and calls onCreateItem", async () => {
    const onCreateItem = vi.fn();
    renderAdminLayout({ onCreateItem });
    await userEvent.click(screen.getByRole("button", { name: "add-item-btn" }));
    expect(onCreateItem).toHaveBeenCalledOnce();
  });
});
