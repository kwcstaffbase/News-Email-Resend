# ADR-0014 — Observability hardening (cost, dashboards, alerts, kobs for cc-tech plugins)

**Status:** Proposed
**Date:** 2026-05-23

## Context

ADR-0009 codified the **app-side** observability contract: structured per-handler logging, RED metrics on `/api/metrics`, access-log skip-list, module-name discipline. That contract gives the platform something to scrape and search, but does not — by itself — produce any of the things an on-call engineer actually opens during an incident:

- a **per-plugin Grafana dashboard** that bundles HTTP RED, resource saturation, runtime, outbound, and cost in one place;
- a **kobs Application** view stitching logs, traces, metrics, K8s resources, and runbooks for the namespace;
- **alerts** routed to Slack / incident.io with team aliases, severities, runbook links;
- a **blackbox uptime + TLS probe** that catches the hard-down case Istio metrics cannot see;
- a **cost view** attributing CPU/memory/network spend to the plugin namespace;
- an **outbound HTTP counter** + **runtime saturation gauges** (event loop lag, heap, GC) so cost and latency causes are visible alongside symptoms.

The mops platform already provides the building blocks. A 2026-05-23 audit across `mops/docs/operate-monitor/*`, the Backstage redbook `operate-monitor/grafana/*` pages, and the existing `cc-custom-plugin-{applaunchpad,glossary,abbreviations,rewards-dashboard}` namespaces found:

- `cc-custom-plugin-applaunchpad` and `cc-custom-plugin-glossary` ship `slo-sloth.yaml` + a generic `application.yaml` and rely on Apperator's implicit `VMServiceScrape` (`metrics.enabled: true`).
- Neither has an explicit `VMServiceScrape`, `GrafanaDashboard` CR, `GrafanaFolder` CR, kobs `Application` CR, `GrafanaAlertRuleGroup`, blackbox probe, or runbook dashboard.
- The template repo has no mops namespace at all yet; bootstrap (see `cc-custom-plugin-bootstrap` skill) is the obvious place to scaffold the full observability bundle alongside the chart + Vault + CuCu steps.
- Best-shape exemplars in mops to clone from: **`reloader`** (small operator, full stack), **`tfy-llm-gateway`** (service with VMServiceScrape + Sloth + dashboards), **`conntrack-stats-exporter`** (minimal exporter with dashboard CR).

The platform stack the contract has to land on:

| Layer | Tool | Notes |
|---|---|---|
| Metrics store | VictoriaMetrics (vmagent + vmselect) | scrape via `VMServiceScrape` CRD |
| Logs | OTel Collector → VictoriaLogs (LogsQL) | 30 d GDPR retention; auto-collected stdout/stderr |
| Traces | OTel Collector → VictoriaTraces | 5 d retention; OTLP opt-in |
| Dashboards | Grafana ("Observatory") | provisioned via `GrafanaDashboard` + `GrafanaFolder` CRs |
| Alerts (SLO) | Sloth (`PrometheusServiceLevel`) → vmalert → Alertmanager → incident.io | team label → incident.io alias → Slack/PD |
| Alerts (non-SLO) | `GrafanaAlertRuleGroup` (Grafana-native) | routed via `GrafanaNotificationPolicy` matchers |
| Cost | OpenCost on AKS Cost Analysis | dashboard UID `fARuElT4z` per env |
| Blackbox | blackbox-exporter | probes in `mops/.../blackbox-exporter/{env}/{region}/` |
| Unified pane | kobs `Application` CR | logs + metrics + K8s + traces + runbooks per namespace |

## Decision

The template scaffolds — and downstream plugins inherit — a fixed bundle of observability artefacts split into two locations: **app-side** (this repo) and **mops-side** (cross-repo PR opened by the bootstrap skill).

### 1. App-side additions (this repo)

#### 1.1 Runtime saturation metrics

Extend `/api/metrics` (ADR-0009 table) with process-level gauges. Bun exposes the same `process.*` and `performance.*` surface as Node, so a hand-rolled collector emits:

