# CC Custom Plugin — P3 `cc-custom-plugin-design-handoff` skill design

**Date:** 2026-05-23
**Author:** Max (`max@staffbase.com`)
**Status:** Draft for review

## Context

P3 is sub-plan 3 of the CC Custom Plugin Platform roadmap ([`../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md`](../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md), §P3). It sits between P2 (user-stories) and P5 (bootstrap) in the customer-request → POC pipeline:

```
customer request
  → P2  cc-custom-plugin-user-stories     (grill-me-driven) → docs/product/user-stories.md
  → P3  cc-custom-plugin-design-handoff   (multi-input)     → docs/design/component-map.md
  → P5  cc-custom-plugin-bootstrap (v2)                     → scaffolded plugin repo
  → P4  cc-custom-plugin-feature-impl                       → working feature code
```

P3 translates a design artifact — in any of six recognised formats — into an explicit mapping from each UI element to an existing `@staffbase/design` primitive. Today, engineers eyeball Figma frames and reinvent components that already exist in the design system, then drift away from canonical composition. P3 collapses that gap: input goes in (Figma URL, gdoc, Word, PDF, Confluence page, Miro board), a component-map artifact comes out, gaps are flagged with rationale, and the implementer (P4) has zero excuses to invent primitives.

The canonical composition reference is [`cc-custom-plugin-template/client/src/components/admin/SettingsDialog.tsx`](../../../client/src/components/admin/SettingsDialog.tsx) — it composes `Dialog`, `Field`, `TextField`, `IconGhostButton`, `Button`, `AlertDialog`, `ViewIcon`/`ViewAltIcon`/`AlertIcon` from `@staffbase/design` with Tailwind utility classes for spacing. Anything P3 maps must look like that file's shape when implemented.

P3 deliberately stops at the artifact. It does not generate JSX, scaffold components, or write tests — those are P4's job.

## Skill `SKILL.md` outline

Skill file lives at `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-design-handoff/SKILL.md`.

**Frontmatter:**

```yaml
---
name: cc-custom-plugin-design-handoff
description: Use when translating a design artifact (Figma / Google Docs / Word / PDF / Confluence / Miro) into a `@staffbase/design` component map for a Staffbase cc-custom plugin. Auto-detects input type, dispatches to the right MCP, enumerates SB Design primitives, maps each UI element to a primitive (or flags a gap with rationale). Writes docs/design/component-map.md per screen. Stops before implementation.
consumes:
  - docs/product/user-stories.md         # optional — produced by P2; informs surfaces + scope
produces:
  - docs/design/component-map.md         # one file per plugin; multi-screen sections within
hands-off-to:
  - cc-custom-plugin-bootstrap           # if plugin doesn't exist yet
  - cc-custom-plugin-feature-impl        # if plugin already scaffolded
requires-skills:
  - grill-me                             # disambiguating ambiguous design elements
  - superpowers:brainstorming            # escalation when no SB primitive fits
---
```

**Sections (in order):**

1. **Use this skill when** — Figma URL pasted; gdoc/Drive link; uploaded PDF or Word doc; Confluence page URL; Miro board URL; user says "map this design to SB components for `<plugin>`".
2. **Do NOT use this skill for** — user-story extraction (P2); scaffolding (P5); feature implementation (P4); designing from scratch (use Figma skills directly).
3. **Process** — Step 1 input detection → Step 2 ingest via right MCP → Step 3 enumerate SB Design primitives → Step 4 element-to-primitive match → Step 5 gap-flag → Step 6 emit artifact → Step 7 hand off.
4. **Input-type handling** — table (§Input-type handling below).
5. **SB Design Library matching algorithm** — explicit ranked-match procedure (§Matching algorithm below).
6. **Output artifact** — schema + example (§Output artifact below).
7. **Gap-flagging format** — explicit shape for `bespoke:` entries (§Gap-flagging format).
8. **Common MCP toolset** — table mirroring the bootstrap skill's "Common MCP toolset" pattern.
9. **Configurability** — explicit override block (§Configurability).
10. **Stop conditions** — what the skill does and does not do.
11. **Skills this depends on** — `grill-me` (for ambiguous elements), `superpowers:brainstorming` (when no primitive fits and a custom component proposal is needed).

