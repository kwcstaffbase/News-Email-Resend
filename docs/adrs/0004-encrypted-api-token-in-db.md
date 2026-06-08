# ADR-0004 — Encrypted Staffbase API token stored in database

**Status**: Accepted  
**Date**: 2026-04

---

## Context

The plugin needs to call Staffbase REST APIs (e.g. fetching app metadata) on behalf of admins. The OAuth client credential flow is not available for custom plugins. Instead, admins obtain a long-lived Personal API token from Staffbase and paste it into the plugin settings.

The token must be persisted between requests and shared across server replicas. Options considered:

1. **Plaintext in DB** — simple but unacceptable if DB backups are exposed
2. **Encrypted in DB** — acceptable when encryption key is injected at runtime via env var
3. **External secret store** (HashiCorp Vault, AWS Secrets Manager) — good practice but overengineered for a single-tenant plugin at this scale

## Decision

Persist the Staffbase API token as **AES-256-GCM ciphertext** in the `settings` table:

- `ENCRYPTION_KEY` env var (≥ 32 bytes hex) is the only way to read/write tokens
- Encryption: `node:crypto` — random 12-byte IV, 16-byte auth tag, stored as `iv:tag:ciphertext` (hex)
- `encrypt()` / `decrypt()` in `server/src/lib/crypto.ts` — fully unit-tested
- DB column: `settings.api_token` (nullable, text)

## Consequences

- **Positive**: A leaked DB dump does not expose usable API tokens
- **Positive**: Auth-tag provides tamper detection; `decrypt()` returns `null` on any mismatch
- **Positive**: 12-byte random IV means repeated encrypts of the same token produce different ciphertexts
- **Negative**: Rotating `ENCRYPTION_KEY` requires re-encrypting all stored tokens (no key-rotation helper exists yet; tracked in `docs/planning/future-considerations.md`)
- **Constraint**: If `ENCRYPTION_KEY` is lost all stored tokens are permanently unreadable; must be in secure secrets store (e.g. Doppler / Kubernetes secrets)
