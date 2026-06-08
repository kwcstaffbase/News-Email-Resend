# ADR-0011 — User cache lifecycle (eager fill + GDPR-safe reconciliation)

**Status:** Accepted
**Date:** 2026-05-21

## Context

The plugin maintains a per-instance `users` table acting as a SCIM cache (firstName, lastName, userName, indexed by `instanceId + userId`). Filling that cache only on user login (typical pattern at first iteration) causes two correctness gaps:

1. **Cross-user references missed.** When user A creates a domain record, user A's row is cached. Editor B's view of the list joins on A's `userId` — if A has never logged in via the plugin (only via Staffbase proper), the LEFT JOIN misses and the client falls back to rendering A's opaque `userId`.
2. **No lifecycle handling.** SCIM renames in Staffbase eventually flow through a background `refreshAllUsers()` pass, but there is no clear path for GDPR-delete cleanup at the rendered display layer beyond "the JOIN misses and we show the userId."

A common workaround is to carry a denormalized snapshot column on the domain table (e.g. `<domain_table>.submitted_by_user_name`). That pattern leaks PII after a GDPR delete and goes stale on rename, so it is rejected here.

## Decision

Keep the cache as the single source of truth. Make it always-correct via three forces, and remove the denormalized column.

- **Eager fill at write time.** New helper `ensureUserInCache(instanceId, userId)` in `server/src/lib/user-cache.ts`. Idempotent: returns immediately if a row exists; on miss fetches the user from Staffbase `/api/users/:id` and upserts. Failures are logged at TRACE and swallowed — writes never block on Staffbase availability. Available to be wired into write handlers that record a `userId` (creation, update, approval, and any state-transition routes — for both the actor and any referenced target user). The helper ships exported + tested in the template; wire it into specific routes as you add foreign-userId-referencing writes (the canonical cache fill paths in the template are the background `refreshAllUsers()` loop + the per-request `revalidateAccessor()` gate).
- **Reconciliation on background refresh.** Existing `refreshAllUsers()` already iterates every cached user per instance and calls `cleanupDeletedUser(userId)` when Staffbase returns 404 for that userId. Because the loop visits every cached entry, orphans are removed deterministically on each refresh cycle. No batch DELETE pass was needed.
- **Drop any denormalized snapshot column.** A follow-up migration drops any denormalized `*_user_name` column from domain tables. List/get handlers LEFT JOIN `users` on `(instance_id, <user_id_column>)` and return `<role>FirstName`, `<role>LastName`, `<role>UserName` (computed) from the join — nullable on cache miss.
- **Render via `displayUser(row, t)` helper.** New `client/src/lib/users.ts` exports a total function with the cascade `firstName + lastName` → `userName` → `t("user-unknown")`. **By contract the helper cannot return a userId.** All admin + viewer render sites call this helper instead of `|| userId` / `?? "—"` fallbacks. New i18n key `user-unknown` added to all locales in both the `admin` and `<plugin>` namespaces.

## Alternatives considered

- **Row-level denormalization at write time** (mirror `submittedByUserName` and similar columns onto every domain table). Rejected — leaks PII after GDPR delete; goes stale on rename; requires schema churn.
- **Render-side fallback only, no cache fill.** Rejected — cross-user references still render "Unknown user" even when the referenced user exists in Staffbase, until they happen to log in.
- **Batch DELETE on each refresh pass.** Considered, but the existing per-user 404 → `cleanupDeletedUser` flow already removes orphans during the refresh. Adding a parallel batch DELETE would be redundant.

## Consequences

- SCIM rename in Staffbase reflects in the rendered name within one refresh cycle (cache row updated by the existing upsert path).
- GDPR delete in Staffbase removes the cache row on next refresh; `displayUser` then returns the localized "Unknown user" string.
- User IDs cannot leak into rendered UI — the helper has no branch that returns one.
- Write handlers are slightly more expensive (one extra round-trip to Staffbase for users not yet cached) but the work is fire-and-forget; write latency is unaffected.
- Domain tables are schema-symmetric (no denormalized name columns anywhere); future user-display work changes one helper and one set of i18n keys, not N table snapshots.

## Superseded reconciliation cadence

The 2.5h background refresh originally specified here was insufficient to meet GDPR Article 17 expectations on its own. [ADR-0012](0012-strict-gdpr-user-lifecycle.md) extends this cache with per-request accessor revalidation (TTL 60 s) and per-render reference revalidation (TTL 5 min), and tightens the background sweep cadence to 1.5 h. The `users` table gained a `last_verified_at` column to track per-row TTL for the new layers.