## Input-type handling

The skill auto-detects input type from the URL/file form, then dispatches to the right MCP. Detection rules and MCP call sequence per type:

| Input type | Auto-detection rule | MCP tool calls (in order) | Output normalisation |
|---|---|---|---|
| **Figma** | URL matches `figma.com/(design|file|board)/...` or user pastes a `node-id` | 1. `mcp__claude_ai_Figma__get_metadata` — overall file structure, top-level frames. 2. `mcp__claude_ai_Figma__get_design_context` per frame — full design hierarchy + style tokens. 3. `mcp__claude_ai_Figma__get_screenshot` per frame — visual fallback for ambiguous layouts. 4. `mcp__claude_ai_Figma__get_variable_defs` — design tokens. 5. `mcp__claude_ai_Figma__get_code_connect_map` — if `@staffbase/design` publishes Code Connect mappings, this gives Figma-node → SB-component IDs directly. | Normalised element tree: `{frame, elements[]}` per screen. Each element has `type` (button/input/dialog/list/...), `text`, `style-tokens`, `bbox`, `code-connect-id` (if matched). |
| **Google Docs** | URL matches `docs.google.com/document/d/...` or `drive.google.com/file/d/.../view` with `application/vnd.google-apps.document` | 1. `mcp__claude_ai_Google_Drive__get_file_metadata` — confirm doc type. 2. `mcp__claude_ai_Google_Drive__read_file_content` — pull doc body as text + embedded images list. 3. For each embedded image: `mcp__claude_ai_Google_Drive__download_file_content` to local tmp, then read via Read tool for visual context. | Parsed sections: headings → screen boundaries; bullet/numbered lists → elements; embedded screenshots → visual context. |
| **Word (.docx)** | URL is a Drive link with `application/vnd.openxmlformats-officedocument.wordprocessingml.document` or user uploads a `.docx` | 1. `mcp__claude_ai_Google_Drive__download_file_content` with `mimeType: text/plain` — Drive auto-converts. 2. Fallback for unrecognised tables: download as HTML (`mimeType: text/html`) and parse with Read. | Same normalised element tree as gdoc. |
| **PDF** | URL ends `.pdf` or MIME `application/pdf` or user attaches a PDF path | 1. `mcp__claude_ai_Google_Drive__download_file_content` if Drive-hosted; else assume local path. 2. Read tool with `pages: "1-N"` — splits by page, returns text + visual. Use `pages` ranges aggressively to stay under the 20-page-per-call ceiling. | Page-grouped element tree. Each page treated as one screen unless explicit screen-break markers ("Screen 1:", "## Admin view") appear. |
| **Confluence** | URL matches `*.atlassian.net/wiki/spaces/.../pages/...` | 1. `mcp__claude_ai_Atlassian__getConfluencePage` with the page id from the URL — returns body + attachments. 2. For each attachment image: `mcp__claude_ai_Atlassian__fetch` with the attachment URL → read locally. 3. If page links out to Figma: chain to Figma flow. | Heading-tree normalised the same way as gdoc; tables/macros preserved as semantic elements (table → SB `Table`). |
| **Miro** | URL matches `miro.com/app/board/...` and the Miro MCP is authenticated | 1. `mcp__claude_ai_Miro__*` — board read API (specific tool name depends on authenticated MCP surface; the skill prompts for auth if unauthenticated). 2. Visual fallback: screenshot the board via the user's browser if Miro MCP read is unavailable for the target board. | Sticky-note clusters and frames normalised to screens; arrows preserved as flow hints (not screen elements). |

**Multi-input** — if the user pastes a Confluence URL that embeds a Figma node, the skill follows the chain: Confluence first (canonical context), Figma second (authoritative pixel-level truth). Frontmatter records all sources.

