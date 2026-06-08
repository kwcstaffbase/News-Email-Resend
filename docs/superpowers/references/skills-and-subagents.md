# Superpowers skills + subagent map

Generic decision guide for picking the right `superpowers:*` skill, `caveman:cavecrew-*` subagent, or `general-purpose` agent when executing a plan in any Staffbase cc-custom plugin.

Link this file from any plan doc instead of re-deriving the map.

---

## Skill selection by work shape

| Work shape | First skill | Then | Why this order |
|------------|-------------|------|----------------|
| Bug / unexpected behaviour / test failure | `superpowers:systematic-debugging` | matching implementation skill | Enforces root-cause-before-patch — prevents silently swallowing symptoms. |
| New feature / behaviour change with screenshot or spec | `superpowers:brainstorming` | `superpowers:writing-plans` → `superpowers:subagent-driven-development` | Clarifying Qs → 2–3 approach options → user picks → decomposition → dispatch. |
| Multi-step task with known requirements | `superpowers:writing-plans` | `superpowers:executing-plans` or `subagent-driven-development` | Lock the contract first so subagents have unambiguous briefs. |
| Independent research streams (logs / metrics / catalogue) | `superpowers:dispatching-parallel-agents` | `superpowers:subagent-driven-development` | Streams with disjoint MCP scopes — no result-reconciliation conflicts. |
| Writing or modifying a skill / agent | `superpowers:writing-skills` | — | Enforces skill-file shape + drift-prevention rules. |
| Pre-merge verification before claiming "done" | `superpowers:verification-before-completion` | — | Evidence before assertions — runs actual gates before marking complete. |
| Code-review intake (own or others') | `superpowers:receiving-code-review` | `superpowers:requesting-code-review` (if pushing back) | Technical rigor, not performative agreement. |
| Branch-close (PR ready, integration mode) | `superpowers:finishing-a-development-branch` | — | Structured options for merge / PR / cleanup. |
| Implementing any feature or bugfix from scratch | `superpowers:test-driven-development` | — | Test before implementation; project rule unless `CLAUDE.md` / `AGENTS.md` overrides. |
| Branch-start needing isolation | `superpowers:using-git-worktrees` | — | Isolated workspace before plan execution. |

`brainstorming` and `writing-plans` are **flexible** — adapt to context. `systematic-debugging`, `test-driven-development`, `verification-before-completion` are **rigid** — don't trim the discipline.

---

## Subagent selection

### `caveman:cavecrew-investigator` — read-only locator

Use for: "where is X defined", "what calls Y", "list all uses of Z", "map this directory". Returns caveman-compressed `file:line` tables — main thread reads ~60% fewer tokens than vanilla `Explore`.

Don't use for: code review, design audits, cross-file consistency checks (reads excerpts, not full files).

### `caveman:cavecrew-builder` — 1–2 file surgical edit

Use for: typo fixes, single-function rewrites, mechanical renames, comment removal, format-preserving tweaks. Hard refuses 3+ file scope. Returns caveman diff receipt.

Don't use for: new features, new files (unless asked), cross-file refactors.

### `caveman:cavecrew-reviewer` — diff / branch / file reviewer

Use for: "review this PR", "review my diff", "audit this file". One line per finding, severity-tagged, no praise, no scope creep. Output format: `path:line: <emoji> <severity>: <problem>. <fix>.`

Skips formatting nits unless they change meaning.

### `general-purpose` — MCP-aware research / multi-step

Use for: research questions spanning 3+ MCP / `gh` calls (Grafana metrics audit, Backstage catalog walk, multi-region kubectl in parallel). Also the default when no specialized agent fits.

### `Explore` — quick read-only search

Use for: bounded "where is X" lookups when scope is a single file or single grep and you don't need the caveman-compressed table format.

### `Plan`

Use for: designing an implementation strategy (returns step-by-step plan + critical files + trade-offs). Read-only.

---

## Parallelisation rules

Run subagents in parallel only when:

1. **File sets are disjoint** — no shared `.tsx`, no shared locale-key block, no shared route file.
2. **MCP scopes are disjoint** — two `general-purpose` agents writing to the same Jira project = serialisation hazard.
3. **No data dependency** — agent B's brief doesn't read from agent A's output.

Always run **`caveman:cavecrew-reviewer`** at the END against the combined diff, not against each subagent's slice. The reviewer needs the merged view to catch cross-cutting issues (mismatched i18n keys, inconsistent log event names, divergent error-shape conventions).

---

## Approval gates (must surface to main thread, never subagent-auto-executed)

- 🛑 `vault kv put` — any path
- 🛑 `gh pr merge` on `Staffbase/infrastructure` / `Staffbase/mops` `main`
- 🛑 `kubectl delete` / `rollout restart` on prod
- 🛑 CuCu (Customer-Control) changes in prod
- 🛑 `git tag vX.Y.Z && git push --tags` — irreversible, triggers prod release
- 🛑 `gh release create` / `gh release edit --draft=false` on prod release
- 🛑 Any `mcp__claude_ai_Atlassian__createJiraIssue` write that names a team or project not previously confirmed in this session

Subagents may **propose** these and **surface** the proposed command. The main thread executes after explicit user `yes` (or `AskUserQuestion` confirmation).

---

## MCP toolset (canonical)

| Surface | Tool prefix | Auth |
|---------|-------------|------|
| Grafana per-env | `mcp__grafana-{dev-de1,stage-de1,prod-de1,prod-au1,prod-us1}__*` | `kubectl grafana credentials --grafana-url=<observatory-host>` per env, cached at `~/.kube/cache/kubectl-grafana/` (7-day TTL — re-run when MCP returns 401) |
| Victoria Logs | same Grafana MCPs (`query_logs`) | inherited |
| kobs / observatory dashboards | browser (Staffbase Google SSO) | no MCP yet |
| Backstage | `mcp__claude_ai_Backstage__*` | Staffbase SSO |
| Atlassian (Jira + Confluence) | `mcp__claude_ai_Atlassian__*` | Staffbase SSO |
| Figma (workspace integration) | `mcp__claude_ai_Figma__*` | Staffbase SSO |
| Slack | `mcp__claude_ai_Slack__*` | Staffbase SSO |
| Microsoft 365 | `mcp__claude_ai_Microsoft_365__*` | Staffbase SSO |
| Web search | `WebSearch` | none |
| Context7 docs | `mcp__plugin_context7_context7__*` | none |
| GitHub | `gh` CLI | one-shot per device |

**Pattern**: MCP first (SSO-cached) → `gh` → Staffbase browser → manual. Never invent ad-hoc workflows when a Staffbase-SSO MCP exists.

---

## Cross-references

- Skill definitions: see `superpowers:*` skills listed at session start, or run `skill list` in Claude Code.
- Subagent definitions: `~/.claude/projects/*/agents/` or repo-local `.claude/agents/`.
