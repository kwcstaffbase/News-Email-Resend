# Custom plugin deployment handoff

> **Fork-customize note:** this document is a generic deployment-handoff template.
> Replace every `<PLUGIN_NAME>` / `<Plugin>` placeholder with the real plugin name,
> and trim or rewrite plugin-domain examples before sharing with infra/SRE.

Operational runbook for shipping a new Staffbase custom plugin to all clusters, from "repo + manifests prepared" to "pod running, plugin installable from Customer Control". Reusable for any custom plugin — every step includes the **generic action**, a **ready-to-run command**, and a **worked example** placeholder to be filled in per plugin.

Both humans and AI agents (Claude / subagents) can execute this doc. Approval gates between sensitive steps are marked **🛑 APPROVAL GATE**.

## Contents

- [How to use this doc](#how-to-use-this-doc)
  - [Superpowers + subagent patterns](#superpowers--subagent-patterns-claude--agents-only)
- [Pre-flight — permissions + tooling check](#pre-flight--permissions--tooling-check)
- [End-to-end checklist](#end-to-end-checklist)
- [Step 1 — Verify cross-repo PRs are in sync](#step-1--verify-cross-repo-prs-are-in-sync)
- [Step 2 — Merge `infrastructure`, then `mops`](#step-2--merge-infrastructure-then-mops)
- [Step 3 — Open + preview the plugin PR](#step-3--open--preview-the-plugin-pr)
- [Step 4 — Vault credentials (per environment)](#step-4--vault-credentials-per-environment)
- [Step 5 — Register the plugin in Customer Control](#step-5--register-the-plugin-in-customer-control)
- [Step 6 — Verify pod + first install smoke test](#step-6--verify-pod--first-install-smoke-test)
- [Step 7 — Initial prod release, then switch to ongoing dev branch](#step-7--initial-prod-release-then-switch-to-ongoing-dev-branch)
- [Troubleshooting](#troubleshooting)
- [Rollback](#rollback)

---

## How to use this doc

### Human path

Read top-to-bottom. Each step has a generic intro, ready-to-run commands, a verify block, and a worked-example slot to compare against.

### Agent path (Claude / subagents)

1. Run [pre-flight](#pre-flight--permissions--tooling-check) first. If any permission check fails, stop and ask the user to log in / refresh tokens.
2. Execute commands inline. **Stop at every 🛑 APPROVAL GATE** and ask the user to confirm before proceeding.
3. After each Verify block, confirm success state matches expected output before moving on.
4. If a step produces unexpected output, jump to [Troubleshooting](#troubleshooting) and report findings instead of guessing.

### Always-stop list (approval gates)

These actions must always go through an explicit user confirmation:

- Any `vault kv put` (writes secrets)
- Any `git push` to `mops/main`, `infrastructure/main`, or the plugin repo `main` (PR merges)
- Any `git tag` creation (triggers prod release)
- Any `helm uninstall`, `kubectl delete`, or `flux suspend` (destructive cluster ops)
- Any CuCu form submission (creates real plugin entries)
- Any `git push origin main:dev` (changes which image runs on dev cluster)

Read-only diagnostics (`kubectl get`, `kubectl describe`, `vault kv get`, `gh pr view`, `flux get`) do not require approval.

### Superpowers + subagent patterns (Claude / Agents only)

The Claude Code session that drives this runbook has access to **Superpowers skills** (`brainstorming`, `writing-plans`, `executing-plans`, `systematic-debugging`, `verification-before-completion`, `using-git-worktrees`, `dispatching-parallel-agents`, etc.) and **cavecrew subagents** (`cavecrew-investigator`, `cavecrew-builder`, `cavecrew-reviewer`). Use them deliberately — they're not free, but they slash main-context token usage and parallelise independent work.

#### When to invoke each Superpower skill

| Skill | Use when |
|---|---|
| `superpowers:executing-plans` | Driving this runbook end-to-end. This doc IS the plan; invoke the skill so the checkpoint discipline (verify between steps) is enforced. |
| `superpowers:systematic-debugging` | Any time the [Troubleshooting](#troubleshooting) section is hit (e.g. helper Job stuck, HelmRelease backoff). Forces hypothesis-driven debugging rather than guess-and-restart. |
| `superpowers:verification-before-completion` | Before claiming any step "done" (esp. before approval gates). Catches the "ran command, didn't read output" failure mode. |
| `superpowers:using-git-worktrees` | If you need to work on `mops` + plugin repo simultaneously without context-switching the cwd. Each gets its own worktree. |
| `superpowers:dispatching-parallel-agents` | The three cross-repo PR setups (infra / mops / plugin) at the start of an onboarding can be prepped in parallel — different repos, no shared state. |
| `superpowers:writing-plans` | **Not for this doc** — only for one-off engineering work spawned off this runbook (e.g. "we need to add a new metric, write a plan"). |

#### When to dispatch a cavecrew subagent

The main thread runs all `kubectl`, `vault`, `gh`, `git`, and `flux` commands — these are sequential and approval-gated. Subagents are for code work that doesn't touch infra:

| Subagent | Use when | Don't use for |
|---|---|---|
| `cavecrew-investigator` | "Where is `validate-migrations` defined?", "Which chart template hardcodes `/metrics`?", "List all references to `<PLUGIN_NAME>-credentials`". Read-only, returns a `file:line` table — ~60% fewer tokens than inline grep+read. | Anything that needs to modify state. |
| `cavecrew-builder` | Single bounded edit: "exempt `<join_table>` in `server/src/scripts/validate-migrations.ts`", "bump `runAsUser` to 65534 in helm.yaml". Hard-refuses 3+ files. | Cross-repo edits, anything requiring infra access, anything where the fix isn't obvious from the prompt. |
| `cavecrew-reviewer` | Reviewing the diff of a feature branch before merging (e.g. running `/ultrareview` style audit on the bootstrap PR). | Open-ended "is this design good?" questions — that's brainstorming, not review. |

#### Parallelisation pattern (example)

When prepping the three cross-repo PRs, you'd dispatch in a single message:

```text
Agent #1 (cavecrew-investigator): "Locate the exact files I need to touch in
  Staffbase/infrastructure to onboard <PLUGIN_NAME> for cs-tech.
  Report file:line. Do not modify."

Agent #2 (cavecrew-investigator): "In Staffbase/mops, find the launchpad
  namespace tree as a template to copy. Report file:line for base + per-env
  overlays + cluster Flux kustomizations."

Agent #3 (cavecrew-builder): "In the <PLUGIN_NAME> repo, run validate-migrations
  locally and report any failures. If a failure cites a missing instance_id
  on a join table, exempt that table in
  server/src/scripts/validate-migrations.ts and commit."
```

Main thread reads three caveman-compressed reports back, then drives the actual writes/PRs.

#### Gotchas

- **Subagents don't see approval gates.** Never let a subagent run a `vault kv put`, `gh pr merge`, or `kubectl delete`. Main thread is the only path for gated actions.
- **Subagent shells are fresh.** They don't inherit `VAULT_TOKEN`, `KUBECONFIG`, or `gh` auth. Pass paths/values in the prompt, not as assumed env.
- **Trust but verify.** A `cavecrew-builder` saying "fixed" doesn't mean fixed — re-read the diff before approving the next step.
- **Don't over-delegate.** Single `kubectl get` doesn't need a subagent. Reserve them for tasks that would otherwise eat 1000+ tokens inline.
- **Approval gates take priority over efficiency.** Even if a subagent could "just merge the PR", main thread asks the user first.

---

## Pre-flight — permissions + tooling check

### Workspace convention

Every shell snippet in this doc references two env vars instead of hardcoded paths. **Set them once at the start of the session** (add to your shell rc if you do this often):

```bash
# Root folder where every Staffbase repo lives side-by-side:
#   $STAFFBASE_WORKSPACE/infrastructure/
#   $STAFFBASE_WORKSPACE/mops/
#   $STAFFBASE_WORKSPACE/cc-custom-plugin-applaunchpad/
#   $STAFFBASE_WORKSPACE/<PLUGIN_NAME>/
#   …
export STAFFBASE_WORKSPACE=~/DEV/Github_Staffbase   # adjust to your local layout

# Per-cluster kubeconfigs:
#   $KUBECONFIG_DIR/kubeconfig-dev-de1.yaml
#   $KUBECONFIG_DIR/kubeconfig-stage-de1.yaml
#   $KUBECONFIG_DIR/kubeconfig-prod-de1.yaml
#   …
export KUBECONFIG_DIR=~/.kube/config
```

> 🤖 **Agent / Claude session note:** when opening a new Claude Code (or other AI) session for **any** custom plugin work — onboarding, ongoing dev, troubleshooting — open it with `$STAFFBASE_WORKSPACE` as the cwd, **not** the plugin repo directly. Reason: cross-repo work (mops manifests, infrastructure PR, plugin source) all live as siblings; a session rooted at `$STAFFBASE_WORKSPACE` can `cd` into any of them without re-rooting, and the `git status` / `gh pr` results don't bleed across repos. Sibling repos like `cc-custom-plugin-applaunchpad`, `cc-custom-plugin-abbreviations` are also reachable for "how did launchpad solve X" lookups (often the fastest answer to a chart / manifest question).

### Permissions + tooling

Run this once before starting; bail if any check fails.

```bash
# Tooling
for cmd in gh kubectl vault flux helm yq jq openssl; do
  command -v "$cmd" >/dev/null && echo "✓ $cmd" || echo "✗ MISSING: $cmd"
done

# Workspace env vars set?
[ -n "$STAFFBASE_WORKSPACE" ] && [ -d "$STAFFBASE_WORKSPACE" ] && echo "✓ STAFFBASE_WORKSPACE=$STAFFBASE_WORKSPACE" || echo "✗ set STAFFBASE_WORKSPACE first (see Workspace convention)"
[ -n "$KUBECONFIG_DIR"    ] && [ -d "$KUBECONFIG_DIR"    ] && echo "✓ KUBECONFIG_DIR=$KUBECONFIG_DIR"       || echo "✗ set KUBECONFIG_DIR first"

# GitHub authenticated
gh auth status 2>&1 | grep -q "Logged in" && echo "✓ gh" || echo "✗ gh — run: gh auth login"

# Vault session (OIDC role oidc-team-cstech or equivalent)
VAULT_ADDR=https://vault.staffbase.com vault token lookup 2>&1 | grep -qE "^policies.*oidc-team-" \
  && echo "✓ vault" \
  || echo "✗ vault — run: VAULT_ADDR=https://vault.staffbase.com vault login -method=oidc role=oidc-team-cstech"

# Kubectl per target env (one check per env you plan to touch)
for ENV in dev-de1 stage-de1 prod-de1 prod-au1 prod-us1; do
  KC=$KUBECONFIG_DIR/kubeconfig-${ENV}.yaml
  if [ -f "$KC" ]; then
    KUBECONFIG=$KC kubectl get ns >/dev/null 2>&1 && echo "✓ $ENV" || echo "✗ $ENV — kubeconfig found but token rejected"
  else
    echo "✗ $ENV — no kubeconfig at $KC"
  fi
done
```

> **Worked example slot:** for the initial deploy on `dev/de1`, only `dev-de1` kubeconfig + Vault OIDC are required. `prod-*` kubeconfigs become required at step 7.

> 🤖 **Agent tip:** invoke `superpowers:executing-plans` *now* (top of the runbook). The skill enforces the "verify between steps" discipline. The pre-flight above is the natural first step it gates on.

---

## End-to-end checklist

| # | Step | Action (generic) | Owner | Gated on |
|---|---|---|---|---|
| 1 | infra PR | Merge `infrastructure` PR | Plugin team | — |
| 2 | mops PR | Merge `mops` PR (with `dev` label for dev cluster auto-deploy) | Plugin team + Diablo reviewer | infra merged + Terraform applied |
| 3 | Vault writes per env | 1 plugin credentials secret + **5 postgres user secrets** at `{cluster}/{env}/{plugin-name}/...` | Plugin team via OIDC | mops merged + Flux reconciled the env |
| 4 | VSO + helper unblock | (automatic, with optional Flux nudge) | none | Vault writes |
| 5 | CuCu register | Register plugin in CuCu per env | Plugin team | none specific |
| 6 | PR preview (dev) | Add `dev` label on plugin PR → `dev-preview.yml` builds + patches mops `dev/de1` | Plugin team | env unblocked (Vault + CuCu) |
| 7 | Smoke test | Walk Step 6 checklist on the dev cluster URL | Plugin team | preview image deployed |
| 8 | Merge plugin PR to `main` | Triggers stage build via cd.yml | Plugin team + reviewer | dev smoke green |
| 9 | Stage Vault + CuCu | Repeat Vault writes + CuCu registration for stage | Plugin team | PR merged (so stage Flux has the image) |
| 10 | Prod Vault + CuCu | All three regions, no placeholders | Plugin team | stage smoke green |
| 11 | Cut `vX.Y.Z` tag | Triggers prod release across de1/au1/us1 | Plugin team | all prod Vault + CuCu done |
| 12 | Persistent `dev` branch | `git push origin main:dev` on plugin repo | Plugin team | after prod live |

---

## Step 1 — Verify cross-repo PRs are in sync

Three independent PRs are logically paired. Before promoting any out of DRAFT, confirm they reference each other and their diffs are scoped.

### Commands

```bash
# Replace with your three PRs
INFRA_PR=15120 ; MOPS_PR=15996 ; PLUGIN_REPO=<PLUGIN_NAME> ; PLUGIN_PR=1

gh pr view "$INFRA_PR"     --repo Staffbase/infrastructure --json title,state,body | jq '{title,state,bodyHead:(.body[0:200])}'
gh pr view "$MOPS_PR"      --repo Staffbase/mops           --json title,state,body | jq '{title,state,bodyHead:(.body[0:200])}'
gh pr view "$PLUGIN_PR"    --repo "Staffbase/$PLUGIN_REPO" --json title,state,body | jq '{title,state,bodyHead:(.body[0:200])}'

# Diff scopes — infra should only touch 3 files; mops should only touch the new ns + 2 existing files
gh pr diff "$INFRA_PR"  --repo Staffbase/infrastructure --name-only
gh pr diff "$MOPS_PR"   --repo Staffbase/mops           --name-only | head -30
```

### Verify

- All three PRs reference each other in their descriptions.
- `infrastructure` diff = 3 files: 1 new repo yml + 2 existing-file edits (`locals.tf`, `vault/oidc.tf`).
- `mops` diff = ~23 files under `kubernetes/namespaces/{plugin-name}/` + 5 cluster-level Flux kustomizations + 2 existing-file edits (`flux-system/.../staffbase-cluster-vars-teams-cm.yaml`, `.github/CODEOWNERS`).
- Plugin PR = source + workflows, no external services touched.

> 🤖 **Agent tip:** the three diff-stat checks are independent reads. Dispatch them with `superpowers:dispatching-parallel-agents`, three `cavecrew-investigator` agents (one per repo). Each returns a `file:line` list in caveman-compressed form; main thread reads all three together and surfaces any unexpected file additions to the user. Cuts ~3-5k tokens vs running `gh pr diff` inline three times.

> **<Plugin> v1.0.0 example:**
> - `infrastructure` → [`Staffbase/infrastructure#15120`](https://github.com/Staffbase/infrastructure/pull/15120) (merged)
> - `mops` → [`Staffbase/mops#15996`](https://github.com/Staffbase/mops/pull/15996)
> - `<PLUGIN_NAME>` → [`Staffbase/<PLUGIN_NAME>#1`](https://github.com/Staffbase/<PLUGIN_NAME>/pull/1)
> All three branches were named `<PLUGIN_NAME>-onboarding` (PR #1 uses `bootstrap` because the GitHub repo only exists after Terraform applies).

---

## Step 2 — Merge `infrastructure`, then `mops`

Strict order — `mops` depends on the GitHub repo + Vault OIDC binding that `infrastructure` creates.

### 2a. `infrastructure` PR

> 🤖 **Agent tip:** before the gate, invoke `superpowers:verification-before-completion`. It forces you to (a) re-read the PR diff, (b) confirm the three expected files are the only changes, (c) state the merge command back to the user verbatim. Without it, agents have a tendency to "approve in spirit" by glossing over the diff.

#### 🛑 APPROVAL GATE — confirm before merge

#### Commands

```bash
# Mark ready (drop DRAFT)
gh pr ready "$INFRA_PR" --repo Staffbase/infrastructure
# After human review + approval:
gh pr merge "$INFRA_PR" --repo Staffbase/infrastructure --squash --delete-branch
```

Wait for Terraform apply on `infrastructure/main` (Atlantis or the workspace owner).

#### Verify

```bash
# New repo exists
gh repo view "Staffbase/$PLUGIN_REPO" --json url,createdAt | jq

# Vault OIDC binding includes the new namespace (requires vault login)
VAULT_ADDR=https://vault.staffbase.com vault policy read oidc-team-cstech | grep -F "$PLUGIN_REPO" \
  && echo "✓ Vault OIDC includes $PLUGIN_REPO" || echo "✗ Vault OIDC missing $PLUGIN_REPO"
```

> **<Plugin> v1.0.0 example:** [PR #15120](https://github.com/Staffbase/infrastructure/pull/15120) touches three files:
> - [`infrastructure/github/staffbase/repositories/teams/cs-tech/<PLUGIN_NAME>.yml`](https://github.com/Staffbase/infrastructure/blob/main/github/staffbase/repositories/teams/cs-tech/<PLUGIN_NAME>.yml) — NEW. Repo definition copied from launchpad equivalent.
> - [`infrastructure/github/staffbase/organization/locals.tf`](https://github.com/Staffbase/infrastructure/blob/main/github/staffbase/organization/locals.tf) — adds `<PLUGIN_NAME>` to org-wide ruleset.
> - [`infrastructure/vault/oidc.tf`](https://github.com/Staffbase/infrastructure/blob/main/vault/oidc.tf) — adds namespace to `module.oidc-team-cstech.team_namespaces`.

### 2b. `mops` PR

#### 🛑 APPROVAL GATE — confirm before merge + `dev` label

#### Commands

```bash
# 1. Mark ready
gh pr ready "$MOPS_PR" --repo Staffbase/mops
# 2. Human adds the `dev` label via GitHub UI (bots cannot — policy enforced via check-dev-label workflow)
gh pr view "$MOPS_PR" --repo Staffbase/mops --json labels | jq '.labels[].name' | grep -qx '"dev"' \
  && echo "✓ dev label present" || echo "✗ ask a human to add the dev label"
# 3. Merge (after review + approval)
gh pr merge "$MOPS_PR" --repo Staffbase/mops --squash --delete-branch
```

#### Verify (~5 min after merge)

```bash
export KUBECONFIG=$KUBECONFIG_DIR/kubeconfig-dev-de1.yaml
kubectl get ns "$PLUGIN_REPO"
kubectl -n "$PLUGIN_REPO" get pods
kubectl -n "$PLUGIN_REPO" get helmreleases
```

Expect:
- Namespace exists.
- Postgres pod running (Zalando postgres-operator creates and starts it).
- **Plugin pod `ImagePullBackOff`** — the base HelmRelease points at `image.tag: "1.0.0"` which does not exist in the registry yet. **Expected.** Steps 3 + 7 publish the real image.
- **Postgres HelmRelease in `False` state** — the secret-helper Job blocks on missing Vault entries. **Expected and resolved by step 4.**

> **Note** All new plugins must follow [ADR-0015](https://github.com/Staffbase/mops/blob/main/docs/adrs/0015-replace-apperator-with-helm-chart.md) and target the `./charts/staffbase-application` Helm chart, **not** the legacy Apperator CRD. See [mops migration guide](https://github.com/Staffbase/mops/blob/main/docs/howtos/apperator-to-helm-migration.md) for the field mapping.

> **⚠️ Chart pitfall — initContainers don't inherit defaults.** The chart's pod template renders `initContainers` via `toYaml $config` with **no defaults applied** — only the main container gets defaults from `values.yaml`. Every init container MUST set its own explicit `securityContext` covering all four Kyverno-required fields:
>
> ```yaml
> initContainers:
>   migrate:
>     image: …
>     securityContext:
>       allowPrivilegeEscalation: false
>       capabilities:
>         drop: [ALL]
>       readOnlyRootFilesystem: true
>       runAsGroup: 65534           # match Dockerfile USER
>       runAsNonRoot: true
>       runAsUser: 65534            # match Dockerfile USER
>       seccompProfile:
>         type: RuntimeDefault
> ```
>
> Without this, ReplicaSet creation is rejected by Kyverno's Enforce policies (`disallow-privilege-escalation`, `require-runasnonroot`, `require-seccomprofile-runtimedefault`, `require-drop-all-capabilities`) and the Helm upgrade times out after 15 min. See [Troubleshooting → Pods rejected by Kyverno](#pods-rejected-by-kyverno-on-the-init-container).

> **<Plugin> v1.0.0 example:** [PR #15996](https://github.com/Staffbase/mops/pull/15996) lays down 23 files under [`kubernetes/namespaces/<PLUGIN_NAME>/`](https://github.com/Staffbase/mops/tree/main/kubernetes/namespaces/<PLUGIN_NAME>):
> - **base/** — `<PLUGIN_NAME>-ns.yaml`, `<PLUGIN_NAME>-helm.yaml` (HelmRelease of the `staffbase-application` chart), `postgres-<PLUGIN_NAME>-helm.yaml` (HelmRelease of the `postgres` chart), `<PLUGIN_NAME>-application.yaml` (Kobs application), `<PLUGIN_NAME>-slo-sloth.yaml`, `kustomization.yaml`.
> - **overlays** — five per-env directories.
> - **cluster-level Flux kustomizations** under `kubernetes/clusters/{env}/{region}/`.
> - Two existing-file edits: alert routing → `cs-tech` + CODEOWNERS.
>
> Notable commits: [`1174c51`](https://github.com/Staffbase/mops/pull/15996/commits/1174c51f789) (Apperator → Helm), [`eaf9cc0`](https://github.com/Staffbase/mops/pull/15996/commits/eaf9cc0369c) (UID 65534), [`a10b6131`](https://github.com/Staffbase/mops/pull/15996/commits/a10b6131a2f) (drop redundant init securityContext per [reviewer feedback](https://github.com/Staffbase/mops/pull/15996#discussion_r3279207884)).

---

## Step 3 — Open + preview the plugin PR

After the GitHub repo exists (step 2a):

### 3a. Push your local branch as a feature PR

> 🤖 **Agent tip:** if you're juggling more than one repo at this point (e.g. fixing a `validate-migrations` violation in the plugin repo while waiting for mops CI), invoke `superpowers:using-git-worktrees` to keep separate `cwd`s instead of context-switching. Don't `cd` back and forth — gets lost easily.

Repos created by Terraform are initialised with a stub `README.md`, so `main` is not empty and direct pushes are blocked by the repo ruleset. Push as a feature branch and open a PR against `main`.

#### Commands

```bash
cd {}/$PLUGIN_REPO
git remote add origin "git@github.com:Staffbase/$PLUGIN_REPO.git" 2>/dev/null || true
git fetch origin
git checkout -b bootstrap
git rebase origin/main          # README conflict — keep local
git checkout --theirs README.md && git add README.md && git rebase --continue 2>/dev/null || true
git push -u origin bootstrap
gh pr create --base main --head bootstrap \
  --title "feat: bootstrap $PLUGIN_REPO (v1.0.0)" \
  --body "$(cat <<'EOF'
## Summary
Initial import of {plugin-name} v1.0.0. See CHANGELOG.md.

## Test plan
- [ ] Required checks pass
- [ ] After merge, cd.yml publishes image and patches mops stage/de1
EOF
)"
```

#### Verify

```bash
gh pr checks "$PLUGIN_PR" --repo "Staffbase/$PLUGIN_REPO"
```

Required org-wide checks: `Quality Gates`, Playwright E2E × 4 browsers, Playwright a11y, TechDocs publish, Socket Security, required-files.

> **Worked example slot:** the first bootstrap PR will often fail `validate-migrations` if your schema has join tables without an `instance_id` column. Fix by adding those table names to `EXEMPT_TABLES` in `server/src/scripts/validate-migrations.ts`. Record the actual PR / commit link here once known.

### 3b. cd.yml shape (what merging will trigger later)

#### Layout

`cd.yml` is split into two jobs to handle the `staffbase-application` Helm chart's split image format:

1. **`build`** — calls `Staffbase/gha-workflows/.github/workflows/template_gitops.yml` without `gitops-*` inputs. Builds + pushes to `registry.staffbase.com/sb-images/{plugin-name}:<tag>` (`main-<short-sha>` for main, `dev-<short-sha>` for dev, tag name for releases).
2. **`gitops`** — checks out `mops`, runs `yq` to write two YAML paths per overlay:
   - `spec.values.workload.container.image.tag` ← just the tag
   - `spec.values.workload.initContainers.migrate.image` ← full `registry/name:tag` string

Branch → overlay routing:

| Trigger | Patches mops overlay |
|---|---|
| push to `main` | `stage/de1` |
| push to `dev` | `dev/de1` |
| tag `v*` | `prod/de1`, `prod/au1`, `prod/us1` (single mops commit) |

> **Why not the shared `gitops-*` inputs?** The shared `gitops-github-action` writes one flat image string at a single yq path. The Helm chart splits image into `repository`/`tag`, so writing a flat string clobbers the map. The custom `yq` step writes both paths separately.

> **<Plugin> v1.0.0 example:** see [`.github/workflows/cd.yml`](../../.github/workflows/cd.yml). Custom `gitops` job + `/metrics` route alias introduced in [`055f160`](https://github.com/Staffbase/<PLUGIN_NAME>/pull/1/commits/055f160).

> 🤖 **Agent tip:** if `gh pr checks` shows a red CI step, do **not** flail. Invoke `superpowers:systematic-debugging`, dispatch a `cavecrew-investigator` to pull the failing job's logs (`gh run view --log-failed --job=<id>`) + locate the relevant source (e.g. `validate-migrations.ts` for the migration validator), then a `cavecrew-builder` for the single-file fix. Returns to main in one round-trip with a ready-to-approve diff.

### 3c. Smoke-test on dev/de1 before merging — `dev` label preview

You typically want to see the plugin run on the dev cluster **before** merging the bootstrap PR. The plugin repo carries [`dev-preview.yml`](../../.github/workflows/dev-preview.yml) which fires on `pull_request: labeled / synchronize` and:

1. Builds the PR head as `:pr-{PR#}-{short-sha}`.
2. Patches mops `dev/de1` with that tag.
3. Commits + pushes to `mops/main`.

#### Pre-conditions (must be true before adding the label)

- Namespace already on the cluster (mops PR merged — step 2b).
- Vault populated for dev (step 4).
- CuCu plugin registered for dev (step 5).

Without those, the pod stays `ImagePullBackOff` or `CreateContainerConfigError`.

#### 🛑 APPROVAL GATE — confirm before adding the `dev` label

#### Commands

```bash
# Add the label via GitHub UI, OR:
gh pr edit "$PLUGIN_PR" --repo "Staffbase/$PLUGIN_REPO" --add-label dev

# Watch the workflow run
gh run watch --repo "Staffbase/$PLUGIN_REPO" --exit-status \
  $(gh run list --repo "Staffbase/$PLUGIN_REPO" --workflow dev-preview.yml --limit 1 --json databaseId -q '.[0].databaseId')
```

#### Verify (~5 min after workflow green)

```bash
export KUBECONFIG=$KUBECONFIG_DIR/kubeconfig-dev-de1.yaml
kubectl -n "$PLUGIN_REPO" get pods
kubectl -n "$PLUGIN_REPO" describe pod -l app="$PLUGIN_REPO" | grep -E "Image:|Status:"
```

Smoke-test through the dev-cluster URL (step 6).

> **<Plugin> v1.0.0 example:** [`dev-preview.yml`](../../.github/workflows/dev-preview.yml) added in [`1232443`](https://github.com/Staffbase/<PLUGIN_NAME>/pull/1/commits/1232443).

### 3d. Merge the bootstrap PR

#### 🛑 APPROVAL GATE — confirm before merge

#### Commands

```bash
# Once dev smoke is green
gh pr edit "$PLUGIN_PR" --repo "Staffbase/$PLUGIN_REPO" --remove-label dev
gh pr merge "$PLUGIN_PR" --repo "Staffbase/$PLUGIN_REPO" --squash --delete-branch

# Watch CD on main
gh run list --repo "Staffbase/$PLUGIN_REPO" --branch main --workflow cd.yml --limit 3
```

#### Verify (~5 min after CD green)

```bash
export KUBECONFIG=$KUBECONFIG_DIR/kubeconfig-stage-de1.yaml
kubectl -n "$PLUGIN_REPO" get pods
```

> The dev/de1 overlay still carries the **last preview tag** (`pr-1-<sha>`) you pushed via the dev label. That image keeps running on dev/de1 until step 7c or another labeled PR overwrites it.

#### What surfaces in Backstage after merge

The Backstage catalog scanner reads each repo's **default branch (`main`)** for `catalog-info.yaml`. While PR #1 is open on `initial-import`, **no Component entity is registered** — `https://backstage.staffbase.com/catalog/default/component/$PLUGIN_REPO` returns 404. The `dev` label triggers `dev-preview.yml` (image build + mops patch) but does NOT touch the catalog.

After merging to `main`:

| Surface | Visibility |
|---|---|
| `/catalog/default/component/$PLUGIN_REPO` | Appears after Backstage's next catalog refresh (minutes, not hours) |
| TechDocs at `/docs/default/component/$PLUGIN_REPO/` | Requires both the Component entity AND a `techdocs` publish on `main` to have run. PR runs of `publish-techdocs-site / TechDocs` are smoke-builds only — they do NOT attach a site to a non-existent entity. The first usable docs site appears on the next push to `main` after the entity is registered. |
| SonarCloud project / ownership lookups (`mcp__claude_ai_Backstage__find_owner_by_repo`) | Both depend on the catalog entity existing |

Verify after merge:

```bash
sleep 600  # give catalog scanner a refresh cycle
curl -s "https://backstage.staffbase.com/api/catalog/entities/by-name/component/default/$PLUGIN_REPO" \
  -H "Accept: application/json" | jq '.metadata.name, .metadata.annotations'
```

Expect: `"$PLUGIN_REPO"` plus the `github.com/project-slug` and `backstage.io/techdocs-ref` annotations from `catalog-info.yaml`. If 404 after 30 min, fall back to manual `/catalog-import` via the Backstage UI with the URL `https://github.com/Staffbase/$PLUGIN_REPO/blob/main/catalog-info.yaml`.

---

## Step 4 — Vault credentials (per environment)

The plugin pod will keep crashing (or `CreateContainerConfigError`) until these secrets are present. **Two kinds of writes — one manual, five also manual.** (Earlier versions of this doc claimed the postgres entries auto-populate; that is wrong — see [Troubleshooting](#troubleshooting).)

> 🤖 **Agent tip:** **never dispatch a subagent for Vault writes.** Main thread only, behind the 🛑 gate. Subagents bypass approval prompts AND their shells don't inherit your authenticated `VAULT_TOKEN` (they'd 403 anyway). Same rule for the read-back verify — main thread reads `vault kv get` so the user sees the path list.

### 4a. Plugin credentials secret (manual)

**Path:** `{cluster}/{env}/{plugin-name}/{plugin-name}-credentials`

| Key | Value source | Notes |
|---|---|---|
| `PLUGIN_ID` | Customer Control (step 5) | UUID assigned at plugin registration in CuCu |
| `PUBLIC_KEY` | Customer Control (step 5) | RSA PEM shown in CuCu under **Plugin Secrets** |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` | 64 hex chars. AES-256-GCM key for the plugin's encrypted-token column. **Generate fresh per env, never reuse.** |
| `SECRET` | Customer Control (step 5) | Installation shared secret for push notifications. |

For **dev** + **stage** you can write placeholder strings (`PLUGIN_ID="placeholder"`, `PUBLIC_KEY="placeholder"`) to let the pod start; rotate them to real values once step 5 completes. **In prod the real values must be set before exposing the route.**

> ⚠️ **Vault rotation needs a pod restart.** Kubernetes `env.valueFrom.secretKeyRef` reads each variable **once at container start**. VSO updates the K8s Secret when Vault changes, but the running pod keeps the values it captured at boot. Any time you `vault kv put` or `vault kv patch` these keys (initial seed, placeholder → real rotation, key rotation), you **must** follow up with `kubectl -n $PLUGIN_REPO rollout restart deploy/$PLUGIN_REPO` or every JWT verify in the iframe returns 401. Step 5 includes this restart; outside that flow it is your responsibility.

#### 🛑 APPROVAL GATE — confirm before any `vault kv put`

#### Commands

```bash
export VAULT_ADDR=https://vault.staffbase.com
CLUSTER=de1 ; ENV=dev   # adjust per env
BASE="$CLUSTER/$ENV/$PLUGIN_REPO"

# Encryption key — generated locally, never reused
ENCRYPTION_KEY=$(openssl rand -hex 32)

vault kv put "$BASE/$PLUGIN_REPO-credentials" \
  PLUGIN_ID="placeholder" \
  PUBLIC_KEY="placeholder" \
  ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  SECRET="placeholder" >/dev/null
unset ENCRYPTION_KEY

vault kv get -field=ENCRYPTION_KEY "$BASE/$PLUGIN_REPO-credentials" | wc -c
# → 65  (64 hex chars + newline)
```

#### Verify — `PLUGIN_ID` matches the right plugin

Easy mistake: copying `PLUGIN_ID` / `PUBLIC_KEY` / `SECRET` from the **wrong** plugin row in Customer Control (e.g. another plugin already registered for the same team) and only catching it via mysterious 401s in the iframe. Catch it now with the public endpoint:

```bash
# Wait until pod has been restarted with current Vault values (see warning above).
curl -s "https://${PLUGIN_REPO}-${CLUSTER}.staffbase.${ENV_DOMAIN}/api/public/instance" | jq '.pluginId'
# ENV_DOMAIN = dev | stage | com   (matches CLUSTER/ENV)
```

The returned `pluginId` MUST be this plugin's identifier as shown in CuCu — not the placeholder, not another plugin's ID. If it is wrong, you copied the values from the wrong CuCu entry; `vault kv patch` the real ones and restart the pod again.

> **Worked example slot (`dev/de1`):** common failure mode — `curl …/api/public/instance` returns another plugin's `pluginId` because credentials were copied from the wrong CuCu row. Fix: re-grab values from the **correct `<PLUGIN_NAME>`** row in CuCu → `vault kv patch` → `kubectl rollout restart` → endpoint then returns the right identifier.

### 4b. Postgres credentials (manual — 5 entries per env)

The `postgres` Helm chart (v0.6.0+) renders five `VaultSecret` CRDs at deploy time. **Each Vault path must be seeded manually with `username` + `password`** — the chart waits for them indefinitely otherwise (see `secret-helper` Job in [Troubleshooting](#troubleshooting)).

| Vault path suffix | `username` value |
|---|---|
| `postgres-{plugin-name}.postgres-{plugin-name}.credentials` | `postgres-{plugin-name}` (main app user — pod's `DATABASE_PASSWORD`) |
| `postgres.postgres-{plugin-name}.credentials` | `postgres` (superuser) |
| `metrics.postgres-{plugin-name}.credentials` | `metrics` (Prometheus exporter) |
| `readonly.postgres-{plugin-name}.credentials` | `readonly` |
| `standby.postgres-{plugin-name}.credentials` | `standby` (replica) |

#### 🛑 APPROVAL GATE — confirm before any `vault kv put`

#### Commands

```bash
export VAULT_ADDR=https://vault.staffbase.com
CLUSTER=de1 ; ENV=dev
BASE="$CLUSTER/$ENV/$PLUGIN_REPO"

for USER in "postgres-$PLUGIN_REPO" postgres metrics readonly standby; do
  case "$USER" in
    "postgres-$PLUGIN_REPO") P="$BASE/postgres-$PLUGIN_REPO.postgres-$PLUGIN_REPO.credentials" ;;
    *)                        P="$BASE/$USER.postgres-$PLUGIN_REPO.credentials" ;;
  esac
  PW="$(openssl rand -base64 32 | tr -d '\n' | tr '/+=' 'abc')"
  vault kv put "$P" username="$USER" password="$PW" >/dev/null && echo "✓ $P (username=$USER)"
  unset PW
done
```

(Passwords pass through shell vars only and are never echoed to stdout. The transcript captures only `username=<role>`.)

### 4c. Verify VSO sync + helper Job completion

VSO retries every 30-60s. If the helper Job has been hanging for hours, it may be in long backoff — see [Troubleshooting](#troubleshooting) for the Flux-reconcile-nudge trick.

```bash
export KUBECONFIG=$KUBECONFIG_DIR/kubeconfig-${ENV}-${CLUSTER}.yaml
KC=kubectl

$KC -n "$PLUGIN_REPO" get vaultsecrets
# Expect all 5 to flip from `False FetchFailed` → `True Updated` within ~60s

$KC -n "$PLUGIN_REPO" get jobs
# postgres-{plugin-name}-secret-helper should go to STATUS=Complete

$KC -n "$PLUGIN_REPO" get helmreleases
# Both should go to READY=True
```

> **<Plugin> v1.0.0 example:** for `dev/de1`, the manual writes were 1 + 5 = 6 Vault entries under `de1/dev/<PLUGIN_NAME>/`. The helper Job [`postgres-<PLUGIN_NAME>-secret-helper`](https://github.com/Staffbase/mops/blob/main/charts/postgres/templates/secret-helper-cm.yaml) waits for VSO to mirror the postgres VaultSecrets into K8s Secrets, then runs `ALTER USER ... WITH PASSWORD ...` to sync the database. Without the 5 writes the helper hangs forever in `Waiting for secret <name> to be ready...`.

---

## Step 5 — Register the plugin in Customer Control

Plugin registration is done in **Customer Control (CuCu)** — the internal CC Tech tooling that owns plugin definitions per environment. Performed by a CC Tech Team member with CuCu write access, **one registration per `{cluster}/{env}` combo**, since each env has its own CuCu instance.

> 📎 **Studio profile links auto-derive.** Since v1.0.0 the plugin's client reads `staffbaseUrl` from the JWT `issuer_domain` claim ([ADR-0010 sibling change](../adrs/0011-user-cache-lifecycle.md) reference area). User-profile links in admin tables resolve to the branch's canonical Studio URL automatically — no manual URL config in CuCu is needed for links to work on customer-rebranded domains.

> 🤖 **Agent tip:** CuCu is a UI workflow — no automation path. Agents cannot fill the form. Best you can do is present the table values (vendor / ID / URLs / toggles) and ask the user to verbatim copy them into the form. Then ask the user to paste back `PLUGIN_ID` / `PUBLIC_KEY` / `SECRET` so you can run the `vault kv patch` (main thread, behind the 🛑 gate).

### 🛑 APPROVAL GATE — confirm before submitting the CuCu form

### Register the plugin

In Customer Control → switch the service selector to the target env (e.g. `dev / de1`) → **PLUGINS** → **Add Plugin**. Fill in:

#### Publisher / Vendor

| Field | <Plugin> v1.0.0 value | Notes |
|---|---|---|
| Vendor | `Staffbase` | Pick from dropdown. If your vendor is missing, add it via the linked "add a new vendor" flow first. |

#### Plugin Details

| Field | <Plugin> v1.0.0 value | Notes |
|---|---|---|
| **ID** | `staffbase.<plugin>` | Reverse-DNS form: `{vendor}.{plugin-slug}`. Becomes the canonical plugin id used everywhere. |
| **Flag protected?** | `true` (toggle on) | Default true. Leave on unless the plugin must run unprotected. |
| **Icon** | `spaces-alt` (or pick another) | Drives the in-app plugin icon. |
| **Color** | `#000000` (or brand color) | Hex color, applied to the icon background. |
| **Display** | `Auto` | Default. |

#### Plugin Localizations

One tab per supported locale (DE / EN visible in CuCu). Fill all five fields per locale:

| Field | <Plugin> v1.0.0 value |
|---|---|
| Title | `<Plugin>` |
| Entity singular | `<Plugin> Item` |
| Entity plural | `<Plugin> Items` |
| Synopsis (Plugin Description) | `<one-line description of what this plugin does>` |
| Add New | `Add <Plugin> Item` |

#### Plugin URLs

Plugin host comes from the chart's VirtualService: `{plugin-name}-${staffbase_cluster_name}.${staffbase_cluster_domain}`. For `<PLUGIN_NAME>` on `dev/de1` that's `<PLUGIN_NAME>-de1.staffbase.dev`. Adjust per env (`stage.staffbase.dev`, `staffbase.com` for prod).

| Field | <Plugin> v1.0.0 value (`dev/de1`) |
|---|---|
| **Frontend URL** | `https://<PLUGIN_NAME>-de1.staffbase.dev` |
| **Backoffice (Admin) URL** | `https://<PLUGIN_NAME>-de1.staffbase.dev/admin` |
| **API URL** | `https://<PLUGIN_NAME>-de1.staffbase.dev/api` |

#### Plugin Configuration (boolean toggles)

| Toggle | <Plugin> v1.0.0 | Notes |
|---|---|---|
| add Native View Target (MobilePlatform.ios) | **off** | Default true. |
| add Native View Target (MobilePlatform.android) | **off** | Default false. |
| is Available In Public Area | **off** | Plugin requires auth. |
| is Anonymous Mode | **off** | Default false. |
| **is Remote Deleteable** | **on** | Server implements `DELETE /api/users/{id}` for GDPR data removal. |
| **is Session Managed** | **on** | Server implements `DELETE /api/users/session` for backend logout. |
| is Sandboxed | **off** | Default false. |
| is BasicAuth Supported | **off** | JWT/SSO only. |
| Allow iFrame Fullscreen | **off** | Default false. |
| Allow iFrame Clipboard Write | **off** | Default false. |

#### Additional SSO Properties

| Toggle | <Plugin> v1.0.0 | Notes |
|---|---|---|
| tags | **off** | Plugin does not use custom profile tags. |
| primary_email_address | **off** | Plugin uses push notifications. |
| username | **off** | Identity via JWT `sub`. |

#### Plugin Secrets (read-only — generated by CuCu after save)

After clicking **Add Plugin**, CuCu shows:

- **Public Key** — RSA PEM. Copy verbatim into Vault as `PUBLIC_KEY` (step 4a).
- **Secret** — alphanumeric. Copy verbatim into Vault as `SECRET` (step 4a).
- **Plugin ID** (visible in the plugin URL / details panel as a UUID) — copy into Vault as `PLUGIN_ID` (step 4a).

### Post-registration

#### Commands

```bash
# Rotate placeholders to real values
export VAULT_ADDR=https://vault.staffbase.com
BASE="$CLUSTER/$ENV/$PLUGIN_REPO"
# Run interactively (paste values from CuCu):
read -s -p "PLUGIN_ID: " PLUGIN_ID; echo
read -s -p "PUBLIC_KEY (paste PEM, end with Ctrl+D): " PUBLIC_KEY
read -s -p "SECRET: " SECRET; echo

vault kv patch "$BASE/$PLUGIN_REPO-credentials" \
  PLUGIN_ID="$PLUGIN_ID" \
  PUBLIC_KEY="$PUBLIC_KEY" \
  SECRET="$SECRET" >/dev/null
unset PLUGIN_ID PUBLIC_KEY SECRET

# Restart pod so new env vars load
export KUBECONFIG=$KUBECONFIG_DIR/kubeconfig-${ENV}-${CLUSTER}.yaml
kubectl -n "$PLUGIN_REPO" rollout restart deploy/"$PLUGIN_REPO"
```

#### Verify

```bash
curl -s "https://${PLUGIN_REPO}-${CLUSTER}.staffbase.dev/api/public/instance" | jq
# → { "pluginId": "<UUID>", "instances": [...] } — pluginId MUST match CuCu
```

### Widget registration in Studio (if the plugin ships a widget)

The widget bundle is served by the plugin at `{plugin-host}/widget/{bundle}.min.js`. The plugin's `plugin.json` lists the widget under `widgets[]` with its config attributes. CC Tech Team registers the widget through the Studio widget-catalogue tooling (varies by environment).

> **Worked example slot:** record the final CuCu values once registered — plugin ID (e.g. `staffbase.<plugin>`), vendor, count of `widgets[]` config attributes from [`plugin.json`](../../plugin.json), toggles flipped ON (typically `isRemoteDeleteable` + `isSessionManaged`), plugin host (e.g. `https://<PLUGIN_NAME>-de1.staffbase.dev`), and widget bundle URL.

---

## Step 6 — Verify pod + first install smoke test

Once Vault + CuCu registration are done:

#### Commands

```bash
export KUBECONFIG=$KUBECONFIG_DIR/kubeconfig-${ENV}-${CLUSTER}.yaml
KC=kubectl

# 1. Pod healthy
$KC -n "$PLUGIN_REPO" get pods
$KC -n "$PLUGIN_REPO" logs deploy/"$PLUGIN_REPO" --tail=50
$KC -n "$PLUGIN_REPO" exec deploy/"$PLUGIN_REPO" -- curl -s localhost:3000/health
# → {"status":"ok"}
```

Then walk through the install flow. The plugin is consumed inside Staffbase (Studio editor + Frontend), not via direct URLs — three handoff hops between tools:

### 6a. CuCu — gate the plugin behind a feature flag

In Customer Control → switch the service selector to the target env (e.g. `dev / de1`) → **BRANCHES** → pick the test branch → **Add Feature Flag** → create one entry for the plugin:

| Field | <Plugin> v1.0.0 value | Notes |
|---|---|---|
| Flag title | `<Plugin>` | Same as the plugin title (step 5). Shown to branch admins. |
| Flag ID | `staffbase.<plugin>` | **Must match the plugin ID from step 5.** This is the link between the feature-flag toggle and the plugin definition. |

Flip the flag **on** for the branch you want to test with.

### 6b. Staffbase admin (Studio) — install the plugin into the customer instance

Login to the Staffbase customer instance for that branch → **Studio** → **Content** → **Marketplace**.

Customer instance URL is one of two patterns:

| Branch type | URL pattern |
|---|---|
| Internal / Staffbase-owned dev/test branch | `https://{branch-slug}.staffbase.dev` (dev), `…staffbase.stage` (stage), `…staffbase.com` (prod) |
| Customer with their own domain | `https://{customCustomerDomain}` (whatever the customer mapped via CNAME — Cloudflare config in `infrastructure/`) |

Use whichever applies to the branch you're testing against. For initial onboarding it's almost always the Staffbase-owned dev branch; only switch to a customer domain once you're shipping to a real tenant.

Then:

1. Search for the plugin (title from step 5 — `<Plugin>`).
2. Click **Install**. The marketplace tile becomes available because the CuCu feature flag (6a) gates it.

### 6c. Studio editor — add a plugin instance + author content

In Studio → **Content** → find the installed plugin in the left nav → **Add new instance** → name it (e.g. "<Plugin> - Dev Smoke") → save.

Open the instance to land in the **admin/editor** view of the plugin (iframed inside Studio):

1. Verify the admin tabs render (whatever the plugin exposes — items / settings / etc.).
2. Create some content.
3. **Publish** the instance so end-users can see it.

### 6d. Frontend user — view the published instance

Switch to the customer-facing frontend — same URL as 6b (`https://{branch-slug}.staffbase.{dev|stage|com}` for Staffbase-owned branches, or `https://{customCustomerDomain}` for real tenants). Use a regular user, separate session/profile if your editor user is different:

1. Navigate to the page or location that surfaces the plugin (mobile/web nav entry created when the instance was published).
2. Verify the content you authored in 6c appears.
3. Walk through the plugin-specific UX (search, submit forms, widget, settings cascades, etc.).
4. **Activity log** — switch back to the Studio editor view and confirm every mutation made above is captured.

> **Worked example slot — smoke checklist:**
> - 6a: feature flag `staffbase.<plugin>` enabled on the test branch.
> - 6b: install **<Plugin>** from Marketplace.
> - 6c: add instance → as editor walk every admin tab the plugin exposes. Create at least one item per content type. Toggle each settings checkbox and confirm any documented cascade behaviour (see `server/src/routes/plugin-settings.ts`).
> - 6d: as a regular user — exercise the user-facing flows (search, submit, etc.). Embed the widget on a Studio page and switch every `view_mode` value.
> - Activity log at **Admin → Settings → View Activity Log** must capture each mutation.

Tick each before declaring the deploy "live".

---

## Step 7 — Initial prod release, then switch to ongoing dev branch

> 🤖 **Agent tip:** every action here is gated. **No subagents for prod work.** `git tag`, `git push --tags`, `git push origin main:dev` — main thread only, behind 🛑 gates. Legitimate subagent use: a `cavecrew-reviewer` pass over `git log --oneline {last-tag}..HEAD` and the resulting diff *before* the tag goes out (catches any "shouldn't ship yet" commits).

### 7a. Register + populate Vault for every prod env (one-time)

For each of `prod/de1`, `prod/au1`, `prod/us1`:

1. CuCu — switch the service selector to the prod env → register the plugin (step 5). Capture `PLUGIN_ID`, `PUBLIC_KEY`, `SECRET`.
2. Vault — populate the plugin credentials + 5 postgres entries per step 4 (real values for prod, no placeholders).
3. Confirm VSO + helper unblock per env via the Verify commands in 4c.

**Do not cut the prod tag until all three regions are CuCu-registered + Vault-populated.**

### 7b. Cut the initial tag

#### 🛑 APPROVAL GATE — confirm tag + push

#### Commands

```bash
cd $STAFFBASE_WORKSPACE/$PLUGIN_REPO
git checkout main && git pull
git tag -a v1.0.0 -m "v1.0.0 — initial release"
git push origin v1.0.0
gh run watch --repo "Staffbase/$PLUGIN_REPO" \
  $(gh run list --repo "Staffbase/$PLUGIN_REPO" --workflow cd.yml --branch v1.0.0 --limit 1 --json databaseId -q '.[0].databaseId')
```

#### Verify

```bash
for ENV_TARGET in prod-de1 prod-au1 prod-us1; do
  export KUBECONFIG=$KUBECONFIG_DIR/kubeconfig-${ENV_TARGET}.yaml
  echo "=== $ENV_TARGET ===" && kubectl -n "$PLUGIN_REPO" get pods
done
```

Smoke each prod region per step 6.

> **<Plugin> v1.0.0 example:** prod hostnames are `<PLUGIN_NAME>-de1.staffbase.com`, `<PLUGIN_NAME>-au1.staffbase.com`, `<PLUGIN_NAME>-us1.staffbase.com`. The tag-triggered cd.yml run patches all three overlays in a single mops commit. Tag should match `plugin.json` `version` (`1.0.0`).

### 7c. Switch to ongoing `dev` branch

Once v1.0.0 is live in prod, retire the per-PR dev label flow and use a persistent `dev` branch for ongoing dev/de1 deploys.

#### 🛑 APPROVAL GATE — confirm before pushing the `dev` branch

#### Commands

```bash
cd $STAFFBASE_WORKSPACE/$PLUGIN_REPO
git checkout main && git pull
git push origin main:dev
```

This kicks `cd.yml` → image `dev-<sha>` builds and `dev/de1` overlay gets patched, replacing the last preview tag. From here on:

- **dev/de1** — merge to `dev` (or push directly) → image rolls into dev cluster.
- **stage/de1** — merge to `main` → image rolls into stage.
- **prod/{de1,au1,us1}** — cut a new tag (`v1.0.1`, `v1.1.0`, …) → image rolls into all three regions.

The dev-label preview flow stays available for visiting contributors / risky changes that need a dev preview before merge, but is no longer the primary path.

> **<Plugin> v1.0.0 example:** the persistent `dev` branch is created from `main` after v1.0.0 ships. Canonical chain afterwards: feature branch → PR to `main` → squash-merge → (optional) tag `vX.Y.Z` for prod. The `dev` branch can be force-reset to match main any time the preview flow has drifted it.

---

## Troubleshooting

> 🤖 **Agent tip for all subsections below:** invoke `superpowers:systematic-debugging` *before* reading any subsection. The skill enforces hypothesis-driven debugging — observe → hypothesise → test → confirm — rather than the "restart and hope" pattern. For locating relevant chart templates / operator logs, dispatch `cavecrew-investigator` (read-only, returns `file:line` table). Never dispatch a `cavecrew-builder` for cluster fixes — main thread runs `kubectl annotate` / `flux reconcile` so the user sees every cluster mutation.

### Pods rejected by Kyverno on the init container

**Symptom:** plugin URL (`https://{plugin-name}-{cluster}.staffbase.{dev|stage|com}`) returns no response (not even a JWT 401). `kubectl -n {plugin-name} get deploy` shows `0/1 READY`. `get rs` shows several ReplicaSets all at `Desired=1 Current=0 Ready=0`. HelmRelease stuck `False / Helm upgrade failed: context deadline exceeded` (15-min timeout).

**Diagnose:**

```bash
KC=kubectl
$KC -n {plugin-name} get events --sort-by='.lastTimestamp' -o json \
  | jq -r '.items[] | select(.reason=="FailedCreate") | .message' \
  | tail -1
```

Look for `validate.kyverno.svc-ignore` denying at `/spec/initContainers/0/securityContext/` against `disallow-privilege-escalation` / `require-runasnonroot` / `require-seccomprofile-runtimedefault` / `require-drop-all-capabilities`.

**Cause:** the chart's pod template renders `initContainers` via `toYaml $config` with no defaults. The init container has no `securityContext` block (or one missing the four Kyverno-required fields). Pod admission rejected → ReplicaSet can't create pods → Deployment stays at 0/1 → Helm upgrade times out.

**Fix:** add the explicit `securityContext` block to the init container in `kubernetes/namespaces/{plugin-name}/base/{plugin-name}-helm.yaml` — see the chart pitfall note in [Step 2b](#2b-mops-pr) for the full required block. UID/GID must match the `USER` directive in the plugin's `docker/Dockerfile` (typically `65534` for distroless `nonroot`).

Open a fix-forward PR on mops. Once merged + Flux reconciles, the next ReplicaSet attempt passes admission.

> **<Plugin> v1.0.0 example:** [`Staffbase/mops#16058`](https://github.com/Staffbase/mops/pull/16058) restores the block dropped by [a10b6131](https://github.com/Staffbase/mops/pull/15996/commits/a10b6131a2f) (a misguided "drop redundant defaults" change during the original onboarding PR review).

### Postgres VaultSecret stuck on `FetchFailed: secret is nil`

**Symptom:** `kubectl -n {plugin-name} get vaultsecrets` shows 1+ postgres entries with `SUCCEEDED=False, REASON=FetchFailed, MESSAGE=secret is nil` for hours; `secret-helper` Job pod still `Running` printing `Waiting for secret … to be ready` every 10s.

**Cause:** the Vault paths at `{cluster}/{env}/{plugin-name}/{user}.postgres-{plugin-name}.credentials` are empty. These do NOT auto-populate — see step 4b.

**Fix:**

1. Write the 5 entries (step 4b).
2. After writes, VSO may still be in a long post-failure backoff (~5-30 min) and won't notice immediately. Force a Flux reconcile of the postgres HelmRelease to nudge VSO:
   ```bash
   kubectl -n {plugin-name} annotate helmrelease postgres-{plugin-name} \
     "reconcile.fluxcd.io/requestedAt=$(date +%s)" --overwrite
   ```
3. Wait ~60s — VaultSecrets flip to `True/Updated`, helper Job moves to `Complete`, postgres pods get force-restarted.

### Plugin HelmRelease stuck on `Helm upgrade failed ... context deadline exceeded`

**Symptom:** after the postgres HelmRelease recovers, the plugin HelmRelease still shows `False`.

**Cause:** the previous upgrade timed out while postgres was broken; Flux is in backoff before retrying.

**Fix:**
```bash
kubectl -n {plugin-name} annotate helmrelease {plugin-name} \
  "reconcile.fluxcd.io/requestedAt=$(date +%s)" --overwrite
```

If that doesn't recover within 5-10 min, force a clean reinstall:
```bash
kubectl -n {plugin-name} patch helmrelease {plugin-name} --type=merge -p '{"spec":{"suspend":true}}'
sleep 5
kubectl -n {plugin-name} patch helmrelease {plugin-name} --type=merge -p '{"spec":{"suspend":false}}'
```

### VSO not picking up new Vault entries

**Symptom:** Vault entries are written and readable via `vault kv get`, but VaultSecret CR stays `FetchFailed`.

**Cause:** VSO is in post-failure backoff. Long-failed VaultSecrets may have minute-to-hour retry intervals.

**Fix:** trigger a Flux reconcile of the chart that owns the VaultSecret CR (postgres chart for postgres entries):
```bash
kubectl -n {plugin-name} annotate helmrelease postgres-{plugin-name} \
  "reconcile.fluxcd.io/requestedAt=$(date +%s)" --overwrite
```
The Flux reconcile touches the VaultSecret CR's generation, which forces VSO to reconcile it from scratch.

If even that doesn't work, ask Core Infra to restart the VSO pod:
```bash
kubectl -n vault-secrets-operator delete pod -l app.kubernetes.io/name=vault-secrets-operator
```

### Plugin returns 401 in the Staffbase iframe despite Vault values being set

**Symptom:** `vault kv get {cluster}/{env}/{plugin-name}/{plugin-name}-credentials` shows real `PLUGIN_ID` / `PUBLIC_KEY` / `SECRET`, the K8s Secret in the namespace has the same values (VSO synced), but every page-load in Staffbase logs `GET /` and `GET /admin` returning `401` with no SSO middleware trace.

**Cause:** Kubernetes `env.valueFrom.secretKeyRef` reads the Secret **once at container start**. VSO updated the Secret after the pod started → pod still holds the pre-rotation values (often placeholders or empty strings) → JWT signature verify against the stale `PUBLIC_KEY` fails on every request.

Quick diagnostic — compare pod start vs. Secret update time:

```bash
export KUBECONFIG=$KUBECONFIG_DIR/kubeconfig-${ENV}-${CLUSTER}.yaml
kubectl -n $PLUGIN_REPO get pod -l app=$PLUGIN_REPO -o jsonpath='{.items[0].status.startTime}{"\n"}'
kubectl -n $PLUGIN_REPO get vaultsecret $PLUGIN_REPO-credentials -o jsonpath='{.status.conditions[?(@.type=="SecretCreated")].lastTransitionTime}{"\n"}'
# If pod.startTime < VaultSecret.lastTransitionTime → env vars are stale.
```

**Fix:**

```bash
kubectl -n $PLUGIN_REPO rollout restart deploy/$PLUGIN_REPO
kubectl -n $PLUGIN_REPO rollout status deploy/$PLUGIN_REPO --timeout=2m
```

Reload the plugin in the Staffbase iframe — JWT verify succeeds.

> **<Plugin> v1.0.0 example (`dev/de1`):** pod started `13:20:45Z`, K8s Secret rotated by VSO at `13:24:09Z` (after `vault kv patch` for real `PLUGIN_ID` / `PUBLIC_KEY` / `SECRET` post CuCu registration). All `/` and `/admin` requests returned 401 until `kubectl rollout restart` cycled the pod.

### SCIM rename or GDPR delete not reflected in admin tables

**Symptom:** Editor renamed a user in Staffbase but the admin table inside the plugin still shows the old name. Or: user deleted in Staffbase but the table still shows the deleted user's name.

**Cause:** The per-instance `users` SCIM cache is refreshed by a background job (`refreshAllUsers()` in `server/src/lib/user-cache.ts`). Until the next cycle runs, the cache has the stale row.

**Fix:** The next refresh cycle resolves it automatically. Force a check + nudge if needed:

```bash
export KUBECONFIG=$KUBECONFIG_DIR/kubeconfig-${ENV}-${CLUSTER}.yaml
# Tail logs for the user-cache module to confirm refresh runs + reconciles
kubectl -n $PLUGIN_REPO logs deploy/$PLUGIN_REPO --tail=200 | grep "module=user-cache"
# Look for: event=refresh.deleted (orphan removed) — confirms GDPR delete propagated
```

If the refresh cadence is too slow for the test, restart the pod to force a fresh refresh cycle on boot:

```bash
kubectl -n $PLUGIN_REPO rollout restart deploy/$PLUGIN_REPO
```

For the rename case: the upsert pass overwrites the cache row's `firstName` / `lastName` from the latest Staffbase response. For the delete case: the per-user 404 from Staffbase triggers `cleanupDeletedUser`, removing the cache row → client `displayUser` helper falls through to the localized "Unknown user" string. **User IDs are never rendered.**

### Push notifications silently not delivered

**Symptom:** Submitted/approved/rejected an idea while `pushEnabled=true`, but the submitter never received anything.

**Diagnostic — grep the `module=push` structured log surface:**

```bash
export KUBECONFIG=$KUBECONFIG_DIR/kubeconfig-${ENV}-${CLUSTER}.yaml
kubectl -n $PLUGIN_REPO logs deploy/$PLUGIN_REPO --tail=500 | grep "module=push"
```

Interpretation of events seen:

| Event | Meaning | Next step |
|---|---|---|
| `push.skipped reason=no_secret` | `SECRET` env var unset in pod | Re-check Vault `<PLUGIN_NAME>-credentials` has `SECRET` populated; rollout restart |
| `push.skipped reason=no_endpoint` | `issuerDomain` JWT claim couldn't be mapped to a Staffbase backend URL | Check `resolveApiBaseUrl()` in `server/src/lib/pushNotifications.ts` covers the customer's domain suffix |
| `push.skipped reason=not_enabled` | Admin's per-instance `pushEnabled` flag is off | Toggle Settings → Notifications → On |
| `push.skipped reason=no_channels` | Both `pushChannelPush` + `pushChannelNotificationCenter` are off (master on) | Toggle at least one channel in the SettingsDialog |
| `push.failure status=4xx` | Staffbase rejected the request | Inspect `body` field in the log entry; confirm Vault `SECRET` matches the value in CuCu for **this** plugin |
| `push.error message=…` | Network exception reaching Staffbase | Check egress + DNS from the pod |
| `push.attempt` followed by `push.success status=201` | Server-side call succeeded | If end-user still sees nothing: they're on desktop browser and `pushChannelNotificationCenter` is off (notify shows in bell/inbox only on mobile + desktop when `notificationCenter` is included) |

Native mobile push only delivers to Staffbase native apps on iOS/Android with active APNs/FCM registrations. Desktop browser users **must** have `pushChannelNotificationCenter=true` to receive bell-icon entries.

### `validate-migrations` CI gate fails on a new migration

**Symptom:** `Quality Gates` job fails with `[validate-migrations] FAIL: 000N_*.sql — table "X" is missing an instance_id column.`

**Cause:** every new table must declare `instance_id text NOT NULL` for tenant isolation, unless it inherits isolation via FK (e.g. a pure join table).

**Fix:** either add `instance_id` to the table OR add the table name to `EXEMPT_TABLES` in [`server/src/scripts/validate-migrations.ts`](../../server/src/scripts/validate-migrations.ts). Document the FK that establishes isolation.

> **Worked example slot:** typical case — a join table (composite PK across two FK columns) is exempt because it inherits isolation through FKs to two parent tables that already carry `instance_id`. Record the actual table name + fix commit here.

---

## Rollback

- **Code regression** — revert the offending commit on `{plugin-name}@main` (or `@dev`). `cd.yml` rebuilds and gitops-patches mops, Flux rolls forward to the previous SHA.
- **Manifest regression** — revert the `mops` PR (or the offending commit on `mops/main`). Flux reconciles to the prior state within ~5 min.
- **Wrong Vault secret** — rewrite the secret + restart the pod:
  ```bash
  kubectl -n {plugin-name} rollout restart deploy/{plugin-name}
  ```
- **Catastrophic** — scale to 0 via the cluster to take the plugin offline while you investigate:
  ```bash
  kubectl -n {plugin-name} scale deploy/{plugin-name} --replicas=0
  ```
  Customer Control will show "plugin unavailable" but no data is lost.

The database is per-plugin (`postgres` Helm release in the namespace), so a rollback of the plugin image does not touch data. **However, a one-way migration (e.g. Drizzle `0000N_*.sql`) is never reverted by rolling back the image** — roll forward with a new migration instead.

> **<Plugin> v1.0.0 example:** Drizzle migrations live in [`server/src/db/migrations/`](../../server/src/db/migrations); validator at [`server/src/scripts/validate-migrations.ts`](../../server/src/scripts/validate-migrations.ts) gates new migrations. Rolling forward = add a new `000N_<name>.sql` + ship via the normal PR → main → stage → tag flow.
