/**
 * GET /api/ack-status?postId=
 *
 * Returns the full acknowledgement breakdown for a post:
 *   { postId, postTitle, postUrl, acknowledgingEnabled,
 *     totalRecipients, acknowledgedUsers, notAcknowledgedUsers }
 *
 * Execution flow:
 *   1. GET /api/posts/:postId            → channelId, acknowledgingEnabled
 *   2. GET /api/posts/:postId/acknowledgements (all pages)
 *   3. GET /api/channels/:channelId      → group IDs
 *   4. GET /api/groups/:groupId (×N)     → activated users
 *   5. Diff → partition into read / unread
 *
 * Required headers:
 *   x-staffbase-url    e.g. https://yourco.staffbase.com
 *   x-staffbase-token  Basic auth token
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { postId } = req.query;
  const staffbaseUrl = req.headers["x-staffbase-url"];
  const apiToken = req.headers["x-staffbase-token"];

  if (!postId) return res.status(400).json({ error: "postId is required" });
  if (!staffbaseUrl || !apiToken) {
    return res.status(400).json({ error: "x-staffbase-url and x-staffbase-token headers are required" });
  }

  const auth = { headers: { Authorization: `Basic ${apiToken}` } };

  try {
    // 1. Fetch post
    const postRes = await fetch(`${staffbaseUrl}/api/posts/${postId}`, auth);
    if (!postRes.ok) {
      return res.status(postRes.status).json({ error: `Post fetch failed: ${postRes.status}` });
    }
    const post = await postRes.json();
    const channelId = post.channelID;
    if (!channelId) return res.status(500).json({ error: "Post has no channelID" });

    // 2. Fetch all acknowledged user IDs (paginated)
    const acknowledgedIds = new Set();
    let offset = 0;
    const PAGE = 100;
    for (;;) {
      const r = await fetch(
        `${staffbaseUrl}/api/posts/${postId}/acknowledgements?offset=${offset}&limit=${PAGE}`,
        auth
      );
      if (!r.ok) break;
      const body = await r.json();
      const data = body.data ?? [];
      for (const entry of data) {
        if (entry.userID) acknowledgedIds.add(entry.userID);
      }
      offset += data.length;
      if (offset >= (body.total ?? 0) || data.length === 0) break;
    }

    // 3. Fetch channel → group IDs
    const chanRes = await fetch(`${staffbaseUrl}/api/channels/${channelId}`, auth);
    if (!chanRes.ok) {
      return res.status(chanRes.status).json({ error: `Channel fetch failed: ${chanRes.status}` });
    }
    const channel = await chanRes.json();
    const groupIds = channel.accessors?.groups?.data?.map((g) => g.id) ?? [];

    // 4. Fetch all activated users across all groups
    const recipients = new Map(); // userId → { firstName, lastName, email }
    for (const groupId of groupIds) {
      let gOffset = 0;
      for (;;) {
        const r = await fetch(
          `${staffbaseUrl}/api/groups/${groupId}?offset=${gOffset}&limit=${PAGE}`,
          auth
        );
        if (!r.ok) break;
        const group = await r.json();
        const users = group.users?.data ?? [];
        for (const u of users) {
          if (u.status && u.status !== "activated") continue;
          if (recipients.has(u.id)) continue;
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
        gOffset += users.length;
        if (gOffset >= (group.users?.total ?? 0) || users.length === 0) break;
      }
    }

    // 5. Partition
    const acknowledgedUsers = [];
    const notAcknowledgedUsers = [];
    for (const [userId, info] of recipients) {
      const entry = { userId, ...info };
      (acknowledgedIds.has(userId) ? acknowledgedUsers : notAcknowledgedUsers).push(entry);
    }

    const sort = (a, b) => {
      const la = (a.lastName ?? "").toLowerCase();
      const lb = (b.lastName ?? "").toLowerCase();
      if (la !== lb) return la < lb ? -1 : 1;
      return (a.firstName ?? "").toLowerCase() < (b.firstName ?? "").toLowerCase() ? -1 : 1;
    };
    acknowledgedUsers.sort(sort);
    notAcknowledgedUsers.sort(sort);

    const postTitle = Object.values(post.contents ?? {})[0]?.title ?? postId;

    res.status(200).json({
      postId,
      postTitle,
      postUrl: post.links?.detail_view?.href ?? null,
      acknowledgingEnabled: post.acknowledgingEnabled ?? false,
      totalRecipients: recipients.size,
      acknowledgedUsers,
      notAcknowledgedUsers,
    });
  } catch (err) {
    res.status(502).json({ error: `Request failed: ${err.message}` });
  }
}
