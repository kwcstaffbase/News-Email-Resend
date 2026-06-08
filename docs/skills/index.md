# Claude Skills

Skills ship in `.claude/skills/` at the repo root. Claude Code auto-discovers them; humans use this page as a directory.

## Vendored skills

### `grill-me`

Interview-driven design tool. Pose one question at a time, recommend an answer per question, explore the codebase before asking when the codebase can answer.

- Source: [`mattpocock/skills`](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md) (MIT, © 2026 Matt Pocock)
- Local copy: `.claude/skills/grill-me/SKILL.md`
- Use when: stress-testing a plan or design before committing to it.

## Plugin-owned skills

### `cc-custom-plugin-bootstrap`

End-to-end bootstrap orchestration for a new Staffbase custom plugin. Wraps the scaffold step, the deployment-handoff walkthrough (infra + mops + Vault + CuCu), and the observability baseline.

- Local copy: `.claude/skills/cc-custom-plugin-bootstrap/SKILL.md`
- Use when: scaffolding a new `cc-custom-plugin-<name>` repo from this template.

## Adding a new skill

1. Create `.claude/skills/<skill-name>/SKILL.md` with frontmatter (`name`, `description`).
2. If vendoring from an external source, add `source:`, `license:`, `attribution:` frontmatter fields.
3. Add an entry to this page.
4. Reference the skill by name from other skills via `Use the Skill tool with name: <skill-name>`.
