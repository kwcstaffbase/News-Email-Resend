/**
 * Regression tests for the route-bucketing logic in
 * `server/src/middleware/access-log.ts`.
 *
 * Bounds the `path` label cardinality on `http_requests_total`. Without
 * `bucketRouteLabel`, every distinct URI (dynamic IDs, scanner-crafted
 * paths, hashed asset names) becomes its own time series. The fix in
 * PR #81 maps matched Hono routes to their pattern (e.g.
 * `/api/installations/:id`) and unmatched paths into a small set of
 * coarse buckets (`/assets/*`, `/widget/*`, `/api/*`, `/other`).
 */

import { describe, expect, test } from "bun:test";
import {
  bucketRouteLabel,
  hasUserContext,
  shouldSilenceAccessLog,
} from "../middleware/access-log.ts";

describe("bucketRouteLabel — matched routes", () => {
  test("returns the matched Hono pattern verbatim", () => {
    expect(bucketRouteLabel("/api/apps", "/api/apps")).toBe("/api/apps");
    expect(
      bucketRouteLabel("/api/apps/:id", "/api/apps/489cac04-adc9-46ec-9138-c13fe65c1dd8")
    ).toBe("/api/apps/:id");
    expect(bucketRouteLabel("/api/installations/:id", "/api/installations/abc")).toBe(
      "/api/installations/:id"
    );
    expect(bucketRouteLabel("/api/widget/catalog", "/api/widget/catalog")).toBe(
      "/api/widget/catalog"
    );
  });

  test("dynamic IDs in matched routes don't leak as raw labels", () => {
    const ids = [
      "489cac04-adc9-46ec-9138-c13fe65c1dd8",
      "deb75764-926e-4777-a98d-c30dc7bc6c4e",
      "e7319c49-69f0-46a1-a1ed-8b2a32587319",
    ];
    const labels = ids.map((id) => bucketRouteLabel("/api/favorites/:id", `/api/favorites/${id}`));
    // All three UUIDs collapse to the same label.
    expect(new Set(labels).size).toBe(1);
    expect(labels[0]).toBe("/api/favorites/:id");
  });
});

describe("bucketRouteLabel — unmatched paths", () => {
  test("falls back to /assets/* for /assets prefix", () => {
    expect(bucketRouteLabel(null, "/assets/index-DumW2mKV.css")).toBe("/assets/*");
    expect(bucketRouteLabel(undefined, "/assets/main-abc123.js")).toBe("/assets/*");
    expect(bucketRouteLabel("/*", "/assets/anything")).toBe("/assets/*");
  });

  test("falls back to /widget/* for /widget prefix", () => {
    expect(bucketRouteLabel(null, "/widget/staffbase.applaunchpad-favorites.min.js")).toBe(
      "/widget/*"
    );
    expect(bucketRouteLabel("/*", "/widget/whatever")).toBe("/widget/*");
  });

  test("falls back to /api/* for unmatched /api routes", () => {
    expect(bucketRouteLabel(null, "/api/some-future-route")).toBe("/api/*");
    expect(bucketRouteLabel("/*", "/api/version-2/things")).toBe("/api/*");
  });

  test("falls back to /other for everything else (incl. scanner garbage)", () => {
    expect(bucketRouteLabel(null, "/")).toBe("/other");
    expect(bucketRouteLabel(null, "/random")).toBe("/other");
    expect(bucketRouteLabel(null, "/.env")).toBe("/other");
    expect(bucketRouteLabel(null, "/wp-login.php")).toBe("/other");
    // Scanner-crafted URI containing characters that would otherwise pollute
    // the label set. After bucketing, it collapses to /other.
    expect(bucketRouteLabel(null, '/foo",le="+Inf"} 1\n# evil_metric{x="1"}')).toBe("/other");
  });
});

