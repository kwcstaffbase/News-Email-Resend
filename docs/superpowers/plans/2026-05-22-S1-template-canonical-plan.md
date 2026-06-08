# S1 — Template-as-canonical Implementation Plan

> **Status: ✅ COMPLETE** — all C1–C9 components shipped on local branch `chore/template-canonical-sync` and merged to template `main` via fast-forward (commit chain `da6bf31..564e589`, 23 commits, 2026-05-22). All verifications passed: Biome clean, server 174/174, client 62/62, widget 1/1, dependabot gate ok, vault dry-run namespaced to template. Below checkboxes left unchecked for historical readability — see git log on template `main` for execution evidence.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `cc-custom-plugin-template` to be the canonical reference for every generic concern shared by CC custom plugins, by absorbing improvements from glossary v1 + applaunchpad PR #81.

**Architecture:** Sequential multi-commit work on a single local branch `chore/template-canonical-sync` of `~/<sb-repos>/cc-custom-plugin-template`. Each component group (C1–C9) is one or more commits. No remote — `cc-custom-plugin-template` has no GitHub remote yet. After this plan ships, sub-projects S2–S5 (separate plans) reuse this updated template as the source of truth.

**Tech Stack:** Bun, Hono, Drizzle, React, Vite, Biome, Playwright, MkDocs, GitHub Actions, HashiCorp Vault. Source files live in `cc-custom-plugin-glossary` and `cc-custom-plugin-applaunchpad`.

**Convention used in this plan:** `$TPL = ~/<sb-repos>/cc-custom-plugin-template`. `$GLO = ~/<sb-repos>/cc-custom-plugin-glossary`. `$AL = ~/<sb-repos>/cc-custom-plugin-applaunchpad`. Every `cd` is to one of those three.

---

## Task 0: Pre-work — branch + baseline

**Files:** none (git state only).

- [ ] **Step 0.1: Confirm template `main` is clean**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git status
```

Expected: `On branch main` + `working tree clean`. If dirty, stop and ask user — there may be in-progress local-only work.

- [ ] **Step 0.2: Create the feature branch**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git checkout -b chore/template-canonical-sync
```

Expected: `Switched to a new branch 'chore/template-canonical-sync'`.

- [ ] **Step 0.3: Baseline test pass**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
bun install
bun run check
bun test
(cd client && bun run test)
(cd widget && bun test)
```

Expected: Biome 0 errors, all suites green. If anything red on `main`, stop — fix on `main` first (not in this plan).

---

## Task 1 (C1): Vault bootstrap (parameterized)

**Files:**
- Create: `$TPL/scripts/vault-bootstrap.sh`
- Create: `$TPL/scripts/vault-bootstrap.env.example`
- Modify: `$TPL/.gitignore`

The glossary script is hardcoded for `cc-custom-plugin-glossary` (Vault path prefix). The template version takes a `PLUGIN_NAME` env (default = current git repo basename) and derives all Vault paths from it.

- [ ] **Step 1.1: Copy source files into template**

```bash
cp ~/<sb-repos>/cc-custom-plugin-glossary/scripts/vault-bootstrap.sh \
   ~/<sb-repos>/cc-custom-plugin-template/scripts/vault-bootstrap.sh
cp ~/<sb-repos>/cc-custom-plugin-glossary/scripts/vault-bootstrap.env.example \
   ~/<sb-repos>/cc-custom-plugin-template/scripts/vault-bootstrap.env.example
chmod +x ~/<sb-repos>/cc-custom-plugin-template/scripts/vault-bootstrap.sh
```

- [ ] **Step 1.2: Parameterize plugin name in `vault-bootstrap.sh`**

Open `$TPL/scripts/vault-bootstrap.sh`. Find every literal occurrence of `cc-custom-plugin-glossary` (use `grep -n 'cc-custom-plugin-glossary' $TPL/scripts/vault-bootstrap.sh`). Replace **all** of them with the shell variable `${PLUGIN_NAME}`.

At the top of the file, after `set -euo pipefail`, insert:

```bash
# Plugin name controls Vault path prefix. Default to current git repo name so
# the script works without any wrapper. Override via PLUGIN_NAME=<name> ./vault-bootstrap.sh ...
PLUGIN_NAME="${PLUGIN_NAME:-$(basename "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse --show-toplevel 2>/dev/null || pwd)")}"

if [[ -z "$PLUGIN_NAME" || "$PLUGIN_NAME" =~ [^a-z0-9-] ]]; then
  echo "FAIL: PLUGIN_NAME must be lowercase alphanumeric with hyphens. Got: '${PLUGIN_NAME}'" >&2
  exit 1
