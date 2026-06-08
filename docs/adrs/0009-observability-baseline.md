# ADR-0009 — Observability baseline (logging + metrics contract for cc-tech plugins)

**Status:** Proposed
**Date:** 2026-05-22

## Context

The `cc-custom-plugin-glossary` v1 build (companion repo) ran a Phase F observability audit on dev/de1 against itself + `cc-custom-plugin-applaunchpad`. Findings: handlers ship without domain logs, `http_requests_total{path}` carries raw URI labels (cardinality risk), DB queries and outbound Staffbase API calls have no app-side metrics, background-task outcomes are opaque, and the access-log middleware silently dominates 86% of dev log volume with probe/scraper noise.

Each finding is generic to the template — every plugin scaffolded from this repo inherits the same gaps. Codifying the contract here means new plugins start observable instead of being audited later.

This ADR ports the relevant decisions from `cc-custom-plugin-glossary` ADRs 0010 (push channels), 0012 (strict-GDPR user lifecycle), and 0013 (logging contract) into a single template-level baseline. Plugin authors should treat this as the default and only deviate when documented.

## Decision

### 1. Structured per-handler logging

Every route file and notable internal lib instantiates `createLogger("<module>")` once at file top. Module names are dot-friendly identifiers, currently in use across the reference plugin:

| Module | Source | Notes |
|--------|--------|-------|
| route names (`entries`, `categories`, `ideas`, `widget`, `admin`, `settings`, …) | `server/src/routes/*.ts` | one per route file |
| `sso` | `server/src/middleware/sso.ts` | auth.success (debug), auth.user_deleted (warn), revalidate.* |
| `push` | `server/src/lib/pushNotifications.ts` | push.attempt / .success / .failure / .error / .skipped |
| `user-cache` | `server/src/lib/user-cache.ts` | upsert (debug) + revalidate events |
| `changelog` | `server/src/lib/changelog.ts` | changelog.entry mirror of every audit DB write |
| `sessions` | `server/src/lib/sessions.ts` | create / cleanup / user_invalidate / hash_invalidate |
| `api` | `server/src/lib/staffbase-api.ts` | outbound Staffbase API request/response detail |
| `sql` | `server/src/db/client.ts` | per-query metric + (when `LOG_SQL=true`) verbose query string |
| `background` | `server/src/index.ts` | setInterval-driven tasks |
| `startup` | `server/src/index.ts` | bootstrap / shutdown |
| `http` | `server/src/middleware/access-log.ts` | every non-probe request |
| `error-handler` | global error middleware | unhandled exceptions only |

Each line carries `event` (dot-namespaced, kebab-cased) + `userId` + `instanceId` when auth context exists, plus context fields:

```ts
log.info("entries.list", { event: "entries.list", userId, instanceId, page, limit, sort });
// ...
log.info("entries.list.ok", { event: "entries.list.ok", userId, instanceId, count: data.length });
// or on validation reject:
log.warn("entries.list.invalid", { event: "entries.list.invalid", userId, instanceId, reason: "category_required" });
```

Unhandled exceptions are NOT double-logged — global `error-handler` middleware emits a single `level=error` line with the stack.

Free-text user input (entry term/definition, category name, search query) MUST NOT be logged. Only counts, IDs, and structural flags. The DB row + `changelog` audit table are the source of truth for content.

### 2. Log levels & dev-vs-prod policy