**Detection ambiguity** — if the URL or file gives no decisive signal (e.g. a Drive link with no MIME hint), the skill invokes `grill-me` with a single question: "Detected ambiguous input — is this `<gdoc|word|pdf|other>`? Recommended: `<best guess from URL pattern>`."

## SB Design Library matching algorithm

The skill enumerates `@staffbase/design` primitives, then ranks each detected UI element against the primitive catalog. Algorithm:

1. **Enumerate the design system catalog.**
   - Primary source: `@staffbase/design` exports. The skill reads `node_modules/@staffbase/design/dist/index.d.ts` (or `client/node_modules/...` if running from the plugin client root) and extracts every exported React component name + its prop shape via the TypeScript AST.
   - Secondary source: the canonical reference file [`cc-custom-plugin-template/client/src/components/admin/SettingsDialog.tsx`](../../../client/src/components/admin/SettingsDialog.tsx) — every primitive used there is, by definition, a known-good composition. Skill loads it as a "preferred composition" prior.
   - Tertiary source: Code Connect map from Figma (`mcp__claude_ai_Figma__get_code_connect_map`). If a Figma node has a published mapping to an SB component, that mapping is authoritative and bypasses ranking.

2. **Build the primitive catalog index.** For each exported primitive, capture: `name`, `compound-children` (e.g. `Dialog.Root`, `Dialog.Popup`, `Dialog.Header`, `Dialog.Title`, `Dialog.Body`, `Dialog.Footer`), `prop-shape` (TypeScript signature), `semantic-category` (input/container/feedback/navigation/data-display/icon/typography), `evidence-of-canonical-usage` (presence in SettingsDialog.tsx or any other `client/src/components/admin/*.tsx`).

3. **For each detected design element, rank candidates.** Score = sum of:
   - `+10` if Code Connect maps this element directly (Figma path only)
   - `+5` if element semantic category matches primitive category
   - `+3` if element text/label matches a known SB primitive use-case (e.g. "Save" button → `Button variant="primary"`; "Cancel" → `Button variant="secondary"`; "Delete account" → `Button variant="critical"`)
   - `+3` if the primitive appears in the canonical SettingsDialog.tsx for an analogous element
   - `+2` if element has compound children that match the primitive's compound API (e.g. a modal with header + body + footer → `Dialog.Root` + `Dialog.Popup` + `Dialog.Header` + ... beats a flat `Modal` primitive)
   - `-5` if the primitive's prop-shape requires data the design doesn't provide

4. **Threshold.** Highest score wins if it scores ≥10. If top score <10, the element is flagged as a gap. If two primitives tie ≥10, the skill emits both as alternatives and asks via `grill-me`: "Two SB primitives match this element: `<A>` vs `<B>`. Recommended: `<A>` because `<canonical-usage-rationale>`."

5. **Composition over substitution.** Compound primitives (`Dialog.*`, `AlertDialog.*`, `Field.*`) are always emitted with their full compound shape — the artifact lists every sub-component, not just the root. Mirrors SettingsDialog.tsx lines 152–264.

6. **Token surfacing.** When a design specifies colors/spacing/typography that don't match SB design tokens (`text-body-sm`, `text-neutral-medium`, `text-danger-strong`, `divide-neutral-weak`, etc. — see SettingsDialog.tsx lines 192, 200, 220), the skill flags the deviation as a gap with sub-type `token-mismatch`.

## Output artifact — `docs/design/component-map.md`

