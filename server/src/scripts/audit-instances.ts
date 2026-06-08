#!/usr/bin/env bun
/**
 * audit-instances.ts — Instance reconciliation script.
 *
 * Enumerates every distinct `instance_id` present anywhere in the plugin DB,
 * cross-references each against its Staffbase host, and (optionally) purges
 * orphaned instances that will never receive the deleteInstance webhook.
 *
 * CLASSIFICATION
 *   live                Both probe stages succeeded — instance is active.
 *   credentials-revoked Auth probe returned 401/403 — token was revoked.
 *   missing             Auth probe returned 404 — installation no longer exists.
 *   no-credentials      Settings row exists but api_token is blank.
 *   host-unknown        No settings row or staffbase_url is null — cannot probe.
 *   unreachable         Network error (either stage) reaching the Staffbase host.
 *
 * PURGE LOGIC  (--apply flag)
 *   deleteInstance() is called for every instance classified as:
 *     - credentials-revoked   (token revoked → instance gone from Staffbase)
 *     - missing               (404 on probe → installation no longer exists)
 *   "trashed" instances (still in Staffbase trash, pending 30-day window) will
 *   appear as `live` until the token is revoked or the host becomes 404, at
 *   which point re-running with --apply will clean them up (retry semantics).
 *
 * USAGE
 *   bun src/scripts/audit-instances.ts            # dry-run, JSON report to stdout
 *   bun src/scripts/audit-instances.ts --apply    # purge orphaned instances
 *
 * ENV
 *   PLUGIN_ID   Staffbase plugin ID.  When set, the auth probe hits
 *               /api/plugins/{PLUGIN_ID}/installations/{instanceId} — semantically
 *               exact and avoids the versioned Accept-header requirement of the user
 *               search endpoint.  Without it, falls back to /api/users/search.
 *
 * OUTPUT
 *   Structured JSON written to stdout; all logging goes to stderr so the JSON
 *   can be piped to a file or forwarded as a pipeline artefact without mixing.
 */

import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { changelog, sessions, settings, users } from "../db/schema.ts";
import { createLogger } from "../lib/logger.ts";
import { deleteInstance } from "../lib/remote-calls.ts";
import { getInstanceSettings } from "../lib/staffbase-api.ts";

const logger = createLogger("audit");

// ── Types ─────────────────────────────────────────────────────────────────────

export type InstanceStatus =
  | "live"
  | "credentials-revoked"
  | "missing"
  | "no-credentials"
  | "host-unknown"
  | "unreachable";

export interface TableCount {
  tableName: string;
  rowCount: number;
}

export interface InstanceEntry {
  instanceId: string;
  totalRows: number;
  rowsPerTable: TableCount[];
  status: InstanceStatus;
  staffbaseUrl: string | null;
  /** null = dry-run; true = purge succeeded; false = purge failed */
  purged: boolean | null;
  purgeError: string | null;
}

export interface AuditReport {
  generatedAt: string;
  dryRun: boolean;
  totalInstances: number;
  byStatus: Record<InstanceStatus, number>;
  instances: InstanceEntry[];
}

// ── Table registry ────────────────────────────────────────────────────────────

/**
 * All tables that carry instance_id.  Derived from scoped.ts — must be kept in
 * sync whenever a new instance_id table is added.  The validate-migrations.ts
 * CI check ensures every new table has an instance_id column; this list is the
 * script-side counterpart.
 */
const SCOPED_TABLES = [
  { schema: users, name: "users" },
  { schema: sessions, name: "sessions" },
  { schema: settings, name: "settings" },
  { schema: changelog, name: "changelog" },
] as const;

// ── Enumeration ───────────────────────────────────────────────────────────────

/**
 * Parse a Postgres `COUNT(*)::text` result into a safe number.
 *
 * `COUNT(*)` returns `bigint`, which Postgres drivers serialise as a string so
 * the 53-bit float range of JavaScript `Number` cannot silently truncate it.
 * We parse as `BigInt` first, then downcast to `Number` only when the value is
 * within `Number.MAX_SAFE_INTEGER`.  Any realistic per-instance row count fits
 * comfortably (MAX_SAFE_INTEGER ≈ 9 × 10¹⁵), but defensive parsing makes the
 * failure mode a loud warning rather than a silent precision loss.
 */
function parseRowCount(raw: string): number {
  const big = BigInt(raw);
  if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
    logger.warn("Row count exceeds Number.MAX_SAFE_INTEGER; clamping.", { raw });
    return Number.MAX_SAFE_INTEGER;
  }
  return Number(big);
}

