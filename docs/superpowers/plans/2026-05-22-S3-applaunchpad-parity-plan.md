# S3 — Applaunchpad Parity Implementation Plan

> **Status: ✅ COMPLETE.**
>
> **Shipped via PR #87 / #88 / #89 (merged earlier):**
> - ✅ CI dependabot blocker gate (PR #87)
> - ✅ AL PR #81 metric label injection fix
> - ✅ Unknown User anchor guard sweep across admin (PR #89)
> - ✅ apiToken-null-clear server fix (PR #89)
> - ✅ SettingsDialog stabilization (PR #89 chain)
> - ✅ Filter dropdowns server-side + client (PR #89)
> - ✅ `userName` SQL filter unification (PR #89)
> - ✅ Widget cast cleanup (PR #89)
> - ✅ E2E spec for SettingsDialog API token flow (PR #88)
>
> **Shipped on draft branch `chore/applaunchpad-template-parity` (this session):**
> - ✅ Task 1: GDPR layer port — 5 commits (migration `0016_add_users_last_verified_at`, `revalidateAccessor`/`revalidateReferencedUsers`/`ensureUserInCache`, `gateAccessor` wired into 4 sso auth paths, `IS_LOCALDEV` bypass in delete intercept, `.env.example` GDPR knobs). +15 new tests; 297/297 server pass.
> - ✅ Task 2: NO-OP (`autodev.yml` is canonical for `dev` label; redundant `dev-preview.yml` removed from template).
> - ✅ Task 3a: Phase F real-data findings doc (5 envs via grafana MCP).
> - ✅ Task 3b: `docs/observability/{how-to-verify-f2-f9,logging-guidelines}.md`, `docs/qa/mobile-checklist.md`, ADRs 0010-0013, bootstrap CHANGELOG.md, Operational Links README section.
> - ✅ Task 4: vault-bootstrap.sh + env.example port.
> - ✅ Task 5: AGENTS.md GDPR + widget + per-instance token guardrails port; `sub=delete` intercept location fix.
> - ✅ Task 6: dependency hygiene verified — `@hono/zod-validator@^0.8.0` + `gha-workflows@v13.4.0` already at parity (no-op).
> - ✅ Task 7: path portability sweep no-op (no `/Users/ms/DEV/Github_Staffbase` references in AL `docs/`).
>
> AL main HEAD at completion: `6265227` (+10 unmerged commits on `chore/applaunchpad-template-parity`).
>
> **Phase F follow-up open (separate scope, NOT in this PR):** F5 finding — `_msg` raw-JSON leak across all envs (998-2012 entries/24h in prod). Documented in `docs/observability/phase-f-findings.md`. Needs hand-rolled JSON-log audit pass in `server/src/`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `cc-custom-plugin-applaunchpad` to parity with the canonical `cc-custom-plugin-template` produced in S1. The big-ticket items are: port the GDPR user lifecycle layer (revalidateAccessor / gateAccessor / last_verified_at / revalidateReferencedUsers), add the dev-preview workflow, add observability docs incl. a REAL Phase F findings doc generated via grafana MCPs, mobile-checklist, ADRs 0010-0013, CHANGELOG, Operational Links, parameterize vault-bootstrap.

AL is already deployed; `deployment-handoff.md` is NOT needed (template + audio-hub need it; AL doesn't).

**Architecture:** Single feature branch off latest `Staffbase/cc-custom-plugin-applaunchpad@main`. Multi-commit (one logical concern per commit). Opens as **DRAFT PR**. The Phase F findings doc is generated AS PART of this plan via read-only grafana MCP queries (no Vault, no writes).

**Tech Stack:** Bun, Hono, Drizzle, React, GitHub Actions, HashiCorp Vault, VictoriaLogs + Prometheus via Grafana MCPs.

**Convention:** `$AL = ~/<sb-repos>/cc-custom-plugin-applaunchpad`, `$TPL = ~/<sb-repos>/cc-custom-plugin-template`, `$GLO = ~/<sb-repos>/cc-custom-plugin-glossary`.

**Pre-condition:** PR #89 (Unknown User + apiToken-clear + SettingsDialog port + filter dropdowns) and PR #88 (E2E settings spec) are either merged or rebased onto. S3 work happens AFTER those land.

---

## Diff vs template (from S1 design + ongoing audits)

| Item | AL state | Template state | Action |
|---|---|---|---|
| GDPR layer (`revalidateAccessor` + `revalidateReferencedUsers` + `gateAccessor` + `last_verified_at` + `IS_LOCALDEV` bypass) | **MISSING** | ✓ | Major port (see Task 1) |
| `.env.example` GDPR knobs | **MISSING** | ✓ | Add |
| `.github/workflows/dev-preview.yml` | **MISSING** | ✓ | Copy |
| `docs/observability/how-to-verify-f2-f9.md` | **MISSING** | ✓ | Copy + AL placeholder fill |
| `docs/observability/phase-f-findings.md` | **MISSING** | ✓ (placeholder) | Generate REAL via MCP grafana (Task 3a) |
| `docs/qa/mobile-checklist.md` | **MISSING** | ✓ | Copy |
| `docs/reference/visual-tour.md` | ✓ (AL-specific captures present) | placeholder | none (AL has real captures) |
| ADRs 0010-0013 (push-channels, user-cache-lifecycle, strict-gdpr, logging-contract) | **MISSING** | ✓ | Copy + AL adapt |
| `CHANGELOG.md` | **MISSING** | bootstrap | Bootstrap |
| Operational Links README section | **MISSING** | ✓ | Add with AL-specific URLs |
| `scripts/vault-bootstrap.sh` parameterized | **MISSING** entirely | ✓ | Copy |
| `scripts/vault-bootstrap.env.example` | **MISSING** | ✓ | Copy |
| `scripts/check-dependabot-blockers.sh` + CI wiring | ✓ already (PR #87) | ✓ | none |
| `_msg` field fix | ✓ already (earlier session) | ✓ | none |
| AL PR #81 metric label injection fix | ✓ (this is AL's own PR) | ✓ | none |
| `@hono/zod-validator@0.8` | needs verify | ✓ | Verify; bump if stale |
| `gha-workflows@v13.4.0` | needs verify | ✓ | Verify; bump if stale |
| AGENTS.md GDPR/API-token rules | partial | full | Port missing |
| `_msg` → `msg` field name (logger.ts) | ✓ already | ✓ | none |

---

## Task 0: Pre-work

- [ ] **Step 0.1: Pull latest + branch**

```bash
cd ~/<sb-repos>/cc-custom-plugin-applaunchpad
git fetch origin
git checkout main
git pull --ff-only origin main
git status   # clean
git checkout -b chore/applaunchpad-template-parity
```

- [ ] **Step 0.2: Baseline test pass**

```bash
bun install
bun run check
bun test
(cd client && bun run test)
(cd widget && bun test)
```

All green.

---

## Task 1: Port GDPR user lifecycle layer (biggest piece)

Major port from template (which itself ported from glossary). 5 sub-commits, in this order (each one's tests must stay green before next commit).

### 1.1 Schema + migration for `last_verified_at`

- Read `$TPL/server/src/db/migrations/0001_add_users_last_verified_at.sql` + `$TPL/server/src/db/schema.ts` users-table block.
- Find AL's highest existing migration number. Create `0016_add_users_last_verified_at.sql` (or next number) in `$AL/server/src/db/migrations/` with the same SQL.
- Update `$AL/server/src/db/schema.ts` to add `lastVerifiedAt: timestamp("last_verified_at")` on the users table.
- Update `$AL/server/src/db/migrations/meta/_journal.json` with a new entry (drizzle convention).
- `bun test 2>&1 | tail -15` — existing tests still pass.
- Commit: `feat(db): add last_verified_at column for GDPR accessor revalidation`.

### 1.2 Port `revalidateAccessor()` + `revalidateReferencedUsers()` + helpers + tests

- Read `$TPL/server/src/lib/user-cache.ts` for `revalidateAccessor`, `revalidateReferencedUsers`, `ensureUserInCache`, supporting helpers, env-var reads, TTL constants.
- Port verbatim into `$AL/server/src/lib/user-cache.ts`. Keep AL's existing functions (background `refreshAllUsers` already exists in AL — it's the source pattern template inherited).
- Port glossary's tests from `$AL/server/src/__tests__/user-cache.test.ts` for the new functions. Run tests.
- Commit: `feat(user-cache): port revalidateAccessor + revalidateReferencedUsers for per-request GDPR gate`.

### 1.3 Wire `gateAccessor()` into SSO middleware

- Read `$TPL/server/src/middleware/sso.ts` around the `gateAccessor()` definition and the call sites.
- Port `gateAccessor()` into `$AL/server/src/middleware/sso.ts`. Wire after each auth checkpoint AL has (cookie session, Bearer JWT, Bearer session id, query JWT — whichever exist).
- Port tests from `$AL/server/src/__tests__/sso.test.ts`.
- Commit: `feat(sso): port gateAccessor() per-request GDPR revalidation`.

### 1.4 `IS_LOCALDEV` bypass in delete-intercept

- Read `$TPL/server/src/app.ts` around the `sub === "delete"` intercept.
- Find AL's equivalent intercept (likely also in `app.ts`). Add `if (process.env.IS_LOCALDEV === "true") return next();` (or equivalent) at the top.
- Add or update tests asserting the intercept is skipped when `IS_LOCALDEV=true`.
- Commit: `fix(app): skip GDPR delete intercept under IS_LOCALDEV to unblock widget preview`.

### 1.5 `.env.example` GDPR knobs

- Add to `$AL/.env.example`: `USER_ACCESSOR_REVALIDATE_SECONDS=60`, `USER_REFERENCE_REVALIDATE_SECONDS=300`, `STRICT_REFERENCES_BLOCKING=false` (with comments mirroring template).
- Commit: `chore(env): add GDPR revalidation knobs to .env.example`.

### 1.6 Run full suite

```bash
cd ~/<sb-repos>/cc-custom-plugin-applaunchpad
bun run check
bun test
```

All green. New tests: ~19 added (matching template's count).

---

## Task 2: dev-preview.yml workflow

- [ ] Copy `$TPL/.github/workflows/dev-preview.yml` to `$AL/.github/workflows/dev-preview.yml`.
- [ ] Replace any `cc-custom-plugin-template` references with `cc-custom-plugin-applaunchpad`.
- [ ] `bunx js-yaml .github/workflows/dev-preview.yml > /dev/null` — valid YAML.
- [ ] Commit: `feat(ci): add dev-preview widget bundle workflow`.

---

## Task 3: Documentation copies (observability + qa + ADRs + CHANGELOG + Operational Links)

### Task 3a — Phase F findings via MCP grafana (read-only)

Generate REAL `docs/observability/phase-f-findings.md` for AL by querying the 5 environments via the MCP grafana servers (`mcp__grafana-{dev-de1,stage-de1,prod-de1,prod-au1,prod-us1}__query_logs` and `mcp__grafana-*__query_metrics`).

For each environment (5 envs), capture for `namespace="cc-custom-plugin-applaunchpad"`:

- [ ] **F2 — Log volume (24h)** by level (DEBUG/INFO/WARN/ERROR). LogsQL: `k8s.namespace.name:"cc-custom-plugin-applaunchpad" _time:24h | stats count() by (level)`.
- [ ] **F3 — Error baseline (24h)**: count of `level:ERROR` + top 5 `_msg` patterns.
- [ ] **F4 — Access RPS + p50/p95/p99**: PromQL `sum(rate(http_requests_total{namespace="cc-custom-plugin-applaunchpad"}[5m]))` + `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{namespace="cc-custom-plugin-applaunchpad"}[5m])) by (le))`.
- [ ] **F5 — `_msg` field hygiene**: `k8s.namespace.name:"cc-custom-plugin-applaunchpad" _msg:"\"level\""` — must return 0 (proves no raw-JSON leak).
- [ ] **F6 — Push delivered vs failed (24h)**: `k8s.namespace.name:"cc-custom-plugin-applaunchpad" module:push _time:24h | stats count() by (msg)`.
- [ ] **F7 — DB query p50/p95/p99**: `histogram_quantile` on `db_query_duration_seconds_bucket` if instrumented; else note "not instrumented".
- [ ] **F8 — Container saturation**: PromQL on `container_cpu_usage_seconds_total{namespace="cc-custom-plugin-applaunchpad"}` and `container_memory_working_set_bytes`.
- [ ] **F9 — Active alerts**: list any firing in Prometheus for AL namespace.

Write findings into `$AL/docs/observability/phase-f-findings.md` using the same matrix shape as `$GLO/docs/observability/phase-f-findings.md` (one section per F, one column per env).

If a metric isn't instrumented or returns no data, note explicitly. Don't fabricate.

This task is **independent** from the code changes — can run in parallel with Tasks 1+2 if dispatched concurrently. Just MCP reads, no writes.

### Task 3b — Other docs

- [ ] Copy `$TPL/docs/observability/how-to-verify-f2-f9.md` → `$AL/docs/observability/`. `sed` `<PLUGIN_NAME>` → `cc-custom-plugin-applaunchpad`.
- [ ] Copy `$TPL/docs/qa/mobile-checklist.md` → `$AL/docs/qa/`. `sed` placeholders.
- [ ] Copy ADRs 0010-0013 from `$TPL/docs/adrs/` → `$AL/docs/adrs/`. Scan for any glossary-domain leakage; rewrite to AL-domain examples (apps/tags/owners) or generic.
- [ ] Bootstrap `$AL/CHANGELOG.md` (Unreleased section). Note: AL is already deployed, so the CHANGELOG can backfill last 2-3 known releases as a starting point (read git log for the most recent tagged releases).
- [ ] Add Operational Links section to `$AL/README.md` (after the deployment section). Fill in AL-specific URLs/Vault paths.

Commit (single or split): `docs: add observability + qa + ADRs 0010-0013 + Operational Links from template canonical`.

---

## Task 4: Vault bootstrap script

- [ ] Copy `$TPL/scripts/vault-bootstrap.sh` + `$TPL/scripts/vault-bootstrap.env.example` to `$AL/scripts/`.
- [ ] `chmod +x scripts/vault-bootstrap.sh`.
- [ ] Add `scripts/vault-bootstrap.env` to `$AL/.gitignore`.
- [ ] Dry-run smoke test: `DRY_RUN=1 bash scripts/vault-bootstrap.sh dev-de1` — Vault paths should show `cc-custom-plugin-applaunchpad`.
- [ ] Commit: `feat(scripts): add parameterized vault-bootstrap script`.

---

## Task 5: AGENTS.md cross-check + port missing generic rules

- [ ] Diff `$AL/AGENTS.md` against `$TPL/AGENTS.md`. Port any missing generic rules:
  - GDPR per-request gate
  - Per-instance API token + SCIM sync
  - Widget API mount-before-SSO (if AL has widget endpoints)
  - Widget escape-HTML (if AL has a widget)
  - `sub === "delete"` intercept location (AL likely still says `routes/html.ts` — should be `app.ts`)
  - `cd widget && bun test` in pre-commit checklist (if AL has a widget suite)
- [ ] Commit: `docs(agents): port generic guardrails from template canonical`.

---

## Task 6: Dependency hygiene verification

- [ ] Verify `@hono/zod-validator` is `^0.8.0` in `$AL/server/package.json`. If older, bump + run tests.
- [ ] Verify `gha-workflows@v13.4.0` is referenced everywhere in `$AL/.github/workflows/*.yml`. If older, bump.
- [ ] Verify any Docker action versions match template (likely already at parity).
- [ ] If any change, commit: `chore(deps): bump <dep> to <version>`.

---

## Task 7: Path portability in `docs/superpowers/`

- [ ] `grep -rl "/Users/ms/DEV/Github_Staffbase" $AL/docs/superpowers/ 2>/dev/null`.
- [ ] If hits: `sed -i '' 's|/Users/ms/DEV/Github_Staffbase|~/<sb-repos>|g' <files>`.
- [ ] Commit (only if changes).

---

## Task 8: Final verification + push + draft PR

- [ ] Full suite:

```bash
cd ~/<sb-repos>/cc-custom-plugin-applaunchpad
bun run check
bun test
(cd client && bun run test)
(cd widget && bun test)
bash scripts/check-dependabot-blockers.sh
DRY_RUN=1 bash scripts/vault-bootstrap.sh dev-de1 2>&1 | tail -10
mkdocs build --strict 2>&1 | tail -10  # if mkdocs installed
```

All green.

- [ ] Push + open DRAFT PR:

```bash
git push -u origin chore/applaunchpad-template-parity
gh pr create --draft --base main --title "chore: bring applaunchpad to parity with cc-custom-plugin-template (S3)" --body "$(cat <<'EOF'
## Summary

Brings cc-custom-plugin-applaunchpad to parity with the canonical cc-custom-plugin-template (produced in S1). Major work item is the GDPR user-lifecycle layer port; secondary items are doc absorption + Phase F observability verification.

### What changed

- **GDPR layer** (5 sub-commits): `last_verified_at` migration + `revalidateAccessor`/`revalidateReferencedUsers`/`ensureUserInCache` in `user-cache.ts` + `gateAccessor()` wired into `sso.ts` + `IS_LOCALDEV` bypass in `sub=delete` intercept + new env-var knobs.
- **Observability**: `docs/observability/how-to-verify-f2-f9.md` (copy from template) + **REAL `phase-f-findings.md`** generated via grafana MCP queries against all 5 envs (see Phase F section in the doc).
- **Mobile checklist** + ADRs 0010-0013 + bootstrap CHANGELOG + Operational Links section.
- **dev-preview.yml workflow** + **parameterized vault-bootstrap.sh** + AGENTS.md guardrail port.
- (Verify) `@hono/zod-validator@0.8` + `gha-workflows@v13.4.0`.

### Test plan

- [ ] CI green (incl. new tests for revalidateAccessor + gateAccessor).
- [ ] `bun test` server + `bun test` widget + client tests — all green.
- [ ] Phase F findings doc rendered correctly via `mkdocs build`.
- [ ] `DRY_RUN=1 bash scripts/vault-bootstrap.sh dev-de1` writes to `cc-custom-plugin-applaunchpad` Vault paths.
- [ ] Smoke test in dev/de1: a deleted user (via Staffbase platform) is denied within the configured TTL (default 60s).

### Notes

- DRAFT — please review carefully before merging the GDPR layer; it's net-new infra logic that should be reviewed for fail-open / fail-closed semantics.
- Depends on PR #88 (E2E) + PR #89 (Unknown User + apiToken-clear) being merged first. Rebase if needed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL.

---

## Verification + scope notes

- S3 is the heaviest of the sub-projects because AL is missing the entire GDPR layer template ported from glossary.
- The Phase F findings doc is generated as part of THIS plan via MCP — no separate ticket. Run AFTER Task 1 lands (so post-port metrics reflect the gate's behavior, though baseline metrics work even before the gate).
- S3 does NOT add: `deployment-handoff.md` (AL is already deployed, doc not needed there).

## References

- `$TPL/docs/superpowers/specs/2026-05-22-cross-repo-sync-design.md` (parent spec)
- `$TPL/docs/superpowers/plans/2026-05-22-S1-template-canonical-plan.md` (S1 reference)
- `$GLO/docs/observability/phase-f-findings.md` (shape reference for AL's findings doc)
- `$GLO/docs/adrs/0010-0013` (ADRs source — already ported to template; copy from template)
- AL PR #87 (CI gate, already merged)
- AL PR #88 (E2E settings spec, depending on this PR's predecessor)
- AL PR #89 (Unknown User + apiToken-clear + SettingsDialog port + filter dropdowns, depending on this PR's predecessor)
