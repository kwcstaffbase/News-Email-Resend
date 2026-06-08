# ADR-0012 — Strict-GDPR layered user lifecycle (per-request accessor + per-render reference revalidation)

**Status:** Accepted
**Date:** 2026-05-22

## Context

[ADR-0011](0011-user-cache-lifecycle.md) established the per-instance `users` cache with eager fill on write + background reconciliation. Reconciliation cadence was set at `USER_CACHE_REFRESH_HOURS=2.5h` to bound SCIM load.

Two GDPR gaps remained after ADR-0011:

1. **Deleted user retains plugin access.** Staffbase JWT validation (signature + expiry) was the only per-request gate. JWT lifetime is short (~1 min) but the per-instance session cookie extends authenticated activity to `SESSION_TTL_HOURS` (default 8h). A user deleted in Staffbase could continue interacting with the plugin until either (a) their session naturally expired or (b) the next background refresh (up to 2.5h later) removed their cache row — and even then, the cookie itself could still authorise requests. Worst case: ~8 hours of access after deletion.
2. **Deleted user's PII still rendered in list responses.** Every list/get handler joins `users` on referenced userIds (e.g. `createdByUserId`, `reviewedByUserId`, `submittedByUserId`, `changelog.userId`). Until the next 2.5h background refresh hits the deleted user, their `firstName`/`lastName` continues to appear in rendered responses across the entire admin UI and the widget.

For an enterprise communications product handling EU customer data, GDPR Article 17 ("right to erasure") implies near-real-time PII removal once a user is deleted in the source system. Multi-hour windows where the plugin still shows a deleted person's name are not defensible.

## Decision

Layer three reconciliation forces, each bounded by its own TTL. Accept that no single mechanism balances latency, cost, and operational simplicity — combine them.

### Layer 1 — Per-request accessor revalidation

New `revalidateAccessor(instanceId, userId)` in [`server/src/lib/user-cache.ts`](../../server/src/lib/user-cache.ts). Called from `ssoMiddleware` after every successful auth resolution (cookie, Bearer session-id, Bearer JWT, query-param JWT). Bypassed only for the instance-purge handshake (`sub === "delete"`) and local-dev mode.

- Caches by `users.last_verified_at TIMESTAMP` (added by a dedicated migration that introduces the column).
- TTL: `USER_ACCESSOR_REVALIDATE_SECONDS` (default **60 s**, set 0 for revalidate-on-every-request).
- On upstream `404` → `cleanupDeletedUser(userId)` runs immediately; middleware returns `401 user_deleted`.
- On `200 + deleted=true` → same path.
- On transient errors (network failure, 5xx, missing apiToken) → fail-open. Staffbase outage must not lock all users out of the plugin.

Worst-case retained access after upstream delete: ≤ TTL (default 60 s).

### Layer 2 — Per-render reference revalidation

New `revalidateReferencedUsers(instanceId, userIds[])` in the same module. Called fire-and-forget at the end of every list/get handler that surfaces referenced userIds — admin list/get routes, the `changelog` audit feed, and the widget-facing list endpoint. Each call passes every userId the response will render (creators, reviewers, submitters, actors).

Filters input to userIds whose `lastVerifiedAt` is null or older than `USER_REFERENCE_REVALIDATE_SECONDS` (default **300 s**), then fires `revalidateAccessor()` for each stale id in parallel. Default behaviour is **fire-and-forget**: the calling handler does not await it, so list responses incur zero added latency. Set `STRICT_REFERENCES_BLOCKING=true` to await all revalidations — slower responses but no stale-PII window.

Worst-case stale-PII window: ≤ TTL (default 5 min) — exactly one rendered response can show the deleted user's name; the next request after the parallel revalidate finishes sees the cleaned-up cache.

### Layer 3 — Background sweep (existing)

`refreshAllUsers()` continues to iterate every cached user per instance. Default cadence tightened from `USER_CACHE_REFRESH_HOURS=2.5` → `1.5`. Layer 1 + 2 cover active accessors and actively-rendered references; this layer catches stragglers — e.g. users referenced only in the changelog who never log in and whose log rows are never opened.

## Why this combination

