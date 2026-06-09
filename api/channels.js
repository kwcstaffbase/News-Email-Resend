/**
 * GET /api/channels
 *
 * Discovers all news channel installations and returns each one with
 * an approximate recipient count (sum of group user totals).
 *
 * Credentials are read from environment variables — never from the browser:
 *   STAFFBASE_URL        e.g. https://yourco.staffbase.com
 *   STAFFBASE_API_TOKEN  Basic auth token (btoa("installations/{id}:{secret}"))
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const staffbaseUrl = process.env.STAFFBASE_URL;
  const apiToken     = process.env.STAFFBASE_API_TOKEN;

  if (!staffbaseUrl || !apiToken) {
    return res.status(500).json({
      error: "STAFFBASE_URL and STAFFBASE_API_TOKEN environment variables are not set. " +
        "Add them in the Vercel project settings under Environment Variables.",
    });
  }

  const auth = { headers: { Authorization: `Basic ${apiToken}` } };

  try {
    const searchRes = await fetch(
      `${staffbaseUrl}/api/plugins/news/installations/search?limit=100&permission=view`,
      auth
    );

    if (!searchRes.ok) {
      return res.status(searchRes.status).json({
        error: `Staffbase channel discovery returned ${searchRes.status}. ` +
          "Ensure the API token has branch-level read access.",
      });
    }

    const searchBody  = await searchRes.json();
    const installations = searchBody.data ?? searchBody ?? [];

    // Fetch approximate recipient count per channel in parallel
    const channels = await Promise.all(
      installations.map(async (inst) => {
        const channelId = inst.id;
        const localizations = inst.config?.localization ?? {};
        const name =
          Object.values(localizations).find((l) => l?.title)?.title ??
          inst.name ??
          channelId;

        const groupIds =
          inst.accessors?.groups?.data?.map((g) => g.id) ??
          inst.typedAccessorIds?.groupIds ??
          [];

        // limit=0 returns just users.total without loading user objects
        const groupTotals = await Promise.all(
          groupIds.map(async (gid) => {
            try {
              const r = await fetch(`${staffbaseUrl}/api/groups/${gid}?limit=0`, auth);
              if (!r.ok) return 0;
              const g = await r.json();
              return g.users?.total ?? 0;
            } catch {
              return 0;
            }
          })
        );

        return {
          id: channelId,
          name,
          approximateRecipients: groupTotals.reduce((s, n) => s + n, 0),
        };
      })
    );

    channels.sort((a, b) => a.name.localeCompare(b.name));
    res.status(200).json({ channels });
  } catch (err) {
    res.status(502).json({ error: `Request failed: ${err.message}` });
  }
}