| Metric | Type | Source |
|---|---|---|
| `nodejs_eventloop_lag_ms` | gauge | `perf_hooks` `monitorEventLoopDelay()` (Bun-compatible) |
| `nodejs_heap_used_bytes`, `nodejs_heap_total_bytes` | gauge | `process.memoryUsage()` |
| `nodejs_external_bytes`, `nodejs_rss_bytes` | gauge | `process.memoryUsage()` |
| `nodejs_active_handles`, `nodejs_active_requests` | gauge | `process._getActiveHandles/Requests` (best-effort) |
| `process_uptime_seconds` | gauge | `process.uptime()` |

Sampled once per scrape (lazy collection inside the `/api/metrics` handler). No background interval — keeps cost flat.

#### 1.2 Outbound HTTP counter is mandatory baseline

ADR-0009 listed `outbound_http_requests_total` + duration histogram as "wrap the upstream fetch wrapper". Promote from optional to **required for every plugin that calls Staffbase API or any third party**. Label set: `target` (logical name, e.g. `staffbase-api`, `azure-translator`), `endpoint` (templated path, never raw URI), `status`. Implementation lives in `server/src/lib/staffbase-api.ts` and any other client wrapper.

Rationale: cost attribution for third-party APIs + visibility into the most common production failure mode (upstream timeouts / 5xx) — both invisible from Istio metrics alone.

#### 1.3 OTel-aligned log keys

Logs already emit JSON to stdout; the OTel Collector adds `service.namespace`, `service.name`, `k8s.*`. Align application-emitted keys with OTel semconv so dashboard panels work without per-plugin field remapping:

- `http.request.method`, `http.response.status_code`, `http.route`, `url.path`
- `error.type`, `error.message` (no stack in `error.message` — keep stack in dedicated `error.stack`)
- continue emitting `event`, `module`, `userId`, `instanceId` (Staffbase-specific, no semconv equivalent)
- keep top-level `msg` (NOT `_msg` — collides with VictoriaLogs reserved field; bug already fixed in glossary)

#### 1.4 Trace header propagation

Outbound fetches (Staffbase API client + any other) must forward incoming `traceparent`, `tracestate`, `x-request-id`, `x-b3-*` headers. Istio sidecar generates and propagates if the app forwards them; missing forwarding breaks correlation. Implement once in the fetch wrapper.

#### 1.5 `docs/observability.md`

Single onboarding page per plugin, replacing the scattered links currently in `docs/links.md` and `docs/log-queries.md`. Sections:

1. **Dashboards** — table of dashboard UIDs × env (cost, kobs, per-plugin overview, istio workload, k8s workload, SLO overview).
2. **Alerts** — list of alerts the plugin ships, severities, routing destination, runbook link.
3. **Logs** — link to `docs/log-queries.md`.
4. **Traces** — Explore URL filtered to `service.name=<plugin>`.
5. **Cost** — OpenCost link filtered to the namespace.
6. **On-call playbook** — first-five-minutes checklist.

### 2. Mops-side bundle (cross-repo PR)

Every plugin namespace under `mops/kubernetes/namespaces/cc-custom-plugin-<name>/base/` ships the following files. The template repo owns the canonical copies under `mops-overlay/` (consumed by the `cc-custom-plugin-bootstrap` skill, which renders them into the mops PR).

```
mops-overlay/
├── ns.yaml                              # namespace (already present)
├── cr.yaml                              # Apperator CR (already present)
├── helm.yaml                            # HelmRelease (already present)
├── postgres-helm.yaml                   # optional, only if DB needed
├── application.yaml                     # kobs Application CR (NEW; was plain placeholder)
├── vmservicescrape.yaml                 # NEW — explicit, do not rely on Apperator implicit
├── slo-sloth.yaml                       # SLO via Sloth, team label set
├── grafana-folder.yaml                  # NEW — per-plugin folder under folder-namespaces
├── grafana-alertrulegroup.yaml          # NEW — non-SLO alerts
├── dashboards/
│   ├── kustomization.yaml
│   └── dashboard-overview.yaml          # NEW — GrafanaDashboard CR
└── blackbox-probe.yaml                  # NEW — uptime + TLS probe
```

#### 2.1 Explicit `VMServiceScrape`

