# P6 — Template-Sync Rollout: P1 Mobile QA → Existing Plugins — Design

**Date:** 2026-05-23
**Author:** Max (`max@staffbase.com`)
**Status:** Draft for review

## Context

P6 is sub-plan 6 of the CC Custom Plugin Platform roadmap (see [`../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md`](../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md) §P6). It is the only process-only sub-plan and depends entirely on P1 being merged + tagged on the template.

Roadmap scope (verbatim from §P6):

- Apply [`cc-custom-plugin-template/docs/guides/template-sync.md`](../../guides/template-sync.md) Part B mechanism.
- One DRAFT PR per downstream (`cc-custom-plugin-glossary`, `cc-custom-plugin-applaunchpad`, `cc-custom-plugin-audio-hub` if implemented by then) carrying P1 (mobile QA).
- Apply `dev` label, verify in de1, mark ready, merge in dependency order.

**Acceptance** (verbatim): All applicable downstream plugins on the new mobile QA baseline in production within two weeks of template tag.

**Files** (verbatim): per-downstream branch `chore/template-sync-mobile-qa`; no template changes.

P6 reuses the established template-sync Part B flow documented in [`cc-custom-plugin-template/docs/guides/template-sync.md`](../../guides/template-sync.md) — this spec does not re-invent that mechanism; it commits to the concrete sequencing, verification protocol, and rollback shape for the P1-specific rollout.

## Downstream inventory + PR order

At time of writing (2026-05-23), the applicable downstream set is:

| # | Repo | State | Last template-sync commit | PR order |
|---|---|---|---|---|
| 1 | `cc-custom-plugin-glossary` | v1.0.0+, canonical reference, mature CI, real customer install on dev-de1 | up-to-date through 2026-05-22 cross-repo-sync | **1st** |
| 2 | `cc-custom-plugin-applaunchpad` | at parity with canonical, real customer install on dev-de1 + stage-de1 | up-to-date through 2026-05-22 cross-repo-sync | **2nd** |
| 3 | `cc-custom-plugin-audio-hub` | docs-only as of 2026-05-23 (`docs/PLAN.md` + `docs/EXECUTION.md`); no `server/`, no `client/`, no `widget/`, no `e2e/` | n/a (not bootstrapped) | **conditional** — see below |

**Why glossary first, applaunchpad second**:

1. Glossary is the canonical reference plugin per [`CLAUDE.md`](../../../../CLAUDE.md) workspace inventory and is the diff baseline used by every template-sync since v1.0.0. Landing P1 on glossary first means later sync work (P5 v2, future) can use the new glossary `playwright.mobile.config.ts` as the canonical port reference.
2. Applaunchpad ships in two environments (dev-de1 + stage-de1), so a regression there has a larger blast radius. Landing applaunchpad second lets glossary's dev preview burn in for 24–48 h before applaunchpad inherits the change. **Not** parallel — sequence matters for the post-merge soak window even though the underlying patches are independent.
3. The roadmap doesn't mandate this order; it falls out of the canonical-reference + blast-radius pair. Reviewer may swap if dev-cluster scheduling demands it; rationale must be recorded in the merging PR's description.

**Audio-hub conditional**:

- Audio-hub is **deferred from P6** as long as it stays docs-only. The template-sync mechanism only applies to plugins with the surfaces it ports — `playwright.mobile.config.ts`, `e2e/tests/widget-mobile.spec.ts`, `.github/workflows/ci.yml`, `docs/qa/mobile-checklist.md`, `mkdocs.yml`. None of those exist in audio-hub at the start of P6.
- If audio-hub's bootstrap phase begins **during** P6's calendar window (weeks 3–5), the audio-hub branch ships from the **P1-tagged template** directly — no separate sync PR is needed; P1 lands as part of audio-hub's first commit.
- If audio-hub bootstraps **after** P6 closes, it inherits P1 automatically via the same first-commit path.
- A `git notes` reference to the template SHA + P1 tag lands on audio-hub's `docs/EXECUTION.md` as a one-line "P1 inheritance" annotation so the future bootstrap knows the floor.