- **Prod default:** `LOG_LEVEL=INFO`. Per-request `debug` (e.g. `auth.success`, `user-cache.upsert`) suppressed.
- **Dev / stage default:** `LOG_LEVEL=DEBUG`. Per-request `debug` visible, useful for tracing draft-PR feature flows.
- **PR `dev` label deploys:** mops `dev/de1` overlay overrides `LOG_LEVEL=DEBUG` (see [`mops/kubernetes/namespaces/<plugin>/dev/de1/<plugin>-helm.yaml`](#) for the override shape).
- **Investigation override:** `LOG_LEVEL=TRACE` for short scoped investigations; document in incident write-up.

Level meanings:

- `debug` — high-volume / per-request: `auth.success`, `user-cache.upsert`.
- `info` — handler entry + success, state transitions, push sends, every CRUD.
- `warn` — business rejections (4xx returns), validation failures, partial successes, deleted-upstream signals.
- `error` — unexpected upstream failures the handler swallowed but ops should see. Reserved for actionable signals.
- `trace` — fire-and-forget swallowed errors; off by default.

### 3. Access-log middleware

Skip uptime probes + Prometheus scrape paths (audit found these = ~86% of dev log volume). At minimum:

```ts
const SKIP_PATHS = new Set(["/health", "/probe", "/metrics", "/api/metrics"]);
```

Adapt to the actual probe + scrape paths your chart wires. Verify post-deploy by tailing logs for ~5 min — `module=http` traffic to skip paths should be zero.

### 4. Metrics contract (RED + saturation)

The reference plugin exposes a hand-rolled Prometheus text endpoint at `/api/metrics` (Apperator `metrics: enabled: true` auto-creates the `VMServiceScrape`). The baseline metric set:

| Metric | Labels | Type | Purpose |
|--------|--------|------|---------|
| `app_info` | `arch`, `bun_version`, `node_env` | gauge | Build marker |
| `http_requests_total` | `method`, `path`, `status` | counter | Request rate per route. **`path` MUST be the matched route template (e.g. `/api/entries/:id`), not the raw URI.** Use `hono/route` `routePath()` helper. |
| `http_request_duration_ms_bucket/sum/count` | `method`, `path`, `status`, `le` | histogram | Latency P50/P95/P99. Buckets: `10, 25, 50, 100, 250, 500, 1000, 2500, 5000` ms. |
| `http_requests_in_flight` | — | gauge | Current concurrency. Increment/decrement around `next()` in access-log middleware. |
| `background_tasks_total` | `task`, `status` | counter | Background-task outcomes (`success` / `failure`). Plus legacy `background_task_errors_total{task}` retained for back-compat dashboards. |
| `background_task_duration_ms_*` | `task`, `status`, `le` | histogram | Background-task duration. |
| `db_queries_total` | `operation` (select / insert / update / delete / transaction / other), `status` | counter | Per-query metric via Drizzle logger. (Per-query *duration* histogram requires per-call-site wrapping — out of baseline; revisit when fragmented latency becomes a problem.) |
| `outbound_http_requests_total` | `target` (e.g. `staffbase-api`), `endpoint` (templated, not raw URI), `status` | counter | Calls to Staffbase + other upstream HTTP. Wrap the upstream fetch wrapper. |
| `outbound_http_request_duration_ms_*` | `target`, `endpoint`, `le` | histogram | Upstream latency. |

Routes that emit no metric beyond the access-log middleware do not need any per-handler code — the middleware covers them automatically.

### 5. Engineer-facing query reference

Ship a `docs/log-queries.md` table per plugin: one row per `event=*` value × five env columns (`dev/de1`, `stage/de1`, `prod-de1`, `prod-au1`, `prod-us1`). Each cell is a pre-filled Grafana Explore URL with URL-encoded LogsQL.

Generation is mechanical — the reference plugin uses a Python helper that walks the event list and emits the table. New plugins should fork the helper rather than hand-roll URLs.

Cross-link `docs/log-queries.md` from `docs/links.md`'s "Common Log Queries" section.

### 6. Module-name discipline

Adding a new logger means adding the module to this ADR's table. Avoid one-off modules ("misc", "util") — pick a real noun matching the source file or domain concept. `module` is the highest-cardinality grouping dimension in dashboards; keep it stable.

## Alternatives considered

- **OpenTelemetry traces only.** Spans correlate well but don't solve at-rest log search. No deployed OTLP collector today. Re-evaluate when org-wide OTel lands.
- **Vendor logging library (pino / winston).** Reference plugin uses an in-house `createLogger` to keep dependency surface small. Pino's perf advantage doesn't matter at Bun-level throughput.
- **`changelog` table as sole audit source.** It's persistent and queryable but slow to search and limited to mutations. Logs complement, don't replace.
- **DB pool gauge** (postgres.js connection state). Skipped at baseline — postgres.js v3 has no stable public API for pool stats. Revisit if pool exhaustion becomes a recurring incident pattern.

## Consequences

- New plugins start with zero observability technical debt.
- Engineers debug incidents via Grafana Explore using pre-built event-level links; the `event=*` taxonomy is consistent across plugins.
- PR review checklist: every new route handler emits entry + ok + invalid logs; every new metric documented in this ADR's table.
- Storage cost is bounded by Victoria Logs retention (~30 d); the access-log skip-list keeps probe noise out.
- Module renames are breaking changes for dashboards — discuss before doing them.

## Reference

- Reference plugin: `Staffbase/cc-custom-plugin-glossary` v1, which derived this contract via its own ADRs 0010 / 0012 / 0013 and the Phase F audit.
- Companion docs in this repo:
  - [`docs/observability/logging-guidelines.md`](../observability/logging-guidelines.md) — practical how-to for new plugins.
  - [`docs/log-queries.md`](../log-queries.md) — template's own log-queries reference.
