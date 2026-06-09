/**
 * GET /api/channels
 *
 * Discovers all news channel installations accessible via the API token,
 * then computes an approximate recipient count per channel by summing each
 * channel's group user totals.
 *
 * Returns:
 *   { channels: [{ id, name, approximateRecipients }] }
 *
 * "approximateRecipients" is the sum of users.total across all groups that
 * have access to the channel. It overcounts when users belong to multiple
 * groups, but is fast (no user enumeration) and sufficient for summary display.
 *
 * Required headers:
 *   x-staffbase-url    e.g. https://yourco.staffbase.com
 *   x-staffbase-token  Basic auth token
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const staffbaseUrl = req.headers["x-staffbase-url"];
  const apiToken = req.headers["x-staffbase-token"];

  if (!staffbaseUrl || !apiToken) {
    return res.status(400).json({ error: "x-staffbase-url and x-staffbase-token headers are required" });
  }

  const auth = { headers: { Authorization: `Basic ${apiToken}` } };

  try {
    // Discover all news installations the token has access to.
    // Tries the plugin installations search endpoint first.
    const searchRes = await fetch(
      `${staffbaseUrl}/api/plugins/news/installations/search?limit=100&permission=view`,
      auth
    );

    if (!searchRes.ok) {
      return res.status(searchRes.status).json({
        error: `Channel discovery failed (HTTP ${searchRes.status}). ` +
          "Ensure your API token has branch-level read access.",
      });
    }

    const searchBody = await searchRes.json();
    // Response shape: { data: [{ id, config: { localization: { en_US: { title } } }, accessors }] }
    const installations = searchBody.data ?? searchBody ?? [];

    // For each channel, compute approximate recipient count from group totals.
    // We fetch each channel's groups in parallel to keep latency down.
    const channels = await Promise.all(
      installations.map(async (inst) => {
        const channelId = inst.id;
        const localizations = inst.config?.localization ?? {};
        const title =
          Object.values(localizations).find((l) => l?.title)?.title ??
          inst.name ??
          channelId;

        // Pull group IDs from the installation's accessors (may already be embedded)
        const groupIds =
          inst.accessors?.groups?.data?.map((g) => g.id) ??
          inst.typedAccessorIds?.groupIds ??
          [];

        // Fetch group totals in parallel
        const groupTotals = await Promise.all(
          groupIds.map(async (gid) => {
            try {
              // limit=0 returns just the metadata (total) without loading user objects
              const r = await fetch(`${staffbaseUrl}/api/groups/${gid}?limit=0`, auth);
              if (!r.ok) return 0;
              const g = await r.json();
              return g.users?.total ?? 0;
            } catch {
              return 0;
            }
          })
        );

        const approximateRecipients = groupTotals.reduce((sum, n) => sum + n, 0);

        return { id: channelId, name: title, approximateRecipients };
      })
    );

    // Sort channels alphabetically for consistent display
    channels.sort((a, b) => a.name.localeCompare(b.name));

    res.status(200).json({ channels });
  } catch (err) {
    res.status(502).json({ error: `Request failed: ${err.message}` });
  }
}