## Per-downstream PR shape

For each applicable downstream:

- **Branch**: `chore/template-sync-mobile-qa` (matches the roadmap-mandated branch name; same across both plugins so `git log --grep="chore/template-sync-mobile-qa"` finds the cohort later).
- **Commit message**: identical across downstreams, of the form:
  ```
  chore: sync mobile QA pipeline from template (P1 / fid-<sha>)

  Cross-port of cc-custom-plugin-template P1 — adds
  playwright.mobile.config.ts (Pixel 7 + iPhone 14 + iPad Mini),
  widget-mobile.spec.ts, mobile-checklist.md extensions, and the
  e2e-mobile CI job. Real-device leg present iff template has it.

  Source SHA: <template-sha>
  Source tag: v2026.<NN>.0  (template tag carrying P1)
  ```
- **Patch application**: `git format-patch v<previous-tag>...v<P1-tag> --stdout | git apply -3 -` from the template repo. 3-way merge surfaces drift as conflicts rather than hard-failing. For downstreams that diverged on `.github/workflows/ci.yml` (applaunchpad runs additional product-specific E2E legs), the conflict resolves by appending the new `e2e-mobile` job under the existing matrix rather than replacing the file.
- **PR title**: `chore: sync mobile QA pipeline from template (P1)`.
- **PR body** (templated):
  ```markdown
  Cross-port of cc-custom-plugin-template P1 — mobile QA pipeline.

  ## What this brings
  - playwright.mobile.config.ts with 3 mobile-emulation projects
  - widget-mobile.spec.ts widget regression spec
  - mobile-checklist.md native-shell extensions
  - e2e-mobile CI job (3-project matrix)
  - e2e-mobile-realdevice CI job (nightly, iff template has it)

  ## Verification
  - [ ] `dev` label applied → autodev → pod healthy on dev-de1
  - [ ] `e2e-mobile` matrix green on this PR (3 legs)
  - [ ] Spot-check widget on real iOS + real Android device per mobile-checklist.md
  - [ ] No regression in existing desktop e2e matrix
  - [ ] `bunx mkdocs build --strict` green

  Source: cc-custom-plugin-template@<sha> · tag <v-tag>
  CHANGELOG: see [sync] entries in template v<NN>.x
  ```
- **PR state**: DRAFT on open, per `template-sync.md` Part B Step B2 discipline.

## Dev-label verification protocol — per downstream

For each downstream, after the DRAFT PR opens:

### Glossary

1. `gh pr edit <pr-num> --add-label dev` → autodev workflow run completes successfully (`gh run list --workflow autodev.yml --limit 1`).
2. Confirm pod health: `kubectl --context dev-de1 -n cc-custom-plugin-glossary rollout status deploy/cc-custom-plugin-glossary` → `successfully rolled out`.
3. Open the glossary admin + widget on a test branch tenant on dev-de1; perform one read + one write to confirm no regression from the new CI surface bleeding into runtime.
4. Confirm `e2e-mobile` matrix is green on the PR (all three legs).
5. Pull Grafana dev-de1 logs for the plugin via `mcp__grafana-dev-de1__query_logs` over the 10-minute window post-deploy — expect zero ERROR-level entries new in this window.
6. Run the manual mobile checklist (extended) on a real iOS device + real Android device for the glossary widget; record findings in the PR description.
7. **24-hour soak window** — leave PR in DRAFT, label still applied. Re-check dev-de1 logs at hour 24 via the same MCP query. Zero new errors over 24 h → flip to ready-for-review.

### Applaunchpad