Do not rely on Apperator's `metrics.enabled: true` implicit scrape. Shipping an explicit `VMServiceScrape` makes the contract auditable in mops without reading Apperator state, and survives any future change to Apperator defaults.

```yaml
apiVersion: operator.victoriametrics.com/v1beta1
kind: VMServiceScrape
metadata:
  name: cc-custom-plugin-<NAME>
  namespace: cc-custom-plugin-<NAME>
spec:
  selector:
    matchLabels:
      app: cc-custom-plugin-<NAME>
  endpoints:
    - port: http
      path: /api/metrics
      interval: 30s
```

#### 2.2 `PrometheusServiceLevel` (Sloth SLO)

Base SLO every plugin ships: **99% availability** over 28d rolling window, measured on `istio_requests_total{response_code!~"5.."}` divided by total. `team: cc-tech` (or owning team) label required — drives incident.io routing. Burn-rate alerts auto-generated by Sloth controller into a `VMRule`.

Plugins with stricter latency SLOs add a second SLI on `istio_request_duration_milliseconds_bucket` (e.g. p95 < 500 ms).

Validation locally before commit: `sloth validate -i mops-overlay/slo-sloth.yaml`.

#### 2.3 `GrafanaFolder` + `GrafanaDashboard`

One folder per plugin under `parentFolderUID: folder-namespaces`. `uid: folder-cc-custom-plugin-<name>`. Kyverno policy `require-grafana-dashboard-specs` enforces `spec.uid` + `spec.folderUID` + `folder-` prefix.

Dashboard `cc-custom-plugin-<name>-overview` panels (rows top-to-bottom):

1. **Header** — text panel with markdown links: OpenCost ns view, Istio workload, K8s workload, kobs Application, logs Explore, SLO overview, plugin's `docs/observability.md`.
2. **HTTP RED (Istio)** — request rate, success %, p50/p95/p99 latency, response-code breakdown. Reuse library panels under `mops/kubernetes/namespaces/grafana/base/dashboards/panels/` with vars `namespace`, `istio_workload`.
3. **HTTP RED (app)** — `http_requests_total` + `http_request_duration_ms` from `/api/metrics`. Confirms Istio + app agree.
4. **Errors** — `istio_requests_total{response_code=~"5.."}` rate, plus VictoriaLogs panel `level=ERROR` count and recent error lines.
5. **Resources** — CPU req/limit/use, mem req/limit/use, restart count. Library panels `panel-cpu`, `panel-memory`.
6. **Runtime** — `nodejs_eventloop_lag_ms`, heap/RSS, GC count, active handles.
7. **Outbound** — `outbound_http_requests_total` by `target`, latency histogram by target. Highlights Staffbase API latency + 3rd-party cost.
8. **Background tasks** — `background_tasks_total{status}`, duration histogram.
9. **DB** — `db_queries_total` by operation + status. Pool gauge deferred per ADR-0009 alternatives.
10. **Cost** — OpenCost panel (CPU $/day, memory $/day, network egress $/day) for the namespace.

Variables: `cluster`, `namespace` (defaulted to plugin ns), `istio_workload`, `pod`. All multi-value.

#### 2.4 `GrafanaAlertRuleGroup` (non-SLO)

Alerts the SLO does not catch — symptoms outside the request path:

| Alert | Severity | Expression sketch | Routing |
|---|---|---|---|
| `PluginPodCrashLoop` | error | `rate(kube_pod_container_status_restarts_total[15m]) > 0.2` for 10 m | Slack `#cc-tech-alerts` |
| `PluginOOMKilled` | error | `kube_pod_container_status_terminated_reason{reason="OOMKilled"} == 1` | Slack `#cc-tech-alerts` + incident.io ticket |
| `PluginHighMemory` | warning | `container_memory_working_set_bytes / container_spec_memory_limit_bytes > 0.9` for 30 m | Slack only |
| `PluginEventLoopLagHigh` | warning | `nodejs_eventloop_lag_ms > 100` for 10 m | Slack only |
| `PluginOutboundFailing` | error | `sum(rate(outbound_http_requests_total{status=~"5..|0"}[5m])) / sum(rate(outbound_http_requests_total[5m])) > 0.05` | Slack + ticket |
| `PluginBlackboxDown` | critical | `probe_success == 0` for 5 m | incident.io page + Slack |
| `PluginCertExpiringSoon` | warning | `probe_ssl_earliest_cert_expiry - time() < 14*86400` | Slack |