```markdown
---
plugin: cc-custom-plugin-<slug>
source_artifacts:
  - https://www.figma.com/design/abc123/Admin?node-id=12-345
  - https://docs.google.com/document/d/xyz789/edit
  - confluence:CC/Admin+spec
  - pdf:./docs/design/inputs/spec.pdf#pages=1-4
input_types: [figma, gdoc, pdf, confluence]
sb_design_version: "<resolved @staffbase/design version from package.json>"
code_connect_used: true
status: draft  # draft | reviewed | locked
created: 2026-05-23
---

# Component map — <plugin slug>

## Summary

<2–4 sentence overview: how many screens, how many gaps, headline composition decisions.>

## Screen S1 — <admin settings dialog>

**Source:** figma:node-id=12-345 / gdoc-section "Admin settings"
**Surface:** admin
**Linked story:** docs/product/user-stories.md#S2 (if user-stories.md present)

### Composition

\`\`\`
Dialog.Root (open, onOpenChange)
└─ Dialog.Popup (className: w-[min(92vw,720px)]!)
   ├─ Dialog.Header
   │  └─ Dialog.Title — text: "Settings"
   ├─ Dialog.Body (className: p-0!)
   │  ├─ Field.Root (invalid: tokenError)
   │  │  ├─ Field.Label — text: "API token"
   │  │  ├─ Field.Description — text: <state-dependent>
   │  │  └─ TextField (type: password|text)
   │  │     + IconGhostButton (icon: ViewIcon | ViewAltIcon, aria-label: reveal/hide)
   │  └─ Section: "Activity log" + "Danger zone"
   │     ├─ Button variant="secondary" — text: "View"
   │     ├─ Button variant="secondary" — text: "Export"
   │     └─ Button variant="critical" — text: "Clear all"
   └─ Dialog.Footer
      ├─ Button variant="secondary" — text: "Close"
      └─ Button variant="primary" — text: "Save" / "Saving..."

AlertDialog.Root (confirm clear) — composed as sibling
└─ AlertDialog.Popup
   ├─ AlertDialog.Icon — AlertIcon
   ├─ AlertDialog.Title
   ├─ AlertDialog.Description
   ├─ AlertDialog.Action variant="critical"
   └─ AlertDialog.Cancel
\`\`\`

### Elements mapped

| Element (in design) | SB primitive | Variant / props | Score | Rationale |
|---|---|---|---|---|
| Modal frame | `Dialog.Root` + `Dialog.Popup` | open, onOpenChange | 18 | Compound match + canonical in SettingsDialog.tsx |
| "Settings" heading | `Dialog.Title` | — | 12 | Inside Dialog.Header per compound API |
| API token input | `Field.Root` + `Field.Label` + `Field.Description` + `TextField` | `type` toggles password/text | 16 | Canonical input pattern; matches SettingsDialog.tsx |
| Reveal/hide icon | `IconGhostButton` | icon: `ViewIcon` / `ViewAltIcon` | 14 | Direct canonical match |
| Primary action | `Button` | variant="primary" | 11 | Semantic category + text match |
| Destructive action | `Button` | variant="critical" | 13 | Text "Delete/Clear" + canonical danger-zone pattern |
| Confirm dialog | `AlertDialog.Root` family | — | 18 | Compound match + canonical |

### Gaps

(none for this screen)

## Screen S2 — <widget content view>

...
```

## Gap-flagging format

When the matching algorithm finds no primitive scoring ≥10, the element becomes a gap entry under the screen's `### Gaps` heading:

```markdown
### Gaps

#### G1 — Inline collapsible filter chip row

- **Design element:** horizontal row of pill-shaped filters, each with a remove "x", that wraps to multi-line on overflow
- **Closest SB primitives evaluated:**
  - `Chip` (score 7 — has remove handler but no compound wrap-on-overflow)
  - `SegmentedControl` (score 4 — wrong semantic; not removable)
  - `Tag` (score 5 — no remove)
- **Why no match:** SB Design doesn't ship a `ChipGroup` / `FilterBar` compound. Closest is `Chip` but each chip is independent — the wrapping + group semantics are bespoke.
- **Proposed bespoke component:** `<FilterChipRow chips={...} onRemove={...} />` — composes `Chip` underneath, adds Tailwind `flex flex-wrap gap-8` shell. Single file, ~40 LOC.
- **Recommended action:** build bespoke in `client/src/components/admin/FilterChipRow.tsx` for v1; file a `@staffbase/design` issue for `ChipGroup` primitive for v2.
- **Token mismatches:** none.
```

Sub-types:

- `bespoke` — no primitive maps; component must be authored
- `token-mismatch` — primitive maps but design specifies non-canonical colors/spacing/typography
- `compound-incomplete` — design needs a compound that the primitive offers partially (e.g. design uses `Dialog` without footer, but `Dialog.Popup` lacks a `noFooter` prop — purely a doc gap, not a code gap)
- `code-connect-missing` — Figma node lacks a Code Connect mapping; flag for the design repo backlog

## Configurability

The skill accepts an inline override block at invocation time. Auto-detection runs first; override wins where set:

```yaml
# Optional override block
input-type: gdoc                 # one of: figma | gdoc | word | pdf | confluence | miro | auto
source-url: https://docs.google.com/document/d/xyz/edit
screen-breaks:                   # explicit screen split for inputs lacking structure
  - "Admin overview"
  - "Widget reader view"
skip-code-connect: false         # set true if Code Connect map is stale
strict-mode: false               # set true to fail-hard on any unmatched element (no gaps allowed)
sb-design-source: "node_modules/@staffbase/design"  # override catalog path if running outside a plugin
```

Defaults:

- `input-type: auto`
- `source-url` required (positional)
- `screen-breaks` derived from headings / Figma frames / PDF pages
- `skip-code-connect: false`
- `strict-mode: false` — gaps are normal output, not failures
- `sb-design-source` resolved from nearest `package.json` containing `@staffbase/design`

Override invocation example:

```
/cc-custom-plugin-design-handoff input-type=pdf source-url=./inputs/spec.pdf screen-breaks=["Admin","Widget"]
```

## Stop conditions

P3 does **not**:

- Generate JSX or component files (P4 / `cc-custom-plugin-feature-impl` does that).
- Scaffold a plugin repo (P5 / `cc-custom-plugin-bootstrap` does that).
- Edit Figma files (use Figma skills directly for that).
- Author new `@staffbase/design` primitives (separate spec in the `design` repo).
- Re-derive user stories from the design (P2's job — if `docs/product/user-stories.md` is missing, the skill flags it and proceeds best-effort, but does not invent stories).

Hand-off:

- If `docs/product/user-stories.md` is absent → suggest running P2 first; proceed only if user confirms.
- If the plugin doesn't exist yet → emit artifact to `cc-custom-plugin-template/docs/design/component-map.<slug>.md` (staging area, mirroring P2's pattern) and point at P5.
- If the plugin exists → emit to `cc-custom-plugin-<slug>/docs/design/component-map.md` and point at P4.

## Acceptance criteria

1. Skill file present at `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-design-handoff/SKILL.md` with frontmatter, all sections from §Skill `SKILL.md` outline above.
2. Skill produces a `docs/design/component-map.md` artifact for at least three real input types — Figma + Google Doc + one of {Word, PDF, Confluence, Miro}.
3. For each artifact: frontmatter records every ingested source; every screen has a composition tree; every element has a primitive match or a numbered gap entry; gaps have rationale + proposed action.
4. Matching algorithm exercises the SettingsDialog.tsx canonical prior — verifiable by inspecting an artifact's rationale column for "canonical in SettingsDialog.tsx" citations.
5. Code Connect path used when available — verifiable by `code_connect_used: true` in frontmatter and elements scoring 18+ in the rationale column.
6. Configurability honoured — invoking with `input-type=pdf source-url=...` overrides auto-detection.
7. Skill does not create files outside `docs/design/`. No JSX, no `client/src/components/`, no ADRs.

## Open questions

