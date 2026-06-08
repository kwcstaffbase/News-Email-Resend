import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";

declare global {
  var __USER__:
    | {
        userId: string;
        userName: string;
        instanceId: string;
        pluginId: string;
        role: "editor" | "user";
        firstName: string | null;
        lastName: string | null;
        locale: string | null;
        type: string | null;
        branchId: string | null;
        externalId: string | null;
        issuerDomain: string | null;
        branchSlug: string | null;
      }
    | undefined;
}

interface AuthUser {
  userId: string;
  userName: string;
  instanceId: string;
  pluginId: string;
  role: "editor" | "user";
  isEditor: boolean;
  /** Staffbase instance base URL derived from the JWT issuer_domain claim, e.g. "https://company.staffbase.com". Empty string when not available (local dev). */
  staffbaseUrl: string;
  /** JWT branch_slug claim — identifies the customer for per-customer branding and locale overrides. */
  branchSlug: string;
}

const AuthContext = createContext<AuthUser | null>(null);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  // window.__USER__ is injected by the Hono server before React mounts (production + localhost:3000).
  // When the Vite dev server serves the HTML (localhost:5173), __USER__ is absent — fall back to
  // VITE_DEV_* env vars baked in at build time from the same .env file (vite.config.ts define block).
  const user = useMemo<AuthUser>(() => {
    const u = globalThis.__USER__;
    if (!u) {
      // Vite dev server path — no server-side injection
      const role = import.meta.env.VITE_DEV_ROLE === "editor" ? "editor" : "user";
      return {
        userId: import.meta.env.VITE_DEV_USER_ID ?? "local-user-1",
        userName: import.meta.env.VITE_DEV_USER_NAME ?? "Local Dev",
        instanceId: import.meta.env.VITE_DEV_INSTANCE_ID ?? "dev-instance",
        pluginId: import.meta.env.VITE_PLUGIN_ID ?? "dev-plugin",
        role,
        isEditor: role === "editor",
        staffbaseUrl: "",
        branchSlug: import.meta.env.VITE_DEV_BRANCH_SLUG ?? "_default",
      };
    }
    const role = u.role === "editor" ? "editor" : "user";
    return {
      userId: u.userId ?? "",
      userName: u.userName ?? "",
      instanceId: u.instanceId ?? "",
      pluginId: u.pluginId ?? "",
      role,
      isEditor: role === "editor",
      staffbaseUrl: u.issuerDomain ? `https://${u.issuerDomain}` : "",
      branchSlug: u.branchSlug ?? "_default",
    };
  }, []);

  // Load per-customer theme CSS when it was not already injected server-side.
  // This happens when the Vite dev server (port 5173) serves the HTML directly
  // instead of routing through the Hono server, which normally inlines the CSS.
  useEffect(() => {
    if (document.getElementById("customer-theme")) return; // already server-injected
    const slug = user.branchSlug;
    fetch(`/customers/${slug}/theme.css`)
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null)
      .then((css) => {
        if (!css || document.getElementById("customer-theme")) return;
        const style = document.createElement("style");
        style.id = "customer-theme";
        style.textContent = css;
        document.head.appendChild(style);
      });
  }, [user.branchSlug]);

  return <AuthContext.Provider value={user}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthUser {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
