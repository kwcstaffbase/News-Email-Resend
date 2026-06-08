# ADR-0006 — GitOps deployment via mops

**Status**: Accepted  
**Date**: 2026-04

---

## Context

The plugin needs a reproducible, auditable deployment process that integrates with the Staffbase internal platform. Deployment options considered:

1. Manual `docker push` + SSH
2. CI-pushed Helm values PR into a central infra repo
3. **mops** (Staffbase internal GitOps tool) — the standard deployment mechanism for internal services

## Decision

Use **mops** for all deployments to staging and production.

The CD workflow (`.github/workflows/cd.yml`) builds and pushes the Docker image, then calls `mops` to open a GitOps PR in the central infrastructure repository. The PR bumps the image tag and triggers ArgoCD to sync the new deployment.

Staging deploys automatically on every merge to `main`. Production requires a manual approval step in the CD workflow.

## Consequences

- **Positive**: Deployment history is in the infrastructure repo's git log (full audit trail)
- **Positive**: Rollbacks are a git revert in the infrastructure repo — no special tooling needed
- **Positive**: Consistent with how other Staffbase internal services are deployed; on-call responders are familiar with the process
- **Negative**: Adds a dependency on the internal `mops` tool; external contributors cannot run the CD pipeline without access to the infrastructure repo
- **Constraint**: The Docker base image must be kept up to date separately; Dependabot is not aware of the `mops`-managed image tag in the infrastructure repo