fi
```

Update the script header comment (lines 1–~30) to drop glossary-specific language and reference `${PLUGIN_NAME}` instead.

- [ ] **Step 1.3: Parameterize `vault-bootstrap.env.example`**

In `$TPL/scripts/vault-bootstrap.env.example`, replace any reference to `cc-custom-plugin-glossary` with `<PLUGIN_NAME>` and add this header comment at the top:

```bash
# Copy to scripts/vault-bootstrap.env, fill in real values, and run scripts/vault-bootstrap.sh.
# Plugin name is auto-detected from the git repo name (override via PLUGIN_NAME=...).
# scripts/vault-bootstrap.env is git-ignored — never commit real secrets.
```

- [ ] **Step 1.4: Add `.gitignore` rule**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
grep -q '^scripts/vault-bootstrap\.env$' .gitignore || echo 'scripts/vault-bootstrap.env' >> .gitignore
```

- [ ] **Step 1.5: Dry-run smoke test**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
DRY_RUN=1 bash scripts/vault-bootstrap.sh dev-de1 2>&1 | head -40
```

Expected: stdout shows Vault paths like `dev/de1/cc-custom-plugin-template/plugin-credentials` (NOT `cc-custom-plugin-glossary`). No actual writes. If the script complains about a missing `scripts/vault-bootstrap.env`, that's fine — placeholder rejection should fail closed.

- [ ] **Step 1.6: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add scripts/vault-bootstrap.sh scripts/vault-bootstrap.env.example .gitignore
git commit -m "feat(scripts): add parameterized vault-bootstrap script

Source: cc-custom-plugin-glossary PR #6. Plugin name auto-detected from
git repo name; override via PLUGIN_NAME env. Vault paths derived from
\${PLUGIN_NAME}; idempotent reads, placeholder rejection in prod,
ROTATE_* flags, secrets masked in logs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2 (C2): Screenshot + video capture scripts

**Files:**
- Create: `$TPL/scripts/capture-docs-screenshots.ts`
- Create: `$TPL/scripts/capture-docs-videos.ts`

- [ ] **Step 2.1: Copy from glossary**

```bash
cp ~/<sb-repos>/cc-custom-plugin-glossary/scripts/capture-docs-screenshots.ts \
   ~/<sb-repos>/cc-custom-plugin-template/scripts/capture-docs-screenshots.ts
cp ~/<sb-repos>/cc-custom-plugin-glossary/scripts/capture-docs-videos.ts \
   ~/<sb-repos>/cc-custom-plugin-template/scripts/capture-docs-videos.ts
```

- [ ] **Step 2.2: Placeholder-ize each file**

Find the hardcoded scenario list at the top of each file (typically an exported `SCENARIOS` or `STEPS` const). Replace its body with a single placeholder entry and a comment block:

```ts
// CUSTOMIZE PER PLUGIN: each entry describes one screenshot/video to capture.
// Replace the placeholder below with real scenarios when forking this template.
// See docs/reference/visual-tour.md for the rendering target.
export const SCENARIOS = [
  {
    id: "example-landing",
    description: "Replace this placeholder with a real scenario.",
    url: "/",
    steps: async () => { /* TODO: customize */ },
  },
] as const;
```

Also, find any hardcoded URLs that mention `glossary` (search the files for `glossary` literal) and replace with `<plugin>` placeholders.

- [ ] **Step 2.3: Smoke check (compile only)**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
bunx tsc --noEmit scripts/capture-docs-screenshots.ts scripts/capture-docs-videos.ts 2>&1 | head -20
```

Expected: 0 errors. If type errors fire, fix imports or the placeholder shape until clean.

- [ ] **Step 2.4: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add scripts/capture-docs-screenshots.ts scripts/capture-docs-videos.ts
git commit -m "feat(scripts): add docs capture scripts (screenshot + video)

Source: cc-custom-plugin-glossary PR #1. Scenario list reset to a single
placeholder — fork-customize per plugin. Uses Playwright; runs against
\`bun run dev\` locally and writes into \`docs/assets/{screenshots,videos}/\`.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3 (C3): dev-preview.yml workflow

**Files:**
- Create: `$TPL/.github/workflows/dev-preview.yml`

- [ ] **Step 3.1: Copy from glossary**

```bash
cp ~/<sb-repos>/cc-custom-plugin-glossary/.github/workflows/dev-preview.yml \
   ~/<sb-repos>/cc-custom-plugin-template/.github/workflows/dev-preview.yml
