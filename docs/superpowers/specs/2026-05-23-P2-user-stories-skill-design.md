# CC Custom Plugin — P2 `cc-custom-plugin-user-stories` skill design

**Date:** 2026-05-23
**Author:** Max (`max@staffbase.com`)
**Status:** Draft for review

## Context

P2 is sub-plan 2 of the CC Custom Plugin Platform roadmap ([`../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md`](../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md), §P2). It sits at the front of the pipeline that drives the roadmap goal — customer request → working POC ≤ 1 engineer-day on dev — via composable Claude skills:

```
customer request
  → P2  cc-custom-plugin-user-stories   (grill-me-driven)  → docs/product/user-stories.md
  → P3  cc-custom-plugin-design-handoff                    → docs/design/component-map.md
  → P5  cc-custom-plugin-bootstrap (v2)                    → scaffolded plugin repo
  → P4  cc-custom-plugin-feature-impl                      → working feature code
```

Today, the front-of-pipeline work (translating a Jira/Slack/Gmail/email/voice-note customer ask into INVEST-shaped stories an engineer can implement against) is done ad-hoc in engineer heads, occasionally in Notion. There is no canonical artifact, no enforced multi-tenant / GDPR / telemetry checklist, no MCP-driven context aggregation. P2 closes that gap.

P2 reuses the **vendored `grill-me` skill** at `cc-custom-plugin-template/.claude/skills/grill-me/SKILL.md` (commit `d285ee3`, MIT, from `mattpocock/skills`, vendored 2026-05-23 on branch `chore/vendor-grill-me`). It does not inline grill-me; it invokes it via the Skill tool by name.

P2 deliberately stops where P5 (`cc-custom-plugin-bootstrap`) begins — it produces a doc, never code or scaffolding.

## Skill `SKILL.md` outline

