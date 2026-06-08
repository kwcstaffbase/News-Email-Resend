# CC Custom Plugin — P4 `cc-custom-plugin-feature-impl` skill design

**Date:** 2026-05-23
**Author:** Max (`max@staffbase.com`)
**Status:** Draft for review

## Context

P4 is sub-plan 4 of the CC Custom Plugin Platform roadmap ([`../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md`](../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md), §P4). It is the implementation skill — the last station in the customer-request → POC pipeline:

```
customer request
  → P2  cc-custom-plugin-user-stories     → docs/product/user-stories.md
  → P3  cc-custom-plugin-design-handoff   → docs/design/component-map.md
  → P5  cc-custom-plugin-bootstrap (v2)   → scaffolded plugin repo
  → P4  cc-custom-plugin-feature-impl     → working feature code (this spec)
```

P4 consumes the artifacts from P2 + P3, then drives implementation via `superpowers:writing-plans` + `superpowers:subagent-driven-development` + the cavecrew triad (`cavecrew-investigator`, `cavecrew-builder`, `cavecrew-reviewer`). It enforces:

- TDD per `superpowers:test-driven-development` — failing test first, then implementation, then refactor
- Logging contract per [`cc-custom-plugin-template/docs/adrs/0013-logging-contract.md`](../../adrs/0013-logging-contract.md)
- Instance-scoping via `c.var.scopedDb` (see `cc-custom-plugin-template/server/src/middleware/sso.ts`)
- Admin / widget surface split discipline
- GDPR-aware accessor revalidation per [`cc-custom-plugin-template/docs/adrs/0012-strict-gdpr-user-lifecycle.md`](../../adrs/0012-strict-gdpr-user-lifecycle.md)

P4 starts where P5 (bootstrap) ends: the plugin repo exists, infra is deployed, Vault/CuCu are wired, the smoke test passed. P4 implements the feature defined in `docs/product/user-stories.md`, composed from the primitives in `docs/design/component-map.md`, in a fully scaffolded plugin.

Anti-overlap: bootstrap (P5) ships scaffolding/cross-repo PRs/deployment; P4 ships business logic. If P4 detects it needs new infra or new Vault paths or new K8s resources, it halts and points back at P5 — those are not P4's job.

## Skill `SKILL.md` outline

Skill file lives at `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-feature-impl/SKILL.md`.

**Frontmatter:**

```yaml
---
name: cc-custom-plugin-feature-impl
description: Use when implementing a feature in a scaffolded Staffbase cc-custom plugin. Reads docs/product/user-stories.md (from P2) + docs/design/component-map.md (from P3), then drives implementation via superpowers:writing-plans + subagent-driven-development + cavecrew triad. Enforces TDD, ADR-0013 logging contract, c.var.scopedDb instance scoping, admin/widget split, ADR-0012 accessor revalidation. Stops at scaffolding boundaries — does not open cross-repo PRs.
consumes:
  - docs/product/user-stories.md         # from P2 — authoritative scope + acceptance criteria
  - docs/design/component-map.md         # from P3 — authoritative SB Design composition
  - docs/adrs/0013-logging-contract.md   # logging shape enforced
  - docs/adrs/0012-strict-gdpr-user-lifecycle.md  # accessor revalidation pattern
  - docs/adrs/0009-observability-baseline.md      # metrics shape
produces:
  - server/src/routes/<feature>.ts                # admin or widget API route(s)
  - server/src/db/<feature>.ts                    # scoped DB access via c.var.scopedDb
  - client/src/components/admin/<Feature>.tsx     # admin surface (if any)
  - client/src/widget/<Feature>.tsx               # widget surface (if any)
  - server/test/<feature>.test.ts                 # failing test first, per TDD
  - e2e/tests/<feature>.spec.ts                   # Playwright coverage
requires-skills:
  - superpowers:writing-plans               # produces the impl plan before any code
  - superpowers:subagent-driven-development # routes work to cavecrew triad
  - superpowers:test-driven-development     # gates every step on a failing test
  - superpowers:verification-before-completion  # gates "done" claims on evidence
  - cavecrew                                # investigator + builder + reviewer
  - grill-me                                # disambiguation when stories underspecify
---
```