```

- [ ] **Step 3.2: Genericize**

Open `$TPL/.github/workflows/dev-preview.yml`. Find any literal `cc-custom-plugin-glossary` or `glossary` (workflow `name:`, artifact names, comments) and replace with `cc-custom-plugin-template` or generic phrasing. The workflow body (steps) should be plugin-agnostic — verify by reading every step.

- [ ] **Step 3.3: Validate YAML**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
bunx -p js-yaml js-yaml .github/workflows/dev-preview.yml > /dev/null
```

Expected: no output (valid YAML). If `js-yaml` isn't installed via bunx fallback, use `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/dev-preview.yml'))"` instead.

- [ ] **Step 3.4: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add .github/workflows/dev-preview.yml
git commit -m "feat(ci): add dev-preview widget bundle workflow

Source: cc-custom-plugin-glossary. Builds widget bundle on PR + uploads
as artifact; consumed downstream to test viewer-side render.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4 (C4): Documentation absorbed from glossary

Each doc is copied then placeholder-ized. One commit per doc keeps blame clean. Skip TDD — these are static reference docs, not testable behavior.

### Task 4a: deployment-handoff.md

**Files:**
- Create: `$TPL/docs/guides/deployment-handoff.md`

- [ ] **Step 4a.1: Copy**

```bash
cp ~/<sb-repos>/cc-custom-plugin-glossary/docs/guides/deployment-handoff.md \
   ~/<sb-repos>/cc-custom-plugin-template/docs/guides/deployment-handoff.md
```

- [ ] **Step 4a.2: Placeholder-ize plugin-name references**

Open `$TPL/docs/guides/deployment-handoff.md`. Use `sed -i ''` (macOS) to replace bulk references:

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
sed -i '' \
  -e 's/cc-custom-plugin-glossary/<PLUGIN_NAME>/g' \
  -e 's/`glossary`/`<plugin>`/g' \
  -e 's/Glossary plugin/<Plugin> plugin/g' \
  -e 's/Glossary/<Plugin>/g' \
  docs/guides/deployment-handoff.md
```

Then manually scan the file (the sed replacements are blunt; some lines may need rewriting):

```bash
grep -n -i 'glossar\|entries\|ideas\|categori' docs/guides/deployment-handoff.md
```

Rewrite or delete any glossary-feature-specific paragraph the engineer finds (entries table, ideas workflow examples, etc.). Add this banner at the very top of the file (after the existing H1):

```markdown
> **Fork-customize note:** this document is a generic deployment-handoff template.
> Replace every `<PLUGIN_NAME>` / `<Plugin>` placeholder with the real plugin name,
> and trim or rewrite plugin-domain examples before sharing with infra/SRE.
```

- [ ] **Step 4a.3: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add docs/guides/deployment-handoff.md
git commit -m "docs(guides): add deployment-handoff template

Source: cc-custom-plugin-glossary PR #1. Plugin-name placeholder-ized;
glossary feature examples removed. For first-deploy of template-derived
plugins (e.g. cc-custom-plugin-audio-hub).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4b: observability/how-to-verify-f2-f9.md

**Files:**
- Create: `$TPL/docs/observability/how-to-verify-f2-f9.md`

- [ ] **Step 4b.1: Copy**

```bash
cp ~/<sb-repos>/cc-custom-plugin-glossary/docs/observability/how-to-verify-f2-f9.md \
   ~/<sb-repos>/cc-custom-plugin-template/docs/observability/how-to-verify-f2-f9.md
```

- [ ] **Step 4b.2: Placeholder-ize**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
sed -i '' \
  -e 's/cc-custom-plugin-glossary/<PLUGIN_NAME>/g' \
  -e 's/namespace="cc-custom-plugin-glossary"/namespace="<PLUGIN_NAME>"/g' \
  docs/observability/how-to-verify-f2-f9.md
```

Verify with `grep -n glossar docs/observability/how-to-verify-f2-f9.md`. If any glossary-domain examples remain (e.g. push channel "ideas-approved"), rewrite as a generic example or remove.

- [ ] **Step 4b.3: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add docs/observability/how-to-verify-f2-f9.md
git commit -m "docs(observability): add F2-F9 verification recipes

Source: cc-custom-plugin-glossary PR #6. LogsQL + Prometheus queries
for log volume, error baseline, RPS, p95/p99, push delivery, db latency,
saturation, alerts. Plugin name placeholder-ized.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4c: observability/phase-f-findings.md (placeholder shell)

**Files:**
- Create: `$TPL/docs/observability/phase-f-findings.md`

- [ ] **Step 4c.1: Write placeholder shell**

