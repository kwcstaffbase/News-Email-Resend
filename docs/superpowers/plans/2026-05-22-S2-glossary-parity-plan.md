# S2 — Glossary Parity Implementation Plan

> **Status: ✅ COMPLETE.**
>
> **Shipped via PR #11 / #12 / #13 / #14 (merged earlier):**
> - ✅ `scripts/check-dependabot-blockers.sh` + `ci.yml` step (Task 1)
> - ✅ Operational Links section in README (Task 3; PR #13 commit `3d7de02`)
> - ✅ Path portability in `docs/superpowers/` (Task 5; not applicable)
> - ✅ Ideas-workflow seed fix (Task 6; PR #12 commit `bb35e21`)
> - ✅ Plus large additional scope NOT in this plan: API token UI (#12), Unknown User sweep, filter dropdown exclusion, setup-warning banner, buildUserName sentinel, SettingsDialog refactor, Drizzle `/creators` fix (#14), README refresh (#13).
>
> **Shipped on draft branch `chore/glossary-template-parity` (this session):**
> - ✅ Task 2: `scripts/vault-bootstrap.sh` parameterized by `PLUGIN_NAME` (commit `72ddd9c`).
> - ✅ Task 4: AGENTS.md cross-check — added explicit GDPR + per-instance API token guardrails (commit `17e58cd`).
> - ✅ Bonus: removed redundant `dev-preview.yml` (commit `d3afaa8`); `autodev.yml` is the canonical Staffbase `dev`-label mechanism.
>
> Glossary main HEAD at completion: `e705e25` (+3 unmerged commits on `chore/glossary-template-parity`).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `cc-custom-plugin-glossary` to parity with the canonical `cc-custom-plugin-template` produced in S1. Adds the missing CI dependabot gate, parameterizes the vault-bootstrap script, ports the GDPR posture rules in AGENTS.md, adds the Operational Links README section.

**Architecture:** Single feature branch off latest `Staffbase/cc-custom-plugin-glossary@main`. Multi-commit, each commit scoped to one concern so reviewers can review independently. Opens as a **DRAFT PR**.

**Tech Stack:** Bun, Hono, Drizzle, React, GitHub Actions, HashiCorp Vault. Source files live in `cc-custom-plugin-template` (canonical) and `cc-custom-plugin-applaunchpad` (CI gate pattern). The glossary repo already has most of S1's improvements; this plan only addresses the gaps.

**Convention:** `$GLO = ~/<sb-repos>/cc-custom-plugin-glossary`, `$TPL = ~/<sb-repos>/cc-custom-plugin-template`, `$AL = ~/<sb-repos>/cc-custom-plugin-applaunchpad`.

**Pre-condition:** PR #12 (`fix/settings-api-token-field`) is merged to `Staffbase/cc-custom-plugin-glossary@main` before this PR opens. PR #11 + the v1.0.x work is already merged.

---

## Diff vs template (from S1 design + state-matrix)

| Item | Glossary state | Template state | Action |
|---|---|---|---|
| `scripts/check-dependabot-blockers.sh` + `ci.yml` wiring | **MISSING** | ✓ | Port from template |
| `scripts/vault-bootstrap.sh` PLUGIN_NAME param | hardcoded `cc-custom-plugin-glossary` | parameterized | Parameterize (replace literal with `${PLUGIN_NAME}` default = repo basename) |
| Root README `Operational Links` section | missing | present | Add (placeholder + glossary-specific URLs) |
| AGENTS.md GDPR + API-token rules | partial | full S1 set | Verify + port any missing |
| Path-portability in `docs/superpowers/*` | hardcoded `/Users/ms/DEV/Github_Staffbase` | portable `~/<sb-repos>` | sed |
| GDPR layer (`revalidateAccessor` / `revalidateReferencedUsers` / `gateAccessor` / `last_verified_at`) | ✓ already present (template ported FROM glossary) | ✓ | none |
| Background SCIM `refreshAllUsers` loop | ✓ already present (template ported FROM glossary) | ✓ | none |
| AL PR #81 metric label injection fix | ✓ already present (glossary v1 carried it) | ✓ | none |
| @hono/zod-validator 0.8 | ✓ | ✓ | none |
| gha-workflows v13.4.0 | ✓ | ✓ | none |
| CHANGELOG.md | ✓ | bootstrap | none |
| dev-preview.yml | ✓ | ✓ | none |

---

## Task 0: Pre-work — branch off latest glossary main

- [ ] **Step 0.1: Pull latest**

```bash
cd ~/<sb-repos>/cc-custom-plugin-glossary
git fetch origin
git checkout main
git pull --ff-only origin main
git status   # clean
```

- [ ] **Step 0.2: Create feature branch**

```bash
git checkout -b chore/glossary-template-parity
```

- [ ] **Step 0.3: Baseline test pass**

```bash
bun install
bun run check
bun test
(cd client && bun run test)
(cd widget && bun test)
```

All green before proceeding.

---

## Task 1: Port `scripts/check-dependabot-blockers.sh` + wire into CI

**Files:**
- Create: `$GLO/scripts/check-dependabot-blockers.sh`
- Modify: `$GLO/.github/workflows/ci.yml`

- [ ] **Step 1.1: Copy script from template**

```bash
cp ~/<sb-repos>/cc-custom-plugin-template/scripts/check-dependabot-blockers.sh \
   ~/<sb-repos>/cc-custom-plugin-glossary/scripts/check-dependabot-blockers.sh
chmod +x ~/<sb-repos>/cc-custom-plugin-glossary/scripts/check-dependabot-blockers.sh
```

- [ ] **Step 1.2: Smoke-test the script**

```bash
cd ~/<sb-repos>/cc-custom-plugin-glossary
bash scripts/check-dependabot-blockers.sh
```

Expected: `ok: dependabot blockers are consistent...` (or `skip: ...` if `@staffbase/design` isn't pinned).

- [ ] **Step 1.3: Wire into `ci.yml`**

Open `$GLO/.github/workflows/ci.yml`. Find the "Validate plugin manifest" step. Insert immediately after it:

```yaml
      - name: Validate dependabot blockers
        run: bash scripts/check-dependabot-blockers.sh
```

- [ ] **Step 1.4: Commit**

```bash
git add scripts/check-dependabot-blockers.sh .github/workflows/ci.yml
git -c user.email="max@staffbase.com" -c user.name="Max" commit -m "ci(dependabot): add gate enforcing @staffbase/design semver-major ignore consistency

Source: cc-custom-plugin-template (which inherited from applaunchpad PR #87).
Prevents the dependabot ignore block from going stale once @staffbase/design
migrates past v16.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Parameterize `scripts/vault-bootstrap.sh`

**Files:**
- Modify: `$GLO/scripts/vault-bootstrap.sh`
- Modify: `$GLO/scripts/vault-bootstrap.env.example`

- [ ] **Step 2.1: Replace literal occurrences**

```bash
cd ~/<sb-repos>/cc-custom-plugin-glossary
grep -n 'cc-custom-plugin-glossary' scripts/vault-bootstrap.sh
```

Replace every literal `cc-custom-plugin-glossary` with the shell variable `${PLUGIN_NAME}`. (Manual sed if confident, or Edit-by-Edit.)

- [ ] **Step 2.2: Add PLUGIN_NAME default + validation block**

After `set -euo pipefail`, insert (matching template's pattern):

```bash
# Plugin name controls Vault path prefix. Default to current git repo name so
# the script works without any wrapper. Override via PLUGIN_NAME=<name> ./vault-bootstrap.sh ...
PLUGIN_NAME="${PLUGIN_NAME:-$(basename "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse --show-toplevel 2>/dev/null || pwd)")}"

if [[ -z "$PLUGIN_NAME" || "$PLUGIN_NAME" =~ [^a-z0-9-] ]]; then
  echo "FAIL: PLUGIN_NAME must be lowercase alphanumeric with hyphens. Got: '${PLUGIN_NAME}'" >&2
  exit 1
fi
```

- [ ] **Step 2.3: Update `vault-bootstrap.env.example`**

Replace any `cc-custom-plugin-glossary` references with `<PLUGIN_NAME>` placeholders.

- [ ] **Step 2.4: Dry-run smoke test**

```bash
cd ~/<sb-repos>/cc-custom-plugin-glossary
DRY_RUN=1 bash scripts/vault-bootstrap.sh dev-de1 2>&1 | head -25
```

Expected: Vault paths still show `cc-custom-plugin-glossary` (because PLUGIN_NAME auto-resolves to repo basename = `cc-custom-plugin-glossary`). No regression vs before this PR.

- [ ] **Step 2.5: Commit**

```bash
git add scripts/vault-bootstrap.sh scripts/vault-bootstrap.env.example
git -c user.email="max@staffbase.com" -c user.name="Max" commit -m "refactor(scripts): parameterize vault-bootstrap by PLUGIN_NAME

Source: cc-custom-plugin-template (S1). PLUGIN_NAME defaults to the
git repo basename, so glossary's behaviour is preserved while the script
becomes reusable across CC custom plugins.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Operational Links section in README

**Files:**
- Modify: `$GLO/README.md`

- [ ] **Step 3.1: Find insertion point**

```bash
grep -n '^##' README.md
```

Insert the new section after the existing deployment/architecture section and before any test-suite / license section. Use the template's pattern (copy verbatim, then replace placeholder URLs/paths with glossary-specific values where known):

```markdown
## Operational Links

| Resource | dev/de1 | stage/de1 | prod/de1 | prod/au1 | prod/us1 |
|---|---|---|---|---|---|
| Backstage | [cc-custom-plugin-glossary component](https://backstage.staffbase.com/catalog/default/component/cc-custom-plugin-glossary) | — | — | — | — |
| Grafana | [dashboard](https://observatory-dev-de1.staffbase.com/d/cc-custom-plugin-glossary) | [dashboard](https://observatory-stage-de1.staffbase.com/d/cc-custom-plugin-glossary) | [dashboard](https://observatory-de1.staffbase.com/d/cc-custom-plugin-glossary) | [dashboard](https://observatory-au1.staffbase.com/d/cc-custom-plugin-glossary) | [dashboard](https://observatory-us1.staffbase.com/d/cc-custom-plugin-glossary) |
| VictoriaLogs | [explore](https://observatory-dev-de1.staffbase.com/explore?...&namespace=cc-custom-plugin-glossary) | [explore](https://observatory-stage-de1.staffbase.com/explore?...&namespace=cc-custom-plugin-glossary) | [explore](https://observatory-de1.staffbase.com/explore?...&namespace=cc-custom-plugin-glossary) | [explore](https://observatory-au1.staffbase.com/explore?...&namespace=cc-custom-plugin-glossary) | [explore](https://observatory-us1.staffbase.com/explore?...&namespace=cc-custom-plugin-glossary) |
| Vault path | `dev/de1/cc-custom-plugin-glossary/` | `stage/de1/cc-custom-plugin-glossary/` | `prod/de1/cc-custom-plugin-glossary/` | `prod/au1/cc-custom-plugin-glossary/` | `prod/us1/cc-custom-plugin-glossary/` |
| Customer Control | [staging](https://customer-control.stage.staffbase.dev/) | (same) | (same) | (same) | (same) |
| Mops manifests | `mops/kubernetes/namespaces/cc-custom-plugin-glossary/dev/de1/` | `.../stage/de1/` | `.../prod/de1/` | `.../prod/au1/` | `.../prod/us1/` |
| Infrastructure | `infrastructure/github/staffbase/repositories/teams/cs-tech/cc-custom-plugin-glossary.yml` | — | — | — | — |
```

- [ ] **Step 3.2: Commit**

```bash
git add README.md
git -c user.email="max@staffbase.com" -c user.name="Max" commit -m "docs(readme): add Operational Links section

Mirrors cc-custom-plugin-template's canonical Operational Links table
with glossary-specific URLs and Vault paths filled in.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: AGENTS.md cross-check (verify + port any missing generic rules)

**Files:**
- Modify (maybe): `$GLO/AGENTS.md`

- [ ] **Step 4.1: Diff against template's S1 version**

```bash
diff ~/<sb-repos>/cc-custom-plugin-glossary/AGENTS.md ~/<sb-repos>/cc-custom-plugin-template/AGENTS.md | head -80
```

For each line unique to template that is GENERIC (not template-specific), port it to glossary. Specifically check:
- `sub === "delete"` intercept location: should say `app.ts`, not `routes/html.ts`. Update if wrong.
- The widget API mount-before-SSO rule (glossary likely already has it).
- The widget escape-HTML rule (glossary likely already has it).
- The per-instance API token + SCIM sync rule.
- The GDPR per-request gate rule.
- `cd widget && bun test` in the pre-commit checklist.

Skip template-specific bullets (like "demo `items` table" — glossary doesn't have an `items` table).

- [ ] **Step 4.2: Apply edits**

Edit `$GLO/AGENTS.md` to bring in any missing generic rule. If a glossary rule is more specific (e.g. names the actual table), keep glossary's wording.

- [ ] **Step 4.3: Commit (only if any edits)**

```bash
git add AGENTS.md
git -c user.email="max@staffbase.com" -c user.name="Max" commit -m "docs(agents): port missing generic guardrails from template

Bring glossary AGENTS.md to parity with cc-custom-plugin-template
(GDPR/API-token rules, pre-commit checklist, intercept location).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

If `diff` shows everything already aligned (glossary is the source for most rules), skip.

---

## Task 5: Path portability in `docs/superpowers/`

**Files:**
- Modify: `$GLO/docs/superpowers/plans/*.md` and `$GLO/docs/superpowers/specs/*.md` (if any have hardcoded paths)

- [ ] **Step 5.1: Grep + sed**

```bash
cd ~/<sb-repos>/cc-custom-plugin-glossary
grep -rl "/Users/ms/DEV/Github_Staffbase" docs/superpowers/ 2>/dev/null
sed -i '' 's|/Users/ms/DEV/Github_Staffbase|~/<sb-repos>|g' docs/superpowers/plans/*.md docs/superpowers/specs/*.md 2>/dev/null
grep -c "/Users/ms/DEV" docs/superpowers/plans/*.md docs/superpowers/specs/*.md 2>/dev/null
```

Expected: all 0 hits after sed.

- [ ] **Step 5.2: Commit (only if changes)**

```bash
git add docs/superpowers/
git -c user.email="max@staffbase.com" -c user.name="Max" commit -m "docs(superpowers): use portable ~/<sb-repos> paths in plans + specs

Aligns with template + audio-hub conventions so plan files don't bake in
a specific developer's local checkout location.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: ideas-workflow.spec.ts seed fix (pre-existing failure)

Discovered during S1 + S2 sweep. Spec timeout: "Submit New Idea" button missing because `seed()` / `seedGlossary()` never initializes the `plugin_settings` row, so `ideaMgmtEnabled` is unset.

**Files:**
- Modify: `$GLO/server/src/seed.ts`

- [ ] **Step 6.1: Add plugin-settings init**

Inside `seedGlossary()` (or whichever helper the test calls), add an `INSERT INTO plugin_settings ... ON CONFLICT DO UPDATE SET ideaMgmtEnabled = true, ...` for the `test-instance` (or whichever instance the e2e fixture uses). Set all 9 plugin_settings flags to known good values so the spec is deterministic.

Use Drizzle's `insert ... onConflictDoUpdate({ target: pluginSettings.instanceId, set: { ... } })` pattern; see existing seed code for the idiom.

- [ ] **Step 6.2: Verify**

```bash
cd ~/<sb-repos>/cc-custom-plugin-glossary
SKIP_BROWSERS=firefox,webkit,MicrosoftEdge bun run test:e2e e2e/tests/ideas-workflow.spec.ts 2>&1 | tail -25
```

Both tests pass.

- [ ] **Step 6.3: Commit**

```bash
git add server/src/seed.ts
git -c user.email="max@staffbase.com" -c user.name="Max" commit -m "fix(seed): initialize plugin_settings row so ideas-workflow E2E is deterministic

Without this row the lazy getOrCreateSettings() either failed to insert
under the seeded transaction or left the spec at the mercy of prior-run
state. The 'Submit New Idea' button is conditional on ideaMgmtEnabled;
unset → button missing → 30s timeout.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Final verification + push + draft PR

- [ ] **Step 7.1: Run all suites**

```bash
cd ~/<sb-repos>/cc-custom-plugin-glossary
bun run check
bun test
(cd client && bun run test)
(cd widget && bun test)
bash scripts/check-dependabot-blockers.sh
```

All green.

- [ ] **Step 7.2: Push + open DRAFT PR**

```bash
git push -u origin chore/glossary-template-parity
gh pr create --draft --base main --title "chore: bring glossary to parity with cc-custom-plugin-template (S2)" --body "$(cat <<'EOF'
## Summary

Brings cc-custom-plugin-glossary to parity with the canonical cc-custom-plugin-template (produced in cross-repo sync sub-project S1). Net new in this PR:

- **CI dependabot gate** (`scripts/check-dependabot-blockers.sh` + `ci.yml` step) — prevents the `@staffbase/design` semver-major ignore from going stale.
- **`scripts/vault-bootstrap.sh` parameterized by `PLUGIN_NAME`** — same script can be reused by sibling plugins; glossary's behaviour preserved (auto-defaults to repo basename).
- **Operational Links section** in root README.
- **AGENTS.md cross-check** — any missing generic rules from template ported in.
- **Path portability** in `docs/superpowers/*` (no more hardcoded `/Users/ms/...`).
- **ideas-workflow.spec.ts seed fix** — seed now initializes `plugin_settings` so the E2E is deterministic.

## Test plan

- [ ] CI green (incl. new dependabot gate step).
- [ ] `bun test` server + `bun test` widget + `cd client && bun run test` — all green.
- [ ] `DRY_RUN=1 bash scripts/vault-bootstrap.sh dev-de1` — still writes to `cc-custom-plugin-glossary` Vault paths (no regression).
- [ ] E2E `ideas-workflow.spec.ts` no longer flakes (locally + CI).

## Notes

- This PR depends on PR #12 (API token UI) being merged first. Once #12 lands and main is updated, rebase this branch.
- Draft PR — review before merging.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL.

---

## Verification + scope notes

- S2 is intentionally minimal because glossary v1 already shipped most of the generic improvements (GDPR layer, `_msg` field fix, `gha-workflows@13.4`, `@hono/zod-validator@0.8`, dev-preview workflow, ADRs 0010–0013).
- S2 does **not** touch the API token UI (PR #12) or the Unknown-User fix (already part of PR #12).
- S2 does **not** touch domain-specific test additions (those land separately).
- If during execution a sub-task turns out to be a no-op (template's rule is already in glossary), skip the commit — empty commits aren't useful.

## References

- `~/<sb-repos>/cc-custom-plugin-template/docs/superpowers/specs/2026-05-22-cross-repo-sync-design.md` (parent spec)
- `~/<sb-repos>/cc-custom-plugin-template/docs/superpowers/plans/2026-05-22-S1-template-canonical-plan.md` (S1 reference)
- PR #12 (API token UI; pre-condition)
- AL PR #87 (CI gate origin)
