/**
 * Minimal in-process TTL cache. Used by the GDPR layer to short-circuit the
 * common-case "user verified within the last N seconds" lookup so authenticated
 * requests don't pay a Postgres round-trip on every call.
 *
 * Not LRU — entries are evicted lazily on read after their TTL elapses, and
 * eagerly on size overflow (oldest-by-insertion wins). For the workloads here
 * (small-cardinality `(instanceId, userId)` tuples, dozens of instances) the
 * insertion-order eviction is adequate. Swap for a real LRU later if cache
 * miss-rate becomes hot.
 *
 * Per-process; not shared across replicas — that's intentional. The Postgres
 * `users.last_verified_at` column is the source of truth across replicas; this
 * cache is a single-replica optimisation only.
 */

export class TtlCache<K, V> {
  private readonly store = new Map<K, { value: V; expiresAt: number }>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  // Opportunistic-sweep budget: on `set()` we inspect at most this many of the
  // oldest entries and drop any whose TTL has already elapsed. Bounded so a
  // single insertion can't degrade into an O(n) scan, but generous enough to
  // keep write-heavy workloads from filling up with expired entries that only
  // a subsequent `get()` would otherwise reclaim.
  private static readonly SWEEP_BUDGET = 8;

  constructor(ttlSeconds: number, maxEntries: number) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    // `<=` so an entry whose expiresAt equals `now` is treated as expired —
    // matches the documented "TTL elapsed" semantic at the boundary, and
    // makes TTL=0 behave as "do not cache" instead of "cache for one tick".
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      // Opportunistic sweep — reclaim a bounded number of already-expired
      // entries before falling back to insertion-order eviction. Without
      // this, write-heavy workloads (e.g. one-shot accessors that never get
      // re-read) could fill the cache with dead entries up to `maxEntries`,
      // forcing fresh writes to evict still-valid entries one-at-a-time.
      // The sweep is bounded by SWEEP_BUDGET so a single set() stays O(1)-ish.
      const now = Date.now();
      let scanned = 0;
      for (const [k, entry] of this.store) {
        if (scanned++ >= TtlCache.SWEEP_BUDGET) break;
        if (entry.expiresAt <= now) this.store.delete(k);
      }
      // If the sweep didn't free space, drop the oldest insertion-order entry.
      if (this.store.size >= this.maxEntries) {
        const oldest = this.store.keys().next().value;
        if (oldest !== undefined) this.store.delete(oldest);
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  /**
   * Iterate over currently-cached keys. Used by prefix-invalidation paths
   * (e.g. evicting every entry belonging to one instance). Does NOT skip
   * expired entries — callers that care should re-check via `get()` or
   * tolerate the stale-key list.
   */
  keys(): IterableIterator<K> {
    return this.store.keys();
  }

  // Visible for tests.
  size(): number {
    return this.store.size;
  }
}
