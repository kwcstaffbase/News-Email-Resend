/**
 * GET /api/all-posts?channelIds=id1,id2&limit=50
 *
 * Fetches posts from all supplied channel IDs in parallel, merges them,
 * and returns sorted by published date descending.
 *
 * Accepts an optional x-channel-names header (JSON map channelId → name)
 * to annotate each post with its channel's display name.
 *
 * Credentials are read from environment variables:
 *   STAFFBASE_URL        e.g. https://yourco.staffbase.com
 *   STAFFBASE_API_TOKEN  Basic auth token
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const staffbaseUrl = process.env.STAFFBASE_URL;
  const apiToken     = process.env.STAFFBASE_API_TOKEN;

  if (!staffbaseUrl || !apiToken) {
    return res.status(500).json({ error: "STAFFBASE_URL and STAFFBASE_API_TOKEN environment variables are not set." });
  }

  const { channelIds, limit = "50" } = req.query;
  if (!channelIds) return res.status(400).json({ error: "channelIds is required" });

  let channelNameMap = {};
  try {
    const raw = req.headers["x-channel-names"];
    if (raw) channelNameMap = JSON.parse(raw);
  } catch { /* ignore */ }

  const ids = channelIds.split(",").map((s) => s.trim()).filter(Boolean);
  const perChannelLimit = Math.min(Number(limit) || 50, 100);
  const auth = { headers: { Authorization: `Basic ${apiToken}` } };

  const results = await Promise.allSettled(
    ids.map(async (channelId) => {
      const url =
        `${staffbaseUrl}/api/channels/${encodeURIComponent(channelId)}/posts` +
        `?offset=0&limit=${perChannelLimit}`;
      const r = await fetch(url, auth);
      if (!r.ok) return [];
      const body = await r.json();
      return (body.data ?? []).map((post) => ({
        ...post,
        channelId,
        channelName: channelNameMap[channelId] ?? channelId,
      }));
    })
  );

  const allPosts = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  allPosts.sort((a, b) => {
    const ta = new Date(a.published ?? a.planned ?? a.created ?? 0).getTime();
    const tb = new Date(b.published ?? b.planned ?? b.created ?? 0).getTime();
    return tb - ta;
  });

  res.status(200).json({ posts: allPosts, total: allPosts.length });
}