Every alert carries the annotations the redbook policy requires: `summary`, `description`, `runbook_url`, `__dashboardUid__`, `__panelId__`. Runbook URLs point to `docs/observability.md#<anchor>` until per-alert runbook pages are written.

#### 2.5 `kobs Application` CR

Replaces the plain `application.yaml` placeholder with a kobs `Application` that pins:

- **Insights panels** — Prometheus queries for req rate, success %, p95 latency (single-pane health).
- **References** — logs (VictoriaLogs datasource pre-filtered by `service.namespace`), traces, K8s workload, repo URL, plugin's `docs/observability.md`, runbook dashboard.
- **Topology** — link to upstream `staffbase-api` + downstream DB so on-call sees the dependency graph.

#### 2.6 Blackbox probe

```yaml
apiVersion: monitoring.coreos.com/v1
kind: Probe   # or platform-equivalent CR used in mops/.../blackbox-exporter/
spec:
  module: http_2xx
  prober:
    url: blackbox-exporter.blackbox-exporter.svc:9115
  targets:
    staticConfig:
      static:
        - https://<plugin>.<cluster-domain>/health
```

Files live under `mops/kubernetes/namespaces/blackbox-exporter/{env}/{region}/` per platform convention, not under the plugin namespace. The template ships the YAML stub; bootstrap copies it to the right env/region paths.

### 3. Alert routing

- Register `cc-tech` (or the owning team alias) once in `infrastructure/incident-io/locals.tf`. Subsequent plugins reuse the alias.
- `team` label on every `PrometheusServiceLevel` and `GrafanaAlertRuleGroup.spec.rules[].labels.team`.
- Slack channel: `#cc-tech-alerts` (or per-team) — wire via `GrafanaNotificationPolicy` matcher in `mops/kubernetes/namespaces/grafana/base/notification-policies/`.
- Email: through incident.io escalation policy (no direct Grafana → email).
- Cost reports: ADR0012 (mops) ships a monthly cost + utilization Slack + email digest. Add the `cc-custom-plugin-*` namespaces to the digest recipient list (one-line PR against the cost-report config).

### 4. Bootstrap integration

The `cc-custom-plugin-bootstrap` skill already drives scaffolding + cross-repo PRs + Vault + CuCu. It picks up `mops-overlay/` from this repo and produces the mops PR with the bundle above. The skill must:

1. Substitute `<NAME>` and team alias placeholders.
2. Open the mops PR with the full bundle, not just the helm chart.
3. Open a tiny PR against `infrastructure/incident-io/locals.tf` if the team alias is missing (idempotent — no-op when alias exists).
4. Surface the dashboard UID + observatory URLs into the new plugin's `docs/observability.md` (rendered, not hand-edited).

### 5. Reference dashboard UIDs (env table)

To be embedded in every plugin's `docs/observability.md`:

| Dashboard | UID | dev/de1 | stage/de1 | prod/de1 | prod/us1 | prod/au1 |
|---|---|---|---|---|---|---|
| OpenCost | `fARuElT4z` | `grafana-de1.staffbase.dev` | `grafana-de1.staffbase.rocks` | `grafana-de1.staffbase.com` | `grafana-us1.staffbase.com` | `grafana-au1.staffbase.com` |
| Istio Workload | `UbsSZTDik` | observatory-de1.staffbase.dev | observatory-de1.staffbase.rocks | observatory-de1.staffbase.com | observatory-us1.staffbase.com | observatory-au1.staffbase.com |
| Istio Service | `LJ_uJAvmk` | (same domains) | | | | |
| Istio Mesh | `G8wLrJIZk` | (same domains) | | | | |
| K8s Workloads (plugin) | `ricoberger-kubernetes-app` (app, not dashboard UID) | (same domains) | | | | |
| SLO Overview | `slo-overview` | (same domains) | | | | |
| Plugin overview | `cc-custom-plugin-<name>-overview` | per env | per env | per env | per env | per env |

## Alternatives considered

