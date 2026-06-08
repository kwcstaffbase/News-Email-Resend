import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { settings, users } from "../db/schema.ts";
import { decrypt } from "./crypto.ts";
import { createLogger } from "./logger.ts";
import { cleanupDeletedUser } from "./remote-calls.ts";
import { getInstanceSettings, staffbaseFetch } from "./staffbase-api.ts";
import { TtlCache } from "./ttl-cache.ts";

const cacheLogger = createLogger("user-cache");

// Staffbase API shape for GET /api/users/:userId
// Accept: application/vnd.staffbase.accessors.user.v3+json
interface StaffbaseUser {
  id: string;
  deleted?: boolean;
  profile?: Record<string, string>;
  userName?: { value: string };
}

const USER_ACCEPT_HEADER = "application/vnd.staffbase.accessors.user.v3+json";

function splitName(userName: string): {
  firstName: string | null;
  lastName: string | null;
} {
  const idx = userName.indexOf(" ");
  if (idx === -1) return { firstName: userName || null, lastName: null };
  return {
    firstName: userName.slice(0, idx),
    lastName: userName.slice(idx + 1) || null,
  };
}

export async function upsertUser(user: {
  userId: string;
  instanceId: string;
  userName?: string;
  firstName?: string | null;
  lastName?: string | null;
  // When set, also persist users.last_verified_at in the same write. Callers
  // on the GDPR-revalidation path (revalidateAccessor / refresh paths) pass
  // `new Date()` so the TTL gate is updated without a second round-trip.
  lastVerifiedAt?: Date | null;
}): Promise<void> {
  let firstName = user.firstName ?? null;
  let lastName = user.lastName ?? null;

  // If first/last not provided but combined userName is, do best-effort split
  if (firstName === null && lastName === null && user.userName) {
    const split = splitName(user.userName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  const lastVerifiedAt = user.lastVerifiedAt ?? undefined;

  if (firstName !== null || lastName !== null) {
    // Full upsert — update names, status, and timestamp
    await db
      .insert(users)
      .values({
        userId: user.userId,
        instanceId: user.instanceId,
        firstName,
        lastName,
        status: "active",
        updatedAt: new Date(),
        ...(lastVerifiedAt !== undefined && { lastVerifiedAt }),
      })
      .onConflictDoUpdate({
        target: [users.instanceId, users.userId],
        set: {
          firstName,
          lastName,
          status: "active",
          updatedAt: new Date(),
          ...(lastVerifiedAt !== undefined && { lastVerifiedAt }),
        },
      });
    cacheLogger.debug("user-cache.upsert", {
      event: "user-cache.upsert",
      userId: user.userId,
      instanceId: user.instanceId,
      hasName: true,
    });
  } else {
    // Presence-only upsert — register the user without overwriting existing names
    await db
      .insert(users)
      .values({
        userId: user.userId,
        instanceId: user.instanceId,
        firstName: null,
        lastName: null,
        status: "active",
        updatedAt: new Date(),
        ...(lastVerifiedAt !== undefined && { lastVerifiedAt }),
      })
      .onConflictDoUpdate({
        target: [users.instanceId, users.userId],
        set: {
          status: "active",
          updatedAt: new Date(),
          ...(lastVerifiedAt !== undefined && { lastVerifiedAt }),
        },
      });
  }
}

/**
 * Strict-GDPR accessor revalidation TTL in seconds. On each authenticated
 * request, revalidateAccessor() re-fetches the accessor from the upstream
 * Staffbase API if the cached row is older than this. Set to 0 to force a
 * round-trip on every request (strictest).
 */
// Parse a non-negative integer from an env var. 0 is a valid value (forces
// round-trip on every request); NaN / negative / non-numeric inputs fall back
// to the default and emit a warning so misconfiguration is visible.
function envSeconds(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    cacheLogger.warn("Invalid env value; falling back to default.", {
      event: "user-cache.env_invalid",
      name,
      raw,
      fallback,
    });
    return fallback;
  }
  return parsed;
}

const REVALIDATE_SECONDS = envSeconds(
  "USER_ACCESSOR_REVALIDATE_SECONDS",
  Bun.env.USER_ACCESSOR_REVALIDATE_SECONDS,
  60
);
const REFERENCE_REVALIDATE_SECONDS = envSeconds(
  "USER_REFERENCE_REVALIDATE_SECONDS",
  Bun.env.USER_REFERENCE_REVALIDATE_SECONDS,
  300
);
const STRICT_REFERENCES_BLOCKING = Bun.env.STRICT_REFERENCES_BLOCKING === "true";

// In-process TTL cache for the GDPR accessor TTL gate. Keys are
// `${encodeURIComponent(instanceId)}::${encodeURIComponent(userId)}`. The
// value is `true` (sentinel) — presence within the TTL window is the entire
// semantic; the freshness check is owned by TtlCache.get(), which returns
// undefined for expired entries. Postgres still holds the source of truth in
// users.last_verified_at — this cache is a single-replica optimisation.
const ACCESSOR_VERIFIED_CACHE = new TtlCache<string, true>(
  REVALIDATE_SECONDS,
  // 10k entries × ~24 bytes ≈ 240 KB per replica. Cardinality is bounded by
  // (instanceId × accessor) tuples; 10k covers ~100 instances × ~100 active
  // accessors comfortably for our workload shape.
  10_000
);

// getInstanceSettings() is intentionally not memoised: apiToken must be fetched
// fresh per request so it never sits in a module-level Map (heap dumps,
// crash-time JSON.stringify, accidental log serialisation cannot leak the
// decrypted credential). Concurrent callers are still collapsed onto a single
// in-flight SELECT via inFlightInstanceSettings — but every settled call goes
// back to the DB on its next invocation. The hot-path optimisation lives in
// ACCESSOR_VERIFIED_CACHE, which short-circuits the entire revalidation
// (including this settings call) on the warm path.

// Hardcoded fan-out cap for revalidateReferencedUsers. Caps the parallel
// upstream SCIM calls per list response so a first-boot scenario (many
// stale references) doesn't slam the Staffbase /api/users endpoint.
const REFERENCE_FANOUT_CONCURRENCY = 4;

// In-flight dedup map keyed on `${instanceId}::${userId}`. When N concurrent
// callers ask for the same accessor (e.g. revalidateReferencedUsers fanout
// + a near-simultaneous direct gate hit), only the first one actually runs
// the upstream lookup; the others await the same promise. Without this, an
// upsert from one call and a cleanupDeletedUser from another could interleave
// and resurrect a deleted user in the cache until the next TTL window.
const inFlightRevalidations = new Map<string, Promise<{ deleted: boolean }>>();

// In-flight dedup for cold getInstanceSettings lookups. The promise resolves
// to the FULL settings shape so concurrent callers all observe the same
// staffbaseUrl + apiToken pair; nothing is persisted past settlement, so the
// next call after resolution goes back to the DB.
const inFlightInstanceSettings = new Map<
  string,
  Promise<{ staffbaseUrl: string | null; apiToken: string | null }>
>();

async function getInstanceSettingsCached(
  instanceId: string
): Promise<{ staffbaseUrl: string | null; apiToken: string | null }> {
  const existing = inFlightInstanceSettings.get(instanceId);
  if (existing) return existing;
  // The apiToken survives only on the stack of each request — no module-level
  // Map ever holds it past promise settlement.
  // getInstanceSettings may resolve to `null` when no settings row exists for
  // this instance yet; pass that null through as a null-shape object so the
  // caller can handle missing-credentials fail-open.
  const promise: Promise<{ staffbaseUrl: string | null; apiToken: string | null }> =
    getInstanceSettings(instanceId).then(
      (fresh) => fresh ?? { staffbaseUrl: null, apiToken: null }
    );
  inFlightInstanceSettings.set(instanceId, promise);
  promise.finally(() => {
    if (inFlightInstanceSettings.get(instanceId) === promise) {
      inFlightInstanceSettings.delete(instanceId);
    }
  });
  return promise;
}

/**
 * Drop the in-flight cold-fetch handle for this instance and cascade to
 * invalidateAccessorVerifiedCacheForInstance. Call this from the settings
 * mutation handler (the PUT /api/settings route) after a successful write so
 * any concurrent revalidateAccessor caller awaiting the pre-rotation settings
 * promise is dropped, and warm ACCESSOR_VERIFIED_CACHE entries for the
 * instance are evicted — without that cascade, a credential rotation would
 * leave warm gate entries admitting requests for up to REVALIDATE_SECONDS
 * with no upstream re-check, defeating the rotation's security purpose.
 */
export function invalidateInstanceSettingsCache(instanceId: string): void {
  inFlightInstanceSettings.delete(instanceId);
  invalidateAccessorVerifiedCacheForInstance(instanceId);
}

/**
 * Evict every ACCESSOR_VERIFIED_CACHE entry whose key starts with this
 * instance's encoded prefix.
 */
export function invalidateAccessorVerifiedCacheForInstance(instanceId: string): void {
  const prefix = `${encodeURIComponent(instanceId)}::`;
  for (const key of ACCESSOR_VERIFIED_CACHE.keys()) {
    if (key.startsWith(prefix)) ACCESSOR_VERIFIED_CACHE.delete(key);
  }
}

/**
 * Run `worker` over `items` with at most `limit` calls in flight at once.
 *
 * Spawns `min(limit, items.length)` parallel runners that drain a shared
 * index counter — every item is processed exactly once. Per-item exceptions
 * are caught and counted in `{ failed }` rather than propagated, so the
 * returned promise NEVER rejects — callers can `void` it (fire-and-forget)
 * without risk of an unhandled-rejection trace.
 *
 * The only existing caller is `revalidateReferencedUsers`, whose worker is
 * `revalidateAccessor()`. `revalidateAccessor` fails open internally, so
 * `failed` is 0 in practice today. The tally is defence-in-depth: if a
 * future refactor removes the inner try/catch, this helper still catches.
 */
async function runWithConcurrencyCap<T>(
  items: ReadonlyArray<T>,
  limit: number,
  worker: (item: T) => Promise<unknown>
): Promise<{ failed: number }> {
  let i = 0;
  let failed = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      const item = items[idx];
      if (item === undefined) continue;
      try {
        await worker(item);
      } catch {
        failed++;
      }
    }
  });
  await Promise.all(runners);
  return { failed };
}

