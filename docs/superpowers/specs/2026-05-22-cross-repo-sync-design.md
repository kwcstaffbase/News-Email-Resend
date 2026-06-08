# CC Custom Plugin — Cross-Repo Sync Design

**Date:** 2026-05-22
**Author:** Max (`max@staffbase.com`)
**Status:** Partially complete — see each plan file for sub-project status.

## Status at 2026-05-22 EOD

| Sub | State | Evidence |
|---|---|---|
| **S1** Template canonical | ✅ Complete | Merged to template main: commit chain `da6bf31..564e589` (23 commits). See `2026-05-22-S1-template-canonical-plan.md`. |
| **S2** Glossary parity | ✅ Complete | All in-scope items shipped. DRAFT PR (branch `chore/glossary-template-parity`): vault-bootstrap parameterized + AGENTS.md GDPR/token rule port + removed redundant dev-preview.yml. |
| **S3** AL parity | ✅ Complete | All in-scope items shipped. DRAFT PR (branch `chore/applaunchpad-template-parity`): GDPR layer port (5 commits), AGENTS.md guardrails, vault-bootstrap, ADRs 0010-0013, observability + qa docs, CHANGELOG, Op Links README. Task 2 (dev-preview.yml) confirmed NO-OP — `autodev.yml` is the canonical Staffbase `dev`-label mechanism. |
| **S3a** AL Phase F real-data findings via MCP | ✅ Complete | `docs/observability/phase-f-findings.md` generated from 5-env grafana MCP queries. HIGH finding: F5 `_msg` raw-JSON leak across all envs (998-2012/24h in prod) — separate follow-up needed. |
| **S4** Audio-hub bootstrap | ❌ Deferred (user direction) | Still docs-only (PLAN.md + EXECUTION.md). Out of scope for this session. |
| **S5** Widget installation-picker rollout | ✅ NO-OP — Studio default handles it | All 4 repos have `widget/src/installation-picker.tsx` on disk; `widget/scripts/build.ts` uses `widget.ts` as the sole entrypoint, so the picker is NOT in the compiled bundle of any repo. Confirmed (user 2026-05-23): Staffbase Studio renders its own default RJSF widget for the `installation_id` config attribute, so the bundled custom picker is not required today. `installation-picker.tsx` remains as reference example code, not shipped. ADR-0008 documents the design for a future scenario where a plugin needs a custom picker. |

The high-leverage, production-impacting pieces (Unknown User bug, apiToken UI/clear flow, GDPR posture, Drizzle prod crash, observability hygiene, GDPR per-request gate on AL) all landed. Audio-hub bootstrap (S4) is the only remaining sub-project — deferred per user direction.

---

## Context

Four CC Tech custom-plugin repos share the same Bun + Hono + Drizzle + React + Hono-widget stack:

- `cc-custom-plugin-applaunchpad` — has Staffbase GitHub remote, in production
- `cc-custom-plugin-glossary` — has Staffbase GitHub remote, v1.0.0 just shipped
- `cc-custom-plugin-template` — **local only** (no GitHub remote), intended as the canonical reference
- `cc-custom-plugin-audio-hub` — **local only**, docs-only (`PLAN.md` + `EXECUTION.md`); implementation not started

