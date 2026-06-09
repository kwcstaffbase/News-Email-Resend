/**
 * POST /api/enable-ack
 * Body: { postId: string }
 *
 * Sets acknowledgingEnabled: true on the given post.
 *
 * Credentials are read from environment variables:
 *   STAFFBASE_URL        e.g. https://yourco.staffbase.com
 *   STAFFBASE_API_TOKEN  Basic auth token
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const staffbaseUrl = process.env.STAFFBASE_URL;
  const apiToken     = process.env.STAFFBASE_API_TOKEN;

  if (!staffbaseUrl || !apiToken) {
    return res.status(500).json({ error: "STAFFBASE_URL and STAFFBASE_API_TOKEN environment variables are not set." });
  }

  const { postId } = req.body ?? {};
  if (!postId) return res.status(400).json({ error: "postId is required" });

  try {
    const upstream = await fetch(`${staffbaseUrl}/api/posts/${postId}`, {
      method:  "POST",
      headers: {
        Authorization:  `Basic ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ acknowledgingEnabled: true }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({
        error: `Staffbase API returned ${upstream.status}`,
        detail: text,
      });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(502).json({ error: `Request failed: ${err.message}` });
  }
}