// Short-lived negative cache for non-404 upstream errors (401, 429, 5xx, fetch
// timeouts). The TTL gate stored in `users.last_verified_at` is only bumped on
// a successful upstream response, so without this cache every authenticated
// request would re-hit the failing upstream during an outage — turning a
// Staffbase 429/503 into a request storm that deepens the incident. Entries
// expire after NEGATIVE_BACKOFF_MS so the next retry is short and bounded.
// Override via USER_REVALIDATE_NEGATIVE_BACKOFF_SECONDS (default 10s). An
// incident operator can shorten the window for fast recovery testing or
// extend it during a sustained Staffbase outage without a code deploy.
const NEGATIVE_BACKOFF_MS =
  envSeconds(
    "USER_REVALIDATE_NEGATIVE_BACKOFF_SECONDS",
    Bun.env.USER_REVALIDATE_NEGATIVE_BACKOFF_SECONDS,
    10
  ) * 1000;
const negativeCache = new Map<string, number>();
function negativeCacheKey(instanceId: string, userId: string): string {
  return `${encodeURIComponent(instanceId)}::${encodeURIComponent(userId)}`;
}
function isNegativeCached(instanceId: string, userId: string): boolean {
  const key = negativeCacheKey(instanceId, userId);
  const until = negativeCache.get(key);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    negativeCache.delete(key);
    return false;
  }
  return true;
}
function markNegativeCached(instanceId: string, userId: string): void {
  negativeCache.set(negativeCacheKey(instanceId, userId), Date.now() + NEGATIVE_BACKOFF_MS);
}

