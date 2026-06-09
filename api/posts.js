/**
 * GET /api/posts?channelId=&offset=&limit=
 *
 * Proxies GET /api/channels/:channelId/posts to the Staffbase platform.
 * Credentials are passed per-request via headers (never stored server-side).
 *
 * Required headers:
 *   x-staffbase-url    e.g. https://yourco.staffbase.com
 *   x-staffbase-token  Basic auth token (btoa("installations/{id}:{secret}"))
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { channelId, offset = "0", limit = "20" } = req.query;
  const staffbaseUrl = req.headers["x-staffbase-url"];
  const apiToken = req.headers["x-staffbase-token"];

  if (!channelId) return res.status(400).json({ error: "channelId is required" });
  if (!staffbaseUrl || !apiToken) {
    return res.status(400).json({ error: "x-staffbase-url and x-staffbase-token headers are required" });
  }

  try {
    const url = `${staffbaseUrl}/api/channels/${encodeURIComponent(channelId)}/posts?offset=${offset}&limit=${limit}`;
    const upstream = await fetch(url, {
      headers: { Authorization: `Basic ${apiToken}` },
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: `Upstream request failed: ${err.message}` });
  }
}
