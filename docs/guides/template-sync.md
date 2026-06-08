# Template sync — evolving the template and rolling out to existing plugins

This template is **canonical**. Every downstream custom plugin (`cc-custom-plugin-applaunchpad`, `cc-custom-plugin-glossary`, `cc-custom-plugin-audio-hub`, and any future fork) was spun up from this repo and should keep tracking it.

When you add a generic improvement here, you ideally want it to land on every downstream plugin too — quickly, predictably, and verifiable in a real dev cluster before it touches production.

This guide covers both halves of that flow:

1. **Adding improvements to the template** — what counts as "generic", how to land them safely.
2. **Rolling out to existing plugins** — one DRAFT PR per downstream + the `dev` label to get a live preview in the dev cluster before merging.

---

## Contents

- [Mental model](#mental-model)
- [Part A — Adding an improvement to the template](#part-a--adding-an-improvement-to-the-template)
  - [Step A1 — Decide if the change is template-eligible](#step-a1--decide-if-the-change-is-template-eligible)
  - [Step A2 — Branch + write tests first](#step-a2--branch--write-tests-first)
  - [Step A3 — Land the change with an ADR if architectural](#step-a3--land-the-change-with-an-adr-if-architectural)
  - [Step A4 — Update CHANGELOG with a "downstream-sync" line](#step-a4--update-changelog-with-a-downstream-sync-line)
- [Part B — Rolling out to existing plugins](#part-b--rolling-out-to-existing-plugins)
  - [Step B1 — Inventory the downstreams](#step-b1--inventory-the-downstreams)
  - [Step B2 — One DRAFT PR per downstream](#step-b2--one-draft-pr-per-downstream)
  - [Step B3 — Apply the `dev` label → autodev → dev cluster](#step-b3--apply-the-dev-label--autodev--dev-cluster)
  - [Step B4 — Verify in dev, then mark ready for review](#step-b4--verify-in-dev-then-mark-ready-for-review)
  - [Step B5 — Merge in dependency order](#step-b5--merge-in-dependency-order)
- [Cross-port checklist](#cross-port-checklist)
- [Mechanical helpers](#mechanical-helpers)
- [Tracking sync drift at scale](#tracking-sync-drift-at-scale)
- [Future — automated rollout PRs (once the template has a remote)](#future--automated-rollout-prs-once-the-template-has-a-remote)
- [Anti-patterns](#anti-patterns)

---

## Mental model

```
                       ┌──────────────────────────────┐
                       │  cc-custom-plugin-template   │  ← canonical
                       │  (this repo, main branch)    │
                       └──────────────┬───────────────┘
                                      │  port (git diff / cherry-pick)
        ┌─────────────────────────────┼─────────────────────────────┐
        ▼                             ▼                             ▼
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│ applaunchpad       │    │ glossary           │    │ audio-hub          │
│ DRAFT PR + `dev`   │    │ DRAFT PR + `dev`   │    │ DRAFT PR + `dev`   │
│ → autodev preview  │    │ → autodev preview  │    │ → autodev preview  │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

- **Template** owns the generic surface: middleware, GDPR/user-cache, observability, build/test scaffolding, base schema, deployment workflow, ADRs, **helper scripts under [scripts/](../../scripts/)** (vault bootstrap, doc-screenshot capture, dependabot-blocker checker, etc.), **and the generic docs that explain all of the above** (everything under [docs/architecture/](../architecture/), [docs/reference/](../reference/), most of [docs/guides/](.), [docs/adrs/](../adrs/), plus the template-owned sections of `README.md` / `AGENTS.md` / `CLAUDE.md`).
- **Downstream** owns its product surface: routes, tables, UI, widget — everything that makes it a *glossary* vs *audio hub* vs *applaunchpad* — plus the product-specific docs that describe those (e.g. a glossary's "categories model" or an audio-hub's "transcript pipeline").
- A "generic improvement" is anything you'd want **every** plugin to inherit — security hardening, performance fixes, new observability, refactors, build/lint tooling, CI improvements, ADRs, **or documentation updates that describe template-owned behaviour** (a new GDPR drill, a refreshed architecture diagram, a clarified session-flow doc, a new ADR, a tightened AGENTS.md rule).

If only one downstream needs it, it does not belong in the template.

---

## Part A — Adding an improvement to the template

### Step A1 — Decide if the change is template-eligible

Apply this filter before opening a template PR. It covers **code, configuration, *and* documentation** — a markdown-only change is just as eligible (and just as expected to be ported) as a server-side patch.

- **Generic?** Would *every* downstream want it? If not, it lives in the downstream that needs it. For docs: would the explanation make equal sense in a glossary, audio-hub, or applaunchpad readme? If yes → template doc.
- **Stable?** Would you regret writing this if a downstream had to revert it next week? If yes, prove it in one downstream first, *then* promote. Docs describing *speculative* behaviour belong in a downstream until the feature itself stabilises in the template.
- **Self-contained?** Does it touch only template-owned files (no domain models, no plugin-specific tables, no product UI, no downstream-only doc sections like "Categories" or "Audio pipeline")? If it bleeds into product code or product docs, split the PR.

Examples of doc/MD changes that belong in the template (and therefore get a `[sync]` CHANGELOG entry):

- A new or revised ADR under [docs/adrs/](../adrs/).
- Updates to [docs/architecture/](../architecture/), [docs/reference/](../reference/), or generic [docs/guides/](.).
- New constraints or rules in `AGENTS.md` / `CLAUDE.md` that apply to every downstream.
- README sections covering generic setup, env vars, the build/test matrix, or the deployment flow.
- A new troubleshooting recipe for a problem that can occur in any downstream.

Examples of doc/MD changes that **stay in the downstream** (no sync):

- The product-specific README sections (what the plugin *does* — glossary entries, audio episodes, app launchpad tiles).
- Domain-model docs (`docs/<product-name>-data-model.md`).
- Downstream-specific runbooks tied to that product's behaviour.

Examples of **helper-script changes** that belong in the template (`[sync] [scripts]` sub-tag) — these behave more like code than docs (must be tested) but are usually self-contained:

- [scripts/vault-bootstrap.sh](../../scripts/vault-bootstrap.sh) — Vault credential rotation flow. Often drifts (template currently 282 lines, applaunchpad 302; the delta is a candidate for back-port → template, then re-sync everywhere).
- [scripts/check-dependabot-blockers.sh](../../scripts/check-dependabot-blockers.sh) — dependency-update gate.
- [scripts/capture-docs-screenshots.ts](../../scripts/capture-docs-screenshots.ts) / [scripts/capture-docs-videos.ts](../../scripts/capture-docs-videos.ts) — doc asset pipelines (the *script* is generic; the *output assets* are product-specific and stay downstream-only).
- [scripts/dev.ts](../../scripts/dev.ts) — the dev runner.

Examples of helper scripts that **stay in the downstream**:

- Product-specific seeders (e.g. `rewrite-seed-urls.ts`, `upload-generic-images.ts` in applaunchpad).
- Product-specific data fixtures (`generic-apps-media.json` etc.).

When a generic script *and* a downstream-only script live side-by-side under `scripts/`, that's fine — the cross-port mechanics in [Part B](#part-b--rolling-out-to-existing-plugins) only touch the generic one.

Borderline calls — for example, "a helper that 2 of 3 downstreams will use" or "a doc page that's half-generic, half-product" — should usually start in the downstream that's pulling it. Promote to template only after the second consumer needs it, and **split half-and-half docs** into a generic page (template) plus a product-specific page (downstream) before promoting.

### Step A2 — Branch + write tests first

From this repo's `main`:

```bash
git checkout -b feat/<short-name>          # or chore/, fix/, refactor/, docs/
# … implement, with tests
bun run check                              # Biome clean
bun test                                   # server suite green
bun run --filter ./client test             # client suite green
bunx playwright test --project chromium    # E2E smoke (full matrix runs in CI)
```

The test coverage gate is non-negotiable here: a regression in template `main` cascades into every downstream PR, multiplying the blast radius.

**For docs-only PRs** (no code change), use the `docs/<short-name>` branch prefix, skip the unit/E2E suites, and instead:

- Verify markdown renders cleanly: `bunx markdownlint-cli2 "docs/**/*.md"` (or whatever the repo's lint task is).
- Check internal links: `bunx markdown-link-check docs/<changed-file>.md`.
- If the doc lives in the MkDocs nav, run `bunx mkdocs build --strict` to catch broken cross-references.
- Eyeball the rendered preview locally (`bunx mkdocs serve`) before opening the PR.

`bun run check` (Biome) still runs and is still required — it covers code-fence languages, JSON snippets, and any inline TypeScript that ships in the doc.

### Step A3 — Land the change with an ADR if architectural

If the improvement encodes a *decision* (auth flow, caching policy, deployment shape, new external dependency, log contract), add an ADR under [docs/adrs/](../adrs/) using the next number in sequence. ADRs are how a downstream maintainer who picks up the change six months later understands *why*.

If the change is mechanical (bumping a dep, fixing a typo, adding a missing test), no ADR — just a clean commit message and a CHANGELOG entry.

### Step A4 — Update CHANGELOG with a "downstream-sync" line

The template's [CHANGELOG.md](../../CHANGELOG.md) is the source of truth that downstream maintainers consult to know *what should be ported*. Every PR that lands here must add a one-line entry under `### Added` / `### Changed` / `### Fixed` / `### Security` describing the change in user-visible terms.

Tag the entry with `[sync]` when it should be ported downstream — **including docs-only changes**:

```md
### Security
- `[sync]` Remove dead `INSTANCE_URL_CACHE` — apiToken must be fetched fresh per
  request anyway; the URL memo was write-only. Cross-port via `fid-89116d1e0d30`.

### Changed
- `[sync] [docs]` Rewrite [docs/architecture/sessions.md](../architecture/sessions.md)
  to reflect the strict-GDPR `gateAccessor` middleware introduced in ADR-0012.
  Replaces the older "JWT validation only" description.
```

The `[docs]` sub-tag is optional but useful — it signals to the downstream maintainer that the port is markdown-only (no test run needed, much faster to review).

If a change is *template-internal only* (e.g. CI tweak that doesn't apply downstream, or a doc that describes template-only mechanics like this very guide), tag it `[template-only]` so the rollout step knows to skip it.

Once the template PR is merged, the change is ready to be rolled out.

---

## Part B — Rolling out to existing plugins

### Step B1 — Inventory the downstreams

The current downstreams are tracked at the workspace root in [CLAUDE.md](../../../CLAUDE.md). At time of writing:

| Repo                              | Has remote?         | Default branch | CI gate            |
|-----------------------------------|---------------------|----------------|--------------------|
| `cc-custom-plugin-applaunchpad`   | ✅ Staffbase/...    | `main`         | Quality Gates + Playwright matrix + Review Swarm |
| `cc-custom-plugin-glossary`       | ✅ Staffbase/...    | `main`         | Quality Gates + Playwright matrix + Review Swarm |
| `cc-custom-plugin-audio-hub`      | ⚠️  local-only      | `main`         | local only         |

Run `gh repo list Staffbase --topic cc-custom-plugin` to confirm the live set before each rollout — new forks may have appeared.

For local-only repos, you cannot open a draft PR or use the `dev` label. Apply the patch on a local branch and ship it later when the repo gets a remote.

### Step B2 — One DRAFT PR per downstream

Open one PR per downstream — **never combine several plugins into a single PR**, because:

- Each repo has its own CI matrix and reviewers.
- The `dev` label deploys *that one repo's* PR head to *that one repo's* dev cluster.
- A regression in one downstream should not block rollout in the others.

```bash
# from inside each downstream repo
git checkout main && git pull
git checkout -b chore/template-sync-<short-name>

# Option 1: cherry-pick the template commit (works when paths are identical)
# adjust ../cc-custom-plugin-template to wherever the template repo lives on your machine
git fetch ../cc-custom-plugin-template main
git cherry-pick <template-commit-sha>

# Option 2: apply as a patch (when paths drift)
(cd ../cc-custom-plugin-template && git format-patch -1 <sha> --stdout) \
  | git apply -3 -

# Resolve any plugin-specific drift, then run the full local gate:
bun run check && bun test
bunx playwright test --project chromium    # smoke before pushing

git push -u origin chore/template-sync-<short-name>
gh pr create --draft \
  --title "chore: sync <short-name> from template" \
  --body "Cross-port of cc-custom-plugin-template@<sha> ($CHANGELOG_LINK).

Why DRAFT: see ./docs/guides/template-sync.md — promote to ready after \`dev\` label preview confirms green in dev cluster."
```

**Always DRAFT.** A draft PR signals "this is a candidate, not yet asking for review", suppresses notification noise, and lets you iterate on the `dev` preview without spamming reviewers. The template-sync PR only flips to ready-for-review after the dev cluster preview is verified.

### Step B3 — Apply the `dev` label → autodev → dev cluster

Every downstream repo (and this template) ships with an `autodev` workflow ([../../.github/workflows/autodev.yml](../../.github/workflows/autodev.yml)) that watches PRs for the `dev` label. The behaviour:

- Any PR labelled `dev` gets merged (with all other `dev`-labelled PRs) into the `dev` branch on every push.
- The `dev` branch is wired to the dev cluster via Flux → the merged build is live a few minutes after the label lands.
- Unlabel → drop out of the merge train on the next push.

To use it on a template-sync PR:

```bash
gh pr edit <pr-number> --add-label dev
```

After ~3–5 minutes (workflow run + Flux reconcile), the plugin pod in the dev cluster is running the synced code. Confirm with:

```bash
gh run list --workflow autodev.yml --limit 1
# expect: completed / success on the head SHA

# pod check (example — adjust namespace per plugin)
kubectl --context dev-de1 -n <plugin-ns> rollout status deploy/<plugin-name>
```

> **Conflict handling:** when more than one PR carries the `dev` label, autodev attempts a fast-forward merge. If they conflict, the workflow run fails and posts a comment on the offending PR — unlabel one of the two, push a fix, re-label.

### Step B4 — Verify in dev, then mark ready for review

Run the verification that matches the *kind* of change you ported. As a baseline for every sync PR:

1. **Pod health** — `kubectl … rollout status` returns `successfully rolled out`.
2. **Smoke** — open the plugin in a dev branch tenant, sign in, perform one read + one write.
3. **Observability** — confirm no new error-level logs (use the Grafana logging MCP if available, or `kubectl logs -l app=<plugin-name> --tail=500 | grep -i error`).
4. **CI matrix** — the regular `ci.yml` (Quality Gates + Playwright matrix + a11y) must be green on the PR. The `dev` label does not skip CI; it is additive.

If the change is security- or GDPR-sensitive (anything touching `ssoMiddleware`, `gateAccessor`, the cache layer, or the upsert path), also exercise:

- 401 on a deleted accessor (synthesise via the localdev override headers documented in `.env.example`).
- 200 on a valid accessor after `users.last_verified_at` ages past `USER_ACCESSOR_REVALIDATE_SECONDS`.

**For docs-only sync PRs**, skip the `dev` label / Flux preview entirely — there is no code to deploy. Instead:

1. **Render check** — open the PR's "Files changed" tab on GitHub and confirm every page renders (no broken tables, code fences, mermaid blocks).
2. **Link check** — make sure relative links still resolve in the downstream (the path depth can differ slightly between template and downstream).
3. **CI matrix** — markdownlint / `mkdocs build --strict` (where wired up) must be green.
4. **TechDocs publish** — if the downstream publishes to Backstage TechDocs, confirm the `techdocs.yml` workflow run on the PR head completes successfully before flipping to ready-for-review.

If all gates pass:

```bash
gh pr ready <pr-number>             # flip out of draft
gh pr edit <pr-number> --remove-label dev    # optional: drop from dev train so the branch isn't held open
```

If verification fails, keep the PR in draft, push a fix to the same branch — autodev will re-merge on the next push.

### Step B5 — Merge in dependency order

When the same logical change lands across multiple plugins:

- **Independent changes** (e.g. a doc edit, a CI bump): merge in any order.
- **Schema or migration changes**: each plugin has its own database — no cross-plugin ordering — but inside one plugin, run `bun migrate` against staging *before* merging if migration is destructive.
- **Coordinated security fixes**: merge the more-exposed plugin first (typically the one with the largest user base) so the high-blast-radius fix lands first; the others trail close behind.

The template itself never blocks downstream merges — once a fix is on template `main`, downstreams can land at their own pace.

---

## Cross-port checklist

Tape this to your screen before opening sync PRs:

- [ ] Change is genuinely generic (filter from [Step A1](#step-a1--decide-if-the-change-is-template-eligible)) — same filter applies to docs and code.
- [ ] Template `main` has the change merged + CHANGELOG entry with `[sync]` tag (and `[docs]` sub-tag for docs-only changes).
- [ ] One DRAFT PR per downstream, branch named `chore/template-sync-<short-name>` (or `docs/template-sync-<short-name>` for docs-only).
- [ ] Identical commit message across downstreams (so `git log --grep` finds the cohort later).
- [ ] `dev` label applied → autodev success → pod healthy in dev cluster. *Skip for docs-only PRs — no deploy needed.*
- [ ] Smoke + observability check passed; security/GDPR drills passed if applicable. *Docs-only PRs: render + link check + TechDocs publish instead.*
- [ ] CI matrix (Quality Gates + Playwright + a11y, or markdownlint / `mkdocs build --strict` for docs-only) green on every PR.
- [ ] Relative doc links still resolve in each downstream (path depth can drift between template and downstream).
- [ ] PR flipped from draft → ready-for-review.
- [ ] Local-only downstreams (e.g. `audio-hub` while remote-less) committed locally with a `git notes` reference to the template SHA for future replay.

## Mechanical helpers

A few commands that turn up repeatedly in sync work:

```bash
# Find downstream files that drifted from the template version
diff -ru ../cc-custom-plugin-template/server/src/lib/ server/src/lib/

# Same diff for the generic doc surface (architecture, reference, ADRs, guides)
diff -ru ../cc-custom-plugin-template/docs/architecture/ docs/architecture/
diff -ru ../cc-custom-plugin-template/docs/reference/    docs/reference/
diff -ru ../cc-custom-plugin-template/docs/adrs/         docs/adrs/

# Spot drift in helper scripts (template-owned ones — ignore product-specific ones)
for f in vault-bootstrap.sh check-dependabot-blockers.sh capture-docs-screenshots.ts capture-docs-videos.ts dev.ts; do
  diff -q "../cc-custom-plugin-template/scripts/$f" "scripts/$f" 2>/dev/null
done

# Find every "[sync]" CHANGELOG entry that may still be open downstream
grep -n "\[sync\]" ../cc-custom-plugin-template/CHANGELOG.md

# Find every docs-only sync candidate specifically
grep -n "\[sync\] \[docs\]" ../cc-custom-plugin-template/CHANGELOG.md

# Confirm a downstream has already absorbed a template SHA
git log --grep="<template-sha-short>" --oneline

# Spot any downstream still missing a sync (run from workspace root)
for d in cc-custom-plugin-*; do
  echo "--- $d ---"
  git -C "$d" log --grep="fid-89116d1e0d30" --oneline
done
```

Keep the cherry-pick path stable: prefer the *same file path* in template and downstream wherever practical. The cost of a few generic directory names (`server/src/lib/`, `server/src/middleware/`, `server/src/db/migrations/`) is far less than the cost of patch-conflict resolution every time a generic fix lands.

## Tracking sync drift at scale

When there are more than three downstreams, the manual approach starts to fray. Two lightweight options:

1. **GitHub Project** with one card per `[sync]` CHANGELOG entry and one column per downstream — moves from `Open` → `Drafted` → `Verified in dev` → `Merged`.
2. **`scripts/check-template-drift.sh`** in each downstream — diffs key template-owned directories against the local copy and prints a one-line summary. Add it to the CI quality-gates job as advisory-only. (Not shipped today; file as a follow-up task when needed.)

For now, the `[sync]` tag + the `git log --grep` snippet above is enough.

## Future — automated rollout PRs (once the template has a remote)

The template is currently local-only (no GitHub remote, no release tags — see the **Notes for plugins forked from this template** block in [CHANGELOG.md](../../CHANGELOG.md)). Once it gets pushed to `Staffbase/cc-custom-plugin-template` and starts cutting versioned releases, the manual "one DRAFT PR per downstream" step in [Part B](#part-b--rolling-out-to-existing-plugins) becomes a clear candidate for automation. Sketching the shape so it's not lost:

**Trigger.** GitHub Actions workflow on the template repo, fired by a `release: published` event (CalVer tag, e.g. `v2026.21.0`). Workflow lives in `.github/workflows/rollout-to-downstreams.yml`.

**Per-downstream job.** A `matrix:` over a hand-maintained list of downstream repos (`cc-custom-plugin-applaunchpad`, `cc-custom-plugin-glossary`, `cc-custom-plugin-audio-hub`, etc.). For each entry:

1. Clone the downstream with a checkout token that has `contents: write` + `pull-requests: write`.
2. Branch off downstream `main` → `chore/template-sync-<template-version>`.
3. Apply the template release as a patch via `git format-patch v<previous>...v<current> --stdout | git apply -3 -` (3-way merge so plugin-specific drift surfaces as a normal conflict rather than a hard fail).
4. If conflicts → leave them in the working tree, push the branch with the conflict markers intact, and open the PR as DRAFT with a body that lists the conflicting files and a "resolve manually, then run CI" instruction. (Better to surface the conflict than skip the downstream.)
5. If clean → push and open a DRAFT PR with body auto-populated from the template's `CHANGELOG.md` `[sync]`-tagged entries between the two versions.
6. Apply the `dev` label automatically so the [Step B3](#step-b3--apply-the-dev-label--autodev--dev-cluster) preview kicks in without manual labelling.

**Eligibility (which downstreams get a PR).** The model is **file-driven**, not topic-driven — a downstream participates only if it ships a `.template-sync.yml` file at its repo root. No GitHub topic tagging required; the file *is* the opt-in.

Why file over topic: a topic is org metadata that anyone with push can flip silently and that doesn't live alongside the code. A file in the repo is reviewable in a PR, lives next to the code it governs, and survives forks intact.

Layered checks (each filter additive — a downstream must pass every layer):

1. **Discovery via GitHub code search** — workflow lists candidates:
   ```bash
   gh search code 'filename:.template-sync.yml org:Staffbase' --json repository \
     | jq -r '.[].repository.nameWithOwner' | sort -u
   ```
   Any repo in the org that ships the file shows up here. Repos without the file are invisible to the rollout — that is the primary allowlist.

2. **Archived / template filter.** For each candidate, `gh repo view <owner>/<repo> --json isArchived,isTemplate` and skip if either is `true`. Archived forks (e.g. `cc-custom-plugin-code-generator` once it's archived) drop out automatically; the template repo itself can't accidentally sync to itself.

3. **Hard-coded denylist backstop.** Belt-and-suspenders against a legacy repo accidentally getting the file copied in (e.g. someone clones from `cc-custom-plugin-example` and ports it without thinking). Lives in the workflow:
   ```yaml
   # .github/workflows/rollout-to-downstreams.yml
   env:
     DENYLIST: |
       cc-custom-plugin-example          # historical reference fork, do not modify
       cc-custom-plugin-code-generator   # older / archived
       cc-custom-plugin-template         # the template itself (defence-in-depth)
   ```
   **One-line comment per entry** is mandatory; otherwise the list becomes archaeology in six months. With file-driven discovery this layer rarely fires in practice — it exists for the day someone accidentally copies `.template-sync.yml` into a repo that shouldn't participate.

4. **`.template-sync.yml` config.** The file is both the opt-in marker *and* the per-repo configuration:
   ```yaml
   # .template-sync.yml — placed at the root of every participating downstream
   enabled: true                  # set to false to pause auto-sync (e.g. during a freeze window)
   paths-to-skip:                 # optional — patch hunks touching these paths are dropped
     - server/src/routes/legacy-export.ts
   reviewers:                     # optional — overrides CODEOWNERS for sync PRs
     - "@Staffbase/cs-tech"
   notes: |                       # optional — free-text shown in the auto-PR body for context
     This plugin freezes syncs during weeks 49-52 (annual feature freeze).
   ```
   Workflow reads the file; if `enabled: false`, the repo is silently skipped (logged but no PR). This gives each downstream maintainer the final say without leaving the participation universe.

5. **CODEOWNERS-driven review assignment.** The workflow assigns the PR to whoever owns `docs/guides/template-sync.md` (or the repo root) in the downstream's `CODEOWNERS`, unless `.template-sync.yml` `reviewers:` overrides it. Right person gets the review request without anyone editing the auto-PR.

**Logic order:** code search finds `.template-sync.yml` → drop archived/template → drop denylist → check `enabled: true` → port. Layers 1, 2, 3 are workflow-controlled; layer 4 lives in the downstream so its maintainer always has the final say.

**Worked example.** For the current org state (2026-05-23) the layers resolve as:

| Repo                              | Has `.template-sync.yml`? | Archived | Denylist | `enabled`? | Auto-PR? |
|-----------------------------------|:-------------------------:|:--------:|:--------:|:----------:|:--------:|
| `cc-custom-plugin-applaunchpad`   | ✅                         | ❌       | ❌       | ✅          | ✅ on every template release         |
| `cc-custom-plugin-glossary`       | ✅                         | ❌       | ❌       | ✅          | ✅ on every template release         |
| `cc-custom-plugin-audio-hub`      | (no remote yet)                                                                | n/a      |
| `cc-custom-plugin-example`        | ❌ (will never add)       | ❌       | ✅       | n/a        | ❌ never |
| `cc-custom-plugin-code-generator` | ❌ (archived/legacy)      | ✅ soon  | ✅       | n/a        | ❌ never |
| `cc-custom-plugin-template`       | ❌ (is source)            | ❌       | ✅       | n/a        | ❌ (source) |

A new fork is invisible to auto-rollout until its maintainer drops `.template-sync.yml` into the repo root. Safe default — better to under-include than spam an unrelated repo. No need to coordinate topic-tag management across repos, no risk of "topic was removed and the auto-rollout broke" surprises.

**What the automation does *not* do.**

- It does *not* merge the PR. The `dev` label preview + human review gate are still required (see [Step B4](#step-b4--verify-in-dev-then-mark-ready-for-review)).
- It does *not* apply changes flagged `[template-only]` in CHANGELOG — the workflow parses the entries and filters them out.
- It does *not* handle product code at all — patches that touch `<plugin>/src/routes/<product>.ts` will conflict, by design.
- It does *not* touch denylisted or archived repos, ever. The exclusion layers above (denylist + `--no-archived` + missing/disabled opt-in file) are independent gates; bypassing one still leaves the others in force.

**Stretch.** A second workflow that runs nightly, diffs each downstream against the latest template release, and posts a one-line status comment on a tracking issue (`#template-sync-status`). Lightweight "are we drifting?" signal without opening PRs.

Until the template has a remote and a release pipeline, the manual flow in this document is the source of truth.

## Anti-patterns

- **Mega-PR across multiple downstreams.** One PR per downstream, always — see [Step B2](#step-b2--one-draft-pr-per-downstream).
- **Skipping the dev preview for code changes.** "It's a small change" is exactly how a regression slips into prod. Use the `dev` label every time, even for one-line fixes.
- **Treating docs as not worth porting.** A stale architecture doc is a security incident waiting to happen — wrong session/GDPR/cache documentation will get someone to make the wrong call under pressure. Docs are part of the contract; sync them with the same discipline as code.
- **Mixing docs and code in one sync PR.** Keep them separate so the docs port can land fast (no Flux preview) while the code port goes through the full `dev`-label cycle. The CHANGELOG entries can still cross-reference each other.
- **Forgetting the `[sync]` tag in template CHANGELOG.** Downstream maintainers can't replay what they can't see — same goes for `[sync] [docs]` on documentation updates.
- **Branching from a stale downstream `main`.** Always `git pull` first; downstreams accumulate hotfixes that may interact with the port.
- **Promoting product-specific code or docs into the template.** If only one downstream needs it, the helper / type / route / doc page belongs in that downstream until a second consumer arrives.
- **Pushing to `dev` directly.** The `dev` branch is autodev-owned; manual pushes get overwritten on the next labelled-PR merge. Always go through a labelled PR.