- **Auto-generated dashboards via Grafonnet / dashboards-as-code.** Reproducible but adds a Jsonnet toolchain step the team does not run today. Hand-written `GrafanaDashboard` JSON in YAML keeps the dependency surface flat; switch when the dashboard count crosses ~15.
- **Single org-wide cc-tech dashboard.** Easier to maintain but worse for on-call (every alert lands on a noisy multi-plugin view). Per-plugin dashboards with shared library panels balance both.
- **Skip explicit `VMServiceScrape`, keep Apperator implicit only.** Less YAML, but invisible to mops audit. Explicit wins on auditability.
- **Skip blackbox.** Istio metrics catch most failures, but the "pod up, request path broken" failure (e.g. NetworkPolicy misconfigured) is exactly the one blackbox catches and Istio does not. Cost is negligible.
- **Use Apperator-managed dashboards.** Not consistent across mops; explicit `GrafanaDashboard` CRs match the redbook recommendation.
- **OpenTelemetry SDK in-app.** Deferred. App emits structured logs + Prometheus metrics; Istio sidecar produces traces. Adding an in-process OTel SDK doubles instrumentation cost without unique signal at current plugin size. Revisit when a plugin needs custom spans inside business logic.

## Consequences

- Every cc-tech plugin scaffolded from the template starts with: HTTP RED, resource saturation, runtime, outbound, cost, errors-from-logs all on a single overview dashboard, plus a kobs unified pane, plus seven alerts routed to Slack + incident.io.
- Cross-plugin consistency — same panel layout, same alert names, same severity ladder — keeps incident response cheap as the plugin count grows.
- Mops PR per plugin grows by ~7 small files; reviewed once via the template, low marginal cost.
- Dashboard JSON drift risk: library panels under `mops/.../grafana/base/dashboards/panels/` are the de-facto source. Any drift between plugin overviews and library panels is fixed by re-running bootstrap's dashboard render — not by editing the plugin's dashboard YAML by hand.
- Sloth SLO `team` label is now a hard requirement; missing it breaks incident.io routing. Bootstrap enforces it.

## Next steps (execution order)

1. **App PR (this repo)**
   1.1. Add `nodejs_*` runtime metrics collector to `/api/metrics` handler.
   1.2. Promote `outbound_http_requests_total` from optional to baseline; wire into `server/src/lib/staffbase-api.ts`.
   1.3. Forward trace headers in the upstream fetch wrapper.
   1.4. Add OTel-aligned log keys (`http.request.method`, `http.response.status_code`, `http.route`, `url.path`, `error.type`) to access-log middleware + error-handler.
   1.5. Write `docs/observability.md` (the canonical onboarding page); cross-link from `docs/links.md`.
   1.6. Add `mops-overlay/` directory with all canonical YAML stubs (VMServiceScrape, GrafanaFolder, GrafanaDashboard, GrafanaAlertRuleGroup, kobs Application, blackbox Probe, slo-sloth template).

2. **Bootstrap skill update**
   2.1. Extend `cc-custom-plugin-bootstrap` to render `mops-overlay/` into the mops PR with `<NAME>` + team alias substitution.
   2.2. Add idempotent `infrastructure/incident-io/locals.tf` PR step when team alias missing.
   2.3. Generate plugin's `docs/observability.md` from the dashboard UID table during bootstrap.

3. **Retrofit existing plugins (one PR each, against mops)**
   3.1. `cc-custom-plugin-applaunchpad` — add VMServiceScrape, GrafanaDashboard, GrafanaAlertRuleGroup, kobs Application, blackbox probe. Keep existing slo-sloth.yaml.
   3.2. `cc-custom-plugin-glossary` — same bundle.
   3.3. `cc-custom-plugin-abbreviations` — same bundle + slo-sloth.yaml (currently missing).
   3.4. `cc-custom-plugin-rewards-dashboard` — base is empty; full bundle.

4. **Cost-report subscription**
   4.1. PR against the mops cost-report recipient list to include `cc-custom-plugin-*` namespaces in the monthly Slack + email digest.

