/**
 * POST /api/enable-ack
 * Body: { postId: string }
 *
 * Sets acknowledgingEnabled: true on the given post.
 *
 * Required headers:
 *   x-staffbase-url    e.g. https://yourco.staffbase.com
 *   x-staffbase-token  Basic auth token
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { postId } = req.body ?? {};
  const staffbaseUrl = req.headers["x-staffbase-url"];
  const apiToken = req.headers["x-staffbase-token"];

  if (!postId) return res.status(400).json({ error: "postId is required" });
  if (!staffbaseUrl || !apiToken) {
    return res.status(400).json({ error: "x-staffbase-url and x-staffbase-token headers are required" });
  }

  try {
    const upstream = await fetch(`${staffbaseUrl}/api/posts/${postId}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ acknowledgingEnabled: true }),
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: `Staffbase API returned ${upstream.status}`, detail: text });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    res.status(502).json({ error: `Request failed: ${err.message}` });
  }
}
