/**
 * Read the built index.html from the production dist directory.
 * Falls back to the client workspace dist in local dev if the primary path is missing.
 */
export async function readIndexHtml(): Promise<string> {
  const primaryPath = "./dist/public/index.html";
  const fallbackPath = "../client/dist/index.html";

  const primary = Bun.file(primaryPath);
  if (await primary.exists()) {
    return primary.text();
  }

  const fallback = Bun.file(fallbackPath);
  if (await fallback.exists()) {
    return fallback.text();
  }

  throw new Error(
    `index.html not found at ${primaryPath} or ${fallbackPath}. ` +
      "Run 'bun run build' in the client package first."
  );
}

export interface UserProfile {
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
  staffbaseSessionHash: string | null;
}

/**
 * Candidate base directories for per-customer static assets.
 * Checked in order: production dist/ output first, then client/public/ source tree (local dev).
 */
const CUSTOMER_BASES = ["./dist/public/customers", "../client/public/customers"] as const;

/**
 * Read the per-customer theme CSS for the given branch_slug.
 * If the slug-specific file is missing, repeats the search for the "_default" slug.
 * Returns null only when no theme file can be found at all.
 */
export async function readCustomerTheme(slug: string): Promise<string | null> {
  for (const candidate of [slug, "_default"]) {
    for (const base of CUSTOMER_BASES) {
      const f = Bun.file(`${base}/${candidate}/theme.css`);
      if (await f.exists()) return f.text();
    }
  }
  return null;
}

/**
 * Short language codes that correspond to the locales directory names inside
 * public/customers/{slug}/locales/. Mirrors the `supportedLngs` list in
 * client/src/i18n/init.ts.
 *
 * These are also the keys used in the translationOverrides map sent to the
 * widget. Keying by the short code ("en", "de") rather than the Staffbase
 * locale ("en_US", "de_DE") ensures that getTranslations()'s split("_")[0]
 * fallback can always find a match regardless of whether the Staffbase SDK
 * returns short or long locale codes.
 */
const SUPPORTED_LANGS = ["en", "de", "fr", "es", "pl"] as const;

/**
 * Read per-customer widget string overrides from
 * `public/customers/{slug}/locales/{lang}/widget.json` files.
 * Single source of truth shared with the React client (init.ts glob).
 * Returns null when no widget.json files are found, leaving built-in strings intact.
 */
export async function readCustomerI18n(
  slug: string
): Promise<Record<string, Record<string, Record<string, string>>> | null> {
  for (const base of CUSTOMER_BASES) {
    const widgetLocales: Record<string, Record<string, string>> = {};

    for (const lang of SUPPORTED_LANGS) {
      const f = Bun.file(`${base}/${slug}/locales/${lang}/widget.json`);
      if (!(await f.exists())) continue;
      try {
        const data = JSON.parse(await f.text()) as Record<string, string>;
        widgetLocales[lang] = data;
      } catch {
        // skip malformed files
      }
    }

    if (Object.keys(widgetLocales).length > 0) {
      return { widget: widgetLocales };
    }
  }

  return null;
}

/**
 * Inject per-customer brand CSS (colors, fonts) as an inline <style> block
 * immediately before </head>. Inlining avoids a separate network round-trip and
 * prevents flash of unstyled content (FOUC).
 * The CSS is developer-authored (committed to the repo), not user input.
 */
export function injectTheme(html: string, css: string): string {
  return html.replace("</head>", `<style id="customer-theme">${css}</style></head>`);
}

/**
 * Inject the user identity as window.__USER__ into the HTML string immediately before </head>.
 * Uses Unicode escape sequences for <, >, and & to safely embed JSON in a script block (SEC-001).
 */
export function injectUser(html: string, user: UserProfile): string {
  const json = JSON.stringify(user)
    .replaceAll("<", String.raw`\u003c`)
    .replaceAll(">", String.raw`\u003e`)
    .replaceAll("&", String.raw`\u0026`);
  const scriptTag = `<script>window.__USER__ = ${json};</script>`;
  return html.replace("</head>", `${scriptTag}</head>`);
}

/**
 * Staffbase-owned embedding origins used as a hardcoded fallback when the JWT
 * does not carry an `issuer_domain` claim (e.g. older tokens, dev environments).
 * Must match the origins listed in springboard ADR-0005.
 */
