# How to verify Phase F instrumentation (F2 / F3 / F5 / F6 / F7 / F9)

Concrete checks per item, callable from three surfaces:

- **UI**: Grafana Explore in the relevant cluster
- **Terminal local**: `kubectl port-forward` to the plugin pod → `curl /api/metrics` + `grep`
- **Terminal via Claude**: ask Claude with a Grafana MCP server wired (`mcp__grafana-dev-de1__query_metrics` / `query_logs`, `mcp__grafana-stage-de1__*`, `mcp__grafana-prod-{de1,au1,us1}__*`)

All metric assertions below filter on `app="<PLUGIN_NAME>"`. Replace with `cc-custom-plugin-applaunchpad` to verify the same items in the launchpad PRs (#81, #82).

---

## F2 — Route templating

**Promise:** `http_requests_total{method,path,status}` uses the matched Hono route pattern, never the raw URI.

### UI (Grafana Explore)

Query (Prometheus / VictoriaMetrics datasource):

```promql
count by (path) (http_requests_total{app="<PLUGIN_NAME>"})
```

**Pass**: the `path` label values are matched patterns like `/api/items`, `/api/items/:id`, `/api/widget/foo`, `/api/metrics`, `/other` (or `/assets/*`, `/widget/*`, `/api/*` for unmatched buckets). Total distinct values bounded ≤ ~30.

**Fail**: you see `path` values containing UUIDs, slugs, or query strings (`/api/items/8a3f.../edit`, `/api/widget/items?term=foo`) → cardinality is unbounded again, route-template fix didn't ship or didn't get rebuilt.

### Local terminal

```bash
KUBECONFIG=<path-to-your-kubeconfigs>/kubeconfig-dev-de1.yaml kubectl -n <PLUGIN_NAME> port-forward deploy/<PLUGIN_NAME> 3000:http &
curl -s localhost:3000/api/metrics | grep '^http_requests_total' | awk -F'path="' '{print $2}' | awk -F'"' '{print $1}' | sort -u
```

Expect a short list of route templates.

---

## F3 — `db_queries_total{operation,status}`

**Promise:** Every Drizzle query increments a counter, labelled by operation and `ok|error`.

### UI

```promql
sum by (operation, status) (rate(db_queries_total{app="<PLUGIN_NAME>"}[5m]))
```

**Pass**: non-zero `operation` values (`select`, `insert`, `update`, `delete`) and `status="ok"` rows for any operation that ran. After a 4xx/5xx that bubbled up from the DB layer (or after the `readonly` user 28P01 issue), `status="error"` should also be present.

**Fail**: query returns 0 rows → counter never registered (always-on logger not attached) or pod hasn't yet rolled to a build that includes the Phase F instrumentation (cross-check `kubectl get deploy -o jsonpath='{.spec.template.spec.containers[0].image}'` against the merge commit on `main`).

### Local terminal

```bash
curl -s localhost:3000/api/metrics | grep '^db_queries_total'
# expect 4+ lines like: db_queries_total{operation="select",status="ok"} 142
```

---

## F5 — `outbound_http_requests_total{target,endpoint,status}` + duration histogram

**Promise:** Every call from `staffbaseFetch` records a counter + histogram. Transport-level failures recorded as `status="0"`.

### UI

```promql
sum by (target, endpoint, status) (rate(outbound_http_requests_total{app="<PLUGIN_NAME>"}[5m]))
```

**Pass when traffic exists**: rows like `target="backend-de1.staffbase.dev",endpoint="/api/users/:id",status="200"`. Will be **empty until first outbound call** — push notifications, SCIM lookup, etc.

How to force one (dev):
- Trigger an action that emits a push notification (push path), **or**
- Trigger SCIM cache miss for an unknown user (cache lookup → backend call).

Histogram side check:
```promql
histogram_quantile(0.95, sum by (le) (rate(outbound_http_request_duration_ms_bucket{app="<PLUGIN_NAME>"}[5m])))
```

### Local terminal

```bash
curl -s localhost:3000/api/metrics | grep '^outbound_http_requests_total'
```

Empty if no outbound traffic. Drive a request, then re-check.

---

## F6 — `recordBackgroundTask(task, status, durationMs)`

**Promise:** Background sweeps (user-cache reconcile, sessions cleanup, accessor revalidate) emit counter + histogram + structured `event` log line. `incBackgroundTask`/`incBackgroundError` preserved for back-compat.

### UI — metrics

```promql
sum by (task, status) (rate(background_tasks_total{app="<PLUGIN_NAME>"}[5m]))
```

**Pass**: rows like `task="user-cache.reconcile",status="ok"`, `task="sessions.cleanup",status="ok"`. After an injected failure also `status="error"`.

Duration histogram:
```promql
histogram_quantile(0.95,
  sum by (le, task) (rate(background_task_duration_ms_bucket{app="<PLUGIN_NAME>"}[5m]))
)
```

### UI — logs

In Victoria Logs explore:

```
k8s.namespace.name:<PLUGIN_NAME> _stream:"k8s.container.name=<PLUGIN_NAME>" module:"background"
```

Each successful sweep emits one structured line with `event=<task>.ok` and `durationMs=<N>`.

### Local terminal

```bash
curl -s localhost:3000/api/metrics | grep '^background_tasks_total\|^background_task_duration_ms'
```

---

## F7 — `http_requests_in_flight` gauge

**Promise:** Gauge incremented/decremented around `next()` in access-log middleware. Idle = 0, spikes during concurrent requests.

### UI

```promql
http_requests_in_flight{app="<PLUGIN_NAME>"}
```

**Pass at idle**: 0 across all pods.
**Pass under load** (run `ab -n 200 -c 10 https://<pod>/health`): briefly > 0, returns to 0.

### Local terminal

```bash
curl -s localhost:3000/api/metrics | grep '^http_requests_in_flight'
# http_requests_in_flight 0
```

---

## F9 — ADR-0013 module taxonomy

**Promise:** every structured log line carries a `module` value from the shipped module set. The canonical, up-to-date list lives in [ADR-0013 § "Logger instantiation"](../adrs/0013-logging-contract.md#logger-instantiation) — read it from there rather than hard-coding the set here (the count grows as new files instrument and this doc shouldn't shadow the ADR).

### UI — Victoria Logs

```
k8s.namespace.name:<PLUGIN_NAME> _time:1h | unique by (module)
```

**Pass**: each emitted module name matches the ADR-0013 list.

**Fail**: stray modules → instrumentation drift. Open a follow-up to add to ADR-0013.

### Local

```bash
KUBECONFIG=<path-to-your-kubeconfigs>/kubeconfig-dev-de1.yaml kubectl -n <PLUGIN_NAME> logs --tail=200 deploy/<PLUGIN_NAME> \
  | jq -r 'select(.module != null) | .module' \
  | sort -u
```

---

## Driving traffic for verification

F3/F5/F6/F7 need traffic to produce signal. Two paths:

1. **Browser smoke** (fastest): open the dev/de1 plugin URL, exercise a representative create + write + widget-fetch path. F2 + F3 fire on every request; F5 fires on push send + SCIM lookup; F6 fires when the next background tick runs.
2. **Synthetic from inside the cluster**: `kubectl exec` into a pod that has a Staffbase service-token JWT and `curl` the plugin endpoints. See `docs/observability/phase-f-findings.md` § "F-synthetic-traffic" for the three documented paths.

---

## After dev/de1 verification — repeat on stage

```
KUBECONFIG=<path-to-your-kubeconfigs>/kubeconfig-stage-de1.yaml kubectl ...
```

`mcp__grafana-stage-de1__*` queries work the same way.

---

## Links

- Phase F findings: [`phase-f-findings.md`](./phase-f-findings.md)
- ADR-0013 logging contract: [`../adrs/0013-logging-contract.md`](../adrs/0013-logging-contract.md)
- Module list (canonical): ADR-0013 § "Modules"
- Pre-filled Grafana / Victoria Logs Explore links: [`../log-queries.md`](../log-queries.md)