describe("bucketRouteLabel — cardinality bound", () => {
  test("100 distinct unmatched URIs collapse to ≤ 4 bucket labels", () => {
    const buckets = new Set<string>();
    for (let i = 0; i < 50; i++) {
      buckets.add(bucketRouteLabel(null, `/assets/hash-${i}.js`));
      buckets.add(bucketRouteLabel(null, `/widget/v${i}.js`));
      buckets.add(bucketRouteLabel(null, `/api/unknown/${i}`));
      buckets.add(bucketRouteLabel(null, `/scanner-${i}`));
    }
    expect(buckets.size).toBeLessThanOrEqual(4);
    expect(buckets).toEqual(new Set(["/assets/*", "/widget/*", "/api/*", "/other"]));
  });
});

/**
 * Scanner-noise carve-out. Bounds access-log volume by dropping log
 * lines for anonymous 4xx hits on the `/other` bucket. Documented in
 * docs/reference/log-catalog.md → "What to silence and how".
 */
describe("shouldSilenceAccessLog — scanner noise", () => {
  test("drops anonymous 4xx on /other when flag enabled", () => {
    expect(shouldSilenceAccessLog(404, "/other", false, true)).toBe(true);
    expect(shouldSilenceAccessLog(401, "/other", false, true)).toBe(true);
    expect(shouldSilenceAccessLog(403, "/other", false, true)).toBe(true);
    expect(shouldSilenceAccessLog(499, "/other", false, true)).toBe(true);
  });

  test("keeps real-handler 4xx (route bucket is NOT /other)", () => {
    expect(shouldSilenceAccessLog(404, "/api/apps/:id", false, true)).toBe(false);
    expect(shouldSilenceAccessLog(401, "/api/*", false, true)).toBe(false);
    expect(shouldSilenceAccessLog(403, "/api/admin", false, true)).toBe(false);
    expect(shouldSilenceAccessLog(400, "/api/items", false, true)).toBe(false);
    expect(shouldSilenceAccessLog(404, "/assets/*", false, true)).toBe(false);
    expect(shouldSilenceAccessLog(404, "/widget/*", false, true)).toBe(false);
  });

  test("keeps requests with a populated SSO user (real session)", () => {
    expect(shouldSilenceAccessLog(401, "/other", true, true)).toBe(false);
    expect(shouldSilenceAccessLog(404, "/other", true, true)).toBe(false);
  });

  test("never drops 2xx / 3xx / 5xx — only 4xx is scanner noise", () => {
    expect(shouldSilenceAccessLog(200, "/other", false, true)).toBe(false);
    expect(shouldSilenceAccessLog(204, "/other", false, true)).toBe(false);
    expect(shouldSilenceAccessLog(301, "/other", false, true)).toBe(false);
    expect(shouldSilenceAccessLog(500, "/other", false, true)).toBe(false);
    expect(shouldSilenceAccessLog(503, "/other", false, true)).toBe(false);
  });

  test("flag off ⇒ never silences", () => {
    expect(shouldSilenceAccessLog(404, "/other", false, false)).toBe(false);
    expect(shouldSilenceAccessLog(401, "/other", false, false)).toBe(false);
  });
});

/**
 * Regression coverage for the deleted-user scrub path. `gateAccessor()`
 * in `sso.ts` clears `c.var.user.userId` to "" on the `user_deleted`
 * rejection while keeping `instanceId` / `role` populated. The silence
 * gate's `hasUser` input must be derived from this helper, not from
 * `userId`, so a deleted-user 4xx /other never gets misclassified as
 * anonymous scanner noise and silenced.
 */
describe("hasUserContext — auth context detection", () => {
  test("anonymous request (no ssoUser) → false", () => {
    expect(hasUserContext(undefined)).toBe(false);
  });

  test("authenticated real user → true", () => {
    expect(hasUserContext({ userId: "abc", instanceId: "x", role: "editor" })).toBe(true);
  });

  test("deleted-user scrub (userId blanked, instanceId kept) → true", () => {
    // Mirrors gateAccessor()'s c.set("user", { ...existing, userId: "" })
    // on the user_deleted path. Must still count as authenticated.
    expect(hasUserContext({ userId: "", instanceId: "x", role: "editor" })).toBe(true);
  });

  test("missing instanceId → false (treat as anonymous)", () => {
    expect(hasUserContext({ userId: "abc" })).toBe(false);
    expect(hasUserContext({ instanceId: "" })).toBe(false);
  });
});
