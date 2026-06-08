import { Hono } from "hono";
import { createLogger } from "../lib/logger.ts";
import { deleteSessionsByStaffbaseHash } from "../lib/sessions.ts";
import { extractTraceHeaders, getInstanceSettings, staffbaseFetch } from "../lib/staffbase-api.ts";
import { refreshSingleUser } from "../lib/user-cache.ts";
import { extractSidClaim, requireEditor, ssoMiddleware } from "../middleware/sso.ts";
import type { AppEnv } from "../types/hono.ts";

function isLocalDev(): boolean {
  return Bun.env.IS_LOCALDEV === "true";
}
const usersLogger = createLogger("users");

export const usersRoute = new Hono<AppEnv>();

usersRoute.use(ssoMiddleware);

// Normalized user shape returned to the client (flat, no {value,source} envelopes)
interface NormalizedUser {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  externalId?: string;
  userName?: string;
}

// Raw Staffbase API user shape (as documented in userapi.yaml)
interface StaffbaseUser {
  id: string;
  externalId?: string;
  email?: { value: string; source: string };
  userName?: { value: string; source: string };
  profile?: Record<string, string>;
}

interface StaffbaseSearchResponse {
  total: number;
  entries?: { data: StaffbaseUser }[];
}

function normalizeUser(u: StaffbaseUser): NormalizedUser {
  return {
    id: u.id,
    firstName: u.profile?.firstName,
    lastName: u.profile?.lastName,
    email: u.email?.value,
    externalId: u.externalId,
    userName: u.userName?.value,
  };
}

// Mock data matches the normalized shape (same as production output)
// Local-dev mock with optional status for testing status-filter behaviour
type MockUser = NormalizedUser & {
  status?: "activated" | "pending" | "deactivated" | "contact";
};

const MOCK_USERS: MockUser[] = [
  {
    id: "697129b76c1b2c5885fe0721",
    email: "simple.user@example.com",
  },
  {
    id: "694112534ef3743860fd1861",
    userName: "support-bot",
    email: "support@example.com",
    externalId: "support-bot",
  },
  {
    id: "68fab3aa0ba30a2e985fbd18",
    externalId: "user-private-42",
    status: "contact",
  },
  {
    id: "684c1790559c251841824ed4",
    firstName: "Robert",
    lastName: "Fritzsche",
    userName: "r.fritzsche",
    externalId: "r.fritzsche@example.com",
  },
  {
    id: "677d326195b95b4657b35c17",
    firstName: "Maik",
    email: "m.hofmann@example.com",
  },
  {
    id: "6729c5cbc7fbc725c17fad1e",
    firstName: "Michael",
    lastName: "Krug",
    externalId: "m.krug@example.com",
  },
  {
    id: "6729c5b2e4a81b235b4e3ed5",
    firstName: "Matthias",
    externalId: "matthias-7f3a",
  },
  {
    id: "66f2bf4bda7f000dfe9273ee",
    email: "teams-connector@example.com",
    externalId: "teams-connector@example.com",
    status: "deactivated",
  },
  {
    id: "66dede211e264b51bd7e813e",
    firstName: "Maciej",
    lastName: "Nepelski",
    email: "m.nepelski@example.com",
  },
  {
    id: "66dec8e65f7f996a66c82e6c",
    firstName: "Ruud",
    lastName: "Brok",
    email: "r.brok@example.com",
  },
  {
    id: "663a4912cea1803b5a4c4a9a",
    firstName: "Max",
    email: "max.dev@example.com",
    externalId: "max.dev@example.com",
  },
  {
    id: "663a4911b5d3e17064837ff7",
    firstName: "Amit",
    email: "amit.dev@example.com",
    externalId: "amit.dev@example.com",
  },
  {
    id: "65a4ca0c5d531d0e1519a204",
    lastName: "Mustermann",
    userName: "t.mustermann",
    email: "t.mustermann@example.com",
    externalId: "t.mustermann@example.com",
  },
  {
    id: "65a4ca0c5d531d0e1519a202",
    lastName: "Mustermann",
    userName: "m.mustermann",
    email: "m.mustermann@example.com",
    externalId: "m.mustermann@example.com",
  },
  {
    id: "65812099a175c00c91282e1a",
    firstName: "Arbli",
    email: "arbli@example.com",
  },
];