5. **Validation**
   5.1. Deploy template scaffold once to `dev/de1` end-to-end and walk through the seven alerts (force CrashLoop, force OOM, force 5xx, force outbound 5xx, force eventloop lag, kill blackbox target, expire cert) — confirm Slack + incident.io routing.
   5.2. Confirm OpenCost dashboard surfaces the new namespace within 24 h of first deploy.
   5.3. Tail VictoriaLogs for ~5 min to confirm access-log skip-list still excludes probes (regression check from ADR-0009).

## Per-plugin retrofit playbook

State of each cc-tech plugin as of 2026-05-23 and the concrete delta to land this ADR. "App-side" PRs target the plugin repo; "mops-side" PRs target `Staffbase/mops`. Effort is rough — ~hours of focused work, not elapsed time.

### Template (this repo) — `cc-custom-plugin-template`

**Current state.** Bun + Hono. Hand-rolled `/api/metrics`. Structured per-handler logging per ADR-0009. **No mops namespace exists yet.** No `mops-overlay/` directory in repo.

**App-side delta.**

| Item | File(s) | Effort |
|---|---|---|
| Runtime saturation metrics (`nodejs_eventloop_lag_ms`, heap, RSS, handles) | `server/src/lib/runtime-metrics.ts` (new), wire in `server/src/routes/metrics.ts` | 2 h |
| Promote `outbound_http_requests_total` + duration histogram | `server/src/lib/staffbase-api.ts`, any other client wrapper | 2 h |
| Forward `traceparent` / `tracestate` / `x-request-id` on outbound | `server/src/lib/staffbase-api.ts` (single wrapper) | 0.5 h |
| OTel-aligned log keys in access-log + error-handler | `server/src/middleware/access-log.ts`, global error middleware | 1 h |
| `docs/observability.md` onboarding page | new file; cross-link from `docs/links.md` | 1 h |
| `mops-overlay/` directory with canonical YAML stubs (all 7 files in §2 above) | new directory under repo root | 3 h |
| Update `docs/adrs/0009-observability-baseline.md` table: mark `outbound_http_*` as required (not optional) | edit | 0.2 h |
| Tests: `runtime-metrics` collector unit test; outbound counter integration test | `server/test/` | 1.5 h |

**Mops-side delta.** Create namespace `cc-custom-plugin-template` from scratch by running the (updated) `cc-custom-plugin-bootstrap` skill against itself. Lands the full bundle: `ns`, `cr`, `helm`, `application` (kobs), `vmservicescrape`, `slo-sloth`, `grafana-folder`, `grafana-alertrulegroup`, `dashboards/dashboard-overview`, blackbox probe under `blackbox-exporter/{env}/{region}/`.

**Sequence.** App PR first (no mops dependency). Bootstrap skill update second. Mops PR third (uses the updated skill).

### Launchpad — `cc-custom-plugin-applaunchpad`

**Current state.** Bun + Hono, parity with template app code (audited 2026-05-23). Mops namespace has `ns`, `cr` (Apperator with `metrics.enabled: true`), `helm`, `postgres-helm`, `application.yaml` (generic placeholder), `slo-sloth.yaml`. Deployed to prod-de1/au1/us1, stage-de1, dev-de1. No explicit `VMServiceScrape`, no `GrafanaDashboard`, no `GrafanaFolder`, no `GrafanaAlertRuleGroup`, no kobs `Application` CR, no blackbox probe.

**App-side delta.** Same six items as template (runtime metrics, outbound promotion, trace propagation, OTel log keys, `docs/observability.md`). Sync from template via the existing template-sync flow once template PR merges. ~6 h.

**Mops-side delta.** Single PR adding:

```
mops/kubernetes/namespaces/cc-custom-plugin-applaunchpad/base/
├── vmservicescrape.yaml           NEW
├── grafana-folder.yaml            NEW   (uid: folder-cc-custom-plugin-applaunchpad)
├── grafana-alertrulegroup.yaml    NEW   (7 alerts from §2.4)
└── dashboards/
    ├── kustomization.yaml         NEW
    └── dashboard-overview.yaml    NEW   (uid: cc-custom-plugin-applaunchpad-overview)
+ replace application.yaml         EDIT  (placeholder → kobs Application CR)
+ slo-sloth.yaml                   EDIT  (add `team: cc-tech` label if missing)
+ blackbox-exporter probe entries  NEW   under blackbox-exporter/{env}/{region}/
```

