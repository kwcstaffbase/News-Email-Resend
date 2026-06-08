/**
 * In-process metrics counters exposed as a Prometheus text endpoint at /api/metrics.
 *
 * Metrics are hand-rolled (no prom-client dependency) and designed to work with the
 * Staffbase VMServiceScrape auto-created when `metrics: enabled: true` is set in the
 * Apperator CR (mops). No authentication is required — the scrape endpoint must be
 * reachable without SSO (mounted before ssoMiddleware in app.ts).
 *
 * Exported counters/histograms used by other modules:
 *   incHttpRequests(method, path, status)   — called from access-log middleware
 *   observeHttpDuration(method, path, ms)   — called from access-log middleware
 *   incBackgroundTask(task)                 — called from index.ts background tasks
 *   incBackgroundError(task)                — called from index.ts background tasks
 */

import { Hono } from "hono";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Counter {
  labels: Record<string, string>;
  value: number;
}

interface HistogramBucket {
  labels: Record<string, string>;
  buckets: Map<number, number>; // upper-bound → cumulative count
  sum: number;
  count: number;
}

// ── Singleton metric stores ───────────────────────────────────────────────────

// Finer buckets at the low end. A 2026-05-22 prod audit showed P95 stuck at
// 9.5 ms — the midpoint of the 0-10ms bucket — making it impossible to
// distinguish a 1ms cached response from a 9ms cold-DB read. Sub-10ms
// buckets added for diagnostic granularity; upper end unchanged.
const DURATION_BUCKETS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

// http_requests_total{method, path, status}
export const httpRequestsTotal = new Map<string, Counter>();
// http_request_duration_ms{method, path}
export const httpRequestDurations = new Map<string, HistogramBucket>();
// background_tasks_total{task}
export const backgroundTasksTotal = new Map<string, Counter>();
// background_task_errors_total{task}
export const backgroundTaskErrorsTotal = new Map<string, Counter>();

// ── Label helpers ─────────────────────────────────────────────────────────────

/**
 * Escape a label value for the Prometheus text exposition format.
 *
 * Per the spec (https://prometheus.io/docs/instrumenting/exposition_formats/),
 * a label value MUST escape:
 *   \  →  \\
 *   "  →  \"
 *   \n →  \n  (literal backslash-n)
 *
 * Without escaping, a user-controlled `path` containing `"` or `\n` lets the
 * caller inject arbitrary labels — and a stray `}` followed by another `{`
 * injects a fake metric name into the exposition. A 2026-05-22 audit of this
 * plugin on prod confirmed exactly this exploit shape: scanner URIs like
 * `/foo",le="+Inf"} 1\n# evil_metric{x="1"}` polluted the metric namespace
 * with ~3700 permanent series (de1=2200, au1=1405, us1=112).
 */
// Exported for unit tests. Kept as a named function so the test imports
// the same implementation render paths use, not a copy.
export function escapeLabelValue(value: string): string {
  // String.raw can't represent a single backslash (raw templates can't end
  // in `\`, and `String.raw\`\\\`` is the 2-char string `\\`), so use regular
  // string escapes here.
  //
  // `\r` is escaped in addition to the spec-mandated `\`, `"`, `\n`: some
  // scrapers + intermediaries treat `\r\n` as a line break, so a bare `\r`
  // is a known parser-confusion bypass for the metric-injection vector this
  // function exists to close.
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r");
}

// Prometheus label-key grammar — the only characters allowed by the text
// exposition format. (Equivalent to `[a-zA-Z0-9_]` for ASCII; `\w` is the
// canonical regex shorthand.)
const LABEL_KEY_RE = /^[a-zA-Z_]\w*$/;

/**
 * Format a label map into a Prometheus-compliant label set string.
 *
 * - Labels are emitted in sorted key order so identical label maps produce
 *   identical scrape output (stable series identity).
 * - Each value goes through {@link escapeLabelValue} so the rendered string
 *   cannot terminate the label set or inject a new metric line.
 * - Each key is validated against the Prometheus label-key grammar
 *   (`[a-zA-Z_][a-zA-Z0-9_]*`). Invalid keys throw — a non-conforming
 *   key indicates a programming bug at the call site (not user input),
 *   so failing loud is correct and prevents this function from becoming
 *   a second injection vector if future code passes dynamic keys.
 * - Returns the empty string for an empty label map.
 */
