/**
 * POST /api/send-reminder
 * Body: { postId, postTitle, postUrl, userIds: string[] }
 *
 * Fetches user details for each userId, then POSTs to the configured email
 * service. Users with no email address are skipped (counted in `skipped`).
 *
 * Required headers:
 *   x-staffbase-url       e.g. https://yourco.staffbase.com
 *   x-staffbase-token     Basic auth token
 *   x-email-service-url   e.g. https://email-service.example.com/api/emails
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { postId, postTitle, postUrl, userIds } = req.body ?? {};
  const staffbaseUrl = req.headers["x-staffbase-url"];
  const apiToken = req.headers["x-staffbase-token"];
  const emailServiceUrl = req.headers["x-email-service-url"];

  if (!postId || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: "postId and a non-empty userIds array are required" });
  }
  if (!staffbaseUrl || !apiToken) {
    return res.status(400).json({ error: "x-staffbase-url and x-staffbase-token headers are required" });
  }
  if (!emailServiceUrl) {
    return res.status(400).json({ error: "x-email-service-url header is required" });
  }

  const auth = { headers: { Authorization: `Basic ${apiToken}` } };

  try {
    // Fetch user details in parallel (capped at 20 concurrent to be safe)
    const BATCH = 20;
    const recipients = [];
    for (let i = 0; i < userIds.length; i += BATCH) {
      const batch = userIds.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (uid) => {
          const r = await fetch(`${staffbaseUrl}/api/users/${uid}`, auth);
          if (!r.ok) return null;
          const u = await r.json();
          const email =
            u.publicEmailAddress ??
            u.emails?.find((e) => e.primary)?.value ??
            null;
          return { userId: uid, email, firstName: u.firstName ?? null, lastName: u.lastName ?? null };
        })
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) recipients.push(r.value);
      }
    }

    const sendable = recipients.filter((r) => r.email);
    const skipped = recipients.length - sendable.length;

    if (sendable.length === 0) {
      return res.status(200).json({ success: false, sent: 0, skipped, message: "No recipients have a configured email address" });
    }

    // POST to email service
    // Adjust the payload shape below to match your email service's contract.
    const emailRes = await fetch(emailServiceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients: sendable,
        subject: `Reminder: Please acknowledge "${postTitle ?? "the news post"}"`,
        postUrl: postUrl ?? null,
        postTitle: postTitle ?? null,
        postId,
      }),
    });

    if (!emailRes.ok) {
      const text = await emailRes.text().catch(() => "");
      return res.status(502).json({ error: `Email service returned ${emailRes.status}`, detail: text.slice(0, 500) });
    }

    res.status(200).json({ success: true, sent: sendable.length, skipped });
  } catch (err) {
    res.status(502).json({ error: `Request failed: ${err.message}` });
  }
}