/**
 * Visible for tests — flushes every in-process GDPR cache so per-test state
 * cannot leak across the suite.
 */
export function _clearGdprCachesForTest(): void {
  ACCESSOR_VERIFIED_CACHE.clear();
  inFlightRevalidations.clear();
  inFlightInstanceSettings.clear();
  negativeCache.clear();
}

// Staffbase userIds are 24-char hex MongoDB ObjectIds. Anything else (path
// segments, query characters, traversal payloads, runaway strings) is rejected
// up-front before being interpolated into the upstream URL. `encodeURIComponent`
// alone does NOT escape `/`, so a userId like `"../settings"` would otherwise
// hit the Staffbase API as `/api/users/../settings`.
const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
function isValidUserId(userId: string): boolean {
  return USER_ID_PATTERN.test(userId);
}

/**
 * Per-request strict-GDPR check: confirm the accessor still exists in the
 * upstream Staffbase instance. Called by {@link gateAccessor} on every
 * authenticated request.
 *
 * Caching layers (in evaluation order):
 * 1. **Negative cache** ({@link negativeCache}, {@link NEGATIVE_BACKOFF_MS}):
 *    recent non-404 upstream errors short-circuit further attempts.
 * 2. **In-flight dedup** ({@link inFlightRevalidations}): N concurrent calls
 *    for the same (instanceId, userId) share one upstream lookup.
 * 3. **Per-user TTL gate** (`users.last_verified_at`, env
 *    `USER_ACCESSOR_REVALIDATE_SECONDS`, default 60s).
 *
 * - Upstream 404 / `{ deleted: true }` → {@link cleanupDeletedUser} purges
 *   data and returns `{ deleted: true }`.
 * - Upstream OK → upserts the user with a fresh `last_verified_at`.
 * - Fails open on transient errors → returns `{ deleted: false }`.
 *
 * Always settles — never throws.
 */