/**
 * Returns a map of instanceId → per-table row counts for every instance_id
 * found across all scoped tables.
 */
export async function enumerateInstanceIds(): Promise<Map<string, TableCount[]>> {
  const result = new Map<string, TableCount[]>();

  for (const { schema: tableSchema, name: tableName } of SCOPED_TABLES) {
    const rows = await db.execute<{ instance_id: string; row_count: string }>(
      sql`SELECT instance_id, COUNT(*)::text AS row_count FROM ${tableSchema} GROUP BY instance_id`
    );

    for (const row of rows) {
      const instanceId = row.instance_id;
      const currentCounts = result.get(instanceId) ?? [];
      currentCounts.push({ tableName, rowCount: parseRowCount(row.row_count) });
      result.set(instanceId, currentCounts);
    }
  }

  return result;
}

// ── Classification ────────────────────────────────────────────────────────────

/**
 * Classifies a single instance via a two-stage probe. Never throws.
 *
 * Stage 1 — unauthenticated HEAD to the Staffbase base URL.
 *   Separates "host is down" (network error) from "installation is gone"
 *   (auth probe returns 404/401).  Any HTTP response means the host is up.
 *
 * Stage 2 — authenticated GET using whichever path is available:
 *   a) /api/plugins/{PLUGIN_ID}/installations/{instanceId}  when PLUGIN_ID is set
 *   b) /api/users/search?limit=0                            fallback (no PLUGIN_ID)
 *   The fallback user-search probe requires the versioned Accept header;
 *   the installations endpoint avoids that requirement. Both paths share the
 *   same response → status mapping: 2xx → live | 401/403 →
 *   credentials-revoked | 404 → missing | other → unreachable.
 */
