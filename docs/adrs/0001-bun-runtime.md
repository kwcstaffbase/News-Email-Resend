# ADR-0001 — Bun as the server runtime

**Status**: Accepted  
**Date**: 2026-04

---

## Context

The server needs a TypeScript-native runtime. Alternatives considered: Node.js + tsx/ts-node, Deno, Bun.

The Staffbase CC Tech plugin template already targeted Bun 1.x at the time this project was started.

## Decision

Use **Bun 1.x** as the production runtime and local development runner.

Key reasons:

- Built-in TypeScript execution without a transpile step
- `bun test` ships with the binary — no separate test-runner dependency
- `bun:sqlite` and native DB drivers have lower cold-start overhead
- Workspace support (`bun workspaces`) covers `server/` + `client/` in one lockfile
- First-class compatibility layer for Node.js built-ins (`node:crypto`, `node:path`, etc.)

## Consequences

- **Positive**: faster `bun install` / `bun test` cycles; no tsconfig `paths` alias workarounds needed for `.ts` imports
- **Positive**: `Bun.env` replaces `process.env` in server code (stricter typing for env vars)
- **Negative**: some npm packages still have edge-case Bun incompatibilities; must pin `bun` version in `.tool-versions` / `Dockerfile`
- **Negative**: `bun:test` API surfaces differ slightly from Jest / Vitest (e.g. `mock.module` instead of `jest.mock`)
- **Constraint**: `widget/` uses npm (not Bun) because the Staffbase widget SDK toolchain assumes a Node/npm build environment
