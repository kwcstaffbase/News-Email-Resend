/**
 * Plugin-server + Staffbase-platform fetches used by the widget.
 *
 * - `fetchDiscovery` — calls the plugin server's `/api/public/instance` for
 *   the `pluginId` (reverse-DNS), which is needed to query installations.
 * - `fetchManageableInstallations` — calls the Staffbase platform directly
 *   (same-origin, session cookie) to list the installations the current
 *   editor has `manage` permission on. Used by the installation picker.
 */

export interface DiscoveryResponse {
  pluginId: string;
  instances: Array<{ instanceId: string; staffbaseUrl: string | null }>;
}

export interface InstallationSummary {
  /** Installation UUID (the value persisted in the widget config). */
  id: string;
  /** Resolved display title (localised by `fetchManageableInstallations`). */
  title: string;
  /** Optional Staffbase host where this installation lives. */
  staffbaseUrl: string | null;
}

interface RawInstallationEntry {
  data?: {
    id?: string;
    config?: {
      staffbaseUrl?: string;
      localization?: Record<string, { title?: string }>;
    };
  };
  id?: string;
  config?: {
    staffbaseUrl?: string;
    localization?: Record<string, { title?: string }>;
  };
}

interface InstallationsSearchResponse {
  entries?: RawInstallationEntry[];
  data?: RawInstallationEntry[];
  total?: number;
}

export async function fetchDiscovery(
  pluginUrl: string,
  signal?: AbortSignal
): Promise<DiscoveryResponse> {
  const res = await fetch(`${pluginUrl}/api/public/instance`, { signal });
  if (!res.ok) {
    throw new Error(`Discovery fetch failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as DiscoveryResponse;
  if (!data.pluginId) throw new Error("Discovery response missing pluginId");
  return data;
}

function pickLocalizedTitle(
  localization: Record<string, { title?: string }> | undefined,
  preferredLocales: readonly string[]
): string | null {
  if (!localization) return null;
  for (const locale of preferredLocales) {
    const title = localization[locale]?.title?.trim();
    if (title) return title;
  }
  for (const entry of Object.values(localization)) {
    const title = entry?.title?.trim();
    if (title) return title;
  }
  return null;
}

function buildLocaleFallbacks(locale: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };
  if (locale) {
    push(locale);
    push(locale.replace("_", "-"));
    push(locale.replace("-", "_"));
    const [base] = locale.split(/[-_]/);
    push(base);
  }
  push("en_US");
  push("en");
  return out;
}

/**
 * List installations of this plugin the current Staffbase user can manage.
 * Same-origin call to the Staffbase host (not the plugin server), authed via
 * session cookie. Editor-only — desktop-Studio context.
 */
export async function fetchManageableInstallations(
  pluginId: string,
  options: { locale?: string | null; signal?: AbortSignal } = {}
): Promise<InstallationSummary[]> {
  const url = `/api/plugins/${encodeURIComponent(pluginId)}/installations/search?permission=manage`;
  const res = await fetch(url, {
    credentials: "include",
    headers: { accept: "application/json" },
    signal: options.signal,
  });
  if (!res.ok) {
    throw new Error(`Installations search failed (HTTP ${res.status})`);
  }
  const body = (await res.json()) as InstallationsSearchResponse;
  const entries = Array.isArray(body.entries)
    ? body.entries
    : Array.isArray(body.data)
      ? body.data
      : [];
  const fallbacks = buildLocaleFallbacks(options.locale ?? null);
  const out: InstallationSummary[] = [];
  for (const raw of entries) {
    const data = raw?.data ?? raw;
    if (!data) continue;
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (!id) continue;
    const title = pickLocalizedTitle(data.config?.localization, fallbacks) ?? id;
    const staffbaseUrl =
      typeof data.config?.staffbaseUrl === "string" ? data.config.staffbaseUrl : null;
    out.push({ id, title, staffbaseUrl });
  }
  return out;
}