export function revalidateAccessor(
  instanceId: string,
  userId: string
): Promise<{ deleted: boolean }> {
  // Encode both halves so `::` inside either identifier cannot collide two
  // distinct (instanceId, userId) pairs onto the same key.
  const key = `${encodeURIComponent(instanceId)}::${encodeURIComponent(userId)}`;
  const existing = inFlightRevalidations.get(key);
  if (existing) return existing;
  // Set first, attach the cleanup AFTER — guarantees the entry is visible to
  // concurrent callers before the inner promise can possibly resolve and run
  // the .finally() delete (TOCTOU between .set() and .finally() registration).
  const promise = _revalidateAccessor(instanceId, userId);
  inFlightRevalidations.set(key, promise);
  promise.finally(() => {
    // Identity-guard the delete: only remove the entry if it still points to
    // the promise this caller registered. Without this, a `_clearGdprCachesForTest`
    // call between tests followed by a new in-flight registration could be
    // silently invalidated when the previous test's promise settles.
    if (inFlightRevalidations.get(key) === promise) {
      inFlightRevalidations.delete(key);
    }
  });
  return promise;
}

async function _revalidateAccessor(
  instanceId: string,
  userId: string
): Promise<{ deleted: boolean }> {
  // Defence-in-depth: reject malformed userIds before they reach the upstream
  // URL.
  if (!isValidUserId(userId)) {
    cacheLogger.trace("revalidateAccessor: rejected malformed userId.", {
      event: "revalidate.invalid_userid",
      instanceId,
    });
    return { deleted: false };
  }

  // Negative-cache short-circuit: a recent non-OK upstream response (401/429/
  // 5xx / fetch timeout) blocks further revalidation attempts for this user
  // for NEGATIVE_BACKOFF_MS. Fail-open semantics preserved.
  if (isNegativeCached(instanceId, userId)) return { deleted: false };

  // Positive fast-path: in-process TTL cache. If we verified this accessor
  // within REVALIDATE_SECONDS, skip the DB SELECT and the upstream round-trip.
  // TtlCache.get() enforces the TTL itself (returns undefined for expired
  // entries). The Postgres column users.last_verified_at remains source of
  // truth across replicas — this cache is a per-replica optimisation only.
  const cacheKey = `${encodeURIComponent(instanceId)}::${encodeURIComponent(userId)}`;
  if (ACCESSOR_VERIFIED_CACHE.get(cacheKey) !== undefined) return { deleted: false };

  try {
    const existing = await db
      .select({ lastVerifiedAt: users.lastVerifiedAt })
      .from(users)
      .where(and(eq(users.instanceId, instanceId), eq(users.userId, userId)))
      .limit(1);

    const row = existing[0];
    if (row?.lastVerifiedAt) {
      const ageSeconds = (Date.now() - row.lastVerifiedAt.getTime()) / 1000;
      if (ageSeconds < REVALIDATE_SECONDS) {
        // Warm the in-process cache so the next request from this replica
        // can skip the DB read too.
        ACCESSOR_VERIFIED_CACHE.set(cacheKey, true);
        return { deleted: false };
      }
    }

    const { staffbaseUrl, apiToken } = await getInstanceSettingsCached(instanceId);
    if (!staffbaseUrl || !apiToken) return { deleted: false };

    // 10-second deadline on the upstream fetch. Without an explicit signal, a
    // hung Staffbase API would keep this promise pending forever — the
    // inFlightRevalidations entry would never be removed by .finally(), and
    // every subsequent request for the same (instanceId, userId) would await
    // the stuck promise via the `existing` branch.
    const res = await staffbaseFetch(
      `/api/users/${encodeURIComponent(userId)}`,
      staffbaseUrl,
      apiToken,
      { headers: { Accept: USER_ACCEPT_HEADER }, signal: AbortSignal.timeout(10_000) }
    );

    if (res.status === 404) {
      await cleanupDeletedUser(instanceId, userId);
      ACCESSOR_VERIFIED_CACHE.delete(cacheKey);
      cacheLogger.warn("Accessor revalidation: user deleted upstream.", {
        event: "revalidate.deleted",
        instanceId,
        userId,
      });
      return { deleted: true };
    }

    if (!res.ok) {
      // Transient upstream error (401, 429, 5xx). Mark the negative cache so
      // subsequent requests don't re-hammer the failing upstream within the
      // backoff window. Fail-open: return { deleted: false }.
      markNegativeCached(instanceId, userId);
      cacheLogger.trace("Accessor revalidation: upstream non-OK, negative-cached.", {
        event: "revalidate.upstream_error",
        instanceId,
        userId,
        "http.response.status_code": res.status,
      });
      return { deleted: false };
    }

    const u: StaffbaseUser = await res.json();
    if (u.deleted) {
      await cleanupDeletedUser(instanceId, userId);
      ACCESSOR_VERIFIED_CACHE.delete(cacheKey);
      cacheLogger.warn("Accessor revalidation: user flagged deleted upstream.", {
        event: "revalidate.deleted",
        instanceId,
        userId,
      });
      return { deleted: true };
    }

    await upsertUser({
      userId: u.id,
      instanceId,
      firstName: u.profile?.firstName,
      lastName: u.profile?.lastName,
      userName: u.userName?.value,
      lastVerifiedAt: new Date(),
    });
    ACCESSOR_VERIFIED_CACHE.set(cacheKey, true);
    return { deleted: false };
  } catch (err) {
    // Fetch timeout, network error, JSON parse failure. Same negative-cache
    // treatment as non-OK responses.
    markNegativeCached(instanceId, userId);
    cacheLogger.trace("revalidateAccessor failed; failing open + negative-cached.", {
      event: "revalidate.failed",
      instanceId,
      userId,
      message: (err as Error).message,
    });
    return { deleted: false };
  }
}

