import { db } from "../db/client.ts";
import { changelog } from "../db/schema.ts";
import { createLogger } from "./logger.ts";

const logger = createLogger("changelog");

export type ChangelogAction =
  | "settings_updated"
  | "clear_all"
  | "user_sync"
  | "user_deleted"
  | "item_created"
  | "item_updated"
  | "item_deleted"
  | "post_acknowledging_enabled"
  | "reminder_sent";

export type ChangelogEntityType = "settings" | "user" | "system" | "item" | "post";

export interface ChangelogEntryInput {
  instanceId: string;
  userId: string | null;
  userName: string | null;
  action: ChangelogAction;
  entityType: ChangelogEntityType;
  entityId?: string | null;
  entityName?: string | null;
  summary: string;
  payload?: Record<string, unknown> | null;
  gdprRelevant?: boolean;
}

/**
 * Appends a single entry to the admin changelog.
 *
 * Always call after a successful mutation — never before, never on error.
 * Failures are silently swallowed so a logging hiccup never breaks the
 * primary operation. Errors are logged to stderr for observability.
 */
export async function logChange(entry: ChangelogEntryInput): Promise<void> {
  try {
    await db.insert(changelog).values({
      instanceId: entry.instanceId,
      userId: entry.userId ?? null,
      userName: entry.userName ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      entityName: entry.entityName ?? null,
      summary: entry.summary,
      payload: entry.payload ?? null,
      gdprRelevant: entry.gdprRelevant ?? false,
    });
  } catch (err) {
    // Non-fatal: do not propagate.
    // The primary operation already succeeded at this point.
    logger.error("Failed to write changelog entry.", {
      action: entry.action,
      instanceId: entry.instanceId,
      message: (err as Error).message,
    });
  }
}

/**
 * Build a display name string from optional first/last name components.
 * Falls back to userId if no name parts are available.
 */
export function buildUserName(
  userId: string,
  firstName?: string | null,
  lastName?: string | null,
  fullName?: string | null
): string {
  const parts = [firstName, lastName].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  if (fullName) return fullName;
  return userId;
}
