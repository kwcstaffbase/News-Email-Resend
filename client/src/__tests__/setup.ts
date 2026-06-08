import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Auto-cleanup after each test
afterEach(() => {
  cleanup();
});

// Stub window.__USER__ for AuthContext
globalThis.__USER__ = {
  userId: "test-user-1",
  userName: "Test User",
  instanceId: "test-instance",
  pluginId: "test-plugin",
  role: "editor",
  firstName: "Test",
  lastName: "User",
  locale: "en_US",
  type: "user",
  branchId: null,
  externalId: null,
  issuerDomain: null,
  branchSlug: null,
};

// Stub window.__TOKEN__
(globalThis as Record<string, unknown>).__TOKEN__ = "test-jwt-token";

// Mock @staffbase/plugins-client-sdk
vi.mock("@staffbase/plugins-client-sdk", () => ({
  getBranchLanguages: vi.fn().mockResolvedValue({
    en: { locale: "en_US" },
    de: { locale: "de_DE" },
  }),
  getBranchDefaultLanguage: vi.fn().mockResolvedValue({ locale: "en_US" }),
  getUserContentLocale: vi.fn().mockResolvedValue("en_US"),
  openLinkExternal: vi.fn(),
  // Default: desktop browser (not native, not mobile), SDK resolves immediately.
  isNativeApp: vi.fn().mockResolvedValue(false),
  isMobileApp: vi.fn().mockResolvedValue(false),
}));

// Mock i18n to avoid complex init in tests
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock token module
vi.mock("../token.ts", () => ({
  getToken: vi.fn().mockReturnValue("test-jwt-token"),
  setToken: vi.fn(),
}));
