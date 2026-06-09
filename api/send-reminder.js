/**
 * POST /api/send-reminder
 * Body: { postId, postTitle, postUrl, userIds: string[] }
 *
 * Fetches user details for each userId, then POSTs to the email service.
 * Users with no email address are skipped.
 *
 * Credentials are read from environment variables:
 *   STAFFBASE_URL        e.g. https://yourco.staffbase.com
 *   STAFFBASE_API_TOKEN  Basic auth token
 *   EMAIL_SERVICE_URL    e.g. https://email-service.example.com/api/emails
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const staffbaseUrl   = process.env.STAFFBASE_URL;
  const apiToken       = process.env.STAFFBASE_API_TOKEN;
  const emailServiceUrl = process.env.EMAIL_SERVICE_URL;

  if (!staffbaseUrl || !apiToken) {
    return res.status(500).json({ error: "STAFFBASE_URL and STAFFBASE_API_TOKEN environment variables are not set." });
  }
  if (!emailServiceUrl) {
    return res.status(500).json({ error: "EMAIL_SERVICE_URL environment variable is not set." });
  }

  const { postId, postTitle, postUrl, userIds } = req.body ?? {};
  if (!postId || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: "postId and a non-empty userIds array are required" });
  }

  const auth = { headers: { Authorization: `Basic ${apiToken}` } };

  try {
    // Fetch user details in parallel (batched to avoid overwhelming Staffbase)
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
    const skipped  = recipients.length - sendable.length;

    if (sendable.length === 0) {
      return res.status(200).json({
        success: false, sent: 0, skipped,
        message: "No recipients have a configured email address",
      });
    }

    // POST to the email service.
    // Adjust the payload shape below to match your email service's contract.
    const emailRes = await fetch(emailServiceUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients: sendable,
        subject:    `Reminder: Please acknowledge "${postTitle ?? "the news post"}"`,
        postUrl:    postUrl ?? null,
        postTitle:  postTitle ?? null,
        postId,
      }),
    });

    if (!emailRes.ok) {
      const text = await emailRes.text().catch(() => "");
      return res.status(502).json({
        error: `Email service returned ${emailRes.status}`,
        detail: text.slice(0, 500),
      });
    }

    res.status(200).json({ success: true, sent: sendable.length, skipped });
  } catch (err) {
    res.status(502).json({ error: `Request failed: ${err.message}` });
  }
}