| Open question | Recommended answer |
|---|---|
| **Catalog enumeration source-of-truth** — `@staffbase/design` exports vs Figma Code Connect vs hand-curated allowlist? | Tiered: Code Connect first (when present), `.d.ts` AST second, hand-curated allowlist as bootstrap fallback in skill body. |
| **Per-screen vs single-file artifact** | Single `docs/design/component-map.md` with `## Screen Sn` headings. Mirrors user-stories.md `## Story Sn` shape. |
| **Token-mismatch threshold** — flag every off-token color, or only "clearly wrong" ones? | Every off-token color flagged. Lower noise via grouping: one gap entry per recurring mismatch, not one per usage. |
| **Miro support when MCP unauthenticated** | Skill prompts user to authenticate; if user declines, falls back to "user pastes screenshot" path. |
| **Plugin doesn't have `@staffbase/design` installed yet (pre-bootstrap)** | Skill reads catalog from `cc-custom-plugin-template/client/node_modules/@staffbase/design` via the `sb-design-source` override, then proceeds. |
| **Strict mode use-case** | Useful in late-stage PRs where any unmatched element is a regression; default off for new plugins. |
| **Multi-input chain depth** | Cap at 2 hops (e.g. Confluence → Figma); deeper chains flagged for manual review. |
| **Figma branches** — branch URLs supported? | Yes; URL parser extracts `branchKey` per Figma MCP server instructions. Branched files are flagged as `[branch]` in frontmatter. |

## Files touched

```
cc-custom-plugin-template/
├── .claude/skills/cc-custom-plugin-design-handoff/
│   └── SKILL.md                                     (new)
├── docs/
│   ├── skills/index.md                              (edit — add design-handoff entry)
│   └── superpowers/
│       ├── specs/2026-05-23-P3-design-handoff-skill-design.md   (this file)
│       └── plans/2026-05-23-P3-design-handoff-skill-plan.md     (forthcoming)
└── mkdocs.yml                                       (edit — add nav entry under Skills)
```

Downstream (after template-sync per `cc-custom-plugin-template/docs/guides/template-sync.md`):

```
cc-custom-plugin-glossary/.claude/skills/cc-custom-plugin-design-handoff/SKILL.md
cc-custom-plugin-applaunchpad/.claude/skills/cc-custom-plugin-design-handoff/SKILL.md
cc-custom-plugin-audio-hub/.claude/skills/cc-custom-plugin-design-handoff/SKILL.md   (if implemented by then)
```

Prereq surface (flagged, not in P3 scope):

```
design/  (Staffbase Design System repo)
└── Code Connect mappings published for `@staffbase/design` primitives  — P3 leverages these when present; absence is graceful degradation, not a P3 blocker.
```

## Implementation plan pointer

Implementation plan will land at `cc-custom-plugin-template/docs/superpowers/plans/2026-05-23-P3-design-handoff-skill-plan.md` after this spec is approved. The plan covers: SKILL.md authorship (single commit), input-handler implementation per type (one commit each), matching-algorithm prose + worked examples (separate commit), `mkdocs.yml` nav entry under "Skills" (separate commit), and a smoke-test run against three real inputs (Figma frame + gdoc + one of {pdf, confluence, miro}) to validate acceptance criteria 2–6.

## References

- Roadmap: [`../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md`](../plans/2026-05-23-cc-custom-plugin-platform-roadmap.md) §P3
- Sibling spec P2: [`./2026-05-23-P2-user-stories-skill-design.md`](./2026-05-23-P2-user-stories-skill-design.md)
- Sibling spec P5: [`./2026-05-23-P5-bootstrap-skill-refinement-design.md`](./2026-05-23-P5-bootstrap-skill-refinement-design.md)
- Canonical SB Design composition: [`cc-custom-plugin-template/client/src/components/admin/SettingsDialog.tsx`](../../../client/src/components/admin/SettingsDialog.tsx)
- Vendored grill-me: `cc-custom-plugin-template/.claude/skills/grill-me/SKILL.md`
- Bootstrap skill (MCP toolset pattern): `cc-custom-plugin-template/.claude/skills/cc-custom-plugin-bootstrap/SKILL.md`
- Figma MCP capabilities: see system MCP instructions for `claude_ai_Figma` (get_design_context, get_metadata, get_screenshot, get_variable_defs, get_code_connect_map)
- Cross-repo sync spec (structure reference): `cc-custom-plugin-template/docs/superpowers/specs/2026-05-22-cross-repo-sync-design.md`