function compareLabelKeys(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function labelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => compareLabelKeys(a, b))
    .map(([k, v]) => {
      if (!LABEL_KEY_RE.test(k)) {
        throw new Error(`labelKey: invalid label key ${JSON.stringify(k)}`);
      }
      return `${k}="${escapeLabelValue(v)}"`;
    })
    .join(",");
}

function labelString(labels: Record<string, string>): string {
  const s = labelKey(labels);
  return s ? `{${s}}` : "";
}

// ── Mutation helpers (called from other modules) ──────────────────────────────

export function incHttpRequests(method: string, path: string, status: number): void {
  const labels = { method, path, status: `${status}` };
  const key = labelKey(labels);
  const existing = httpRequestsTotal.get(key);
  if (existing) {
    existing.value++;
  } else {
    httpRequestsTotal.set(key, { labels, value: 1 });
  }
}

export function observeHttpDuration(method: string, path: string, ms: number): void {
  const labels = { method, path };
  const key = labelKey(labels);
  let h = httpRequestDurations.get(key);
  if (!h) {
    const buckets = new Map<number, number>();
    for (const b of DURATION_BUCKETS) buckets.set(b, 0);
    buckets.set(Infinity, 0);
    h = { labels, buckets, sum: 0, count: 0 };
    httpRequestDurations.set(key, h);
  }
  h.sum += ms;
  h.count++;
  for (const b of DURATION_BUCKETS) {
    if (ms <= b) h.buckets.set(b, (h.buckets.get(b) ?? 0) + 1);
  }
  h.buckets.set(Infinity, h.count);
}

export function incBackgroundTask(task: string): void {
  const key = `task="${task}"`;
  const existing = backgroundTasksTotal.get(key);
  if (existing) {
    existing.value++;
  } else {
    backgroundTasksTotal.set(key, { labels: { task }, value: 1 });
  }
}

export function incBackgroundError(task: string): void {
  const key = `task="${task}"`;
  const existing = backgroundTaskErrorsTotal.get(key);
  if (existing) {
    existing.value++;
  } else {
    backgroundTaskErrorsTotal.set(key, { labels: { task }, value: 1 });
  }
}

// ── Prometheus text format rendering ─────────────────────────────────────────

function renderCounter(name: string, help: string, counters: Map<string, Counter>): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
  for (const c of counters.values()) {
    lines.push(`${name}${labelString(c.labels)} ${c.value}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderHistogram(
  name: string,
  help: string,
  histograms: Map<string, HistogramBucket>
): string {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
  for (const h of histograms.values()) {
    const base = labelKey(h.labels);
    for (const [b, count] of h.buckets.entries()) {
      const le = b === Infinity ? "+Inf" : `${b}`;
      const labelStr = base ? `{${base},le="${le}"}` : `{le="${le}"}`;
      lines.push(`${name}_bucket${labelStr} ${count}`);
    }
    const labelStr = base ? `{${base}}` : "";
    lines.push(`${name}_sum${labelStr} ${h.sum}`, `${name}_count${labelStr} ${h.count}`);
  }
  return `${lines.join("\n")}\n`;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export const metricsRoute = new Hono();

metricsRoute.get("/", (c) => {
  const bunVersion = process.versions.bun ?? "unknown";
  const nodeEnv = Bun.env.NODE_ENV ?? "unknown";
  const arch = process.arch; // "x64" in production, "arm64" on Apple Silicon dev machines

  let body = "";
  body += `# HELP app_info Application runtime information\n`;
  body += `# TYPE app_info gauge\n`;
  body += `app_info{node_env="${nodeEnv}",bun_version="${bunVersion}",arch="${arch}"} 1\n`;
  body += renderCounter(
    "http_requests_total",
    "Total HTTP requests by method, path, and status code",
    httpRequestsTotal
  );
  body += renderHistogram(
    "http_request_duration_ms",
    "HTTP request duration in milliseconds",
    httpRequestDurations
  );
  body += renderCounter(
    "background_tasks_total",
    "Total background task executions by task name",
    backgroundTasksTotal
  );
  body += renderCounter(
    "background_task_errors_total",
    "Total background task failures by task name",
    backgroundTaskErrorsTotal
  );

  return c.text(body, 200, {
    "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
  });
});
