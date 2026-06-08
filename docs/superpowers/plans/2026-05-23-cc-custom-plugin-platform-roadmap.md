# CC Custom Plugin Platform — Roadmap

Plan file = roadmap/index. Each sub-plan listed here gets its own follow-up spec in `cc-custom-plugin-template/docs/superpowers/specs/` before implementation.

> **Path convention**: paths in this doc are **workspace-relative** (e.g. `cc-custom-plugin-template/server/...`). Reader resolves against their local Staffbase multi-repo workspace root, wherever it lives.

## Context

Staffbase CC Tech ships bespoke widgets/plugins to thousands of enterprise tenants. Each one is multi-tenant SaaS but must ship in days, not quarters. The `cc-custom-plugin-template` reached v1.0.0 parity (see `cc-custom-plugin-template/docs/superpowers/specs/2026-05-22-cross-repo-sync-design.md`). The `cc-custom-plugin-bootstrap` skill (initial draft at `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-bootstrap/SKILL.md`) automates wave 1-4 of new-plugin setup (scaffold → cross-repo PRs → Vault → CuCu → smoke).

Missing pieces:
- **Earlier-phase skills** for customer-request → user-stories → design-handoff phases that today live in engineer heads.
- **Mobile QA depth** — current template has zero mobile coverage.
- **Bootstrap skill refinement** — initial draft only; needs review + consolidation pass (P5).
- **Template-sync rollout** of additions to existing downstream plugins.

Outcome: customer-request → working POC in ≤ 1 engineer-day on dev, via composable Claude skills + a hardened template + clean handoff to mops/Grafana/Vault/CuCu.

## Inventory (already exists)