```bash
cat > ~/<sb-repos>/cc-custom-plugin-template/docs/observability/phase-f-findings.md << 'EOF'
# Phase F — Observability Findings

> **Placeholder template.** Fill in for each environment AFTER the plugin is
> deployed. See `docs/observability/how-to-verify-f2-f9.md` for the queries
> that produce these numbers. Until deployed, this document only documents
> the *structure* expected.

| Finding | dev/de1 | stage/de1 | prod/de1 | prod/au1 | prod/us1 |
|---|---|---|---|---|---|
| F2 — 24h log volume by level | TBD | TBD | TBD | TBD | TBD |
| F3 — 24h error count + top messages | TBD | TBD | TBD | TBD | TBD |
| F4 — access RPS + p50/p95/p99 | TBD | TBD | TBD | TBD | TBD |
| F5 — `_msg` field hygiene (raw JSON leak count, must be 0) | TBD | TBD | TBD | TBD | TBD |
| F6 — push delivered vs failed (24h) | TBD | TBD | TBD | TBD | TBD |
| F7 — db query p50/p95/p99 | TBD | TBD | TBD | TBD | TBD |
| F8 — container saturation (CPU/mem headroom %) | TBD | TBD | TBD | TBD | TBD |
| F9 — active alerts | TBD | TBD | TBD | TBD | TBD |

## Notes

Add per-finding narrative as each row is filled. Capture anomalies, baselines,
and any follow-up tickets opened.
EOF
```

- [ ] **Step 4c.2: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add docs/observability/phase-f-findings.md
git commit -m "docs(observability): add phase-f-findings placeholder

Empty matrix for post-deploy verification. Filled in per-plugin after
first env reaches steady state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4d: qa/mobile-checklist.md

**Files:**
- Create: `$TPL/docs/qa/mobile-checklist.md`

- [ ] **Step 4d.1: Copy + placeholder-ize**

```bash
mkdir -p ~/<sb-repos>/cc-custom-plugin-template/docs/qa
cp ~/<sb-repos>/cc-custom-plugin-glossary/docs/qa/mobile-checklist.md \
   ~/<sb-repos>/cc-custom-plugin-template/docs/qa/mobile-checklist.md

cd ~/<sb-repos>/cc-custom-plugin-template
sed -i '' \
  -e 's/cc-custom-plugin-glossary/<PLUGIN_NAME>/g' \
  -e 's/Glossary/<Plugin>/g' \
  -e 's/glossary/<plugin>/g' \
  docs/qa/mobile-checklist.md

grep -n -i 'entries\|ideas\|categori' docs/qa/mobile-checklist.md
```

Rewrite or remove any glossary-feature-specific checklist items the grep surfaces.

- [ ] **Step 4d.2: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add docs/qa/mobile-checklist.md
git commit -m "docs(qa): add mobile testing checklist template

Source: cc-custom-plugin-glossary PR #1. iOS Safari + Chrome, Android
Chrome + Samsung Internet. Plugin-domain checklist items genericized.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4e: reference/visual-tour.md

**Files:**
- Create: `$TPL/docs/reference/visual-tour.md`

- [ ] **Step 4e.1: Write placeholder**

```bash
cat > ~/<sb-repos>/cc-custom-plugin-template/docs/reference/visual-tour.md << 'EOF'
# Visual Tour

> **Placeholder template.** Captures go in `docs/assets/screenshots/` and
> `docs/assets/videos/`, produced by `bun run --bun scripts/capture-docs-screenshots.ts`
> and `bun run --bun scripts/capture-docs-videos.ts` against `bun run dev`.
> Each capture is one row below.

| ID | Description | Screenshot | Video |
|---|---|---|---|
| `example-landing` | Placeholder — replace with real scenarios. | — | — |

## How to regenerate

```bash
bun run dev   # in one terminal
bun run --bun scripts/capture-docs-screenshots.ts
bun run --bun scripts/capture-docs-videos.ts
```

See `docs/qa/mobile-checklist.md` for the manual mobile pass that
complements automated captures.
EOF
```

- [ ] **Step 4e.2: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add docs/reference/visual-tour.md
git commit -m "docs(reference): add visual-tour placeholder

Documents the capture-docs script outputs. One row per scenario, filled
in per plugin once scenarios are customized.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5 (C5): ADRs 0010–0013

