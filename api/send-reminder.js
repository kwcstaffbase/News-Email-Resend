/**
 * POST /api/send-reminder
 *
 * The ONLY server-side function. All Staffbase API calls are made
 * directly from the browser; this exists solely to proxy the email
 * service, which may have its own CORS restrictions.
 *
 * Body: {
 *   emailServiceUrl: string,
 *   recipients:  [{ userId, email, firstName, lastName }],
 *   subject:     string,
 *   postUrl:     string | null,
 *   postTitle:   string | null,
 *   postId:      string
 * }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { emailServiceUrl, recipients, subject, postUrl, postTitle, postId } = req.body ?? {};

  if (!emailServiceUrl) {
    return res.status(400).json({ error: "emailServiceUrl is required" });
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "recipients array is required" });
  }

  try {
    const emailRes = await fetch(emailServiceUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipients, subject, postUrl, postTitle, postId }),
    });

    if (!emailRes.ok) {
      const text = await emailRes.text().catch(() => "");
      return res.status(502).json({
        error:  `Email service returned ${emailRes.status}`,
        detail: text.slice(0, 500),
      });
    }

    res.status(200).json({ success: true, sent: recipients.length });
  } catch (err) {
    res.status(502).json({ error: `Email service unreachable: ${err.message}` });
  }
}
