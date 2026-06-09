/**
 * POST /api/all-posts
 * Body: { staffbaseUrl, apiToken, channelIds: string[], channelNames: { [id]: name }, limit? }
 *
 * Fetches posts from all supplied channel IDs in parallel, merges them,
 * and returns sorted by published date descending.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { staffbaseUrl, apiToken, channelIds, channelNames = {}, limit = 50 } = req.body ?? {};

  if (!staffbaseUrl || !apiToken) {
    return res.status(400).json({ error: "staffbaseUrl and apiToken are required" });
  }
  if (!Array.isArray(channelIds) || channelIds.length === 0) {
    return res.status(400).json({ error: "channelIds array is required" });
  }

  const perChannelLimit = Math.min(Number(limit) || 50, 100);
  const auth = { headers: { Authorization: `Basic ${apiToken}` } };

  const results = await Promise.allSettled(
    channelIds.map(async (channelId) => {
      const url =
        `${staffbaseUrl}/api/channels/${encodeURIComponent(channelId)}/posts` +
        `?offset=0&limit=${perChannelLimit}`;
      const r = await fetch(url, auth);
      if (!r.ok) return [];
      const body = await r.json();
      return (body.data ?? []).map((post) => ({
        ...post,
        channelId,
        channelName: channelNames[channelId] ?? channelId,
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
