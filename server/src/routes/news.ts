/**
 * News Acknowledgement Tracker routes
 *
 * Proxies Staffbase Platform API calls needed to determine which users have (or
 * haven't) acknowledged a news post, then triggers reminder emails via a
 * configurable email service.
 *
 * All routes require an authenticated editor session. The Staffbase API token
 * and host URL are read from this instance's settings row.
 *
 * API surface:
 *   GET  /api/news/posts?channelId=&offset=&limit=
 *   GET  /api/news/posts/:postId/acknowledgement-status
 *   POST /api/news/posts/:postId/enable-acknowledging
 *   POST /api/news/posts/:postId/send-reminder
 */

import { Hono } from "hono";
import { z } from "zod";
import { buildUserName, logChange } from "../lib/changelog.ts";
import { createLogger } from "../lib/logger.ts";
import { getInstanceSettings, staffbaseFetch } from "../lib/staffbase-api.ts";
import { requireEditor, ssoMiddleware } from "../middleware/sso.ts";
import type { AppEnv } from "../types/hono.ts";

export const newsRoute = new Hono<AppEnv>();

newsRoute.use(ssoMiddleware);

const newsLogger = createLogger("news");

// ── Helpers ────────────────────────────────────────────────────────────────

/** Resolve the API credentials for this instance, returning 503 if unconfigured. */
async function getCredentials(
  instanceId: string
): Promise<{ staffbaseUrl: string; apiToken: string } | null> {
  const { staffbaseUrl, apiToken } = await getInstanceSettings(instanceId);
  if (!staffbaseUrl || !apiToken) return null;
  return { staffbaseUrl, apiToken };
}

/** Fetch all pages of acknowledgements for a post and return the full set of userIds. */
async function fetchAllAcknowledgedUserIds(
  postId: string,
  staffbaseUrl: string,
  apiToken: string
): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  const limit = 100;

  for (;;) {
    const res = await staffbaseFetch(
      `/api/posts/${postId}/acknowledgements?offset=${offset}&limit=${limit}`,
      staffbaseUrl,
      apiToken
    );
    if (!res.ok) {
      newsLogger.warn("Failed to fetch acknowledgements page.", {
        postId,
        offset,
        status: res.status,
      });
      break;
    }
    const body = (await res.json()) as {
      data?: Array<{ userID?: string }>;
      total?: number;
    };
    const data = body.data ?? [];
    for (const entry of data) {
      if (entry.userID) ids.add(entry.userID);
    }
    offset += data.length;
    if (offset >= (body.total ?? 0) || data.length === 0) break;
  }

  return ids;
}

/**
 * Fetch all users across all groups that have access to a channel.
 * Returns a map of userId → { firstName, lastName, email } so callers can
 * look up display names and email addresses without extra round-trips.
 *
 * Users may belong to multiple groups — the map naturally deduplicates them.
 */
async function fetchChannelRecipients(
  channelId: string,
  staffbaseUrl: string,
  apiToken: string
): Promise<
  Map<string, { firstName: string | null; lastName: string | null; email: string | null }>
> {
  const recipients = new Map<
    string,
    { firstName: string | null; lastName: string | null; email: string | null }
  >();

  // 1. Get group IDs from the channel's accessors
  const channelRes = await staffbaseFetch(`/api/channels/${channelId}`, staffbaseUrl, apiToken);
  if (!channelRes.ok) {
    newsLogger.warn("Failed to fetch channel.", { channelId, status: channelRes.status });
    return recipients;
  }
  const channel = (await channelRes.json()) as {
    accessors?: {
      groups?: { data?: Array<{ id: string }> };
    };
  };

  const groupIds = channel.accessors?.groups?.data?.map((g) => g.id) ?? [];

  // 2. For each group, page through users
  for (const groupId of groupIds) {
    let offset = 0;
    const limit = 100;

    for (;;) {
      const groupRes = await staffbaseFetch(
        `/api/groups/${groupId}?offset=${offset}&limit=${limit}`,
        staffbaseUrl,
        apiToken
      );
      if (!groupRes.ok) {
        newsLogger.warn("Failed to fetch group users.", { groupId, offset, status: groupRes.status });
        break;
      }
      const group = (await groupRes.json()) as {
        users?: {
          total?: number;
          data?: Array<{
            id: string;
            firstName?: string | null;
            lastName?: string | null;
            publicEmailAddress?: string | null;
            emails?: Array<{ value?: string; primary?: boolean }>;
            status?: string;
          }>;
        };
      };

      const users = group.users?.data ?? [];
      for (const u of users) {
        // Skip deleted/pending/deactivated users — they can't read posts
        if (u.status && u.status !== "activated") continue;
        if (recipients.has(u.id)) continue;

        // Prefer publicEmailAddress, fall back to primary email entry
        const email =
          u.publicEmailAddress ??
          u.emails?.find((e) => e.primary)?.value ??
          null;

        recipients.set(u.id, {
          firstName: u.firstName ?? null,
          lastName: u.lastName ?? null,
          email,
        });
      }

      offset += users.length;
      if (offset >= (group.users?.total ?? 0) || users.length === 0) break;
    }
  }

  return recipients;
}

