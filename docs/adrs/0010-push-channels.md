# ADR-0010 — Push channels + endpoint migration

**Status:** Accepted (reference decision)
**Date:** 2026-05-21

> **Template note:** the template does **not ship push-notification code** —
> there is no `server/src/lib/pushNotifications.ts` / `sendPush()`. This ADR
> records the canonical push-channel decision from the reference plugins so a
> forked plugin that adds push follows it from day one (non-deprecated
> installation-scoped endpoint, explicit `channels`, structured logging). Treat
> the file paths below as the target shape to create, not existing code.

## Context

The plugin's push notification code (`server/src/lib/pushNotifications.ts`) was wired against the now-deprecated Staffbase endpoint `POST /api/notifications` (scheduled for removal end-of-2025) and used the deprecated `content[locale].title` field. The deprecated endpoint also omits the `channels` array, leaving channel selection to API defaults — which on desktop browsers produced no visible notification because native push only delivers to APNs/FCM-registered mobile clients.

The library additionally had zero structured logging. Every outcome was silent: failures were swallowed inside the catch block, and callers used `void sendPush(...)` fire-and-forget. Operators had no grep target to diagnose dropped notifications via Grafana.

API spec audited against [https://developers.staffbase.com/openapi/notificationsapi.yaml](https://developers.staffbase.com/openapi/notificationsapi.yaml).

## Decision

Migrate `sendPush()` to the non-deprecated, installation-scoped endpoint and rename the payload field. Make channel selection configurable per installation. Add structured logging.

- **Endpoint:** `POST /api/installations/{installationId}/notifications`. Auth unchanged: `Basic base64("installations/{instanceId}:{SECRET}")`.
- **Payload:** `content[locale].text` (not `title`). New `channels: ("push" | "notificationCenter")[]` array, built dynamically from two per-instance settings — `pushChannelPush` + `pushChannelNotificationCenter` — both default `true`. Optional `link` deep-links the user back into the plugin.
- **Settings UI:** Admin SettingsDialog renders two checkboxes (Mobile push + Notification Center) under the existing `pushEnabled` master toggle, gated by the master and surfaced with a help line explaining the desktop / mobile distinction.
- **Validation:** Server enforces "master on requires at least one channel" with `400 push_channels_required`. Client mirrors with an inline form error + Save disabled.
- **Logging:** New `module=push` logger emits one structured event per outcome:

  | Event | Level | Fields |
  |---|---|---|
  | `push.attempt` | INFO | `instanceId`, `recipientCount`, `channels[]` |
  | `push.success` | INFO | `status`, `duration`, `notificationId` |
  | `push.failure` | WARN | `status`, `body` (truncated, redacted) |
  | `push.error` | ERROR | `message` (network exception) |
  | `push.skipped` | INFO | `reason` (`no_secret` / `no_endpoint` / `not_enabled` / `no_channels`) |

  Verifiable via `mcp__grafana-dev__query_logs` with `module:push`.

## Alternatives considered

- **Feature-flag the endpoint change.** Rejected — YAGNI; the change is single-line revert if it breaks, and the plugin is pre-prod when this lands.
- **Use the `/branch/notifications` endpoint.** Rejected — that path uses Editorial API tokens; the installation-scoped endpoint is the correct contract for per-plugin notifications and matches the existing `Basic installations/{id}:{SECRET}` auth.
- **Add a third "Email" channel toggle.** Rejected — the API spec explicitly says "Users cannot be notified via email notifications" through this endpoint.
- **Default both channels off when introducing the columns.** Rejected — existing installations would lose notifications they were already receiving. Defaulting to true keeps behaviour parity.

## Consequences

- Desktop users receive Notification Center entries deterministically (the channel `notificationCenter` is now always set when enabled).
- Admins control per-installation notification scope without a code change.
- Future Notifications API deprecations are caught at PR time via the `module=push` log surface and corresponding tests.
- The deprecated `/api/notifications` path is no longer called from this plugin; removal at end-of-2025 is a no-op for any plugin built from this template.