Glossary v1.0.0 (Staffbase/cc-custom-plugin-glossary PRs #1, #2, #5, #6) and applaunchpad PR #81 produced a number of **generic** improvements (not glossary- or applaunchpad-specific) that should propagate to the other three plugins. The goal of this design is to converge all four repos on a shared canonical structure, with `cc-custom-plugin-template` as the source of truth going forward.

This is **not** a feature-content sync. Glossary-specific things (entries, categories, ideas, multi-language entry forms) stay in glossary; applaunchpad-specific things stay in applaunchpad.

## Diff matrix (current state)

Each cell shows whether the file/feature exists in that repo. ✓ = present and current; ✗ = missing; ! = present but stale or needs adaptation.

| Topic | applaunchpad | glossary | template | audio-hub |
|---|---|---|---|---|
| `CHANGELOG.md` | ✗ | ✓ | ✗ | ✗ |
| `scripts/vault-bootstrap.sh` + `.env.example` (param by plugin-name) | ✗ | ! (hardcoded for glossary) | ✗ | ✗ |
| `scripts/check-dependabot-blockers.sh` + `ci.yml` step | ✓ | ✗ | ✓ | ✗ |
| Dependabot `@staffbase/design` semver-major ignore | ✓ | ✓ | ✓ | ✗ |
| `scripts/capture-docs-screenshots.ts` + `capture-docs-videos.ts` | ✓ | ✓ | ✗ | ✗ |
| `.github/workflows/dev-preview.yml` (widget preview) | ✗ | ✓ | ✗ | ✗ |
| `docs/guides/deployment-handoff.md` | ✗ (**not needed — AL already deployed**) | ✓ | ✗ (needed for first deploy) | ✗ (needed for first deploy) |
| `docs/observability/how-to-verify-f2-f9.md` | ✗ | ✓ | ✗ | ✗ |
| `docs/observability/phase-f-findings.md` | ✗ (**generate real via MCP — see S3a**) | ✓ | ✗ (placeholder only) | ✗ (placeholder only) |
| `docs/observability/logging-guidelines.md` | ✗ | ✗ | ✓ | ✗ |
| `docs/qa/mobile-checklist.md` | ✗ | ✓ | ✗ | ✗ |
| `docs/reference/visual-tour.md` | ✓ | ✓ | ✗ | ✗ |
| ADR-0008 (widget-installation-picker) | ? | ? | ✓ | ? (in `docs/template/`) |
| ADR-0009 (observability-baseline OR ideas-workflow) | ? | ! (glossary-specific) | ✓ | ? |
| ADR-0010..0013 (server-state, push, key-rotation, logging-contract) | ✗ | ✓ | ✗ | ✗ |
| Operational Links section (root README or separate) | ✗ | ✗ | ✗ | ✗ |
| `widget/src/installation-picker.tsx` (file present) | ✓ | ✓ | ✓ | ✓ |
| Installation-picker wired in `widget/src/widget.ts` | needs audit (S5) | needs audit (S5) | needs audit (S5) | needs audit (S5) |
| `_msg`→`msg` logger fix | ✓ | ✓ | ✓ | ✓ |
| AL PR #81 metric label injection fix | ✓ | ✓ | needs verify | needs verify |
| PR #2 workflow bumps (`gha-workflows@13.4.0`) | needs verify | ✓ | needs verify | needs verify |
| PR #5 `@hono/zod-validator@0.8.0` | needs verify | ✓ | needs verify | needs verify |

## Decomposition (five sub-projects)

Each sub-project is independently shippable. Ordering matters because **template becomes the canonical source**; downstream sub-projects copy from a known-good template state.

### S1 — Template-as-canonical (this design covers S1 in detail)

Update `cc-custom-plugin-template` to absorb every generic improvement above. Multi-commit local branch (`chore/template-canonical-sync`). No remote push (template has no remote).

Sub-project S1 is detailed in §S1 Design below. Other sub-projects are sketched here and will get their own design + plan after S1 ships.

### S2 — Glossary parity (minimal)

Single PR to `Staffbase/cc-custom-plugin-glossary`:

1. Add `scripts/check-dependabot-blockers.sh` (copy from template).
2. Wire it into `.github/workflows/ci.yml` after the "Validate plugin manifest" step.
3. Replace hardcoded `cc-custom-plugin-glossary` in `scripts/vault-bootstrap.sh` with parameterized `$PLUGIN_NAME` (or `$1`) — same script as template canonical version. Update `vault-bootstrap.env.example` accordingly.
4. Add Operational Links section to root `README.md`.

Verification: `bash scripts/check-dependabot-blockers.sh` passes; CI green; `bash scripts/vault-bootstrap.sh --dry-run dev-de1` produces same Vault paths as before.

### S3 — Applaunchpad parity

Single PR to `Staffbase/cc-custom-plugin-applaunchpad`. **AL is already deployed — `deployment-handoff.md` is NOT needed; only template + audio-hub need it (S1/S4).**

1. Copy from updated template: `scripts/vault-bootstrap.sh`, `scripts/vault-bootstrap.env.example`, `.gitignore` entry.
2. Copy: `.github/workflows/dev-preview.yml` (widget preview).
3. Copy: `docs/observability/how-to-verify-f2-f9.md` (adapted with AL placeholders).
4. Generate **real** `docs/observability/phase-f-findings.md` for AL by running observability verification against AL's deployed envs (see §S3a below).
5. Copy: `docs/qa/mobile-checklist.md` (generic).
6. Copy: ADRs 0010–0013 (skip glossary's 0009-ideas-workflow).
7. Add CHANGELOG.md (bootstrap with current state).
8. Add Operational Links section to root `README.md`.
9. Verify PR #2/#5 bumps already applied; if not, apply.

Verification: CI green; `mkdocs build` succeeds; `bash scripts/vault-bootstrap.sh --dry-run dev-de1` writes only to AL-namespaced Vault paths.

### S3a — AL Phase F observability verification

Pre-S3 sub-step that produces the real findings doc for S3 item 4. Runs via `mcp__grafana-{dev-de1,stage-de1,prod-de1,prod-au1,prod-us1}` MCP servers.

For each of the 5 envs, capture for `namespace="cc-custom-plugin-applaunchpad"`:

- **F2 — log volume**: 24h count of log lines per level (DEBUG/INFO/WARN/ERROR) via `count() by (level)` LogsQL on `_time:>24h`.
- **F3 — error baseline**: 24h count of `level:ERROR` + top 5 error messages via `_msg` aggregation.
- **F4 — access log RPS**: `sum(rate(http_requests_total{namespace="cc-custom-plugin-applaunchpad"}[5m]))` and p50/p95/p99 over the same range via `histogram_quantile`.
- **F5 — `_msg` field hygiene**: verify zero raw-JSON leakage by running `_msg:"\"level\""` LogsQL — must return 0 entries (proves the `msg`→`_msg` promotion is clean).
- **F6 — push delivery**: `count` of `level:INFO module:push msg:"push delivered"` vs `msg:"push failed"` over 24h.
- **F7 — db latency**: `histogram_quantile` p50/p95/p99 on `db_query_duration_seconds_bucket` if metric exists; else note "not instrumented".
- **F8 — saturation**: container CPU + memory headroom; flag if >70% in any env.
- **F9 — alerts firing**: list any active alerts in each env's Prometheus for AL namespace.

Output: `docs/observability/phase-f-findings.md` in AL repo, structured exactly like `cc-custom-plugin-glossary/docs/observability/phase-f-findings.md`, with one section per F2–F9 and a 5-column matrix per finding (one column per env).

This is a read-only investigation; no Vault, no writes. Safe to run from session.

### S4 — Audio-hub bootstrap (combo: preserve present + absorb missing from template)

Local branch on `cc-custom-plugin-audio-hub` (no remote). Hybrid approach: preserve what audio-hub already has, port what it's missing from the updated template, replace what audio-hub copied from an older template snapshot.

1. **Preserve as-is:** `docs/PLAN.md`, `docs/EXECUTION.md`, audio-hub-specific CLAUDE.md guidance, `widget/src/audio-player/`, `widget/src/file-picker.tsx`, `widget/src/analytics-client.ts`.
2. **Add (missing entirely):**
   - `@staffbase/design` semver-major ignore + invariant comment in `.github/dependabot.yml`.
   - `scripts/check-dependabot-blockers.sh` + `ci.yml` step.
   - `scripts/vault-bootstrap.sh` + `scripts/vault-bootstrap.env.example` + `.gitignore` entry.
   - `scripts/capture-docs-screenshots.ts` + `scripts/capture-docs-videos.ts`.
   - `.github/workflows/dev-preview.yml`.
   - `docs/guides/deployment-handoff.md` (audio-hub is **not yet deployed** — handoff doc needed).
   - `docs/observability/{how-to-verify-f2-f9.md,logging-guidelines.md,phase-f-findings.md (placeholder)}`.
   - `docs/qa/mobile-checklist.md`.
   - `docs/reference/visual-tour.md` (placeholder).
   - `CHANGELOG.md` (bootstrap, "Unreleased").
   - Operational Links section in root `README.md`.
3. **Replace (audio-hub copied from stale template):**
   - `docs/template/adrs/*` — consolidate into a real `docs/adrs/` directory using the **updated template's** ADRs (0001–0009 + new 0010–0013).
   - `docs/template/architecture/*` → `docs/architecture/*` from updated template.
   - `docs/template/guides/*` → `docs/guides/*` from updated template.
   - Remove `docs/template/` after merging.
4. **Cross-check audio-hub-domain content** (audio player, analytics client, file picker) against template canonical patterns; flag any divergence but **don't** auto-rewrite — audio-hub-specific code stays as the dev's intent.

Verification: parity with updated template for everything generic; PLAN.md + EXECUTION.md + audio-hub-domain code unchanged.

### S5 — Widget installation-picker rollout (real component)

All four repos already have `widget/src/installation-picker.tsx` on disk. **S5 is upgraded from verification-only to a real porting component** — confirm the picker is **wired into each repo's `widget/src/widget.ts`** as the canonical multi-installation onboarding pattern, and port glossary's wiring pattern wherever it's missing.

Steps:

1. **Audit:** read each `widget/src/widget.ts` and grep for `installation-picker` import + usage. Tabulate: wired vs unwired per repo.
2. **Define canonical pattern:** based on the most complete wiring (presumably glossary, then AL), document the contract — when does the picker show (empty/missing `instanceId` config), how does it pass selected instance back to widget state, how does it interact with the JWT service-token flow.
3. **Port:** for each repo where wiring is missing, add the same import + render branch + state handoff. Surgical 1–2 file edit per repo.
4. **Test:** widget unit suite (`bun test` in `widget/`) must remain green; manual smoke if any visible behavior change.

If audit finds **all four wired identically**, S5 collapses back to a no-op verification. If wiring diverges, S5 produces:

- Patch to template (`widget/src/widget.ts` reference wiring).
- Patch lines added to S2 (glossary), S3 (AL), S4 (audio-hub) PRs/branches.

## §S1 Design — Template-as-canonical

### Goal

Make `cc-custom-plugin-template` the canonical reference for every generic concern shared by CC custom plugins, so future plugin bootstraps (incl. audio-hub) only need to fork the template and rename.

### Components (single branch `chore/template-canonical-sync`, one logical commit per group)

**C1: Vault bootstrap (parameterized).**
- `scripts/vault-bootstrap.sh` — adapted from glossary's. Take `PLUGIN_NAME` env (default to repo dir basename) and derive all Vault paths from it. Preserve all glossary behaviors: idempotent reads, placeholder rejection in prod, ROTATE_ENCRYPTION / ROTATE_POSTGRES flags, mask secrets in logs, 5 Postgres users + 1 plugin-credentials path per environment.
- `scripts/vault-bootstrap.env.example` — placeholder-only template; no real values.
- `.gitignore` — add `scripts/vault-bootstrap.env`.

**C2: Screenshot + video capture.**
- `scripts/capture-docs-screenshots.ts`, `scripts/capture-docs-videos.ts` — copy from glossary (Playwright-based). Replace hardcoded glossary URLs/selectors with placeholder list at top of each file documented to be customized per plugin.

**C3: Dev-preview workflow.**
- `.github/workflows/dev-preview.yml` — copy from glossary. No glossary-specific bits; widget build + artifact upload is generic.

**C4: Documentation absorbed from glossary (with placeholders).**
- `docs/guides/deployment-handoff.md` — placeholder-ize plugin name, Vault paths, environment slugs.
- `docs/observability/how-to-verify-f2-f9.md` — placeholder plugin name.
- `docs/observability/phase-f-findings.md` — placeholder plugin name, kept as a reference template (an empty findings doc is more useful than no doc).
- `docs/qa/mobile-checklist.md` — generic checklist (widget viewer + admin view + iOS Safari/Chrome + Android Chrome/Samsung Internet).
- `docs/reference/visual-tour.md` — empty/placeholder template referencing the capture scripts.

Template already has `docs/observability/logging-guidelines.md` — keep, don't displace.

**C5: ADRs.**
- Add ADR-0010 (server-side state isolation), ADR-0011 (push channels), ADR-0012 (api-token encryption key rotation), ADR-0013 (logging contract) — all generic. Source: glossary `docs/adrs/0010–0013`.
- Skip glossary ADR-0009 (ideas-workflow) — glossary-specific. Template's existing ADR-0009 (observability-baseline) stays.

**C6: Operational Links section in README.**
- Add a top-level "## Operational Links" section to root `README.md` with placeholders:
  - Backstage component link
  - Grafana per-env dashboards (5 envs)
  - VictoriaLogs per-env (5 envs)
  - Vault paths (5 envs)
  - Customer Control reference

**C7: CHANGELOG.md bootstrap.**
- Empty `CHANGELOG.md` with "Unreleased" heading.

**C8: AGENTS.md cross-check.**
- Diff glossary AGENTS.md against template AGENTS.md; port any new generic rules glossary added (e.g., `msg` field rule) that template lacks.

**C9: Dependency hygiene.**
- Bump `@hono/zod-validator` to `^0.8.0` in `server/package.json` (PR #5).
- Verify all `.github/workflows/*.yml` reference `gha-workflows@13.4.0` and updated Docker actions (PR #2). Bump if stale.
- Verify metrics + access-log + tests already match AL PR #81. If not, port.

### Out of scope for S1

- Glossary domain content (entries, ideas, categories, multi-language UI).
- Concrete screenshot artifacts (the *scripts* are generic; the captured PNGs are plugin-specific and live with each plugin).
- Backstage owner/team field rewrites (placeholders only — each repo customizes).
- Widget installation-picker wiring deep-dive (S5).
- Pushing template to a new Staffbase GitHub remote (out of scope; template stays local until user explicitly creates the repo).

### Verification

Run locally:

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
bun install
bun run check                        # Biome 0 errors
bun test                             # server suite green
cd widget && bun test && cd ..       # widget suite green
cd client && bun run test && cd ..   # client suite green
bash scripts/check-dependabot-blockers.sh
PLUGIN_NAME=cc-custom-plugin-template DRY_RUN=1 bash scripts/vault-bootstrap.sh dev-de1
mkdocs build
```

### Risks + mitigations

| Risk | Mitigation |
|---|---|
| Vault script parameterization regresses glossary's working invocation | Glossary inherits the same script in S2 — same script, same args. Test S2 with `DRY_RUN=1` against existing Vault paths and compare output. |
| Placeholder-ized docs (deployment-handoff, observability) lose specificity | Mark placeholder regions with `<!-- PLUGIN: ... -->` HTML comments and a one-line "Replace the placeholders below when forking this template" header. |
| Glossary's ADRs 0010–0013 reference glossary-specific decisions inline | Re-read each before copying; rewrite glossary examples as generic ones. |
| Widget installation-picker exists in all 4 repos as a file but not used in widget.ts | S5 verification task — non-blocking for S1. |
| Audio-hub's `PLAN.md`/`EXECUTION.md` overlap with deployment-handoff | S4 explicitly preserves them; deployment-handoff lives alongside as a generic template. |

## Execution mode

- **Order:** S1 → (S2 ∥ S3) → S4 → S5
- **Parallelization:** S2 + S3 can run in parallel via two `caveman:cavecrew-builder` subagents (independent repos, independent PRs).
- **Approval gates:** S1 is local; user reviews via diff before commits. S2 + S3 produce **GitHub PRs** that the user reviews on GitHub. S4 is local; user reviews via diff. S5 only runs if S1–S4 pass without needing widget changes.
- **PR labels:** S2/S3 PRs get `dev` label after open so autodev → CD picks them up for preview environments, per existing AL/glossary workflow.

## Open questions / placeholders

(None — all open items resolved during investigation; placeholders in target docs are intentional, not unknowns.)

## References

- Staffbase/cc-custom-plugin-glossary#1, #2, #5, #6
- Staffbase/cc-custom-plugin-applaunchpad#81, #85, #87
- `cc-custom-plugin-glossary/docs/observability/{how-to-verify-f2-f9.md,phase-f-findings.md}`
- `cc-custom-plugin-glossary/scripts/vault-bootstrap.sh`
- `cc-custom-plugin-glossary/docs/guides/deployment-handoff.md`
- `cc-custom-plugin-glossary/docs/qa/mobile-checklist.md`
- `cc-custom-plugin-glossary/docs/adrs/0010–0013`
- `cc-custom-plugin-applaunchpad/scripts/check-dependabot-blockers.sh`