1. Identical 1–6 sequence, scoped to `cc-custom-plugin-applaunchpad`.
2. **48-hour soak window** instead of 24 h, because applaunchpad ships across dev-de1 + stage-de1. The extra environment doubles the surface area worth soaking.
3. Stage-de1 check: after dev-de1 24-h burn-in is clean, push the same patch to a separate `chore/template-sync-mobile-qa` branch with stage-de1 manifests and confirm pod health via `kubectl --context stage-de1 ...` and `mcp__grafana-stage-de1__query_logs`. Stage-de1 is part of applaunchpad's deployment shape, not glossary's — applies to applaunchpad only.

### Cross-downstream

Both PRs apply the `dev` label simultaneously — autodev's conflict-handling (documented in `template-sync.md` Step B3) handles the fast-forward merge. If conflicts surface, unlabel applaunchpad temporarily, let glossary's `dev` branch settle, then re-label applaunchpad.

## Merge gating signals

A downstream PR is mergeable when **all** of the following hold simultaneously, in this order:

| # | Signal | Source | Gate |
|---|---|---|---|
| 1 | `e2e-mobile` matrix green on the PR head | GitHub Actions | required check |
| 2 | Existing `Quality Gates` + `Playwright matrix` + `Playwright A11y` green on the PR head | GitHub Actions | required check |
| 3 | `dev`-label autodev run succeeded on the PR head | GitHub Actions `autodev.yml` | manual verify via `gh run list` |
| 4 | Pod healthy on dev-de1 (applaunchpad: also stage-de1) | `kubectl rollout status` | manual verify |
| 5 | Zero new ERROR-level logs in the post-deploy soak window (24 h glossary, 48 h applaunchpad) | Grafana MCP per env | manual verify, recorded in PR thread |
| 6 | Manual mobile-checklist run completed on real iOS + Android, no regressions | physical device | manual verify, attached to PR |
| 7 | CODEOWNERS approval present | GitHub | branch protection |
| 8 | PR flipped from DRAFT → ready-for-review | GitHub | manual |

If any signal flips red post-merge (e.g. nightly real-device leg fails next morning), see §Rollback procedure below.

## Rollback procedure — per downstream

If mobile QA regresses on a downstream **post-merge**, the rollback shape depends on which signal fires:

| Failure mode | Trigger | Rollback |
|---|---|---|
| `e2e-mobile` matrix red on `main` immediately after merge | desktop CI saw it green but the sequential mobile leg on `main` failed (rare — usually a port artifact like missing dep) | revert the merge commit with `gh pr create --title "revert: mobile QA sync"`, apply `dev` label, verify revert is green, merge revert; investigate via a follow-up DRAFT PR off the same branch. **Do not** force-push to `main`. |
| Pod crashlooping on dev-de1 post-deploy | runtime regression (e.g. Playwright deps somehow affect runtime build — shouldn't happen with P1's isolation, but possible if `package.json` scripts diverge) | scale deploy to 0 (`kubectl scale deploy/<name> --replicas=0`) to stop noise, revert merge, redeploy via autodev. **No prod impact** — P1 only touches dev-de1 until both PRs merge. |
| Real-device nightly leg goes red on `main` | true regression on real iOS or Android shell that emulation missed | leave `main` as-is (real-device leg is nightly-only, not PR-blocking, so it does not block other merges); open a `fix: real-device mobile regression` PR with the failing spec / widget patch; do **not** revert P1 itself — the spec catching the bug is the value. |
| Manual checklist surfaces a regression on a customer device after merge | post-merge field finding | open a follow-up PR scoped to the specific surface (touch-target / scroll-trap / etc.) on the downstream; cross-port the fix back to the **template** so other downstreams inherit it; do not revert the P1 sync. |
| Stage-de1 pod regression (applaunchpad only) | regression caught after 24 h dev-de1 soak but before stage promotion | revert the merge on applaunchpad's `main`; leave glossary alone; open follow-up fix PR. Glossary is unaffected (no stage-de1). |