const ACCEPT_HEADER = "application/vnd.staffbase.accessors.users-search.v1+json";

async function fetchUsers(
  path: string,
  instanceUrl: string,
  token: string,
  instanceId: string,
  traceHeaders: Record<string, string>
): Promise<StaffbaseUser[]> {
  let res: Response;
  try {
    res = await staffbaseFetch(path, instanceUrl, token, {
      headers: { Accept: ACCEPT_HEADER, ...traceHeaders },
    });
  } catch (err) {
    usersLogger.warn("Upstream fetch failed.", {
      instanceId,
      message: (err as Error).message,
    });
    return [];
  }
  if (!res.ok) {
    usersLogger.warn("Upstream error.", {
      instanceId,
      "http.response.status_code": res.status,
      "url.path": path,
    });
    return [];
  }
  const body: StaffbaseSearchResponse = await res.json();
  return (body.entries ?? []).map((e) => e.data);
}

usersRoute.get("/search", requireEditor, async (c) => {
  const query = c.req.query("query") ?? "";
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") ?? "10")));

  const { instanceId } = c.var.user;
  const { staffbaseUrl, apiToken: token } = await getInstanceSettings(instanceId);

  // Local dev mock — used when upstream is not fully configured
  if (isLocalDev() && !token) {
    const q = query.toLowerCase();
    const isActive = (u: MockUser) =>
      u.status === undefined || u.status === "activated" || u.status === "pending";
    const filtered = MOCK_USERS.filter(
      (u) =>
        isActive(u) &&
        (q.length === 0 ||
          u.firstName?.toLowerCase().includes(q) ||
          u.lastName?.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q) ||
          u.externalId?.toLowerCase().includes(q) ||
          u.userName?.toLowerCase().includes(q) ||
          u.id === q)
    );
    const sliced = filtered.slice(0, limit);

    return c.json({
      total: filtered.length,
      entries: sliced.map((u) => ({ data: u })),
    });
  }

  if (!token) {
    return c.json({ error: "API token is not configured" }, 503);
  }

  const instanceUrl = staffbaseUrl ?? "";
  const term = query.trim();
  const traceHeaders = extractTraceHeaders(c.req.raw);

  // Only return activated/pending users — exclude contact and deactivated.
  const STATUS_FILTER = `staffbase.status eq "activated" or staffbase.status eq "pending"`;

  let users: StaffbaseUser[];

  if (term.length === 0) {
    // Empty query — fetch most recent active users
    users = await fetchUsers(
      `/api/users/search?limit=${limit}&includeProfile=true&filter=${encodeURIComponent(STATUS_FILTER)}`,
      instanceUrl,
      token,
      instanceId,
      traceHeaders
    );
  } else {
    // Fan-out parallel requests with a clean separation of concerns:
    //  A) query= — case-insensitive full-text search over profile fields
    //             (firstName, lastName, etc.) combined with the status filter.
    //  B) SCIM filter= — email, externalId, userName identifiers ANDed with status.
    //  C) For multi-word input (e.g. "John Smith"), also search each individual
    //             word via query= so cross-field name matches are not missed.
    const escaped = term.replaceAll('"', "");
    const scimFilter = `(emails co "${escaped}" or externalId co "${escaped}" or userName co "${escaped}") and (${STATUS_FILTER})`;

    const requests: Promise<StaffbaseUser[]>[] = [
      // A) Full-text profile search with status filter
      fetchUsers(
        `/api/users/search?query=${encodeURIComponent(term)}&limit=${limit}&includeProfile=true&filter=${encodeURIComponent(STATUS_FILTER)}`,
        instanceUrl,
        token,
        instanceId,
        traceHeaders
      ),
      // B) Identifier SCIM filter (email / externalId / userName) with status
      fetchUsers(
        `/api/users/search?filter=${encodeURIComponent(scimFilter)}&limit=${limit}&includeProfile=true`,
        instanceUrl,
        token,
        instanceId,
        traceHeaders
      ),
    ];

    // C) Multi-word: search each individual word so "John Smith" can match
    //    firstName="John" and lastName="Smith" in separate query passes.
    const words = term.split(/\s+/).filter((w) => w.length >= 2);
    if (words.length > 1) {
      for (const w of words) {
        requests.push(
          fetchUsers(
            `/api/users/search?query=${encodeURIComponent(w)}&limit=${limit}&includeProfile=true&filter=${encodeURIComponent(STATUS_FILTER)}`,
            instanceUrl,
            token,
            instanceId,
            traceHeaders
          )
        );
      }
    }

    // Merge and deduplicate by id
    const seen = new Set<string>();
    users = [];
    for (const u of (await Promise.all(requests)).flat()) {
      if (!seen.has(u.id)) {
        seen.add(u.id);
        users.push(u);
      }
    }
  }

  const normalized = users.slice(0, limit).map(normalizeUser);

  return c.json({
    total: normalized.length,
    entries: normalized.map((u) => ({ data: u })),
  });
});

