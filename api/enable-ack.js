/**
 * POST /api/enable-ack
 * Body: { staffbaseUrl, apiToken, postId }
 *
 * Sets acknowledgingEnabled: true on the given post.
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { staffbaseUrl, apiToken, postId } = req.body ?? {};

  if (!staffbaseUrl || !apiToken) {
    return res.status(400).json({ error: "staffbaseUrl and apiToken are required" });
  }
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
        error: `Staffbase returned ${upstream.status}`,
        detail: text,
      });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(502).json({ error: `Request failed: ${err.message}` });
  }
}
