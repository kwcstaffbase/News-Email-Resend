// node:path and node:url are Node.js built-ins — needed in ESM scope, where __dirname is unavailable
import path from "node:path";
import { fileURLToPath } from "node:url";
// Tailwind CSS v4 Vite plugin — runs the Tailwind JIT compiler directly inside the Vite pipeline
import tailwindcss from "@tailwindcss/vite";
// Official Vite plugin for React — enables the JSX transform and Fast Refresh (HMR) in dev
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// ESM modules don’t expose __dirname; reconstruct it from import.meta.url for path lookups below
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }: { mode: string }) => {
  // Load .env from the project root (one level above client/) so server vars
  // like LOCALDEV_* are available in this config. Empty prefix loads everything.
  const envDir = path.resolve(__dirname, "..");
  const env = loadEnv(mode, envDir, "");

  // `@/` resolves to `client/src/` — enables clean absolute-style imports inside the React app
  const aliases: Record<string, string> = {
    "@": path.resolve(__dirname, "./src"),
  };

  return {
    // react() enables JSX transform + HMR; tailwindcss() runs the Tailwind v4 CSS compiler
    plugins: [react(), tailwindcss()],
    // Load .env from the project root (parent of client/) so VITE_DEV_* variables
    // are injected into import.meta.env for client code automatically by Vite.
    envDir,
    resolve: {
      // Apply the `@/` alias (and the local SDK alias in dev) to all import resolutions
      alias: aliases,
    },
    server: {
      proxy: {
        // Proxy /api/* requests from the Vite dev server (port 5173) to the Hono backend (port
        // 3000) — avoids CORS issues and mirrors the production setup where Hono serves both
        "/api": { target: "http://localhost:3000", changeOrigin: true },
      },
    },
    // In production the Staffbase platform injects real user context via a signed JWT.
    // In local dev (IS_LOCALDEV=true on the server) a synthetic user is built from .env instead.
    // These define() calls bake the env values into the bundle at build time so React reads them
    // via import.meta.env — only active during development builds; production object is empty {}.
    // env is populated by loadEnv() above, which actually reads the .env file — unlike
    // process.env, which is NOT populated by Vite's envDir and would always be undefined here.
    //
    // LOCALDEV_USER_ID, LOCALDEV_USER_NAME, and LOCALDEV_ROLE are the canonical
    // vars shared by both server and client. The VITE_DEV_* names below are kept as the
    // build-time substitution keys so client code (AuthContext.tsx) doesn't need to change.
    define:
      mode === "development"
        ? {
            "import.meta.env.VITE_DEV_USER_ID": JSON.stringify(
              env.LOCALDEV_USER_ID ?? "local-user-1"
            ),
            "import.meta.env.VITE_DEV_USER_NAME": JSON.stringify(
              env.LOCALDEV_USER_NAME ?? "Local Dev"
            ),
            "import.meta.env.VITE_DEV_INSTANCE_ID": JSON.stringify(
              env.VITE_DEV_INSTANCE_ID ?? "dev-instance"
            ),
            "import.meta.env.VITE_PLUGIN_ID": JSON.stringify(env.PLUGIN_ID ?? "dev-plugin"),
            // Role controls which UI surfaces are visible: "editor" unlocks the admin panel
            "import.meta.env.VITE_DEV_ROLE": JSON.stringify(env.LOCALDEV_ROLE ?? "editor"),
            // Comma-separated locale codes — drives the language selector and content fallback chain
            "import.meta.env.VITE_DEV_LANGUAGES": JSON.stringify(
              env.VITE_DEV_LANGUAGES ?? "en_US,de_DE"
            ),
            // Customer branch slug — selects the per-customer theme and locale overrides
            "import.meta.env.VITE_DEV_BRANCH_SLUG": JSON.stringify(
              env.LOCALDEV_BRANCH_SLUG ?? "_default"
            ),
            // User content locale — mirrors LOCALDEV_LOCALE so the port-5173 path
            // (no server-side __USER__ injection) can still initialise the correct language.
            "import.meta.env.VITE_DEV_LOCALE": JSON.stringify(env.LOCALDEV_LOCALE ?? null),
          }
        : {},
    css: {
      // LightningCSS replaces the PostCSS pipeline — faster transforms with native support for
      // modern CSS (nesting, custom media) and consistent with the cssMinify setting below
      transformer: "lightningcss" as const,
    },
    build: {
      // Output to dist/public/ at the monorepo root — Hono serves this directory as static assets
      // in production so a single Docker image contains both the server and the compiled client
      outDir: "../dist/public",
      // Always wipe the output directory before a fresh build — prevents stale asset conflicts
      emptyOutDir: true,
      // Use LightningCSS for CSS minification — consistent with the dev transformer above
      cssMinify: "lightningcss" as const,
    },
  };
});
