# Logging

The plugin emits structured JSON log lines to stdout. The Staffbase OTel Collector
picks them up automatically and forwards to VictoriaLogs. No infrastructure changes are
needed to start seeing logs.

---

## Pipeline

```
App stdout (JSON)
  → OTel Collector (auto-collects from pod stdout)
    → VictoriaLogs
      → Observatory (Grafana Explore)
```

All fields described here are queryable via [LogsQL](https://docs.victoriametrics.com/victorialogs/logsql/) in Observatory. See [links.md](../links.md) for pre-filled query shortcuts.

---

## Log format

Each line is a single JSON object. Example (production):

```json
{
  "_time": "2026-04-13T10:24:01.123Z",
  "level": "INFO",
  "msg": "Request completed.",
  "module": "http",
  "http.request.method": "GET",
  "url.path": "/api/settings",
  "http.response.status_code": 200,
  "http.request.duration": 12,
  "http.request.header.x-request-id": "abc-123"
}
```

In local dev (`IS_LOCALDEV=true` or `LOG_FORMAT=pretty`) output is colour-coded human-readable:

```
10:24:01 INFO  [http] Request completed. http.request.method=GET url.path=/api/settings http.response.status_code=200 http.request.duration=12
```

---

## Field reference

| Field                              | Type   | Description                                                  |
| ---------------------------------- | ------ | ------------------------------------------------------------ |
| `_time`                            | string | ISO 8601 timestamp (VictoriaLogs time field)                 |
| `level`                            | string | `TRACE` \| `DEBUG` \| `INFO` \| `WARN` \| `ERROR`                       |
| `msg`                              | string | Static message string. Promoted to OTel `log.body` by the Staffbase OTel Collector and stored as `_msg` in VictoriaLogs — query as `_msg:"..."` in LogsQL. |
| `module`                           | string | Originating component (see table below)                      |
| `http.request.method`              | string | HTTP verb — access-log entries only                          |
| `url.path`                         | string | Request path without query string                            |
| `http.response.status_code`        | number | HTTP status — access-log entries only                        |
| `http.request.duration`            | number | Wall-clock time in milliseconds                              |
| `http.request.header.x-request-id` | string | Istio-injected correlation ID (present when Istio is active) |

> **Distributed tracing**: `x-request-id`, `traceparent`, and `tracestate` are extracted from every inbound request and forwarded as headers on outbound `staffbaseFetch` calls (Users API + Media API). This allows an Observatory query on `http.request.header.x-request-id` to correlate the inbound plugin request with the corresponding downstream Staffbase API call.

---

## Module values

| `module`        | File                       | Events logged                                                   |
| --------------- | -------------------------- | --------------------------------------------------------------- |
| `http`          | `middleware/access-log.ts` | Every non-health, non-metrics request; TRACE also includes full request headers (Authorization redacted) and `?jwt=` value |
| `html`          | `routes/html.ts`           | TRACE on every SSO page load (/, /favorites, /admin) — decoded JWT claims + redacted raw token |
| `startup`       | `index.ts`                 | Server start, SIGTERM, unhandled rejections                    |
| `background`    | `index.ts`                 | Background task runs and errors                                 |
| `gdpr`          | `app.ts`                   | GDPR delete intercept — unexpected JWT sub, validation failure  |
| `error-handler` | `app.ts`                   | Unhandled server errors (500)                                   |
| `sso`           | `middleware/sso.ts`        | JWT validation failures; TRACE on every successful JWT validation (`jwt` field is redacted by default); also emits `event:"jwt.branch_id.missing"` (WARN) when a JWT lacks the `branch_id` claim — auth still succeeds but branch-specific features degrade |
| `user-cache`    | `lib/user-cache.ts`        | SCIM refresh cycle — progress, errors, per-user issues; TRACE per-user cache update (non-secret); also `event:"cache.invalidate.single"` when the editor endpoint `DELETE /api/users/:userId/cache` is called |
| `api`           | `lib/staffbase-api.ts`     | Outgoing Staffbase API calls (requires `LOG_API=true`); TRACE also logs full req/resp detail with Authorization redacted |
| `remote-call`   | `lib/remote-calls.ts`      | GDPR instance deletion                                          |
| `changelog`     | `lib/changelog.ts`         | Audit log write failures (error-only — writes are best-effort; uses structured logger so `module:="changelog"` is queryable) |
| `users`         | `routes/users.ts`          | Session invalidation                                            |
| `media`         | `routes/media.ts`          | Media upload errors                                             |
| `sql`           | `db/client.ts`             | SQL queries (requires `LOG_SQL=true`)                           |

---

## Environment variables

| Variable      | Default                             | Description                                                                            |
| ------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| `LOG_FORMAT`  | `json` (prod) / `pretty` (localdev) | `json` — one JSON line per event; `pretty` — coloured human-readable output            |
| `LOG_LEVEL`   | `INFO`                              | Minimum level to emit: `TRACE` \| `DEBUG` \| `INFO` \| `WARN` \| `ERROR`               |
| `LOG_API`     | `false`                             | When `true`, emit a `DEBUG` line for every outgoing Staffbase API request and response |
| `LOG_SQL`     | `false`                             | When `true` and `IS_LOCALDEV=true`, emit a `DEBUG` line for every SQL query            |
| `LOG_SECRETS` | `false`                             | ⚠️ **Localdev only.** When `true` alongside `IS_LOCALDEV=true`, disables PII redaction so raw JWT tokens, Authorization headers, and user IDs appear in TRACE output. Silently ignored in staging/production even if set. **Never paste logs produced under this flag into tickets, screenshots, or shared chat.** |

The format auto-detection logic is:

1. If `LOG_FORMAT=json` → JSON mode
2. If `LOG_FORMAT=pretty` → pretty mode
3. If neither is set: JSON mode in production (`IS_LOCALDEV` absent), pretty mode in local dev

---

## Usage — adding logs to a new module

```typescript
import { createLogger } from "../lib/logger.ts";

const logger = createLogger("my-module");

// Static message + context object
logger.info("Thing happened.", { entityId, count });
logger.warn("Upstream error.", { "http.response.status_code": res.status });
logger.error("Failed to do thing.", { message: (err as Error).message });
```

Rules:

- **Never log PII without gating**: use the `redact()` helper for JWT token values, Authorization headers, session IDs, email addresses, or full names. Raw values only pass through when `LOG_SECRETS=true` AND `IS_LOCALDEV=true`.
- Use a **static message string** (`msg`) — it maps to `_msg` in VictoriaLogs and is used for full-text search. Dynamic values go in context fields.
- Use **OTel semantic convention field names** where applicable (dotted: `http.request.method`, `url.path`, etc.)
- Prefer `message: (err as Error).message` over `error: err` to avoid logging full stack traces at WARN level

---

## Local development

Log output is visible immediately in the terminal when running `bun run dev`.

To enable SQL query logging:

```sh
LOG_SQL=true bun run dev
```

To enable Staffbase API request/response logging:

```sh
LOG_API=true bun run dev
```

To enable maximum-detail logging (TRACE level + full PII/JWT in output):

```sh
IS_LOCALDEV=true LOG_LEVEL=TRACE LOG_SECRETS=true LOG_API=true LOG_SQL=true bun run dev
```

> ⚠️ **Warning**: logs produced under `LOG_SECRETS=true` contain raw JWT tokens, user IDs, and Authorization headers. Do not paste them into GitHub issues, Slack, or any other shared channel.

To test production JSON format locally:

```sh
LOG_FORMAT=json bun run dev
```

---

## Metrics

The server exposes Prometheus text format metrics at `/api/metrics` (unauthenticated).
This endpoint is scraped automatically by the Staffbase VMServiceScrape created when
`metrics: enabled: true` is set in the mops Apperator CR.

Key metrics:

| Metric                         | Type      | Labels                               |
| ------------------------------ | --------- | ------------------------------------ |
| `http_requests_total`          | counter   | `method`, `path`, `status`           |
| `http_request_duration_ms`     | histogram | `method`, `path`                     |
| `background_tasks_total`       | counter   | `task`                               |
| `background_task_errors_total` | counter   | `task`                               |
| `app_info`                     | gauge     | `version`, `node_env`, `bun_version` |