// ── GET /api/news/posts ─────────────────────────────────────────────────────
// List posts for a given channelId, proxying to the Staffbase Posts API.

const listPostsSchema = z.object({
  channelId: z.string().min(1),
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

newsRoute.get("/posts", requireEditor, async (c) => {
  const { instanceId } = c.var.scopedDb;

  const parsed = listPostsSchema.safeParse({
    channelId: c.req.query("channelId"),
    offset: c.req.query("offset"),
    limit: c.req.query("limit"),
  });
  if (!parsed.success) {
    return c.json({ error: "Invalid query parameters", details: parsed.error.flatten() }, 400);
  }

  const creds = await getCredentials(instanceId);
  if (!creds) {
    return c.json({ error: "Staffbase API credentials not configured." }, 503);
  }

  const { channelId, offset, limit } = parsed.data;
  const res = await staffbaseFetch(
    `/api/channels/${channelId}/posts?offset=${offset}&limit=${limit}`,
    creds.staffbaseUrl,
    creds.apiToken
  );

  if (!res.ok) {
    const body = await res.text();
    newsLogger.warn("Staffbase posts fetch failed.", { channelId, status: res.status, body });
    return c.json({ error: `Staffbase API returned ${res.status}` }, res.status as 400 | 404 | 500);
  }

  const data = await res.json();
  return c.json(data);
});

// ── GET /api/news/posts/:postId/acknowledgement-status ─────────────────────
// Returns the full read/unread breakdown for a post:
//   { acknowledgedUsers, notAcknowledgedUsers, totalRecipients, acknowledgingEnabled }
//
// Execution flow:
//   1. GET /api/posts/:postId → confirm acknowledgingEnabled + get channelId
//   2. fetchAllAcknowledgedUserIds() → page through all acknowledgements
//   3. fetchChannelRecipients() → all activated users in the channel's groups
//   4. Diff to produce notAcknowledgedUsers

newsRoute.get("/posts/:postId/acknowledgement-status", requireEditor, async (c) => {
  const { instanceId } = c.var.scopedDb;
  const postId = c.req.param("postId");

  const creds = await getCredentials(instanceId);
  if (!creds) {
    return c.json({ error: "Staffbase API credentials not configured." }, 503);
  }

  // 1. Fetch the post to get channelId + acknowledgingEnabled flag
  const postRes = await staffbaseFetch(`/api/posts/${postId}`, creds.staffbaseUrl, creds.apiToken);
  if (!postRes.ok) {
    return c.json({ error: `Staffbase API returned ${postRes.status}` }, postRes.status as 404 | 500);
  }
  const post = (await postRes.json()) as {
    id: string;
    channelID?: string;
    acknowledgingEnabled?: boolean;
    contents?: Record<string, { title?: string }>;
    published?: string;
    acknowledgements?: { total?: number };
    links?: { detail_view?: { href?: string } };
  };

  const channelId = post.channelID;
  if (!channelId) {
    return c.json({ error: "Post has no channelID." }, 500);
  }

  // 2. Fetch acknowledged user IDs
  const acknowledgedIds = await fetchAllAcknowledgedUserIds(postId, creds.staffbaseUrl, creds.apiToken);

  // 3. Fetch all channel recipients
  const recipients = await fetchChannelRecipients(channelId, creds.staffbaseUrl, creds.apiToken);

  // 4. Partition into acknowledged / not-acknowledged
  type UserEntry = {
    userId: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };

  const acknowledgedUsers: UserEntry[] = [];
  const notAcknowledgedUsers: UserEntry[] = [];

  for (const [userId, info] of recipients) {
    const entry: UserEntry = { userId, ...info };
    if (acknowledgedIds.has(userId)) {
      acknowledgedUsers.push(entry);
    } else {
      notAcknowledgedUsers.push(entry);
    }
  }

  // Sort by lastName then firstName for display consistency
  const sorter = (a: UserEntry, b: UserEntry) => {
    const la = (a.lastName ?? "").toLowerCase();
    const lb = (b.lastName ?? "").toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    return ((a.firstName ?? "").toLowerCase() < (b.firstName ?? "").toLowerCase() ? -1 : 1);
  };
  acknowledgedUsers.sort(sorter);
  notAcknowledgedUsers.sort(sorter);

  return c.json({
    postId,
    acknowledgingEnabled: post.acknowledgingEnabled ?? false,
    totalRecipients: recipients.size,
    acknowledgedUsers,
    notAcknowledgedUsers,
    postUrl: post.links?.detail_view?.href ?? null,
    postTitle: Object.values(post.contents ?? {})[0]?.title ?? null,
  });
});

// ── POST /api/news/posts/:postId/enable-acknowledging ──────────────────────
// Enables the acknowledging feature on a post (sets acknowledgingEnabled: true).

newsRoute.post("/posts/:postId/enable-acknowledging", requireEditor, async (c) => {
  const { instanceId } = c.var.scopedDb;
  const { userId, firstName, lastName, userName: fullName } = c.var.user;
  const postId = c.req.param("postId");

  const creds = await getCredentials(instanceId);
  if (!creds) {
    return c.json({ error: "Staffbase API credentials not configured." }, 503);
  }

  const res = await staffbaseFetch(`/api/posts/${postId}`, creds.staffbaseUrl, creds.apiToken, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ acknowledgingEnabled: true }),
  });

  if (!res.ok) {
    newsLogger.warn("Failed to enable acknowledging on post.", { postId, status: res.status });
    return c.json({ error: `Staffbase API returned ${res.status}` }, res.status as 400 | 404 | 500);
  }

  void logChange({
    instanceId,
    userId,
    userName: buildUserName(userId, firstName, lastName, fullName),
    action: "post_acknowledging_enabled",
    entityType: "post",
    entityId: postId,
    summary: `Enabled acknowledging on post ${postId}`,
  });

  return c.json({ success: true });
});