Template currently has ADRs 0001–0009 (and template's `0009-observability-baseline.md` is the generic version, NOT glossary's domain-specific `0009-ideas-workflow.md` — keep template's 0009 as-is). Add the four new generic ADRs.

**Files:**
- Create: `$TPL/docs/adrs/0010-push-channels.md`
- Create: `$TPL/docs/adrs/0011-user-cache-lifecycle.md`
- Create: `$TPL/docs/adrs/0012-strict-gdpr-user-lifecycle.md`
- Create: `$TPL/docs/adrs/0013-logging-contract.md`

- [ ] **Step 5.1: Copy all four ADRs**

```bash
for n in 0010 0011 0012 0013; do
  cp ~/<sb-repos>/cc-custom-plugin-glossary/docs/adrs/${n}-*.md \
     ~/<sb-repos>/cc-custom-plugin-template/docs/adrs/
done
ls ~/<sb-repos>/cc-custom-plugin-template/docs/adrs/ | grep -E '^(0010|0011|0012|0013)'
```

Expected: four files listed, matching `0010-push-channels.md`, `0011-user-cache-lifecycle.md`, `0012-strict-gdpr-user-lifecycle.md`, `0013-logging-contract.md`.

- [ ] **Step 5.2: Genericize each ADR**

For each new ADR, look for glossary-domain examples (entries, ideas, categories, idea-approved) and rewrite as generic illustrative examples (e.g. "domain object", "audit event", "user action"). Particularly:

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
grep -n -i 'glossar\|entries\|ideas\|categori\|term\b\|definition' docs/adrs/001{0,1,2,3}-*.md
```

For every hit, decide: rewrite to generic, delete the example, or leave (if it's a coincidental match like "categori-cal").

- [ ] **Step 5.3: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add docs/adrs/0010-*.md docs/adrs/0011-*.md docs/adrs/0012-*.md docs/adrs/0013-*.md
git commit -m "docs(adrs): add 0010-0013 (push channels, user cache, GDPR, logging)

Source: cc-custom-plugin-glossary PR #1 + #6. Glossary-domain examples
rewritten as generic illustrations. Adds canonical reference for push
channel naming, SCIM user-cache lifecycle, GDPR delete + revalidation
semantics, and the structured-log contract.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6 (C6): Operational Links section in README

**Files:**
- Modify: `$TPL/README.md`

Glossary's README does NOT already have an explicit "Operational Links" section (per investigator). Template should add one as a canonical pattern for sibling plugins to copy.

- [ ] **Step 6.1: Find a stable insertion point**

```bash
grep -n '^##' ~/<sb-repos>/cc-custom-plugin-template/README.md
```

Insert the new section after the existing "Documentation" / "Getting started" block, before "Project structure" or before the appendix — whichever comes first. The engineer picks the line number from the grep output.

- [ ] **Step 6.2: Insert the section**

Edit `$TPL/README.md`, adding a new H2 section with this exact content:

```markdown
## Operational Links

> Fork-customize: replace `<PLUGIN_NAME>` and per-env URLs with the real
> values once the plugin is deployed.

| Resource | dev/de1 | stage/de1 | prod/de1 | prod/au1 | prod/us1 |
|---|---|---|---|---|---|
| Backstage | [`<PLUGIN_NAME>` component](https://backstage.staffbase.com/catalog/default/component/<PLUGIN_NAME>) | — | — | — | — |
| Grafana | [dashboard](https://observatory-dev-de1.staffbase.com/d/<plugin-uid>) | [dashboard](https://observatory-stage-de1.staffbase.com/d/<plugin-uid>) | [dashboard](https://observatory-de1.staffbase.com/d/<plugin-uid>) | [dashboard](https://observatory-au1.staffbase.com/d/<plugin-uid>) | [dashboard](https://observatory-us1.staffbase.com/d/<plugin-uid>) |
| VictoriaLogs | [explore](https://observatory-dev-de1.staffbase.com/explore?...&namespace=<PLUGIN_NAME>) | [explore](https://observatory-stage-de1.staffbase.com/explore?...&namespace=<PLUGIN_NAME>) | [explore](https://observatory-de1.staffbase.com/explore?...&namespace=<PLUGIN_NAME>) | [explore](https://observatory-au1.staffbase.com/explore?...&namespace=<PLUGIN_NAME>) | [explore](https://observatory-us1.staffbase.com/explore?...&namespace=<PLUGIN_NAME>) |
| Vault path | `dev/de1/<PLUGIN_NAME>/` | `stage/de1/<PLUGIN_NAME>/` | `prod/de1/<PLUGIN_NAME>/` | `prod/au1/<PLUGIN_NAME>/` | `prod/us1/<PLUGIN_NAME>/` |
| Customer Control | [staging](https://customer-control.stage.staffbase.dev/) — feature flags, branches | (same) | (same) | (same) | (same) |
| Mops manifests | `mops/kubernetes/namespaces/<PLUGIN_NAME>/dev/de1/` | `.../stage/de1/` | `.../prod/de1/` | `.../prod/au1/` | `.../prod/us1/` |
| Infrastructure | `infrastructure/github/staffbase/repositories/teams/cs-tech/<PLUGIN_NAME>.yml` | — | — | — | — |

See `docs/guides/deployment-handoff.md` for the seeding workflow.
```

- [ ] **Step 6.3: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add README.md
git commit -m "docs(readme): add Operational Links section

Canonical pattern for sibling cc-custom-plugin repos to copy. Placeholders
for plugin name + per-env URLs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7 (C7): CHANGELOG.md bootstrap

**Files:**
- Create: `$TPL/CHANGELOG.md`

- [ ] **Step 7.1: Write empty changelog**

```bash
cat > ~/<sb-repos>/cc-custom-plugin-template/CHANGELOG.md << 'EOF'
# Changelog

All notable changes to this template plugin are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [calendar versioning](https://calver.org/) (`v2026.YY.x`).

## [Unreleased]

— No changes yet.

## Notes for plugins forked from this template

Replace this file in your forked repo with a fresh `## [Unreleased]` block
and start tracking changes there. Reference the source template version
in your first release note for traceability.
EOF
```

- [ ] **Step 7.2: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add CHANGELOG.md
git commit -m "docs(changelog): bootstrap CHANGELOG.md

Empty Unreleased section. Forked plugins replace + start their own.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8 (C8): AGENTS.md cross-check + generic rule port

Glossary AGENTS.md has 87 lines; template has 59. The diff reveals several **generic** rules (not glossary-specific) that template should adopt.

**Files:**
- Modify: `$TPL/AGENTS.md`

- [ ] **Step 8.1: Diff and identify generic gaps**

```bash
diff ~/<sb-repos>/cc-custom-plugin-template/AGENTS.md \
     ~/<sb-repos>/cc-custom-plugin-glossary/AGENTS.md \
     | less
```

Identify lines unique to glossary that are **generic** (not feature-specific). Concretely, port these (verbatim from glossary, adapted for template):

A) **The widget-API mount-before-SSO rule**:

> `Widget API surface` — `server/src/routes/widget-api.ts` is the *only* place the widget talks to the backend. Mounted at `/api/widget/*` in `app.ts` BEFORE the global `ssoMiddleware` so the route applies its own (more permissive) SSO + CORS rules. CORS is `origin: "*"` because auth flows through `?jwt=` (a one-time service token), not cookies. Do NOT move widget endpoints under `/api/*` — that would attach the global cookie SSO and break cross-origin embedding.

B) **The `sub === "delete"` GDPR intercept location update** (currently template's AGENTS says "intercept in `routes/html.ts`"; the modern intercept is in `app.ts`):

Replace template's existing line:
> `sub === "delete"` in JWT signals a GDPR deleteInstance call — intercept in `routes/html.ts` before `issueSession()`, never create a session for these requests

with:
> `sub === "delete"` in JWT signals a GDPR deleteInstance call — intercept in `app.ts` before SSO/session issuance, never create a session for these requests. The intercept is **skipped in `IS_LOCALDEV=true`** because the widget preview sends a sentinel `?jwt=dev` that would otherwise produce a spurious 401.

C) **Widget content rendering / escape-HTML rule**:

> `Widget content rendering` — `widget.ts` is hand-written DOM (no React, no JSX). The widget MUST escape every dynamic value through `escHtml()` / `escAttr()` before inserting into `shadow.innerHTML`. Do NOT skip this — dynamic content can come from user input.

D) **Widget test directive — add `cd widget && bun test`** to the "Run X before every commit" line. Template currently is missing the widget test invocation.

Skip glossary-domain-specific rules (entries, ideas, plugin_settings 9 flags etc.) — they're not generic.

- [ ] **Step 8.2: Edit AGENTS.md**

Use the `Edit` tool to insert the four blocks above into the right places in `$TPL/AGENTS.md`:
- Block A: insert under "Key Constraints" near the existing widget bullet
- Block B: replace the existing GDPR line
- Block C: insert under "Key Constraints" right after Block A
- Block D: extend the "Run X before every commit" line to include `cd widget && bun test`

- [ ] **Step 8.3: Lint-style sanity**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
wc -l AGENTS.md
grep -c '^- ' AGENTS.md
```

Expected: line count grew by ~6–10 lines vs original (was 59 → roughly 67–73).

- [ ] **Step 8.4: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add AGENTS.md
git commit -m "docs(agents): port generic rules from glossary AGENTS.md

Add widget-API-mount-before-SSO rule, escape-HTML widget rendering rule,
update GDPR sub==delete intercept location to app.ts (was routes/html.ts),
add widget test invocation to pre-commit checklist.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9 (C9): Dependency hygiene (zod-validator + gha-workflows + AL #81 verification)

### Task 9a: `@hono/zod-validator` 0.7.6 → 0.8.0 (PR #5)

**Files:**
- Modify: `$TPL/server/package.json`
- Modify: `$TPL/bun.lock`

- [ ] **Step 9a.1: Bump dependency**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template/server
bun add @hono/zod-validator@^0.8.0
```

Expected: server/package.json updated, bun.lock updated.

- [ ] **Step 9a.2: Verify server tests still pass**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
bun test 2>&1 | tail -10
```

Expected: all server tests green. If `@hono/zod-validator` 0.8 changes default validation behaviour (it defaults to a 400 failure response), look at any route that overrides the failure handler — surface inconsistencies as a fix or a TODO in the commit message.

- [ ] **Step 9a.3: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add server/package.json bun.lock
git commit -m "chore(deps): bump @hono/zod-validator to ^0.8.0

Source: cc-custom-plugin-glossary PR #5. Minor bump; 0.8 surfaces the
default 400 response for improved RPC schema propagation + type safety.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 9b: `gha-workflows@v13.2.0` → `@v13.4.0` (PR #2)

**Files:**
- Modify: `$TPL/.github/workflows/autodev.yml`
- Modify: `$TPL/.github/workflows/cd.yml`
- Modify: `$TPL/.github/workflows/techdocs.yml`
- Modify: `$TPL/.github/workflows/update-release-draft.yml`

- [ ] **Step 9b.1: Bump references**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
sed -i '' 's|Staffbase/gha-workflows/\.github/workflows/\(.*\)@v13\.2\.0|Staffbase/gha-workflows/.github/workflows/\1@v13.4.0|g' \
  .github/workflows/autodev.yml \
  .github/workflows/cd.yml \
  .github/workflows/techdocs.yml \
  .github/workflows/update-release-draft.yml
grep -n 'gha-workflows.*@v' .github/workflows/*.yml
```

Expected: every reference now shows `@v13.4.0`. If any line still shows `@v13.2.0`, edit manually.

- [ ] **Step 9b.2: Compare with glossary for any other PR #2 deltas**

```bash
diff -r ~/<sb-repos>/cc-custom-plugin-template/.github/workflows/ \
        ~/<sb-repos>/cc-custom-plugin-glossary/.github/workflows/ \
        | head -60
```

Read each diff. For any Docker-action version bump (e.g. `docker/setup-buildx-action`, `docker/build-push-action`, `docker/login-action`) that glossary has and template doesn't, edit the corresponding template workflow file to match.

Don't blanket-apply glossary's whole workflow file — there may be glossary-specific job names or env vars. Cherry-pick only the version bumps.

- [ ] **Step 9b.3: Validate all workflows parse**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
for f in .github/workflows/*.yml; do
  python3 -c "import yaml,sys; yaml.safe_load(open('$f'))" && echo "OK: $f" || echo "FAIL: $f"
done
```

Expected: all OK.

- [ ] **Step 9b.4: Commit**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git add .github/workflows/
git commit -m "chore(ci): bump gha-workflows from v13.2.0 to v13.4.0

Source: cc-custom-plugin-glossary PR #2. Also bumps any Docker actions
that drifted. No job-name or env-var changes.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 9c: Verify AL PR #81 metric label injection fix already present

**Files:**
- Read-only verification: `$TPL/server/src/routes/metrics.ts`, `$TPL/server/src/middleware/access-log.ts`, related tests

- [ ] **Step 9c.1: Diff against AL post-#81 state**

```bash
diff ~/<sb-repos>/cc-custom-plugin-template/server/src/routes/metrics.ts \
     ~/<sb-repos>/cc-custom-plugin-applaunchpad/server/src/routes/metrics.ts \
     | head -60
diff ~/<sb-repos>/cc-custom-plugin-template/server/src/middleware/access-log.ts \
     ~/<sb-repos>/cc-custom-plugin-applaunchpad/server/src/middleware/access-log.ts \
     | head -60
```

If diffs reveal AL has injection-escape / route-bucketing logic that template doesn't, **port the AL versions verbatim** (these are generic fixes, not AL-specific). Run server tests after each port:

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
bun test 2>&1 | tail -10
```

- [ ] **Step 9c.2: Port AL regression tests if missing**

```bash
ls ~/<sb-repos>/cc-custom-plugin-template/server/src/__tests__/access-log.test.ts \
   ~/<sb-repos>/cc-custom-plugin-template/server/src/__tests__/metrics.test.ts 2>&1
```

If either is missing, copy from AL:

```bash
cp ~/<sb-repos>/cc-custom-plugin-applaunchpad/server/src/__tests__/access-log.test.ts \
   ~/<sb-repos>/cc-custom-plugin-template/server/src/__tests__/
cp ~/<sb-repos>/cc-custom-plugin-applaunchpad/server/src/__tests__/metrics.test.ts \
   ~/<sb-repos>/cc-custom-plugin-template/server/src/__tests__/
cd ~/<sb-repos>/cc-custom-plugin-template
bun test 2>&1 | tail -10
```

Expected: tests pass. If a test fails because template doesn't have the same demo route shape, adapt the test (don't change behaviour of metrics.ts).

- [ ] **Step 9c.3: Commit (only if anything was ported)**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git status
git add server/
git commit -m "fix(metrics): port AL PR #81 label injection fix + regression tests

Source: cc-custom-plugin-applaunchpad PR #81. Escapes special chars in
Prometheus label values, buckets unmatched request paths to coarse
ranges, adds regression tests. Prevents the ~3700-series pollution AL
observed in prod."
```

If `git status` shows nothing changed in Step 9c.1/9c.2, skip 9c.3 — template was already up to date. Note the no-op in the final summary commit.

---

## Task 10: Final verification

**Files:** none (test gate).

- [ ] **Step 10.1: Full local test suite**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
bun install
bun run check
bun test
(cd client && bun run test)
(cd widget && bun test)
```

Expected: Biome 0 errors, server suite green, client suite green, widget suite green. If any red, stop and fix in-branch.

- [ ] **Step 10.2: CI gate scripts run locally**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
bash scripts/check-dependabot-blockers.sh
```

Expected: `ok: dependabot blockers are consistent...` (or `skip: @staffbase/design not in client/package.json` if the dep isn't declared).

- [ ] **Step 10.3: Vault script dry-run**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
DRY_RUN=1 PLUGIN_NAME=cc-custom-plugin-template bash scripts/vault-bootstrap.sh dev-de1 2>&1 | tail -20
```

Expected: Vault paths show `cc-custom-plugin-template`; no actual writes.

- [ ] **Step 10.4: MkDocs build**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
mkdocs build --strict 2>&1 | tail -20
```

Expected: build succeeds. New docs (deployment-handoff, how-to-verify-f2-f9, phase-f-findings, mobile-checklist, visual-tour, ADRs 0010–0013) all rendered. If `--strict` fails on a placeholder link, decide: fix the link or relax strictness for that file.

If `mkdocs` isn't installed, skip with `pip install mkdocs mkdocs-material` first.

- [ ] **Step 10.5: Summary commit log review**

```bash
cd ~/<sb-repos>/cc-custom-plugin-template
git log --oneline main..HEAD
```

Expected: roughly 12–14 commits — one per task (Task 4 split into 4a/4b/4c/4d/4e, so 4 doc commits in addition to the others). Each commit message references its source (glossary PR # or AL PR #).

- [ ] **Step 10.6: Final state announcement**

Print a summary to the user:

```
S1 complete on local branch chore/template-canonical-sync.
- N commits added (see git log main..HEAD).
- All test suites green.
- mkdocs build succeeds.
- Vault dry-run produces template-namespaced paths.
- Ready to merge to template main (or hold pending review before S2/S3 dispatch).
```

Do NOT push (no remote). Do NOT merge to `main` without explicit user instruction.

---

## Self-review (post-write)

**Spec coverage check:**

| Spec §S1 Component | Plan task |
|---|---|
| C1 Vault bootstrap | Task 1 |
| C2 Capture scripts | Task 2 |
| C3 dev-preview workflow | Task 3 |
| C4 Documentation (handoff, how-to-verify, phase-f, mobile, visual-tour) | Task 4a–4e |
| C5 ADRs 0010–0013 | Task 5 |
| C6 Operational Links | Task 6 |
| C7 CHANGELOG | Task 7 |
| C8 AGENTS.md cross-check | Task 8 |
| C9 Dep hygiene (zod-validator + gha-workflows + AL #81 verify) | Task 9a–9c |

All covered. No spec gaps.

**Placeholder scan:** No "TBD"/"TODO" in this plan. The placeholder-ization steps INSIDE the created docs use `<PLUGIN_NAME>` / `<Plugin>` as the explicit substitution target — that's documented in the doc headers.

**Type consistency:** No types crossed between tasks. Each task is self-contained.