**Hard rule**: never revert P1 from the template repo itself in response to a downstream rollback. The template is canonical — fix at the source if the bug is generic, fix in the downstream if it is product-specific. The template-sync.md guide already enforces this in its anti-patterns section; P6 inherits the rule.

## Rollout calendar

Roadmap §Execution order: P6 runs weeks 3–5, **starts the moment P1 ships**. Concrete shape:

- **Week 3 Day 1**: P1 merges + tag cut on template. Glossary DRAFT PR opened same day (Part B Step B2).
- **Week 3 Days 1–2**: glossary `dev` label preview running; 24 h soak begins.
- **Week 3 Day 3**: glossary verified, flipped to ready-for-review, merged into glossary `main`.
- **Week 3 Day 3**: applaunchpad DRAFT PR opened (using the same template-sync commit, patched against applaunchpad's `main`).
- **Week 3 Days 3–5**: applaunchpad dev-de1 + stage-de1 48 h soak.
- **Week 4 Day 1**: applaunchpad verified, merged.
- **Week 4–5**: monitoring window — nightly real-device legs report for 7 days before P6 closes.

Closes when both downstreams' `main` carries P1 and seven consecutive nightly real-device legs (per env, per downstream) are green — or if the real-device leg is absent (BS subscription NO), when both downstreams have 7 days of clean emulation-only CI on `main`.

## Files touched

```
cc-custom-plugin-glossary/                                  (per template-sync.md flow)
├── playwright.mobile.config.ts                             (new — copied verbatim from template)
├── e2e/tests/widget-mobile.spec.ts                         (new — copied; selectors map to glossary widget)
├── docs/qa/mobile-checklist.md                             (extended — same 4 subsections as template)
├── .github/workflows/ci.yml                                (e2e-mobile job appended to matrix)
├── mkdocs.yml                                              (nav update)
├── package.json                                            (test:e2e:mobile script)
└── CHANGELOG.md                                            (one entry — "sync from template P1")

cc-custom-plugin-applaunchpad/                              (per template-sync.md flow)
├── playwright.mobile.config.ts                             (new)
├── e2e/tests/widget-mobile.spec.ts                         (new — selectors map to applaunchpad widget; tap targets and shadow-DOM container ids differ but assertion shape is identical to template)
├── docs/qa/mobile-checklist.md                             (extended)
├── .github/workflows/ci.yml                                (e2e-mobile job appended; applaunchpad's existing product-specific E2E legs preserved)
├── mkdocs.yml                                              (nav update)
├── package.json                                            (test:e2e:mobile script)
└── CHANGELOG.md                                            (one entry)

cc-custom-plugin-audio-hub/                                 (conditional — only if bootstrapped during P6)
└── docs/EXECUTION.md                                       (one-line git-notes-style annotation: "P1 inherited from template tag v2026.<NN>.0")

cc-custom-plugin-template/                                  (NO changes — per roadmap §P6 "no template changes")
```

`widget-mobile.spec.ts` per downstream is a port — selectors that don't apply (e.g. glossary has no "play button" that applaunchpad has) are removed; assertion shape stays identical. The template version is the canonical reference for the port.

## Acceptance criteria

1. Glossary `main` and applaunchpad `main` both carry the P1 surface (`playwright.mobile.config.ts`, `widget-mobile.spec.ts`, mobile-checklist extensions, CI `e2e-mobile` job) within two weeks of the P1 template tag.
2. Both downstreams' production pods are healthy (zero new ERROR-level logs over the soak windows defined above) at merge time.
3. `gh pr list --search "template-sync-mobile-qa" --state merged` returns both PRs.
4. Audio-hub state recorded — either it bootstrapped during P6 and inherited P1 in its first commit, or it stays docs-only and a one-line annotation pins the P1 floor for whenever it bootstraps.
5. No revert PR opened against the template `main` for P1 during the P6 window. (Revert PRs against downstream `main` are tolerated and tracked in §Rollback procedure.)
6. The next time a sync PR opens against either downstream (a future template change), `git log --grep="chore/template-sync-mobile-qa"` returns the cohort PRs and the template SHA stamp is preserved.

## Open questions

| Open question | Best-guess answer | Needs |
|---|---|---|
| Should the 24h glossary / 48h applaunchpad soak windows be wall-clock or business-hours? | Wall-clock — P1 is QA pipeline, not customer-facing runtime. Errors that surface only during business hours would surface in the 24-h window regardless. | None — author decision. |
| If P1's real-device leg never lands (BS subscription NO), do downstreams still get the `e2e-mobile-realdevice` job stub for forward-compat? | NO — ship only what the template ships. Forward-compat stubs rot. When BS lands later, that's a separate sync PR. | None — author decision. |
| Who runs the manual mobile checklist on real devices for each downstream? | Author (Max) for glossary; applaunchpad lead for applaunchpad (CC tech rotates this; named owner identified at PR open). | Confirm with applaunchpad lead at PR open. |
| If audio-hub bootstraps mid-P6 and surfaces a P1 incompatibility (e.g. audio widget has a feature that breaks one of the new selectors), do we ship audio-hub with a P1 carve-out or block audio-hub? | Carve-out + open a follow-up PR back on the template to make P1 more generic. Audio-hub blocking on P1 would invert the roadmap precedence — the bootstrap is the higher-value milestone. | Confirm with user if audio-hub starts during P6 window. |
| Do we need a `[sync] [docs]` separate-PR variant for the checklist-only port if a future template-sync PR has only doc changes (per the template-sync.md anti-pattern about mixing docs and code)? | For P1 specifically: NO — the checklist extensions are tied to the spec they support, port them together. For future syncs: defer to the existing template-sync.md guidance. | None — deferred to future syncs. |
| Should P6 also bump the downstreams' protected-branch required-checks list to add `e2e-mobile`? | YES — required from day one, mirrors the template's posture (see [`./2026-05-23-P1-mobile-qa-design.md`](./2026-05-23-P1-mobile-qa-design.md) §CI matrix wiring open question 3). Each downstream's PR includes the branch-protection update as a separate non-code task in the PR description checklist. | User confirmation on branch-protection update per downstream. |

## Implementation plan pointer

Implementation plan will land at `cc-custom-plugin-template/docs/superpowers/plans/2026-05-23-P6-template-sync-rollout-plan.md` after this spec is approved. Plan covers: glossary DRAFT PR creation (Day 1) → glossary dev label + 24h soak (Days 1–2) → glossary merge (Day 3) → applaunchpad DRAFT PR creation (Day 3) → applaunchpad dev + stage soak (Days 3–5) → applaunchpad merge (Week 4 Day 1) → 7-day monitoring window (Weeks 4–5) → P6 close.

## References

- Roadmap: [`../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md`](../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md) §P6
- Sibling P1 spec: [`./2026-05-23-P1-mobile-qa-design.md`](./2026-05-23-P1-mobile-qa-design.md)
- Template-sync mechanism: [`cc-custom-plugin-template/docs/guides/template-sync.md`](../../guides/template-sync.md) — especially Part B
- Cross-repo-sync precedent: [`./2026-05-22-cross-repo-sync-design.md`](./2026-05-22-cross-repo-sync-design.md)
- Workspace inventory: [`/Users/ms/DEV/Github_Staffbase/CLAUDE.md`](../../../../CLAUDE.md)
- Glossary repo (canonical reference): `cc-custom-plugin-glossary/`
- Applaunchpad repo: `cc-custom-plugin-applaunchpad/`
- Audio-hub repo (docs-only at P6 start): `cc-custom-plugin-audio-hub/docs/PLAN.md`, `cc-custom-plugin-audio-hub/docs/EXECUTION.md`
- Sibling spec for tone/density reference: [`./2026-05-23-P5-bootstrap-skill-refinement-design.md`](./2026-05-23-P5-bootstrap-skill-refinement-design.md)
