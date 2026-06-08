# Logging & metrics guidelines

Practical how-to for a new plugin scaffolded from this template. Read [ADR-0009](../adrs/0009-observability-baseline.md) first for the rationale; this doc is operational.

## Add a new route — checklist

1. **Instantiate logger at file top.**

    ```ts
    import { createLogger } from "../lib/logger.ts";
    const log = createLogger("<module>"); // e.g. "entries", "categories", "ideas"
    ```

2. **Emit three log calls per handler.**

    ```ts
    routesGroup.post("/", requireEditor, zValidator("json", schema), async (c) => {
      const { userId, instanceId } = c.var.user;
      const body = c.req.valid("json");
      log.info("<module>.<action>", {
        event: "<module>.<action>",
        userId,
        instanceId,
        // structural context only (counts, IDs, flags) — never user-supplied free text
      });

      // ...business logic...
      if (rejectedForBusinessReason) {
        log.warn("<module>.<action>.invalid", {
          event: "<module>.<action>.invalid",
          userId,
          instanceId,
          reason: "<short-reason>",
        });
        return c.json({ error: "<short-reason>" }, 400);
      }

      // ...do the work...

      log.info("<module>.<action>.ok", {
        event: "<module>.<action>.ok",
        userId,
        instanceId,
        // result summary: count, resulting IDs, transition target
      });
      return c.json(result, 201);
    });
    ```

3. **Do NOT log on unhandled exceptions.** Let them propagate to the global `error-handler` middleware. Use try/catch only when the handler can recover.

4. **No PII / free-text content in logs.** Term, definition, category name, search query, email — none of it. Counts, IDs (Mongo ObjectIds are fine), flags, status codes, durations.

## Add a new metric

Edit `server/src/routes/metrics.ts`. The reference plugin uses a hand-rolled Prometheus exporter (no external dependency). Pattern for a counter:

```ts
export const myCounter = new Map<string, Counter>();

export function incMyCounter(label1: string, label2: string): void {
  const labels = { label1, label2 };
  const key = labelKey(labels);
  const existing = myCounter.get(key);
  if (existing) {
    existing.value++;
  } else {
    myCounter.set(key, { labels, value: 1 });
  }
}
```

Then in the `/api/metrics` route handler, render with `renderCounter("my_counter_total", "help text", myCounter)`.

For histograms use the existing `observeHistogram(store, labels, ms)` helper — buckets are `10, 25, 50, 100, 250, 500, 1000, 2500, 5000` ms by default.

## Wrap outbound HTTP calls

Anywhere the plugin calls Staffbase or another upstream HTTP service:

```ts
import { recordOutboundHttp } from "../routes/metrics.ts";

const endpoint = endpointLabel(path); // strip query, replace ObjectIds with :id
const t0 = Date.now();
let res: Response;
try {
  res = await fetch(`${upstreamUrl}${path}`, init);
} catch (err) {
  recordOutboundHttp("staffbase-api", endpoint, 0, Date.now() - t0); // status=0 for transport failure
  throw err;
}
recordOutboundHttp("staffbase-api", endpoint, res.status, Date.now() - t0);
```

`endpoint` is the TEMPLATED path (`/api/installations/:id/service/token`), not the raw URI. Cardinality matters.

## Background tasks

```ts
import { recordBackgroundTask } from "../routes/metrics.ts";

async function runMyTask() {
  const t0 = Date.now();
  try {
    await doTheWork();
    recordBackgroundTask("my-task", "success", Date.now() - t0);
  } catch (err) {
    recordBackgroundTask("my-task", "failure", Date.now() - t0);
    bgLogger.error("My task failed.", {
      event: "background.my-task.failed",
      message: (err as Error).message,
    });
  }
}
```

## Route templating in access-log

When you add new routes, ensure `routeLabel()` in `server/src/middleware/access-log.ts` resolves them via `routePath(c)` from `hono/route`. The matched-route pattern (e.g. `/api/entries/:id`) becomes the `path` label on `http_requests_total` — keeping Prometheus cardinality bounded.

## Skip noisy paths

Update `SKIP_PATHS` in `server/src/middleware/access-log.ts` to cover uptime probes + Prometheus scrape paths. Defaults cover `/health`, `/probe`, `/metrics`, `/api/metrics`. Add yours if you've added custom probe endpoints.

## dev-vs-prod verbosity

- Base helm chart: `LOG_LEVEL=INFO`.
- dev/de1 mops overlay: `LOG_LEVEL=DEBUG` — see [`mops/kubernetes/namespaces/cc-custom-plugin-glossary/dev/de1/cc-custom-plugin-glossary-helm.yaml`](https://github.com/Staffbase/mops/blob/main/kubernetes/namespaces/cc-custom-plugin-glossary/dev/de1/cc-custom-plugin-glossary-helm.yaml) for the override shape.
- Stage / prod stay at `INFO`.

If you need TRACE for an investigation: set the env var on the pod via a one-off `kubectl set env` (or temporary mops change); revert after.

## Verify post-deploy

After a `git push` + Flux roll:

```bash
# 1. Open Grafana Explore on dev/de1
open "https://observatory-de1.staffbase.dev/explore?..."  # use a row from docs/log-queries.md

# 2. Filter to your new module
#    LogsQL: k8s.namespace.name:="<plugin>" AND module:="<module>"

# 3. Filter to your new event
#    LogsQL: k8s.namespace.name:="<plugin>" AND event:="<module>.<action>.ok"

# 4. Trigger the route once via your local browser or curl with a valid JWT,
#    then re-run the query — expect one line per request.
```

Add a row to `docs/log-queries.md` for every new `event=*` value you emit — one row, five env columns. Use the Python URL-encoding helper that produced the existing table; don't hand-craft URLs.

## What NOT to do

- **No `console.log` / `console.error`.** Always go through `createLogger`. The Hono runtime doesn't structure plain console output for Victoria Logs.
- **No string interpolation in log messages with user content.** `log.info(\`User ${name} did X\`)` is a PII leak.
- **No new module names without updating ADR-0009.** The `module` field is the dashboard pivot dimension; uncontrolled growth makes dashboards unreadable.
- **No probe/scraper paths in the access log.** Always extend `SKIP_PATHS`.
- **No raw URIs in metric labels.** Use route templates only.

## Reference

- [ADR-0009 — Observability baseline](../adrs/0009-observability-baseline.md)
- Reference plugin: [`Staffbase/cc-custom-plugin-glossary`](https://github.com/Staffbase/cc-custom-plugin-glossary) — particularly its `docs/adrs/0010-push-channels.md`, `0012-strict-gdpr-user-lifecycle.md`, `0013-logging-contract.md`, and the `docs/observability/phase-f-findings.md` audit that produced these guidelines.