| Asset | Location | State |
|-------|----------|-------|
| Template repo | `cc-custom-plugin-template/` | v1.0.0 — Bun/Hono server + React/Vite client + Shadow-DOM widget. Remote live at `Staffbase/cc-custom-plugin-template`. |
| ADRs | `cc-custom-plugin-template/docs/adrs/` | 0001–0014 (latest: observability-hardening) |
| Bootstrap skill | `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-bootstrap/SKILL.md` | **Initial draft only — not yet reviewed.** 4-wave orchestration scaffold + MCP-first principles in place; full refinement pass is P5. |
| Reference plugins | `cc-custom-plugin-glossary/` (canonical, v1.0.0+); `cc-custom-plugin-applaunchpad/` (at parity with canonical) | both sibling repos in workspace |
| Template-sync mechanism | `cc-custom-plugin-template/docs/guides/template-sync.md` + `cc-custom-plugin-template/.template-sync.yml` | DRAFT PR + `dev` label per downstream |
| MCPs configured | Grafana per-env (dev-de1, stage-de1, prod-de1/au1/us1), Backstage, Atlassian (Jira + Confluence), Figma, Slack, Swarmia, Context7, Gmail, **Google Drive** (covers Google Docs via `read_file_content` / `download_file_content`; covers Word/Excel via Drive's text export), Google Calendar, Microsoft 365, Miro. |
| Vendored skill — `grill-me` | `cc-custom-plugin-template/.claude/skills/grill-me/SKILL.md` (vendored 2026-05-23 from [mattpocock/skills](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md), MIT) | "Interview relentlessly until shared understanding; one question at a time; recommend an answer per question; explore codebase before asking if answerable." Downstream plugins inherit via template-sync. Used by P2 user-stories, available to P3 + P4 too. |

## Pre-execution actions (done)

### A1 — Vendor `grill-me` SKILL.md into template — **DONE 2026-05-23**

- Source: [mattpocock/skills/skills/productivity/grill-me/SKILL.md](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md) (MIT, © 2026 Matt Pocock).
- Target: `cc-custom-plugin-template/.claude/skills/grill-me/SKILL.md` ✅
- Frontmatter has `source:`, `license: MIT`, `attribution:` fields. Body verbatim.
- New `Skills` nav added to `cc-custom-plugin-template/mkdocs.yml`; backing page at `cc-custom-plugin-template/docs/skills/index.md` lists vendored + plugin-owned skills.
- Commit on a `chore/vendor-grill-me` branch in `cc-custom-plugin-template/`; push + open PR.

## Sub-plans

Each `Pn` becomes a separate spec at `cc-custom-plugin-template/docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` and a separate implementation plan.

### P1 — Mobile QA pipeline additions
- **Type**: code + docs  · **Complexity**: M  · **Deps**: none
- **Scope**: Current `cc-custom-plugin-template/playwright.config.ts` covers desktop Chromium/Firefox/WebKit/Edge only. Add Playwright mobile-emulation projects (Pixel 7, iPhone 14, iPad Mini) via new `playwright.mobile.config.ts`. **First step**: confirm Staffbase BrowserStack subscription. If active, add real-device leg (iOS Safari + Android Chrome on Staffbase mobile app's WKWebView/CCT shell) — wire `BROWSERSTACK_USER` + `BROWSERSTACK_KEY` from Vault via existing template secret pattern. If not, document as future work, ship emulation only. Manual `cc-custom-plugin-template/docs/qa/mobile-checklist.md` for native shell QA (touch targets, viewport clipping, scroll trapping, iframe headers, deep-link return). CI matrix adds `mobile-emulation` leg (always) and `mobile-realdevice` leg (gated on subscription).
- **Acceptance**: `bun run test:e2e:mobile` green locally + CI; mobile checklist published in mkdocs; widget specs catch viewport-clipping / touch-target / scroll regressions; BrowserStack leg present iff subscription confirmed.
- **Files**: new `cc-custom-plugin-template/playwright.mobile.config.ts`, new `cc-custom-plugin-template/e2e/tests/widget-mobile.spec.ts`, new `cc-custom-plugin-template/docs/qa/mobile-checklist.md`, `cc-custom-plugin-template/.github/workflows/ci.yml`, `cc-custom-plugin-template/mkdocs.yml`.

### P2 — New skill: `cc-custom-plugin-user-stories` (grill-me-driven)
- **Type**: skill  · **Complexity**: S–M  · **Deps**: vendor [`grill-me`](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md)
- **Scope**: Customer-facing request (Jira ticket, Slack thread, email body, voice-note transcript) → structured user-story doc the engineer implements against. Skill takes raw customer ask + target plugin slug, fetches related Jira/Confluence via `mcp__claude_ai_Atlassian__*`, related Gmail via `mcp__claude_ai_Gmail__*`, related Slack threads via `mcp__claude_ai_Slack__*`. Then invokes the **grill-me pattern** (one-question-at-a-time, recommended-answer-per-question, codebase-explore-first) to walk the decision tree — acceptance criteria, surfaces (admin/widget/both), data shape, multi-tenant invariants, GDPR posture, telemetry expectations. Writes `docs/product/user-stories.md` in the plugin repo in INVEST shape. Stops where bootstrap skill begins — does NOT scaffold.
- **Integration**: Vendor `grill-me` into the template repo as a **sibling skill** at `cc-custom-plugin-template/.claude/skills/grill-me/SKILL.md` with attribution to [mattpocock/skills](https://github.com/mattpocock/skills) in frontmatter `source:` field. Why vendor (not just reference): the template is the canonical source for downstream plugins; vendoring guarantees every cc-custom-plugin gets grill-me without each engineer manually installing. P2's user-stories skill invokes `grill-me` by name. P3 and P4 can re-use it. Update `cc-custom-plugin-template/mkdocs.yml` to list grill-me under a new `Skills` nav entry so it shows up in published docs.
- **Acceptance**: Skill produces user-stories doc with explicit acceptance criteria per story; covered MCP surfaces actually exercised (Jira ticket pulled in, Slack thread linked, Gmail context referenced); grill-me's one-at-a-time discipline preserved (not collapsed into multi-question dumps).
- **Files**: `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-user-stories/SKILL.md`, `cc-custom-plugin-template/.claude/skills/grill-me/SKILL.md` (vendored with attribution).

### P3 — New skill: `cc-custom-plugin-design-handoff` (multi-input)
- **Type**: skill  · **Complexity**: M  · **Deps**: P2 recommended (design phase reads user stories)
- **Scope**: Design artifact → `@staffbase/design` component-selection skill. Input can be ANY of:
  - **Figma** — `mcp__claude_ai_Figma__get_design_context | get_metadata | get_screenshot`
  - **Google Docs** — `mcp__claude_ai_Google_Drive__read_file_content` + `download_file_content`
  - **Word / PDF** — Google Drive download + local parse (PDF via Read tool's `pages` param, Word via Drive's text export)
  - **Confluence / Miro** — `mcp__claude_ai_Atlassian__getConfluencePage`, `mcp__claude_ai_Miro__*` (when authenticated)
  
  Skill auto-detects input type, dispatches to right MCP, then queries the SB Design Library to map UI elements to existing SB components (`Dialog`, `Field`, `TextField`, `Table`, `Pagination`, `EmptyState`, `SegmentedControl`, etc. — canonical usage in `cc-custom-plugin-template/client/src/components/admin/SettingsDialog.tsx` and the template's `client/src/components/admin/*`). For Figma specifically, leverage `figma-code-connect` mappings if published in `@staffbase/design`. Output: `docs/design/component-map.md` per screen + flagged gaps where bespoke components are required + rationale.
- **Configurability**: Skill takes optional config block in invocation (e.g. `input-type: gdoc`, `source-url: ...`) so engineers can override auto-detection. Skill's "Common MCP toolset" section mirrors the bootstrap skill's MCP-first pattern.
- **Acceptance**: Skill produces a component map for at least three real input types (Figma + Google Doc + one of {Word, PDF, Confluence, Miro}); gaps documented with rationale; engineer implements admin views without inventing components.
- **Files**: `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-design-handoff/SKILL.md`. May require Code Connect mappings published in `@staffbase/design` (flagged as prereq spec on the design repo).

### P4 — New skill: `cc-custom-plugin-feature-impl`
- **Type**: skill  · **Complexity**: M  · **Deps**: P2 + P3 (consumes their outputs)
- **Scope**: Feature implementation skill that reads `docs/product/user-stories.md` (from P2) + `docs/design/component-map.md` (from P3) and drives implementation via `superpowers:writing-plans` + `subagent-driven-development` + cavecrew triad. Anti-overlap: bootstrap skill handles scaffolding/cross-repo/deployment; this one handles plugin-specific business logic after bootstrap. Encodes: TDD via `superpowers:test-driven-development`, logging contract per `cc-custom-plugin-template/docs/adrs/0013-logging-contract.md`, instance scoping via `c.var.scopedDb`, admin/widget split, GDPR-aware accessor revalidation pattern.
- **Acceptance**: Skill drives a small reference feature end-to-end on a real plugin (e.g. "add a tag field to items in audio-hub when its impl phase starts") with passing tests + structured logs + admin + widget touchpoints.
- **Files**: `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-feature-impl/SKILL.md`.

### P5 — Bootstrap skill refinement (umbrella)
- **Type**: skill rewrite + docs  · **Complexity**: M–L  · **Deps**: P2, P3, P4 specs drafted (so P5 knows what to consume); independent of their implementation
- **Status**: Existing `cc-custom-plugin-bootstrap/SKILL.md` is initial draft, not yet reviewed. P5 is its consolidation pass.
- **Scope**: Umbrella refinement of the bootstrap skill. Each item below is a candidate sub-section in the P5 design spec — to be confirmed/de-scoped during spec phase. Skill currently covers Steps 1-6 (confirm scope → scaffold → plan → execute → handoff → verify) at a working-but-thin level.

  Candidate refinement areas:
  1. **Consume P2/P3/P4 artifacts** — Step 1 (confirm scope) should ingest `docs/product/user-stories.md` from P2 if present; Step 2 (scaffold) should reference `docs/design/component-map.md` from P3; Step 4 (execute) should hand off to P4 feature-impl skill instead of stopping at bootstrap.
  2. **First-deployment MCP playbook** — explicit env→Grafana MCP mapping (dev-de1, stage-de1, prod-de1/au1/us1), Vault paths and how to write them safely, K8s secret lookups via kobs, kobs/observatory browser fallback when MCP misses.
  3. **Failure recovery** — explicit playbooks for partial-failure states: Vault write succeeded but VSO bind failed; CuCu register OK but plugin URL points wrong; mops PR merged but image not yet built; rollback procedure per wave.
  4. **Secrets handling decision tree** — when Vault, when env var, when K8s secret, when CuCu config field. Today this is implicit; make it a flowchart.
  5. **Branding/theming handoff** — capture custom plugin colors, logo, copy upfront in Step 1; flow into `plugin.json` + `client/src/theme.ts` + widget manifest.
  6. **Versioning + changelog** — when to cut v1.0.0 of a new plugin; CHANGELOG format; template-sync incoming-PR labeling convention; tag automation.
  7. **Dev-de1 smoke test procedure** — link the canonical glossary smoke walkthrough; if it doesn't exist as a doc, author it.
  8. **Slug constraints + rename procedure** — what to do when a slug has to change post-bootstrap (today flagged as "painful" with no instructions).
  9. **Step 1 question expansion** — current 3 questions (slug, owner, surfaces) are minimal; add: target tenants, expected scale, GDPR data classification, push-notification needs, multi-language scope, customer-facing vs internal-only.
  10. **Subagent task templates** — Wave 1a/1b/1c subagent prompts should be templated, not described in prose. Reduces drift between bootstraps.
  11. **Reference plugin tracking** — currently glossary + applaunchpad pinned as canonical; mechanism for promoting future plugins to canonical when they outpace these references.

- **Process for P5 spec phase**: invoke `grill-me` (vendored in P2) against the existing SKILL.md — walk each section, decide keep/refine/replace, lock the new shape.
- **Acceptance**: Bootstrap skill ships as v2 with: artifact consumption from P2/P3/P4 declared in frontmatter; failure-recovery + secrets-handling + versioning sections present; Step 1 questions expanded; subagent prompts templated; smoke test procedure canonical.
- **Files**: `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-bootstrap/SKILL.md` (rewrite), `cc-custom-plugin-template/docs/guides/deployment-handoff.md` (sync), `cc-custom-plugin-glossary/docs/guides/deployment-handoff.md` (canonical sync), possibly new `cc-custom-plugin-template/docs/guides/smoke-test-dev-de1.md`, `cc-custom-plugin-template/docs/guides/secrets-handling.md`, `cc-custom-plugin-template/docs/guides/failure-recovery.md`.

### P6 — Template-sync rollout: P1 → existing plugins
- **Type**: process  · **Complexity**: S  · **Deps**: P1 merged + tagged
- **Scope**: Apply `cc-custom-plugin-template/docs/guides/template-sync.md` Part B mechanism: one DRAFT PR per downstream (`cc-custom-plugin-glossary`, `cc-custom-plugin-applaunchpad`, `cc-custom-plugin-audio-hub` if implemented by then) carrying P1 (mobile QA). Apply `dev` label, verify in de1, mark ready, merge in dependency order.
- **Acceptance**: All applicable downstream plugins on the new mobile QA baseline in production within two weeks of template tag.
- **Files**: per-downstream branch `chore/template-sync-mobile-qa`; no template changes.

## Execution order

```
Week 1:   P1 (mobile QA) starts; P2 spec drafted in parallel
Week 1-2: P1 ships; P5 spec drafted in parallel
Week 2:   Tag template post-P1; P2 ships
Week 2-3: P3 ships (depends on P2 conceptually); P5 ships
Week 3-4: P4 ships (consumes P2 + P3)
Week 3-5: P6 rollout (starts once P1 tagged) — runs in calendar time
```

Why this sequence:
- **P1 first** — concrete code, independent, produces the artifact P6 propagates.
- **P5 spec can start early** but execution needs P2/P3/P4 specs drafted (so it knows what to consume). Ships parallel to P3.
- **P2 → P3 → P4** — natural request → design → impl pipeline; each consumes the prior's artifact.
- **P6** — calendar time (downstream review cycles), starts the moment P1 ships.

## Verification — how user knows the roadmap delivered

1. **Mobile QA shipping**: `bun run test:e2e:mobile` green locally; CI matrix shows `mobile-emulation` leg, plus `mobile-realdevice` leg iff BrowserStack subscription confirmed.
2. **Skills present** in `cc-custom-plugin-template/.claude/skills/`: `cc-custom-plugin-user-stories`, `cc-custom-plugin-design-handoff`, `cc-custom-plugin-feature-impl`, vendored `grill-me`, plus refined `cc-custom-plugin-bootstrap` (P5 v2).
3. **Real plugin walk-through (north star)**: pick a new customer request, run `/cc-custom-plugin-user-stories` (grill-me drives interview) → `/cc-custom-plugin-design-handoff` (input: Figma or gdoc or pdf) → `/cc-custom-plugin-bootstrap` → `/cc-custom-plugin-feature-impl`. Measured time-to-POC on dev ≤ 1 engineer-day.
4. **P6 rollout**: `gh pr list --search "template-sync-mobile-qa"` merged on `cc-custom-plugin-glossary` + `cc-custom-plugin-applaunchpad`.

## What this plan does NOT cover

- Audio-hub plugin implementation (explicitly out of scope per user — see `cc-custom-plugin-audio-hub/docs/PLAN.md` for that thread).
- JWT/unauth response hardening, API token rework — explicitly removed from scope (revisit in a later cycle if customer ops surfaces them).
- `@staffbase/design` Code Connect map authoring — flagged as P3 dependency; if absent, that's a prereq spec on the design repo, not in this roadmap.
- Backend Staffbase API surface changes.
- Customer-Control (CuCu) feature-flag changes.

## Platform escalations (carried from downstream plugins)

Items that surface across multiple `cc-custom-plugin-*` deployments but are owned by platform / core-infra, not by any individual plugin. Tracked here so they stop being rediscovered per-plugin.

### E1 — Postgres sidecar logs (unstructured, severity=Unspecified)

- **Volume**: ~1.5M+ lines / 30d / plugin, multiplied across every `cc-custom-plugin-*` namespace running the standard Postgres StatefulSet.
- **Source**: the Postgres container itself (not patroni-exporter, not pg-agent). Lines flow into Victoria Logs with `severity:"Unspecified"` because the upstream log format isn't JSON and the otel-collector has no parser configured for raw libpq output.
- **Impact**: dominates log volume on most plugin namespaces; obscures real plugin signal in cross-plugin queries; inflates retention storage.
- **Owners**: platform / core-infra (the Postgres StatefulSet is shared infra; per-plugin instances inherit the same logging shape).
- **Surfaced from**: glossary v1.0.1 plan (carried 2026-05-28 from `cc-custom-plugin-glossary/docs/superpowers/plans/2026-05-22-glossary-v1.0.1-plan.md`).
- **Suggested next step**: open a platform-team ticket (Jira `INFRA` project or equivalent) with the volume number and one example log line per env. No plugin-side action will move the needle.

### E2 — patroni-exporter preprocessing warnings

- **Sample line**: `WARNING:patroni-exporter:Not all metrics has been preprocessed: {dcs_last_seen, replication_state}`
- **Volume**: ~36 lines / min / plugin (every patroni-exporter pod, every plugin namespace).
- **Impact**: warning-level noise that masks real patroni warnings; clutters per-plugin observability dashboards.
- **Owners**: platform / core-infra (patroni-exporter image is shared).
- **Surfaced from**: glossary v1.0.1 plan (carried 2026-05-28).
- **Suggested next step**: upstream fix to the patroni-exporter image's metric preprocessing config, OR a vmagent-side log-drop rule keyed on this exact warning string. Same Jira ticket as E1.

## Critical reference files

- `cc-custom-plugin-template/playwright.config.ts` — P1
- `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-bootstrap/SKILL.md` — P5; pattern reference for P2/P3/P4
- `cc-custom-plugin-template/client/src/components/admin/SettingsDialog.tsx` — canonical SB Design composition for P3 component map
- `cc-custom-plugin-template/docs/adrs/0013-logging-contract.md` — logging contract enforced in P4
- `cc-custom-plugin-template/docs/guides/template-sync.md` — P6 mechanism
- `cc-custom-plugin-template/.claude/skills/grill-me/SKILL.md` — vendored grill-me, used by P2
- `cc-custom-plugin-template/docs/skills/index.md` — skills directory page