| Mechanism | Latency to GDPR erasure | SCIM load (1000 users, ~1 req/min) | Trade-off |
|-----------|-------------------------|------------------------------------|-----------|
| **Layer 1 only** (60s accessor TTL) | ≤ 60 s for active users; ≤ 1.5 h for inactive references | ~1000 req/min worst case | Bounds accessor exposure tightly; references still leak for hours |
| **Layer 2 only** (5min reference TTL) | ≤ 60 s for accessors (still via JWT); ≤ 5 min for active references | ~bursty; depends on list-render volume | Accessor leak persists until cookie expiry |
| **Layer 3 only** (1.5h sweep) | ≤ 1.5 h everywhere | ~11 req/min steady | Simple but worst-case window too long for GDPR |
| **Combined (chosen)** | ≤ 60 s accessor; ≤ 5 min references; ≤ 1.5 h stragglers | additive but largely overlapping (revalidateAccessor() is reentrant via the TTL check) | Latency tight where it matters; load bounded by TTLs |

The combined load is not 3× any single layer — Layer 2 stale-checks the same `last_verified_at` column Layer 1 updates, so a render immediately after an accessor revalidation skips Layer 2 entirely. Layer 3 only fires for users not touched by Layer 1 or 2 since the last sweep.

## Alternatives considered

- **Real-time webhooks from Staffbase** (`user.deleted` event → plugin endpoint). Cleanest mechanism, latency ≈ ms. Not currently supported by the public Staffbase API. Re-evaluate if/when platform-team ships it.
- **JWT-only validation** (shorten Staffbase JWT TTL). Out of plugin control. Even a 1-minute JWT TTL doesn't help here because the per-instance session cookie outlives it.
- **Block on every list render** (Layer 2 always awaited). Defaults to `STRICT_REFERENCES_BLOCKING=false` because the worst-case "one stale render" is acceptable in practice and the latency cost (~50-200 ms × number of stale references in parallel) is real on large lists. The knob exists for deployments that disagree.
- **Server-side PII suppression on stale rows** (SQL `CASE WHEN lastVerifiedAt < now() - interval '5 min' THEN NULL ELSE firstName END`). Considered. Causes name flicker (visible → "Unknown" → back to visible) which is worse UX than the one stale render. Rejected.

## Consequences

- A user deleted in Staffbase loses plugin access within ≤ `USER_ACCESSOR_REVALIDATE_SECONDS` (default 60 s) of their next request.
- A deleted user's PII disappears from rendered lists within ≤ one stale render after deletion, then within ≤ `USER_REFERENCE_REVALIDATE_SECONDS` (default 5 min) of any list render.
- Stragglers (deleted users referenced only in inactive log rows) are removed by the background sweep within ≤ `USER_CACHE_REFRESH_HOURS` (default 1.5 h).
- SCIM load is bounded: under normal access patterns the per-request check is a no-op cache hit; only stale users trigger an upstream call. The TTL knobs let operators tune for their SCIM rate limits.
- The 401 `user_deleted` response from `ssoMiddleware` is treated by the client's existing auth gate as a generic unauthorized condition (no dedicated client UI string by default). The plugin reloads, the user is sent through SSO again, and Staffbase itself blocks their authentication. Adding a dedicated UI message can be layered on later if customer feedback warrants it.
- The fail-open behaviour during transient Staffbase outages is intentional: a 5-minute Staffbase outage must not lock thousands of active users out of the plugin. The next post-recovery request reconciles.
- `STRICT_REFERENCES_BLOCKING=true` exists for deployments with stricter requirements; the latency cost is documented and the knob is opt-in.

## Operational notes

- See [`.env.example`](../../.env.example) for all three TTL knobs.
- The `users.last_verified_at` column is populated by `revalidateAccessor()`; rows that have never been verified upstream (e.g. seeded via local-dev) will have `lastVerifiedAt = NULL` and revalidate on first authenticated request.
- Structured log events for monitoring: `auth.user_deleted` (sso middleware rejected the request), `revalidate.deleted` (cleanup ran), `revalidate.failed` (transient error, request continued), `references.failed` (background reference check failed).
- Sees [ADR-0011](0011-user-cache-lifecycle.md) for the cache table and `displayUser()` rendering contract that this builds on.