/**
 * Strict-GDPR check for *referenced* userIds rendered in list responses
 * (e.g. createdByUserId, changelog.userId).
 *
 * Selects rows from the cache whose `lastVerifiedAt` is null or older than
 * REFERENCE_REVALIDATE_SECONDS, then fires revalidateAccessor() for each in
 * parallel. By default the function is **fire-and-forget**: the calling
 * handler does not await it, so list responses incur zero added latency.
 * The next request after the parallel revalidate finishes sees deletions
 * reflected (cleanupDeletedUser hard-removes the row → displayUser falls
 * back to the "Unknown" label).
 *
 * Set STRICT_REFERENCES_BLOCKING=true to make the function await all
 * revalidations — slower responses but no stale-PII window. The default
 * (fire-and-forget) is the right call for almost all deployments.
 *
 * Worst case for a stale-PII impression: one rendered response per stale
 * reference per TTL window (default 5 min) after the upstream delete.
 */
export async function revalidateReferencedUsers(
  instanceId: string,
  userIds: ReadonlyArray<string | null | undefined>
): Promise<void> {
  // Filter by isValidUserId BEFORE the DB lookup so historical rows that
  // pre-date the upstream-URL validator cannot reach revalidateAccessor's
  // trace logger as warning noise, and cannot widen the `inArray` query
  // unnecessarily.
  const ids = Array.from(
    new Set(
      userIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0 && isValidUserId(id)
      )
    )
  );
  if (ids.length === 0) return;

  let rows: { userId: string; lastVerifiedAt: Date | null }[];
  try {
    rows = await db
      .select({ userId: users.userId, lastVerifiedAt: users.lastVerifiedAt })
      .from(users)
      .where(and(eq(users.instanceId, instanceId), inArray(users.userId, ids)));
  } catch (err) {
    // warn-level so an operator sees this during an incident — silent
    // fail-open is correct behaviour but invisible at trace level.
    cacheLogger.warn("revalidateReferencedUsers cache lookup failed.", {
      event: "references.lookup_failed",
      instanceId,
      message: (err as Error).message,
    });
    return;
  }

  const now = Date.now();
  const cutoffMs = REFERENCE_REVALIDATE_SECONDS * 1000;
  const cachedById = new Map(rows.map((r) => [r.userId, r.lastVerifiedAt]));

  const staleIds = ids.filter((id) => {
    const verifiedAt = cachedById.get(id);
    if (verifiedAt === undefined) return true; // not in cache yet — must verify
    if (verifiedAt === null) return true;
    return now - verifiedAt.getTime() >= cutoffMs;
  });

  if (staleIds.length === 0) return;

  // Cap the upstream SCIM fan-out so a list response referencing many stale
  // userIds doesn't slam /api/users with len(staleIds) parallel requests.
  // REFERENCE_FANOUT_CONCURRENCY workers drain the staleIds queue in order.
  // runWithConcurrencyCap catches per-worker exceptions (returns { failed })
  // so a future refactor that removes _revalidateAccessor's inner try/catch
  // can't produce an unhandled rejection from `void work` either.
  const work = runWithConcurrencyCap(staleIds, REFERENCE_FANOUT_CONCURRENCY, (id) =>
    revalidateAccessor(instanceId, id)
  );

  if (STRICT_REFERENCES_BLOCKING) {
    const { failed } = await work;
    if (failed > 0) {
      cacheLogger.trace("revalidateReferencedUsers: some checks failed.", {
        event: "references.partial_failure",
        instanceId,
        failed,
        total: staleIds.length,
      });
    }
    return;
  }

  // Fire-and-forget — caller never blocks on this. Per-call failures are
  // logged inside revalidateAccessor's own trace branch.
  void work;
}

