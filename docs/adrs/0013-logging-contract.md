# ADR-0013 — Logging contract: per-handler structured events with `module` + `event` fields

**Status:** Accepted
**Date:** 2026-05-22

## Context

During the initial rollout of the template's first downstream plugin, an audit found that most server handlers had **zero domain logs**: only the HTTP access-log middleware and the global error handler emitted to stdout. Incident investigation via Victoria Logs / Grafana yielded HTTP traces but no context about *what* was being done, *for which user/instance*, or *why* a request branched the way it did. The infrastructure was sound (`createLogger`, JSON formatter, structured fields, log levels) but the handlers did not deploy it.

ADR-0010 (push channels) and ADR-0012 (strict-GDPR user lifecycle) introduced structured `push.*` + `revalidate.*` + `auth.user_deleted` events shipped at known levels. The pattern worked. Generalizing it is the right next step.

## Decision

All server handlers and notable internal libs adopt a single logging contract.

### Logger instantiation

One `createLogger` call per file, at module top, with a stable `module` name:

```ts
import { createLogger } from "../lib/logger.ts";
const log = createLogger("<resource>");
```

Module names are dot-friendly identifiers. The template ships with the following infrastructure modules; downstream plugins add one module per route file:

| Module | Source | Notes |
|--------|--------|-------|
| `<resource>` (one per route file) | `server/src/routes/*.ts` | downstream plugins choose names per domain resource |
| `widget` | `server/src/routes/widget-api.ts` (if present) | viewer-facing read endpoints |
| `sso` | `server/src/middleware/sso.ts` | covers `auth.success`, `auth.user_deleted`, `revalidate.*` ([ADR-0012](0012-strict-gdpr-user-lifecycle.md)) |
| `push` | `server/src/lib/pushNotifications.ts` | [ADR-0010](0010-push-channels.md) |
| `user-cache` | `server/src/lib/user-cache.ts` | upsert + revalidate events |
| `remote-call` | `server/src/lib/remote-calls.ts` | inter-route helpers (`cleanupDeletedUser`, `deleteInstance`) |
| `changelog` | `server/src/lib/changelog.ts` | mirrors every DB audit-row write |
| `sessions` | `server/src/lib/sessions.ts` | create / cleanup / user_invalidate / hash_invalidate |
| `api` | `server/src/lib/staffbase-api.ts` | outbound Staffbase API calls (request/response detail at debug/trace) |
| `sql` | `server/src/db/client.ts` | per-query log line when `LOG_SQL=true`; per-query Prometheus counter always on |
| `background` | `server/src/index.ts` | setInterval-driven tasks (user-cache refresh, session cleanup) |
| `startup` | `server/src/index.ts` | server bootstrap / shutdown events |
| `http` | `server/src/middleware/access-log.ts` | every non-probe request; access-log shape |
| `error-handler` | `server/src/app.ts` global error middleware | unhandled exceptions only |

Each line carries this `module` value via `createLogger("<module>")`.

### Event shape

Each log line carries:

| Field | Required | Notes |
|-------|----------|-------|
| `event` | yes | dot-namespaced, kebab-cased identifier — `<module>.<action>[.<outcome>]`. Examples: `<resource>.list`, `<resource>.create.ok`, `<resource>.create.invalid`, `<resource>.approve.invalid`, `widget.<resource>.ok`, `auth.success`, `auth.user_deleted`. |
| `userId` | yes (auth'd) | from `c.var.user.userId` |
| `instanceId` | yes (auth'd) | from `c.var.user.instanceId` |
| context fields | as relevant | `<resource>Id`, `count`, `total`, `page`, `limit`, `from`, `to`, `reason`, `role`, `authPath`, `format`, `dryRun`, `hasSearch`, `hasFilter` … |

Free-text user input (any domain-text field a user typed) MUST NOT be logged — only counts, IDs, and structural flags. The DB row + the changelog audit record are the source of truth for content.

### When to emit

Three log calls per handler — entry, success, business-error:

```ts
log.info("<resource>.list", { event: "<resource>.list", userId, instanceId, page, limit, sort, hasSearch });
// ... handler runs ...
log.info("<resource>.list.ok", { event: "<resource>.list.ok", userId, instanceId, count: data.length, total });
// or on validation/business reject:
log.warn("<resource>.list.invalid", { event: "<resource>.list.invalid", userId, instanceId, reason: "filter_required" });
```

Unhandled exceptions are NOT double-logged — the global error middleware emits an `module=error-handler` line with the stack. Handler-level `try/catch` is reserved for cases where the handler can recover and continue.

### Log levels

- **`debug`** — high-volume / per-request signals that are interesting on dev but noise in prod: `auth.success`, `user-cache.upsert`. Default-off in prod.
- **`info`** — handler entry + success: every CRUD operation, every list response, every state transition (approve/reject), every push send.
- **`warn`** — business rejections (4xx returns), validation failures, partial successes (`import.partial`), deleted-upstream signals (`revalidate.deleted`, `auth.user_deleted`).
- **`error`** — unexpected upstream failures, fetch errors that the handler swallowed but ops should see. Reserved for genuinely actionable signals.
- **`trace`** — fire-and-forget swallowed errors (e.g. `ensureUserInCache` upstream miss). Default-off, available with `LOG_LEVEL=TRACE`.

### Dev vs prod verbosity

- **Prod default:** `LOG_LEVEL=INFO`. Per-request `debug` (auth.success) suppressed.
- **Dev / stage default:** `LOG_LEVEL=DEBUG`. Per-request `debug` visible, useful for tracing draft-PR feature flows.
- **PR `dev` label deploys:** also `LOG_LEVEL=DEBUG`. Operationalise via the mops dev/de1 overlay.
- **Investigation override:** `LOG_LEVEL=TRACE` for short, scoped investigations. Document in the incident write-up.

### What does NOT change

- HTTP access log (`module=http`) — already structured, every request, every status. Not duplicated by domain logs.
- Global error handler (`module=error-handler`) — every unhandled exception. Not duplicated.
- Changelog DB writes via `lib/changelog.ts` — the persistent audit record. Domain logs are a fast-path observability mirror, not a replacement.

## Reference implementations

- [`server/src/middleware/sso.ts`](../../server/src/middleware/sso.ts) — auth.success (4 paths) + auth.user_deleted + ADR-0012 revalidate.* events.
- [`server/src/lib/pushNotifications.ts`](../../server/src/lib/pushNotifications.ts) — `push.attempt`, `push.success`, `push.failure`, `push.error`, `push.skipped` ([ADR-0010](0010-push-channels.md)).
- Any domain route file under `server/src/routes/` — `<resource>.list[.ok|.invalid]`, `<resource>.get[.ok|.not_found]`, `<resource>.create[.ok|.invalid]`, etc.

## Alternatives considered

- **OpenTelemetry traces only.** Spans solve correlation but not at-rest search. The template ships a Bun + Hono service without a deployed OTLP collector today. Defer to an org-wide push.
- **DB-only audit (`changelog` table) without domain logs.** Already in place but slow to query and limited to mutation operations. Doesn't cover GETs, doesn't cover failed validations.
- **Log only on error (drop success logs).** Rejected — the absence of a success log is a question ("did this request succeed quietly or fail silently?"), not an answer.

## Consequences

- Every endpoint produces 1-3 structured log lines per request (entry + outcome). Storage cost is bounded by retention (~30 d in Victoria Logs).
- Engineers can answer "did userA submit an idea on instanceB at 14:32?" with one Grafana Explore query; pre-filled links live in [`docs/log-queries.md`](../log-queries.md).
- New routes / handlers added in PRs must follow this contract. PR review checklist gains: "did the new handler log entry + ok + invalid?"
- Future plugins inheriting this template inherit the contract; per-plugin logging guidelines can be layered on top under each plugin's own `docs/`.
- Dev-vs-prod log-level mechanism is documented; the actual mops overlay change is tracked separately at deployment time.
