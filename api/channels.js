/**
 * POST /api/channels
 * Body: { staffbaseUrl, apiToken }
 *
 * Discovers all news channel installations and returns each one with
 * an approximate recipient count (sum of group user totals).
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { staffbaseUrl, apiToken } = req.body ?? {};

  if (!staffbaseUrl || !apiToken) {
    return res.status(400).json({ error: "staffbaseUrl and apiToken are required" });
  }

  const auth = { headers: { Authorization: `Basic ${apiToken}` } };

  try {
    const searchRes = await fetch(
      `${staffbaseUrl}/api/plugins/news/installations/search?limit=100&permission=view`,
      auth
    );

    if (!searchRes.ok) {
      return res.status(searchRes.status).json({
        error: `Staffbase returned ${searchRes.status}. Check that your API token has branch-level read access.`,
      });
    }

    const searchBody    = await searchRes.json();
    const installations = searchBody.data ?? searchBody ?? [];

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

        // limit=0 fetches only the total count, no user objects
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