/**
 * Idempotent lazy fill of the per-instance users cache.
 *
 * - Returns immediately if a row for (instanceId, userId) already exists.
 * - Otherwise fetches the user from Staffbase /api/users/:id and upserts.
 * - Failures are logged at TRACE and swallowed — writes never block on
 *   Staffbase availability.
 */
export async function ensureUserInCache(instanceId: string, userId: string): Promise<void> {
  // Defence-in-depth: reject malformed userIds before any upstream call.
  if (!isValidUserId(userId)) {
    cacheLogger.trace("ensureUserInCache: rejected malformed userId.", {
      event: "ensure.invalid_userid",
      instanceId,
    });
    return;
  }
  try {
    const existing = await db
      .select({ userId: users.userId })
      .from(users)
      .where(and(eq(users.instanceId, instanceId), eq(users.userId, userId)))
      .limit(1);
    if (existing.length > 0) return;

    const { staffbaseUrl, apiToken } = await getInstanceSettings(instanceId);
    if (!staffbaseUrl || !apiToken) return;

    // 10-second deadline on the upstream fetch — matches `_revalidateAccessor`.
    // A hung Staffbase API would otherwise stall the lazy-fill caller for the
    // duration of the platform's TCP timeout (often minutes), holding open a
    // connection slot and leaking the file descriptor under sustained load.
    const res = await staffbaseFetch(
      `/api/users/${encodeURIComponent(userId)}`,
      staffbaseUrl,
      apiToken,
      { headers: { Accept: USER_ACCEPT_HEADER }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return;

    const u: StaffbaseUser = await res.json();
    if (u.deleted) return;

    await upsertUser({
      userId: u.id,
      instanceId,
      firstName: u.profile?.firstName,
      lastName: u.profile?.lastName,
      userName: u.userName?.value,
    });
  } catch (err) {
    cacheLogger.trace("ensureUserInCache failed; will retry on next reference.", {
      event: "ensure.failed",
      instanceId,
      userId,
      message: (err as Error).message,
    });
  }
}

// Prevents concurrent refresh runs (e.g. background timer + manual trigger)
let refreshInProgress = false;

export async function refreshAllUsers(): Promise<{
  total: number;
  active: number;
  deleted: number;
  fetchErrors: number;
}> {
  if (refreshInProgress) {
    cacheLogger.info("Refresh already in progress — skipping.");
    return { total: 0, active: 0, deleted: 0, fetchErrors: 0 };
  }
  refreshInProgress = true;
  try {
    return await _refreshAllUsers();
  } finally {
    refreshInProgress = false;
  }
}

async function _refreshAllUsers(): Promise<{
  total: number;
  active: number;
  deleted: number;
  fetchErrors: number;
}> {
  // Fetch all instances that have both a Staffbase URL and an API token configured
  const instanceSettings = await db.select().from(settings).where(isNotNull(settings.staffbaseUrl));

  const ready = instanceSettings.filter((s) => s.staffbaseUrl && s.apiToken);

  if (ready.length === 0) {
    cacheLogger.info(
      "Background refresh skipped: no instances have staffbaseUrl + apiToken configured."
    );
    return { total: 0, active: 0, deleted: 0, fetchErrors: 0 };
  }

  let total = 0;
  let active = 0;
  let deleted = 0;
  let fetchErrors = 0;

  for (const instanceSetting of ready) {
    const instanceId = instanceSetting.instanceId;
    const instanceUrl = instanceSetting.staffbaseUrl ?? "";
    const token = decrypt(instanceSetting.apiToken ?? "");

    if (!token) {
      cacheLogger.warn("Failed to decrypt API token for instance — skipping.", {
        instanceId,
      });
      fetchErrors++;
      continue;
    }

    try {
      const result = await _refreshInstance(instanceId, instanceUrl, token);
      total += result.total;
      active += result.active;
      deleted += result.deleted;
      fetchErrors += result.fetchErrors;
    } catch (err) {
      cacheLogger.error("Error refreshing instance.", {
        instanceId,
        message: (err as Error).message,
      });
      fetchErrors++;
    }
  }

  cacheLogger.info("Refresh complete.", {
    total,
    active,
    deleted,
    fetchErrors,
  });
  return { total, active, deleted, fetchErrors };
}

async function _refreshInstance(
  instanceId: string,
  instanceUrl: string,
  token: string
): Promise<{
  total: number;
  active: number;
  deleted: number;
  fetchErrors: number;
}> {
  // Fetch only the users we already track for this instance — those are the
  // ones whose display names need to be checked and whose deletions need to be
  // detected. New users are added to the cache on first login (write-through in html.ts).
  const dbUsers = await db
    .select({ userId: users.userId })
    .from(users)
    .where(eq(users.instanceId, instanceId));

  let active = 0;
  let deleted = 0;
  let fetchErrors = 0;

  for (const row of dbUsers) {
    let res: Response;
    try {
      res = await staffbaseFetch(`/api/users/${row.userId}`, instanceUrl, token, {
        headers: { Accept: USER_ACCEPT_HEADER },
      });
    } catch (err) {
      cacheLogger.warn("Fetch error for user.", {
        userId: row.userId,
        instanceId,
        message: (err as Error).message,
      });
      fetchErrors++;
      continue;
    }

    if (res.status === 404) {
      await cleanupDeletedUser(instanceId, row.userId);
      deleted++;
      continue;
    }

    if (!res.ok) {
      cacheLogger.warn("Upstream error fetching user.", {
        userId: row.userId,
        instanceId,
        "http.response.status_code": res.status,
      });
      fetchErrors++;
      continue;
    }

    const u: StaffbaseUser = await res.json();

    if (u.deleted) {
      await cleanupDeletedUser(instanceId, row.userId);
      deleted++;
    } else {
      await upsertUser({
        userId: u.id,
        instanceId,
        firstName: u.profile?.firstName,
        lastName: u.profile?.lastName,
        userName: u.userName?.value,
        // Background refresh confirms the user still exists — bump the GDPR
        // TTL gate too so the next request's revalidateAccessor short-circuits.
        lastVerifiedAt: new Date(),
      });
      cacheLogger.trace("User cache entry updated.", { userId: u.id, instanceId });
      active++;
    }
  }

  return { total: dbUsers.length, active, deleted, fetchErrors };
}

/**
 * Re-fetches a single user from the Staffbase API and updates the local cache.
 *
 * This is the "editor escape hatch" — when an admin triggers a manual cache
 * bust for a specific user, this function hits the upstream API for just that
 * one user rather than re-running the full background refresh.
 *
 * Returns `"refreshed"` on success, `"deleted"` when the upstream reports the
 * user no longer exists, and throws on configuration or network errors.
 */
export async function refreshSingleUser(
  userId: string,
  instanceId: string
): Promise<"refreshed" | "deleted"> {
  const instanceSettings = await db
    .select()
    .from(settings)
    .where(eq(settings.instanceId, instanceId))
    .limit(1);

  const s = instanceSettings[0];
  if (!s?.staffbaseUrl || !s.apiToken) {
    throw new Error(`Instance ${instanceId} is not configured with a staffbaseUrl and apiToken.`);
  }

  const token = decrypt(s.apiToken);
  if (!token) {
    throw new Error(`Failed to decrypt API token for instance ${instanceId}.`);
  }

  const encodedUserId = encodeURIComponent(userId);

  let res: Response;
  try {
    res = await staffbaseFetch(`/api/users/${encodedUserId}`, s.staffbaseUrl, token, {
      headers: { Accept: USER_ACCEPT_HEADER },
    });
  } catch (err) {
    throw new Error(`Network error fetching user ${userId}: ${(err as Error).message}`);
  }

  if (res.status === 404) {
    await cleanupDeletedUser(instanceId, userId);
    cacheLogger.info("Single-user refresh: user not found upstream, removed from cache.", {
      userId,
      instanceId,
    });
    return "deleted";
  }

  if (!res.ok) {
    throw new Error(`Upstream error fetching user ${userId}: HTTP ${res.status}`);
  }

  const u: StaffbaseUser = await res.json();

  if (u.deleted) {
    await cleanupDeletedUser(instanceId, userId);
    cacheLogger.info("Single-user refresh: user marked deleted upstream, removed from cache.", {
      userId,
      instanceId,
    });
    return "deleted";
  }

  await upsertUser({
    userId: u.id,
    instanceId,
    firstName: u.profile?.firstName,
    lastName: u.profile?.lastName,
    userName: u.userName?.value,
  });

  cacheLogger.info("Single-user refresh: user cache updated.", { userId, instanceId });
  return "refreshed";
}