// ── POST /api/news/posts/:postId/send-reminder ─────────────────────────────
// Sends a reminder email to specified users via the configured email service.
//
// Body: { userIds: string[], subject?: string, postUrl?: string }
//
// The email service endpoint is read from this instance's emailServiceUrl setting.
// Request format sent to the email service:
// POST {emailServiceUrl}
// { "recipients": [{userId, email, firstName, lastName}], "subject": "...", "postUrl": "...", "postId": "..." }
//
// NOTE: Confirm the exact request/response contract of your email service and
// adjust the payload shape in buildEmailPayload() if needed.

const sendReminderSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(500),
  subject: z.string().max(200).optional(),
  postUrl: z.string().optional(),
  postTitle: z.string().optional(),
});

newsRoute.post("/posts/:postId/send-reminder", requireEditor, async (c) => {
  const { instanceId } = c.var.scopedDb;
  const { userId, firstName, lastName, userName: fullName } = c.var.user;
  const postId = c.req.param("postId");

  const body = await c.req.json<unknown>();
  const parsed = sendReminderSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request body", details: parsed.error.flatten() }, 400);
  }

  const { userIds, subject, postUrl, postTitle } = parsed.data;

  // Resolve settings
  const { staffbaseUrl, apiToken, emailServiceUrl } = await getInstanceSettings(instanceId);
  if (!staffbaseUrl || !apiToken) {
    return c.json({ error: "Staffbase API credentials not configured." }, 503);
  }
  if (!emailServiceUrl) {
    return c.json({ error: "Email service URL not configured. Set it in Settings." }, 503);
  }

  // Fetch display names + emails for the requested userIds from the Staffbase user API.
  // We do individual lookups here because we only need a small subset.
  type RecipientInfo = {
    userId: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  const recipients: RecipientInfo[] = [];

  await Promise.allSettled(
    userIds.map(async (uid) => {
      const res = await staffbaseFetch(`/api/users/${uid}`, staffbaseUrl, apiToken);
      if (!res.ok) return;
      const user = (await res.json()) as {
        id: string;
        firstName?: string | null;
        lastName?: string | null;
        publicEmailAddress?: string | null;
        emails?: Array<{ value?: string; primary?: boolean }>;
      };
      const email =
        user.publicEmailAddress ??
        user.emails?.find((e) => e.primary)?.value ??
        null;
      recipients.push({
        userId: uid,
        email,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
      });
    })
  );

  // Filter out recipients with no email address — can't send to them
  const sendable = recipients.filter((r) => r.email);
  const skipped = recipients.length - sendable.length;

  if (sendable.length === 0) {
    return c.json({
      success: false,
      sent: 0,
      skipped,
      message: "No recipients have a configured email address.",
    });
  }

  // POST to the email service
  // Adjust this payload shape to match your email service's API contract.
  const emailPayload = {
    recipients: sendable.map((r) => ({
      userId: r.userId,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
    })),
    subject: subject ?? `Reminder: Please acknowledge the news post`,
    postUrl: postUrl ?? null,
    postTitle: postTitle ?? null,
    postId,
  };

  let emailResponse: Response;
  try {
    emailResponse = await fetch(emailServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailPayload),
    });
  } catch (err) {
    newsLogger.error("Email service request failed.", {
      postId,
      message: (err as Error).message,
    });
    return c.json({ error: "Failed to reach the email service." }, 503);
  }

  if (!emailResponse.ok) {
    const errBody = await emailResponse.text().catch(() => "");
    newsLogger.warn("Email service returned non-OK.", {
      postId,
      status: emailResponse.status,
      body: errBody.slice(0, 500),
    });
    return c.json({ error: `Email service returned ${emailResponse.status}` }, 502);
  }

  void logChange({
    instanceId,
    userId,
    userName: buildUserName(userId, firstName, lastName, fullName),
    action: "reminder_sent",
    entityType: "post",
    entityId: postId,
    summary: `Sent acknowledgement reminder for post ${postId} to ${sendable.length} user(s)`,
    payload: {
      recipientCount: sendable.length,
      skippedNoEmail: skipped,
      postUrl,
    },
  });

  return c.json({ success: true, sent: sendable.length, skipped });
});