export async function classifyInstance(
  instanceId: string
): Promise<{ status: InstanceStatus; staffbaseUrl: string | null }> {
  let staffbaseUrl: string | null = null;
  let apiToken: string | null = null;

  try {
    const s = await getInstanceSettings(instanceId);
    staffbaseUrl = s.staffbaseUrl;
    apiToken = s.apiToken;
  } catch (err) {
    logger.warn("Failed to read settings for instance.", {
      instanceId,
      message: (err as Error).message,
    });
    return { status: "host-unknown", staffbaseUrl: null };
  }

  if (!staffbaseUrl) {
    return { status: "host-unknown", staffbaseUrl: null };
  }

  if (!apiToken) {
    return { status: "no-credentials", staffbaseUrl };
  }

  // Stage 1: unauthenticated HEAD — confirms the Staffbase host is reachable.
  try {
    await fetch(staffbaseUrl, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
  } catch (err) {
    logger.warn("Host unreachable (HEAD failed).", {
      instanceId,
      staffbaseUrl,
      message: (err as Error).message,
    });
    return { status: "unreachable", staffbaseUrl };
  }

  // Stage 2: authenticated installation probe.
  const pluginId = Bun.env.PLUGIN_ID ?? process.env.PLUGIN_ID;
  const [probePath, probeHeaders] = pluginId
    ? [
        `/api/plugins/${pluginId}/installations/${instanceId}`,
        { Authorization: `Basic ${apiToken}` } as Record<string, string>,
      ]
    : [
        "/api/users/search?limit=0",
        {
          Authorization: `Basic ${apiToken}`,
          Accept: "application/vnd.staffbase.accessors.users-search.v1+json",
        } as Record<string, string>,
      ];

  let res: Response;
  try {
    res = await fetch(`${staffbaseUrl}${probePath}`, {
      method: "GET",
      headers: probeHeaders,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.warn("Network error on authentication probe.", {
      instanceId,
      staffbaseUrl,
      message: (err as Error).message,
    });
    return { status: "unreachable", staffbaseUrl };
  }

  if (res.ok) return { status: "live", staffbaseUrl };
  if (res.status === 401 || res.status === 403)
    return { status: "credentials-revoked", staffbaseUrl };
  if (res.status === 404) return { status: "missing", staffbaseUrl };

  logger.warn("Unexpected status from Staffbase probe.", {
    instanceId,
    staffbaseUrl,
    status: res.status,
  });
  return { status: "unreachable", staffbaseUrl };
}

// ── Purge ─────────────────────────────────────────────────────────────────────

/** Statuses for which --apply will invoke deleteInstance(). */
const PURGEABLE_STATUSES = new Set<InstanceStatus>(["credentials-revoked", "missing"]);

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Concurrency limit for the classification + purge pipeline.  Each instance
 * triggers at most one HTTP probe against its Staffbase host plus (optionally)
 * one `deleteInstance()` transaction, so a small fixed pool keeps per-audit
 * runtime bounded on large tenants without overloading Staffbase or the DB.
 * Override via `AUDIT_CONCURRENCY` for one-off debugging.
 */
const DEFAULT_CONCURRENCY = Number(
  Bun.env.AUDIT_CONCURRENCY ?? process.env.AUDIT_CONCURRENCY ?? "5"
);

/**
 * Minimal promise-pool: runs `worker(item)` over `items` with at most
 * `concurrency` tasks in flight.  Results are returned in input order.
 * No external dependency — this script ships as a single file and is invoked
 * ad-hoc in prod pods where `bun install` is not available.
 */
async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<U>
): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  const limit = Math.max(1, concurrency);
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Options for {@link runAudit}.  `purge` is dependency-injectable so the tests
 * can swap in a fake without `mock.module`-ing `remote-calls.ts` (which would
 * leak into other test files in bun's shared-process runner).
 */
export interface RunAuditOptions {
  apply: boolean;
  purge?: (instanceId: string) => Promise<boolean>;
  /** Max concurrent classify+purge tasks. Defaults to AUDIT_CONCURRENCY or 5. */
  concurrency?: number;
}

export async function runAudit(options: RunAuditOptions): Promise<AuditReport> {
  const { apply, purge = deleteInstance, concurrency = DEFAULT_CONCURRENCY } = options;

  logger.info("Audit started.", { apply, concurrency });

  // Step 1 — enumerate
  const instanceMap = await enumerateInstanceIds();
  logger.info("Enumeration complete.", { instanceCount: instanceMap.size });

  // Step 2 — classify + (optionally) purge — concurrency-limited so large
  // tenants don't serialise one probe at a time, but we still cap in-flight
  // requests so we never flood Staffbase or the purge transaction pool.
  const byStatus: Record<InstanceStatus, number> = {
    live: 0,
    "credentials-revoked": 0,
    missing: 0,
    "no-credentials": 0,
    "host-unknown": 0,
    unreachable: 0,
  };

  const entries = Array.from(instanceMap.entries());

  const instances: InstanceEntry[] = await mapWithConcurrency(
    entries,
    concurrency,
    async ([instanceId, tableCounts]) => {
      const totalRows = tableCounts.reduce((s, t) => s + t.rowCount, 0);

      logger.info("Classifying instance.", { instanceId, totalRows });
      const { status, staffbaseUrl } = await classifyInstance(instanceId);

      let purged: boolean | null = null;
      let purgeError: string | null = null;

      if (apply && PURGEABLE_STATUSES.has(status)) {
        logger.info("Purging instance.", { instanceId, status });
        try {
          const ok = await purge(instanceId);
          purged = ok;
          if (ok) {
            logger.info("Purge succeeded.", { instanceId });
          } else {
            purgeError = "deleteInstance() returned false — check server logs for details.";
            logger.error("Purge failed.", { instanceId });
          }
        } catch (error) {
          purged = false;
          purgeError = error instanceof Error ? error.message : String(error);
          logger.error("Purge threw an exception.", { instanceId, error: purgeError });
        }
      }

      return {
        instanceId,
        totalRows,
        rowsPerTable: tableCounts,
        status,
        staffbaseUrl,
        purged,
        purgeError,
      };
    }
  );

  // Tally status counts after all workers have completed
  for (const entry of instances) {
    byStatus[entry.status]++;
  }

  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    dryRun: !apply,
    totalInstances: instanceMap.size,
    byStatus,
    instances,
  };

  logger.info("Audit complete.", {
    totalInstances: report.totalInstances,
    byStatus,
  });

  return report;
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Only run when invoked directly, not when imported by tests.
if (import.meta.main) {
  const apply = process.argv.includes("--apply");

  if (apply) {
    // Require explicit acknowledgement to avoid accidental purges
    const confirmed = process.argv.includes("--yes") || process.env.AUDIT_CONFIRMED === "true";
    if (!confirmed) {
      process.stderr.write(
        "[audit-instances] --apply requires --yes or AUDIT_CONFIRMED=true to prevent accidental data loss.\n"
      );
      process.exit(1);
    }
  }

  const report = await runAudit({ apply });
  // JSON report → stdout (can be piped to a file / pipeline artefact)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  // Exit non-zero if any purge failed so CI pipelines can catch it
  const purgeFailed = report.instances.some((i) => i.purged === false);
  process.exit(purgeFailed ? 1 : 0);
}
