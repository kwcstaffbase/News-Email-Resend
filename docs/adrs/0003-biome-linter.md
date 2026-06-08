# ADR-0003 — Biome for linting and formatting

**Status**: Accepted  
**Date**: 2026-04

---

## Context

The project needed a single tool for TypeScript linting, import organisation, and code formatting. Alternatives considered: ESLint + Prettier, oxc.

The Staffbase org provides a shared `eslint-config` package, but maintaining two separate tools (ESLint + Prettier) with a shared config adds complexity and occasional rule conflicts.

## Decision

Use **Biome** as the single linting + formatting tool for `server/` and `client/`.

Key reasons:

- Single binary, zero transitive dependencies for lint+format
- Default rule set covers the vast majority of ESLint recommended and Prettier formatting out of the box
- `biome check --write` is an atomic lint-fix + format pass
- Native import organiser replaces `eslint-plugin-import`
- Near-instant execution even on large TypeScript codebases

The `widget/` workspace is excluded from Biome (`widget/**` override in `biome.jsonc`) because the Staffbase widget SDK toolchain assumes separate ESLint tooling and has its own `tsconfig`.

## Consequences

- **Positive**: `biome check --write src/` replaces `eslint --fix && prettier --write`
- **Positive**: CI has a single `bun biome check` step for the entire monorepo
- **Negative**: Biome does not support all ESLint plugins (e.g. `eslint-plugin-react-hooks` — mitigated by Biome's own React rule set)
- **Negative**: Biome `organizeImports` reorders differently from `eslint-plugin-import`; enforced via CI to keep imports consistent
- **Trade-off**: Diverges from the Staffbase org-wide `eslint-config`; must be noted in onboarding docs