Effort: ~3 h (mechanical clone of template's `mops-overlay/`, `<NAME>` substitution, sanity-check).

**Dependencies.** Template app PR + bootstrap skill update should land first so the YAML stubs and dashboard JSON are stable. Otherwise rework on the dashboard panel ordering.

**Validation.** Force the seven alerts on dev-de1 (CrashLoop, OOM, 5xx, outbound 5xx, eventloop lag, blackbox down, cert expiry) and confirm Slack + incident.io routing using the `team: cc-tech` alias.

### Glossary — `cc-custom-plugin-glossary`

**Current state.** Bun + Hono, ADRs 0010-0013 cover logging + GDPR + push channels. Already fixed `_msg`→`msg` for VictoriaLogs. Mops shape **identical to launchpad**: `ns`, `cr`, `helm`, `postgres-helm`, `application.yaml`, `slo-sloth.yaml`. Same deploy footprint (prod-de1/au1/us1, stage-de1, dev-de1).

**App-side delta.** Same six items as launchpad — sync from template post-merge. ~6 h. No special carve-outs.

**Mops-side delta.** Same as launchpad, substituting the name. ~3 h.

**One difference vs launchpad.** Glossary already references Grafana dashboards from its `docs/links.md`. Reconcile those references against the new `cc-custom-plugin-glossary-overview` dashboard UID introduced by the retrofit (one-line edit).

### Audio Hub — `cc-custom-plugin-audio-hub`

**Current state per memory.** Docs-only at `/Users/ms/DEV/Github_Staffbase/cc-custom-plugin-audio-hub/docs/` (PLAN.md + EXECUTION.md). Not yet implemented. No mops namespace. No app code.

**Implication.** Audio Hub never needs a retrofit. It is bootstrapped from the template **after** this ADR + the bootstrap-skill update + the template `mops-overlay/` land, so it inherits the full observability bundle natively at scaffold time. Effort = zero incremental beyond what every new plugin already pays via bootstrap.

**Caveat.** If Audio Hub scaffolding starts **before** the template PRs land, it will need the same retrofit work as launchpad/glossary later (~9 h total). Recommend gating audio-hub kickoff on template PRs merged to avoid this.

### Cross-plugin summary

| Plugin | App PR | Mops PR | Bootstrap-only? | Total effort |
|---|---|---|---|---|
| template | yes (canonical) | yes (new namespace) | n/a | ~10 h |
| launchpad | yes (sync) | yes (retrofit) | no | ~9 h |
| glossary | yes (sync) | yes (retrofit) | no | ~9 h |
| audio-hub | no (scaffold) | no (scaffold) | **yes** — if gated correctly | 0 h |

Total to fully land: ~28 h of focused work plus reviews; spread across two sprints if one engineer drives.

## Reference

- Mops monitoring docs index: [`mops/docs/operate-monitor/`](https://github.com/Staffbase/mops/tree/main/docs/operate-monitor)
  - cost-analysis, alerting, grafana, logging, tracing, profiling, tooling, checklist-config-changes
  - monitoring-alerting: general, istio, kobs, slos, victoriametrics
- Backstage redbook: `https://backstage.staffbase.com/docs/default/component/redbook/operate-monitor/grafana/` (dashboards) + sibling pages for alerting / logging / SLOs.
- Exemplar mops namespaces to clone from:
  - `mops/kubernetes/namespaces/reloader/base/` — small operator, full stack
  - `mops/kubernetes/namespaces/tfy-llm-gateway/base/` — service with VMServiceScrape + Sloth + dashboards
  - `mops/kubernetes/namespaces/conntrack-stats-exporter/base/` — minimal exporter with dashboard CR
- Companion ADRs in this repo:
  - [`0009-observability-baseline.md`](0009-observability-baseline.md) — app-side logging + metrics contract this ADR builds on.
  - [`0013-logging-contract.md`](0013-logging-contract.md) — log levels, module discipline, GDPR redaction rules.
- Related skill: `cc-custom-plugin-bootstrap` (owns the cross-repo PR fan-out).