**Sections (in order):**

1. **Use this skill when** — `docs/product/user-stories.md` exists; plugin is scaffolded; user says "implement story `<Sn>`" or "build the `<feature>` feature".
2. **Do NOT use this skill for** — scaffolding (use `cc-custom-plugin-bootstrap`); user-story extraction (use `cc-custom-plugin-user-stories`); design mapping (use `cc-custom-plugin-design-handoff`); cross-repo infra (use bootstrap's wave 1a/1b); mops/Vault/CuCu changes (use bootstrap).
3. **Process** — numbered steps (Step 1 ingest → Step 2 validate inputs → Step 3 plan → Step 4 TDD loop → Step 5 verify → Step 6 hand off).
4. **Input ingestion** — schema expected from P2 + P3 artifacts and what to do if either is missing (§Input ingestion).
5. **Skill composition** — how `writing-plans` + `subagent-driven-development` + cavecrew triad interlock (§Skill composition).
6. **TDD discipline** — explicit failing-test-first contract (§TDD discipline).
7. **Logging contract enforcement** — ADR-0013 shape per emitted log line (§Logging contract enforcement).
8. **Instance-scoping pattern** — every read/write goes through `c.var.scopedDb` (§Instance-scoping pattern).
9. **Admin / widget split discipline** — what code lives where (§Admin/widget split).
10. **GDPR accessor revalidation** — ADR-0012 pattern on every PII touchpoint (§GDPR accessor revalidation).
11. **Reference feature** — concrete acceptance proof feature (§Reference feature).
12. **Common MCP toolset** — table mirroring bootstrap's "Common MCP toolset" pattern.
13. **Stop conditions** — what the skill does and does not do.
14. **Skills this depends on** — list of required skills with rationale.

## Input ingestion

The skill expects two artifacts in the plugin repo (after P2 + P3 have run):

**`docs/product/user-stories.md`** — expected schema (from P2):

```yaml
---
plugin: cc-custom-plugin-<slug>
source_ticket: <url>
source_threads: [...]
owner_team: group:cc-tech
status: draft|reviewed|locked   # P4 refuses to start on `draft` without explicit override
created: <date>
---

# User stories — <slug>

## Story S1 — <title>
**As a** ... **I want** ... **So that** ...
### Acceptance criteria
### Surfaces        # admin | widget | both
### Data fields
### Multi-tenant invariants
### GDPR posture
### Telemetry expectations
### Open questions
```

P4 reads the YAML frontmatter, locates the story by `Sn` (user passes `--story=S1` or skill picks the first `status: reviewed|locked` story). Every `### Subsection` becomes a check the impl plan enforces.

**`docs/design/component-map.md`** — expected schema (from P3):

```yaml
---
plugin: cc-custom-plugin-<slug>
source_artifacts: [...]
input_types: [...]
sb_design_version: <version>
code_connect_used: true|false
status: draft|reviewed|locked
---

# Component map — <slug>

## Screen S1 — <title>
**Source:** ...
**Surface:** admin|widget|both
**Linked story:** docs/product/user-stories.md#S<n>
### Composition  # tree of SB primitives
### Elements mapped  # table
### Gaps  # bespoke / token-mismatch / compound-incomplete / code-connect-missing
```

P4 reads composition trees and elements-mapped tables for the screen(s) tied to the target story (`Linked story` cross-reference). Gaps are surfaced to the impl plan as explicit subtasks ("build bespoke `FilterChipRow`" becomes a planned commit).

**Missing-artifact handling:**

| Missing | Behaviour |
|---|---|
| Only `user-stories.md` missing | **Halt.** Skill points at P2 (`cc-custom-plugin-user-stories`) and stops. P4 refuses to invent stories. Override flag `--no-stories` allowed only for trivial bugfixes (not new features); requires explicit user confirmation. |
| Only `component-map.md` missing | **Halt.** Skill points at P3 (`cc-custom-plugin-design-handoff`) and stops. Override `--no-design` only for backend-only features (no UI surface); skill checks the linked story has `Surfaces: admin-api-only` or similar before allowing. |
| Both missing | **Halt.** Skill points at P2 → P3 sequence and stops. No override. |
| Story `status: draft` | Warn user, ask "proceed against a draft story?" via `grill-me`. Recommended: NO, run P2 to lock first. |
| Story status mismatch with component map | Warn; recommend re-running P3 against latest stories. |
| `component-map.md` references screens not tied to any story | Flag as orphan screens; skill works against story-linked screens only. |

## Skill composition

P4 orchestrates four superpowers skills + the cavecrew triad. Sequence per story:

1. **`superpowers:writing-plans`** — produces `docs/superpowers/plans/<date>-<feature>-plan.md`. Input: ingested artifacts. Output: ordered task list — one task per acceptance criterion + one task per gap + one task per admin/widget surface. Each task includes its expected test, expected log lines, expected metrics.

2. **`superpowers:subagent-driven-development`** — drives execution of the plan. Each task in the plan becomes one subagent invocation:
   - **`cavecrew-investigator`** — used when a task requires "find existing code first" (e.g. "find the canonical pattern for cursor pagination in this plugin"). Output: file paths + 1-line summary per match.
   - **`cavecrew-builder`** — used for 1–2 file edits per task. Input: investigator output + plan task spec. Output: diff + test result.
   - **`cavecrew-reviewer`** — runs after every builder output. Output: caveman-compressed review notes. Main thread acts on notes.

3. **`superpowers:test-driven-development`** — gates every builder invocation: builder MUST produce a failing test commit first, then a passing-test commit, then optional refactor commit. Skill rejects builder output that ships impl without a preceding failing test.

4. **`superpowers:verification-before-completion`** — gates final "done" claim. Skill runs the full verification matrix (Step 5) and refuses to mark the story `implemented` until every check passes.

Composition rationale: `writing-plans` produces the spine; `subagent-driven-development` is the runner; cavecrew is the worker pool; TDD is the per-task contract; verification is the exit gate. Mirrors the structure successfully used by P5 bootstrap's Wave 1a/1b/1c templates.

## TDD discipline

Every implementation task in the plan follows this loop (enforced per `superpowers:test-driven-development`):

1. **Red** — write the failing test. Test must reference the acceptance criterion verbatim (e.g. test name `"S1 AC2 — given three pins, when pinning fourth, then UI blocks with 'Max 3 pinned per channel'"`).
2. **Green** — write the minimum code to pass. No speculative generality, no refactoring during this commit.
3. **Refactor** — separate commit; tests stay green; refactor only the just-touched code.

**Concrete TDD step example** (from the reference feature §Reference feature below):

```
# Step 1 — RED
Commit: test(audio-hub): S1 AC1 — given a tag on an entry, when widget renders, then tag appears
Files:  client/src/widget/AudioHub.test.tsx
        (failing assertion against a tag-rendering element that doesn't exist yet)
Run:    bun run test  → 1 failed (expected)

# Step 2 — GREEN
Commit: feat(audio-hub): render entry tag in widget
Files:  client/src/widget/AudioHub.tsx
        (minimum tag-render JSX; uses Tag primitive from @staffbase/design per component-map S1)
Run:    bun run test  → all passing

# Step 3 — REFACTOR (optional)
Commit: refactor(audio-hub): extract tag-render to AudioHubTag.tsx
Files:  client/src/widget/AudioHub.tsx
        client/src/widget/AudioHubTag.tsx
Run:    bun run test  → all passing
```

Every story acceptance criterion gets at least one RED commit. No exception.

## Logging contract enforcement

Per ADR-0013 ([`cc-custom-plugin-template/docs/adrs/0013-logging-contract.md`](../../adrs/0013-logging-contract.md)), every log line emitted by feature code must conform to:

- Top-level field name `msg` (NOT `_msg` — `_msg` collides with Victoria Logs reserved field and leaks raw JSON; see user memory `reference_otel_collector_msg_field_promotion`).
- Required fields: `level`, `module`, `instance_id` (from `c.var.scopedDb`), `request_id`, `msg`.
- Optional fields: `accessor_id`, `feature`, `latency_ms`, `outcome`.
- Forbidden: PII in the message string; raw stack traces (use `error.cause` field).

P4 enforces this two ways:

1. **Per-commit grep gate** — `cavecrew-reviewer` runs `rg -n '_msg|console\.log|console\.error' server/src client/src` against every builder diff. Any match fails review; builder retries.
2. **Test gate** — server tests assert log shape via the plugin's logging mock (`server/test/helpers/logger-mock.ts` — standard pattern in the template). Every feature-emitting code path gets at least one log-shape assertion.

Worked example:

```typescript
// CORRECT — passes the gate
c.get("logger").info({
  msg: "entry pinned",
  module: "entry",
  instance_id: c.var.instanceId,
  accessor_id: c.var.accessorId,
  feature: "pin",
  outcome: "success",
});

// REJECTED — uses `_msg`, leaks raw JSON in Victoria Logs
c.get("logger").info({
  _msg: "entry pinned",
  ...
});

// REJECTED — bypasses logger, hits stdout directly
console.log("entry pinned");
```

## Instance-scoping pattern

Every DB read and write in server code goes through `c.var.scopedDb` — set by the SSO middleware at `cc-custom-plugin-template/server/src/middleware/sso.ts`. The scopedDb is a wrapper that prefixes every collection with `(instanceId, ...)` so a leaking query returns zero rows from other tenants.

**Enforced patterns:**

- Server route handlers receive `c: Context` from Hono; they NEVER call the raw DB client; they always go through `c.var.scopedDb`.
- Migrations are the only place raw DB access is allowed (they need cross-instance writes).
- Worker scripts (cron / background) accept an explicit `instanceId` parameter, construct a scoped wrapper from it, and never touch the raw client.

**P4's gate:** `cavecrew-reviewer` greps `server/src` for direct DB-client imports outside `server/src/db/migrations/` and `server/src/db/scoped.ts`. Any match fails review.

Worked example:

```typescript
// CORRECT
app.get("/api/entries", async (c) => {
  const entries = await c.var.scopedDb.entries.find({});
  return c.json(entries);
});

// REJECTED — raw client bypasses scoping
import { db } from "../db/client.ts";
app.get("/api/entries", async (c) => {
  const entries = await db.entries.find({});  // leaks across tenants
  return c.json(entries);
});
```

## Admin / widget split

The template enforces a hard split:

- **Admin** code: `client/src/components/admin/**`, server routes under `/api/admin/**`. Authenticated via SSO session + admin role check (`requireAdmin` middleware). Renders inside Experience Studio at `/studio`.
- **Widget** code: `client/src/widget/**` (Shadow DOM root), server routes under `/api/widget/**` or `/api/public/**` depending on auth posture. Renders inside the customer's branch UI via iframe.

**Cross-contamination prevention:**

- No widget file imports from `client/src/components/admin/`.
- No admin file imports from `client/src/widget/`.
- Shared primitives live in `client/src/shared/` (rare; SB Design primitives cover most cases).
- Server route files are split: `server/src/routes/admin/*.ts` and `server/src/routes/widget/*.ts`. No shared route file straddles surfaces.

**P4's gate:** `cavecrew-reviewer` greps for cross-imports. Any match fails review.

When a story spans both surfaces (e.g. admin pins an entry; widget displays the pin), P4's plan splits the work into two separate task pairs — admin-side and widget-side — each with their own RED/GREEN/REFACTOR triple.

## GDPR accessor revalidation

Per ADR-0012 ([`cc-custom-plugin-template/docs/adrs/0012-strict-gdpr-user-lifecycle.md`](../../adrs/0012-strict-gdpr-user-lifecycle.md)), every code path that stores or returns data tied to an `accessor_id` (user_id) must:

1. **Revalidate the accessor on every read** — call the accessor-revalidation helper (`server/src/lib/accessor.ts`) which checks the accessor against the Staffbase backend; if the accessor has been deleted upstream, the helper returns `null` and the caller MUST treat that row as "no longer accessible".
2. **Tombstone on accessor deletion** — when revalidation returns `null` for an existing row, the row's `accessor_id` field is overwritten with `null` and a `tombstoned_at` timestamp is set. The row is preserved for audit but no longer linkable to a person.
3. **Hard-wipe on plugin uninstall** — the uninstall hook (`server/src/routes/lifecycle.ts`) drops every collection scoped to the uninstalling `(instanceId, accessor_id)`.

**P4's gate:** every server route that accepts or returns `accessor_id`-tagged data is reviewed for these three patterns. Missing any one = review fails.

Worked example:

```typescript
// CORRECT — revalidation on read + tombstone path
app.get("/api/admin/pins", async (c) => {
  const pins = await c.var.scopedDb.pins.find({});
  const revalidated = await Promise.all(pins.map(async (p) => {
    const accessor = await c.var.revalidateAccessor(p.pinned_by);
    if (!accessor) {
      await c.var.scopedDb.pins.tombstone(p._id);
      return null;
    }
    return { ...p, pinned_by_name: accessor.displayName };
  }));
  return c.json(revalidated.filter(Boolean));
});

// REJECTED — returns accessor_id-tagged data without revalidation
app.get("/api/admin/pins", async (c) => {
  const pins = await c.var.scopedDb.pins.find({});
  return c.json(pins);  // leaks deleted-user data
});
```

## Reference feature

Per roadmap §P4 acceptance: a small reference feature drives the skill end-to-end on a real plugin. The chosen feature is:

**Add a `tag` field to audio-hub entries**, with admin authoring and widget rendering. Drives all six acceptance dimensions in one feature:

| Acceptance dimension | How the reference feature exercises it |
|---|---|
| TDD | RED commit `test(audio-hub): S1 AC1 — given a tag on an entry, when widget renders, then tag appears`; GREEN commit ships the JSX |
| Logging contract | INFO log `msg: "entry tagged"` with `module: "entry"`, `feature: "tag"`, `outcome: "success"` |
| Instance scoping | Tag write goes through `c.var.scopedDb.entries.update(id, {$set: {tag}})`; no raw client |
| Admin surface | `client/src/components/admin/EntryTagField.tsx` composes `Field.Root` + `Field.Label` + `TextField` per component-map |
| Widget surface | `client/src/widget/EntryTag.tsx` renders `Tag` primitive from `@staffbase/design`; renders only if entry has tag |
| GDPR | Tag itself is not PII (free-text descriptor); but `tagged_by: accessor_id` IS — wired through revalidation per ADR-0012 |
| Metrics | `audio_hub_entry_tagged_total{instance_id}` counter incremented in the route per ADR-0009 |
| Playwright | `e2e/tests/entry-tag.spec.ts` — admin sets tag, widget displays it, mobile viewport doesn't clip it |

Why audio-hub: it is the next plugin scheduled for bootstrap (per user memory `project_cc_custom_plugin_audio_hub`), and per roadmap §P4 acceptance — "when its impl phase starts". P4 runs against audio-hub as its first real exercise.

Fallback: if audio-hub impl phase hasn't started when P4 ships, the skill runs against glossary (`cc-custom-plugin-glossary`) with a synthetic story — "add a `pinned_until` timestamp field to glossary entries" — exercising the same dimensions.

## Stop conditions

P4 does **not**:

- Scaffold the plugin (P5 / `cc-custom-plugin-bootstrap`).
- Open cross-repo PRs to `infrastructure` / `mops` (P5's Wave 1a/1b).
- Write Vault values or register with CuCu (P5).
- Author new ADRs (separate process; P4 flags need + halts).
- Create new `@staffbase/design` primitives (separate repo).
- Re-derive user stories (P2's job — if `user-stories.md` is missing, halt).
- Re-do design mapping (P3's job — if `component-map.md` is missing, halt).

Hand-off after story is implemented:

- Status flip on the story: `status: implemented` in `docs/product/user-stories.md`, with a `### Implementation` subsection appended pointing at the merged PR.
- Tag suggestion: if the story closes a CC-* ticket entirely, suggest `gh issue close` + Jira transition; user confirms.
- If new ADR is needed, point at `cc-custom-plugin-template/docs/adrs/_template.md` and halt.

## Acceptance criteria

1. Skill file present at `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-feature-impl/SKILL.md` with frontmatter, all sections from §Skill `SKILL.md` outline above.
2. Skill refuses to start without `docs/product/user-stories.md` AND `docs/design/component-map.md` (except documented override flags for backend-only or bugfix paths).
3. Skill produces a `docs/superpowers/plans/<date>-<feature>-plan.md` via `superpowers:writing-plans` before any code is written.
4. Every implementation task ships as RED → GREEN → (optional REFACTOR) commit triple per `superpowers:test-driven-development`.
5. Every emitted log line uses `msg` (not `_msg`), conforms to ADR-0013 required fields, asserted by at least one server test.
6. Every server DB access goes through `c.var.scopedDb`; raw DB-client imports outside migrations/wrapper rejected by reviewer.
7. Admin/widget code paths never cross-import; reviewer enforces.
8. Every `accessor_id`-handling route revalidates + tombstones per ADR-0012; reviewer enforces.
9. Reference feature (audio-hub `tag` field, fallback: glossary `pinned_until`) ships end-to-end: passing server + client + Playwright tests, structured logs visible in dev-de1 Victoria Logs, `audio_hub_entry_tagged_total` (or analogous) metric visible in dev-de1 Grafana.
10. Skill produces a verifiable `--story=Sn` invocation contract — passing `--story=S1` against a plugin with a locked story Sn implements exactly that story, no more, no less.
11. Halt-and-point-at behaviour verified: missing user-stories halts, missing component-map halts, draft story warns.

## Open questions

| Open question | Recommended answer |
|---|---|
| **`--story=Sn` arg or auto-pick first reviewed?** | Both. `--story=Sn` explicit override; default = first story with `status: reviewed` or `locked`. |
| **Multi-story per invocation?** | NO. One story per invocation; skill is single-purpose. Multi-story = run skill N times. |
| **Backend-only features (no UI)?** | Allow `--no-design` override iff story has `Surfaces: admin-api-only` or `widget-api-only` declared explicitly. Skill validates the marker before accepting override. |
| **What about pure refactors / no-feature work?** | Out of scope. P4 is feature-driven. Refactors run under `superpowers:simplify` or manual. |
| **Migrations** — allowed in P4? | YES if the story declares them. Migration file lives in `server/src/db/migrations/<date>-<feature>.ts`; gets its own test; reviewed separately from feature code. |
| **Push notifications** — exercised by reference feature? | NO (tag field doesn't justify push). Push exercised by P5 reference plugin via ADR-0011 channels — out of P4 scope. |
| **i18n** — every string keyed? | YES. Skill enforces: no string literals in JSX outside `useAdminI18n` / `useWidgetI18n` hooks; reviewer greps for inline strings in `client/src/**.tsx`. |
| **What happens on test flake during the GREEN step?** | Skill retries once; if still failing, halts and surfaces the flake. Does not loop indefinitely. |
| **Skill drives one feature at a time** — how to handle dependent features (S2 depends on S1)? | Stories declare deps in user-stories.md frontmatter; skill refuses S2 until S1 is `status: implemented`. |
| **Coverage gate?** | Skill does not enforce a coverage threshold; relies on TDD discipline. Coverage thresholds live in `package.json` test config, owned by the plugin. |
| **Subagent fan-out width** — how many cavecrew workers in parallel? | Cap at 3 builders concurrent per plan. Reviewer is serial — every builder output reviewed in order. |

## Files touched

```
cc-custom-plugin-template/
├── .claude/skills/cc-custom-plugin-feature-impl/
│   └── SKILL.md                                     (new)
├── docs/
│   ├── skills/index.md                              (edit — add feature-impl entry)
│   └── superpowers/
│       ├── specs/2026-05-23-P4-feature-impl-skill-design.md   (this file)
│       └── plans/2026-05-23-P4-feature-impl-skill-plan.md     (forthcoming)
└── mkdocs.yml                                       (edit — add nav entry under Skills)
```

Downstream (after template-sync per `cc-custom-plugin-template/docs/guides/template-sync.md`):

```
cc-custom-plugin-glossary/.claude/skills/cc-custom-plugin-feature-impl/SKILL.md
cc-custom-plugin-applaunchpad/.claude/skills/cc-custom-plugin-feature-impl/SKILL.md
cc-custom-plugin-audio-hub/.claude/skills/cc-custom-plugin-feature-impl/SKILL.md   (if implemented by then)
```

Reference feature artifacts (produced by P4's first run against audio-hub):

```
cc-custom-plugin-audio-hub/
├── docs/superpowers/plans/<date>-entry-tag-plan.md          (from writing-plans)
├── server/src/routes/admin/entry-tag.ts                     (new)
├── server/src/routes/widget/entry-tag.ts                    (new — read-only)
├── server/src/db/entry.ts                                   (edit — add tag field)
├── server/test/entry-tag.test.ts                            (new — RED then GREEN)
├── client/src/components/admin/EntryTagField.tsx            (new)
├── client/src/widget/EntryTag.tsx                           (new)
└── e2e/tests/entry-tag.spec.ts                              (new)
```

## Implementation plan pointer

Implementation plan will land at `cc-custom-plugin-template/docs/superpowers/plans/2026-05-23-P4-feature-impl-skill-plan.md` after this spec is approved. The plan covers: SKILL.md authorship (single commit), section-by-section drafting (one commit per major enforcement gate: TDD / logging / scoping / split / GDPR), `mkdocs.yml` nav entry (separate commit), and a smoke-test run driving the reference feature against audio-hub (or glossary fallback) to validate acceptance criteria 3–11.

## References

- Roadmap: [`../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md`](../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md) §P4
- Sibling spec P2: [`./2026-05-23-P2-user-stories-skill-design.md`](./2026-05-23-P2-user-stories-skill-design.md)
- Sibling spec P3: [`./2026-05-23-P3-design-handoff-skill-design.md`](./2026-05-23-P3-design-handoff-skill-design.md)
- Sibling spec P5: [`./2026-05-23-P5-bootstrap-skill-refinement-design.md`](./2026-05-23-P5-bootstrap-skill-refinement-design.md)
- Logging contract: [`cc-custom-plugin-template/docs/adrs/0013-logging-contract.md`](../../adrs/0013-logging-contract.md)
- GDPR accessor revalidation: [`cc-custom-plugin-template/docs/adrs/0012-strict-gdpr-user-lifecycle.md`](../../adrs/0012-strict-gdpr-user-lifecycle.md)
- Observability baseline: [`cc-custom-plugin-template/docs/adrs/0009-observability-baseline.md`](../../adrs/0009-observability-baseline.md)
- Push channels: [`cc-custom-plugin-template/docs/adrs/0011-user-cache-lifecycle.md`](../../adrs/0011-user-cache-lifecycle.md)
- Multi-tenant SSO middleware: `cc-custom-plugin-template/server/src/middleware/sso.ts`
- Canonical SB Design composition: `cc-custom-plugin-template/client/src/components/admin/SettingsDialog.tsx`
- Audio-hub project memory: user memory `project_cc_custom_plugin_audio_hub`
- Cross-repo sync spec (structure reference): `cc-custom-plugin-template/docs/superpowers/specs/2026-05-22-cross-repo-sync-design.md`
- Vendored grill-me: `cc-custom-plugin-template/.claude/skills/grill-me/SKILL.md`
