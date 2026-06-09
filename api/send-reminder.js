/**
 * POST /api/send-reminder
 * Body: { staffbaseUrl, apiToken, emailServiceUrl, postId, postTitle, postUrl, userIds[] }
 *
 * Fetches user details for each userId, then POSTs to the email service.
 * Users without an email address are skipped (counted in `skipped`).
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    staffbaseUrl,
    apiToken,
    emailServiceUrl,
    postId,
    postTitle,
    postUrl,
    userIds,
  } = req.body ?? {};

  if (!staffbaseUrl || !apiToken) {
    return res.status(400).json({ error: "staffbaseUrl and apiToken are required" });
  }
  if (!emailServiceUrl) {
    return res.status(400).json({ error: "emailServiceUrl is required" });
  }
  if (!postId || !Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ error: "postId and a non-empty userIds array are required" });
  }

  const auth = { headers: { Authorization: `Basic ${apiToken}` } };

  try {
    // Fetch user details in batches of 20
    const BATCH = 20;
    const recipients = [];
    for (let i = 0; i < userIds.length; i += BATCH) {
      const results = await Promise.allSettled(
        userIds.slice(i, i + BATCH).map(async (uid) => {
          const r = await fetch(`${staffbaseUrl}/api/users/${uid}`, auth);
          if (!r.ok) return null;
          const u = await r.json();
          return {
            userId: uid,
            email: u.publicEmailAddress ?? u.emails?.find((e) => e.primary)?.value ?? null,
            firstName: u.firstName ?? null,
            lastName:  u.lastName  ?? null,
          };
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

    // POST to email service — adjust payload shape to match your service's contract
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