const CSP_FALLBACK_ORIGINS =
  "https://*.staffbase.com https://*.staffbase.dev https://*.staffbase.rocks";

/**
 * Platform-level origins that must always be present in frame-ancestors regardless
 * of the tenant.
 * @see https://developers.staffbase.com/references/http-header-settings/
 */
const CSP_PLATFORM_ORIGINS = "http://staffbase.com capacitor://staffbase.com https://localhost";

/**
 * Derive the parent (apex) domain from a hostname by stripping the first DNS label.
 *
 * Per the Staffbase invariant the `issuer_domain` claim is always a subdomain
 * (`myapp.company.com` or `www.company.com`), so stripping one label always yields
 * the customer-owned apex — without requiring a full public-suffix-list dependency.
 *
 * When the host has ≤2 labels (bare apex — defensive guard, should not occur in
 * practice for valid Staffbase tokens) the host itself is returned unchanged.
 */
function parentDomain(host: string): string {
  const labels = host.split(".");
  return labels.length >= 3 ? labels.slice(1).join(".") : host;
}

/**
 * Build a `Content-Security-Policy: frame-ancestors` value.
 *
 * Follows the canonical Staffbase template:
 * @see https://developers.staffbase.com/references/http-header-settings/
 * Legacy CSP headers were deprecated as of Q1 2026.
 *
 * For issuer `myapp.mydomain.com` (appURL), parent `mydomain.com` (appdomain):
 *   frame-ancestors 'self'
 *     https://mydomain.com       ← appdomain (https)
 *     https://myapp.mydomain.com ← appURL    (https)
 *     http://staffbase.com       ← platform literal (only http: entry per spec)
 *     capacitor://mydomain.com   ← appdomain on native Capacitor
 *     capacitor://staffbase.com  ← platform native
 *     https://localhost          ← local dev
 *
 * Parent derivation: strip the first DNS label from issuerDomain.
 * When issuer == parent (≤2 labels, defensive) the https:// entry is deduped.
 *
 * When `issuerDomain` is absent or fails sanitisation it falls back to broad
 * Staffbase-hosted wildcard origins plus the platform literals so the plugin
 * still renders in any tenant, including native app embedding.
 */
export function buildFrameAncestors(issuerDomain: string | null | undefined): string {
  if (issuerDomain) {
    const safe = issuerDomain.replaceAll(/[^a-zA-Z0-9.-]/g, "");
    if (safe.length > 0) {
      const parent = parentDomain(safe);
      const httpsOrigins =
        parent === safe ? `https://${safe}` : `https://${parent} https://${safe}`;
      return `frame-ancestors 'self' ${httpsOrigins} http://staffbase.com capacitor://${parent} capacitor://staffbase.com https://localhost`;
    }
  }
  return `frame-ancestors 'self' ${CSP_FALLBACK_ORIGINS} ${CSP_PLATFORM_ORIGINS}`;
}

/**
 * Inject the JWT as window.__JWT_TOKEN__ into the HTML string immediately before </head>.
 * JWTs are base64url encoded and contain no HTML-special characters, but we escape
 * the five unsafe characters defensively (SEC-001).
 */
export function injectToken(html: string, token: string): string {
  const escaped = token
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");

  const scriptTag = `<script>window.__JWT_TOKEN__ = "${escaped}";</script>`;
  return html.replace("</head>", `${scriptTag}</head>`);
}

/**
 * Inject the server-issued session id as window.__SESSION_KEY__ immediately before </head>.
 *
 * Session IDs are crypto.randomUUID() values (hex + hyphens only), so they
 * contain no HTML-special characters. We still Unicode-escape the five unsafe
 * chars defensively to mirror the injectUser pattern (SEC-001).
 *
 * The client prefers this value over window.__JWT_TOKEN__ as the Bearer token
 * for all API calls. Because it is backed by the server-side sessions table it
 * remains valid for the full session TTL (default 8 h) even when Safari ITP
 * blocks the SameSite=None session cookie.
 */
export function injectSessionKey(html: string, sessionKey: string): string {
  const escaped = sessionKey
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");
  const scriptTag = `<script>window.__SESSION_KEY__ = "${escaped}";</script>`;
  return html.replace("</head>", `${scriptTag}</head>`);
}