// DELETE /api/users/session
// Called by the Staffbase backend (InvalidateSessionJob) when a user's session is destroyed.
// Authenticates via ?jwt= query param (SSO token generated by ssoFacade.tokenForPlugin).
// The token is anonymous — `sub` is empty; only `instance_id` and the `sid` claim are present.
// `sid` is createHash(userId + installationId + sessionId) and is stored in the sessions table
// as staffbase_session_hash. We locate and delete all matching rows by (instance_id, hash).
// Returns HTTP 200 — InvalidateSessionJob throws ServiceFailedException on any other status.
usersRoute.delete("/session", async (c) => {
  const { instanceId } = c.var.user;
  const staffbaseHash = extractSidClaim(c.var.rawToken);
  if (!staffbaseHash) {
    usersLogger.warn("Session invalidation: sid claim missing from token.", { instanceId });
    return c.text("OK");
  }
  const deleted = await deleteSessionsByStaffbaseHash(staffbaseHash, instanceId);
  usersLogger.info("Session invalidated.", { instanceId, staffbaseHash, deleted });
  return c.text("OK");
});

// DELETE /api/users/:userId/cache
// Editor-only escape hatch: re-fetches the target user from the Staffbase API
// and updates (or removes) that user's row in the local cache immediately,
// without waiting for the next background refresh cycle.
//
// In IS_LOCALDEV mode without configured upstream credentials the endpoint
// no-ops successfully — this mirrors the `/search` fallback and allows the
// admin UI's "Refresh" affordance to be exercised without a real Staffbase
// tenant.
usersRoute.delete("/:userId/cache", requireEditor, async (c) => {
  const { instanceId } = c.var.user;
  const { userId } = c.req.param();

  if (isLocalDev()) {
    const { apiToken } = await getInstanceSettings(instanceId);
    if (!apiToken) {
      usersLogger.info("Manual cache refresh skipped (localdev, no API token).", {
        userId,
        instanceId,
      });
      return c.json({ outcome: "refreshed" });
    }
  }

  try {
    const outcome = await refreshSingleUser(userId, instanceId);
    usersLogger.info("Manual cache refresh triggered.", {
      event: "cache.invalidate.single",
      userId,
      instanceId,
      outcome,
    });
    return c.json({ outcome });
  } catch (err) {
    usersLogger.error("Manual cache refresh failed.", {
      event: "cache.invalidate.single",
      userId,
      instanceId,
      message: (err as Error).message,
    });
    return c.json({ error: (err as Error).message }, 500);
  }
});