The skill file lives at `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-user-stories/SKILL.md` and mandates the following shape (concrete content drafted in P2's implementation plan):

**Frontmatter:**

```yaml
---
name: cc-custom-plugin-user-stories
description: Use when translating a customer request (Jira / Slack / Gmail / email / voice-note transcript) into INVEST-shaped user stories for a Staffbase cc-custom plugin. Aggregates context via Atlassian + Slack + Gmail + Drive MCPs, then drives a grill-me interview to lock acceptance criteria, surfaces, data shape, multi-tenant invariants, GDPR posture, and telemetry. Writes docs/product/user-stories.md. Stops before scaffolding.
---
```

**Sections (in order):**

1. **Use this skill when** — Jira link/ticket-id pasted; Slack thread URL; Gmail thread; raw email/voice-note transcript; user says "turn this into user stories for `<plugin>`".
2. **Do NOT use this skill for** — scaffolding (use `cc-custom-plugin-bootstrap`); design/component mapping (use `cc-custom-plugin-design-handoff`); feature implementation (use `cc-custom-plugin-feature-impl`); maintenance of existing plugin (use that plugin's `AGENTS.md`).
3. **Process** — numbered steps (Step 1 confirm target slug + sources → Step 2 ingest context via MCPs → Step 3 invoke grill-me → Step 4 emit artifact → Step 5 hand off). Mirrors the bootstrap skill's numbered structure.
4. **Common MCP toolset** — table styled exactly like `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-bootstrap/SKILL.md` "Common MCP toolset" section (see §Customer-input handling below).
5. **grill-me invocation** — the literal prompt the skill passes (see §grill-me invocation).
6. **Output artifact** — schema reference + link to the example below.
7. **Stop conditions** — what the skill does and does not do.
8. **Skills this depends on** — `grill-me` (vendored), `superpowers:brainstorming` (escalation when scope is unclear after grill-me).

## Output artifact — `docs/product/user-stories.md`

```markdown
---
plugin: cc-custom-plugin-<slug>
source_ticket: https://staffbase.atlassian.net/browse/CC-1234
source_threads:
  - https://staffbase.slack.com/archives/C0XYZ/p17...
  - gmail:thread-id-abc123
customer_org: <Acme Corp>
owner_team: group:cc-tech
status: draft  # draft | reviewed | locked
created: 2026-05-23
---

# User stories — <plugin slug>

## Summary

<2–4 sentence customer problem in plain language.>

## Story S1 — <short title>

**As a** <persona — channel admin / end user / mobile reader>
**I want** <capability>
**So that** <outcome>

### Acceptance criteria

- **Given** <state> **When** <action> **Then** <observable outcome>
- ...

### Surfaces

admin | widget | both

### Data fields

- `<field>` — <type, source, validation, retention>

### Multi-tenant invariants

- Instance-scoped via `c.var.scopedDb`: YES/NO
- Cross-instance read forbidden: YES/NO

### GDPR posture

- PII fields: <list or "none">
- Retention: <ttl or "tied to plugin uninstall">
- Right-to-erasure path: <accessor-revalidation pattern per ADR-0012, or "N/A">

### Telemetry expectations

- Metrics: <e.g. `<plugin>_<verb>_total` per ADR-0009>
- Logs: <events emitted per ADR-0013 logging contract>
- Push: <ADR-0011 channel + payload contract, or "N/A">

### Open questions

- <question> — recommended answer: <answer>

## Story S2 — ...
```

**Example story** (illustrative, will live in the SKILL.md):

```markdown
## Story S1 — Pin a glossary entry to the channel header

**As a** channel admin
**I want** to mark up to three glossary entries as "pinned" for my channel
**So that** new joiners see the critical vocabulary first

### Acceptance criteria

- **Given** I am a channel admin **When** I open the glossary admin and click "Pin" on an entry **Then** the entry shows above the alphabetical list in the widget for users in that channel only.
- **Given** I have three entries already pinned **When** I try to pin a fourth **Then** the UI blocks the action with copy "Max 3 pinned per channel".

### Surfaces

both

### Data fields

- `pinned_until` (timestamp, nullable, server-set, no PII)
- `pinned_by` (user_id, set server-side from SSO session, PII — see GDPR)

### Multi-tenant invariants

- Instance-scoped via `c.var.scopedDb`: YES
- Cross-instance read forbidden: YES (pin set per `(instanceId, channelId)`)

### GDPR posture

- PII fields: `pinned_by` (user_id only, no name/email)
- Retention: cleared on plugin uninstall (ADR-0012 accessor revalidation)
- Right-to-erasure: standard plugin-data wipe

### Telemetry expectations

- Metrics: `glossary_entry_pinned_total{instance_id}`
- Logs: INFO `module:entry msg:"entry pinned"` per ADR-0013
- Push: none

### Open questions

- Should "pin" be visible in the mobile widget or admin only? Recommended: visible in widget, edit-only in admin.
```

## Customer-input handling

The skill normalises every input type into a unified context bundle before invoking grill-me. Multiple sources merge; the skill deduplicates by URL and timestamp.

| Input type | MCP / tool | Behaviour |
|---|---|---|
| **Jira ticket URL or `CC-1234` id** | `mcp__claude_ai_Atlassian__getJiraIssue` then follow linked Confluence pages via `mcp__claude_ai_Atlassian__getConfluencePage` for any remote links | Pull summary, description, comments, attachments list, linked tickets via `mcp__claude_ai_Atlassian__getJiraIssueRemoteIssueLinks`. |
| **Slack thread URL** | `mcp__claude_ai_Slack__slack_search_public` (or `_public_and_private`) to resolve the thread, then `mcp__claude_ai_Slack__slack_read_thread` | Capture full thread; flag any pasted Jira/Gmail/Drive links for chained fetch. |
| **Gmail thread URL / subject** | `mcp__claude_ai_Gmail__search_threads` + `mcp__claude_ai_Gmail__get_thread` | Capture full thread; redact obvious PII (email signatures) before passing to grill-me. |
| **Email body / voice-note transcript / plain text** | No MCP — parse inline | Treat as the sole context; flag that no system-of-record link was provided. |
| **Google Doc / Drive link** | `mcp__claude_ai_Google_Drive__read_file_content` | Pull doc body; cross-link to ticket if URL present in doc. |
| **Multi-source** (e.g. Jira ticket + Slack thread linked from ticket comment) | All of the above, in order: Jira first (canonical) → linked Confluence → linked Slack → linked Gmail | Deduplicate by URL; emit a single merged context. |

The skill **must** record every source it ingested in the output artifact frontmatter (`source_ticket`, `source_threads`) so downstream skills (P3, P5, P4) can re-fetch if needed.

## grill-me invocation

After context ingestion, the skill calls the Skill tool with name `grill-me` and passes this opening prompt:

> Context bundle (Jira + Slack + Gmail + Drive merged above). Target plugin slug: `cc-custom-plugin-<slug>`. Reference plugin: `cc-custom-plugin-glossary` (canonical) and `cc-custom-plugin-applaunchpad`. Walk the user through the following branches one question at a time, recommend an answer per question grounded in template defaults, and explore the codebase at `cc-custom-plugin-template/` before asking any question that the code already answers.
>
> Branches (cover all, in order):
>
> 1. **Stakeholders** — who is the requesting customer, who is the persona using the feature, who is the owner team. Recommended owner: `group:cc-tech` if unset.
> 2. **Surfaces** — admin only / widget only / both. Recommended: both (matches glossary + applaunchpad canonical shape).
> 3. **Data shape** — fields, types, validation, source-of-truth. Recommended: derive from Jira description; flag anything that needs schema migration.
> 4. **Multi-tenant invariants** — instance-scoped storage via `c.var.scopedDb`. Recommended: YES, per template default (`cc-custom-plugin-template/server/src/middleware/sso.ts` sets `c.var.scopedDb` on every authenticated request).
> 5. **GDPR posture** — PII fields, retention, right-to-erasure path. Recommended: accessor-revalidation per ADR-0012 (`cc-custom-plugin-template/docs/adrs/0012-...md`).
> 6. **Telemetry expectations** — metrics, logs, push. Recommended: ADR-0009 metrics shape, ADR-0013 logging contract, ADR-0011 push channels.
> 7. **Customer-facing copy** — string keys, i18n requirements. Recommended: en-US first, add locales the customer's org actually uses (pull from Backstage if available).
> 8. **Scope-cut** — what is P1 (must ship), what is P2 (next), what is explicitly out. Recommended: cut anything that needs net-new infra (new Vault path, new K8s resource) to P2.
> 9. **Success metrics** — how do we know it worked. Recommended: 1 quantitative (telemetry counter) + 1 qualitative (customer confirms in Slack thread).
>
> Stop the interview when every branch has a locked answer or an explicit "deferred to story open-question" tag. Produce the user-stories.md artifact at the end.

Sample question + recommendation pairs the skill seeds into grill-me (illustrative):

- *Q:* "Should this feature be instance-scoped? *Recommended: YES, per template default — `c.var.scopedDb` is set on every authenticated request in `cc-custom-plugin-template/server/src/middleware/sso.ts`. Any read or write that bypasses this leaks across tenants."*
- *Q:* "Do we need a push notification on this event? *Recommended: NO unless the customer's ticket explicitly mentions notification — ADR-0011 push channels add operational surface area."*
- *Q:* "Is `<field>` PII? *Recommended: <field-specific> — if YES, route through accessor-revalidation per ADR-0012 so plugin uninstall wipes it."*

## Stop conditions

P2 does **not**:

- Scaffold a plugin repo (P5 / `cc-custom-plugin-bootstrap` does that).
- Write any code (P4 / `cc-custom-plugin-feature-impl` does that).
- Produce designs, component maps, Figma references (P3 / `cc-custom-plugin-design-handoff` does that).
- Make architectural decisions beyond what individual stories require. Anything that requires a new ADR is logged as an open question on the relevant story.

Hand-off: when the artifact is locked (status `reviewed` or `locked`), point the user at P3 (`cc-custom-plugin-design-handoff`) for design + component-map, or directly at P5 (`cc-custom-plugin-bootstrap`) if the plugin doesn't exist yet.

## Acceptance criteria

1. Skill file present at `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-user-stories/SKILL.md` with frontmatter, all sections from §Skill `SKILL.md` outline above, and grill-me invocation via the Skill tool by name (not inlined).
2. Running the skill against a real Jira ticket (e.g. an existing `CC-*` ticket on `staffbase.atlassian.net`) produces a `docs/product/user-stories.md` artifact whose frontmatter records every ingested source (Jira ticket, any linked Slack/Gmail/Drive) and whose stories cover all 9 grill-me branches (stakeholders → success metrics) — either with a locked answer or an explicit open-question tag.
3. The skill exercises at least one MCP surface per input type it was given (e.g. Jira input ⇒ `getJiraIssue` was actually called; Slack input ⇒ `slack_read_thread` was called). Verifiable via session transcript.
4. grill-me's one-question-at-a-time discipline is preserved — the artifact's open questions list each cite the branch (stakeholders/surfaces/data/...) they came from, with a recommended answer alongside.
5. The skill does **not** create files outside `docs/product/`. No scaffolding, no code, no ADRs.

## Open questions

| Open question | Recommended answer |
|---|---|
| **Story numbering** — `S1, S2, ...` per artifact, or globally per plugin across artifacts? | Per artifact (`S1..Sn` resets per file). Cross-artifact references use `{filename}#S1`. |
| **Location when plugin repo doesn't exist yet** (customer request precedes scaffolding) | Write to `cc-custom-plugin-template/docs/product/user-stories.<slug>.md` as a staging area; P5 bootstrap moves it into the new plugin's `docs/product/user-stories.md` as the first commit. |
| **Multi-customer-request bundling** (one ticket asks for three features) | One story per feature, all in the same artifact; `source_ticket` is a list. Frontmatter `source_ticket:` accepts string or list. |
| **Voice-note transcript ingestion** — Otter/Gemini exports, or only raw text? | Raw text in v1; Otter/Gemini integration deferred to a follow-up. |
| **Story locking workflow** — who flips `status: draft → reviewed → locked`? | Engineer flips to `reviewed` after grill-me converges; product owner flips to `locked` via a separate review pass (mirrors PR-review workflow). |
| **i18n surface** in stories — locale list lives where? | In the relevant story's "Customer-facing copy" subsection; canonical locale list lives in the plugin's `plugin.json`. |

## Implementation plan pointer

Implementation plan will land at `cc-custom-plugin-template/docs/superpowers/plans/2026-05-23-P2-user-stories-skill-plan.md` after this spec is approved. The plan will cover: SKILL.md authorship (single commit), example story drafting (separate commit), `mkdocs.yml` nav entry under "Skills" (separate commit), and a smoke-test run against one real Jira ticket to validate acceptance criteria 2–4.

## References

- Roadmap: [`../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md`](../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md) §P2
- Vendored grill-me: `cc-custom-plugin-template/.claude/skills/grill-me/SKILL.md` (commit `d285ee3`, branch `chore/vendor-grill-me`)
- Bootstrap skill reference: `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-bootstrap/SKILL.md`
- Cross-repo sync spec (structure reference): `cc-custom-plugin-template/docs/superpowers/specs/2026-05-22-cross-repo-sync-design.md`
- Canonical reference plugin: `cc-custom-plugin-glossary` (v1.0.0+)
- Multi-tenant pattern: `cc-custom-plugin-template/server/src/middleware/sso.ts` (`c.set("scopedDb", ...)`)
- Logging contract: `cc-custom-plugin-template/docs/adrs/0013-...md`
- Observability metrics: `cc-custom-plugin-template/docs/adrs/0009-...md`
- GDPR accessor revalidation: `cc-custom-plugin-template/docs/adrs/0012-...md`
