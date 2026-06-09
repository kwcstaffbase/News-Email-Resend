/**
 * GET /api/all-posts?channelIds=id1,id2,id3&limit=30
 *
 * Fetches the most recent posts from each supplied channel ID in parallel,
 * merges them, and returns them sorted by published date descending.
 *
 * Each post in the response is annotated with:
 *   - channelId   — which channel it belongs to
 *   - channelName — display name (pass as channelNames[]=id:name pairs or derived from channelId)
 *
 * Query params:
 *   channelIds   Comma-separated list of channel IDs (required)
 *   limit        Max posts per channel to fetch (default 50, max 100)
 *
 * Required headers:
 *   x-staffbase-url    e.g. https://yourco.staffbase.com
 *   x-staffbase-token  Basic auth token
 *
 * Also accepts x-channel-names header as JSON: { "channelId": "Channel Name", ... }
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { channelIds, limit = "50" } = req.query;
  const staffbaseUrl = req.headers["x-staffbase-url"];
  const apiToken = req.headers["x-staffbase-token"];

  if (!channelIds) return res.status(400).json({ error: "channelIds is required" });
  if (!staffbaseUrl || !apiToken) {
    return res.status(400).json({ error: "x-staffbase-url and x-staffbase-token headers are required" });
  }

  // Optional map of channelId → channelName passed from the client
  let channelNameMap = {};
  try {
    const raw = req.headers["x-channel-names"];
    if (raw) channelNameMap = JSON.parse(raw);
  } catch {
    // ignore malformed header
  }

  const ids = channelIds.split(",").map((s) => s.trim()).filter(Boolean);
  const perChannelLimit = Math.min(Number(limit) || 50, 100);
  const auth = { headers: { Authorization: `Basic ${apiToken}` } };

  // Fetch posts from all channels in parallel
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

  // Merge fulfilled results, ignore failed channels
  const allPosts = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));

  // Sort by published date descending (fall back to planned, then createdAt)
  allPosts.sort((a, b) => {
    const ta = new Date(a.published ?? a.planned ?? a.created ?? 0).getTime();
    const tb = new Date(b.published ?? b.planned ?? b.created ?? 0).getTime();
    return tb - ta;
  });

  res.status(200).json({ posts: allPosts, total: allPosts.length });
}
