/**
 * HTML route tests — production mode (IS_LOCALDEV is NOT "true").
 * routes/html.ts reads IS_LOCALDEV dynamically via isLocalDev(). We set env
 * per-test in beforeEach.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const originalLocalDev = Bun.env.IS_LOCALDEV;

mock.module("@staffbase/staffbase-plugin-sdk", () => ({
  sso: class MockSSOToken {
    constructor(_audience: string, _appSecret: string, tokenData: string) {
      if (!tokenData || tokenData === "invalid.token.here") {
        throw new Error("Invalid or expired token");
      }
    }
    getTokenData() {
      return {
        getUserId: () => "user-1",
        getFullName: () => "Test User",
        getFirstName: () => "Test",
        getLastName: () => "User",
        getInstanceId: () => "test-instance",
        getRole: () => "editor",
        getLocale: () => "en_US",
        getType: () => "user",
        getBranchId: () => "test-branch",
        getUserExternalId: () => null,
        getUserUsername: () => "testuser",
      };
    }
  },
}));

// JWT whose payload decodes to {"issuer_domain":"company.staffbase.com"} — used
// in the dynamic CSP test.  The SDK mock accepts any non-empty, non-"invalid" token.
const JWT_WITH_ISSUER = `header.${btoa(JSON.stringify({ issuer_domain: "company.staffbase.com" })).replaceAll("=", "")}.sig`;

// JWT for a customer-owned subdomain (non-staffbase.com apex).
const JWT_WITH_CUSTOMER_ISSUER = `header.${btoa(JSON.stringify({ issuer_domain: "myapp.mydomain.com" })).replaceAll("=", "")}.sig`;

function chainResult(value: unknown): unknown {
  const promise = Promise.resolve(value);
  return new Proxy(promise as object, {
    get(target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        return (target as any)[prop].bind(target);
      }
      return () => chainResult(value);
    },
  });
}

mock.module("../db/client.ts", () => ({
  db: {
    select: () => chainResult([]),
    selectDistinctOn: () => chainResult([]),
    insert: () => chainResult([{ id: "test-session-id" }]),
    update: () => chainResult([]),
    delete: () => chainResult([]),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: () => chainResult([]),
        delete: () => chainResult([]),
        update: () => chainResult([]),
      };
      return cb(tx);
    },
  },
}));

mock.module("../lib/staffbase-api.ts", () => ({
  upsertStaffbaseUrl: () => Promise.resolve(),
  staffbaseFetch: () => Promise.resolve(new Response("ok")),
  getApiToken: () => Promise.resolve(null),
  getInstanceSettings: () => Promise.resolve(null),
  extractTraceHeaders: () => ({}),
}));

const minimalHtml = "<!DOCTYPE html><html><head></head><body></body></html>";
mock.module("../html.ts", () => ({
  readIndexHtml: () => Promise.resolve(minimalHtml),
  readCustomerTheme: () => Promise.resolve(null),
  readCustomerI18n: () => Promise.resolve(null),
  injectTheme: (html: string, _css: string) => html,
  injectToken: (html: string, token: string) => {
    const escaped = token
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#x27;");
    return html.replace("</head>", `<script>window.__JWT_TOKEN__ = "${escaped}";</script></head>`);
  },
  injectUser: (html: string, user: unknown) => {
    const json = JSON.stringify(user)
      .replaceAll("<", String.raw`\u003c`)
      .replaceAll(">", String.raw`\u003e`)
      .replaceAll("&", String.raw`\u0026`);
    return html.replace("</head>", `<script>window.__USER__ = ${json};</script></head>`);
  },
  injectSessionKey: (html: string, key: string) => {
    return html.replace("</head>", `<script>window.__SESSION_KEY__ = "${key}";</script></head>`);
  },
  buildFrameAncestors: (issuerDomain: string | null | undefined) => {
    if (issuerDomain) {
      const safe = issuerDomain.replaceAll(/[^a-zA-Z0-9.-]/g, "");
      if (safe.length > 0) {
        const labels = safe.split(".");
        const parent = labels.length >= 3 ? labels.slice(1).join(".") : safe;
        const httpsOrigins =
          parent === safe ? `https://${safe}` : `https://${parent} https://${safe}`;
        return `frame-ancestors 'self' ${httpsOrigins} http://staffbase.com capacitor://${parent} capacitor://staffbase.com https://localhost`;
      }
    }
    return "frame-ancestors 'self' https://*.staffbase.com https://*.staffbase.dev https://*.staffbase.rocks http://staffbase.com capacitor://staffbase.com https://localhost";
  },
}));

let app: any;

beforeAll(async () => {
  app = (await import("../app.ts")).app;
});

afterEach(() => {
  Bun.env.IS_LOCALDEV = originalLocalDev;
});

// ── Production mode: JWT is required ───────────────────────────────────────────

describe("HTML routes (production mode)", () => {
  beforeEach(() => {
    Bun.env.IS_LOCALDEV = "false";
  });

  test("GET / returns 401 without JWT", async () => {
    const res = await app.request("/", { method: "GET" });
    expect(res.status).toBe(401);
    const html = await res.text();
    expect(html).toContain("401");
  });

  test("GET /admin returns 401 without JWT", async () => {
    const res = await app.request("/admin", { method: "GET" });
    expect(res.status).toBe(401);
  });

  test("GET / with valid JWT returns 200", async () => {
    const res = await app.request("/?jwt=valid.test.token", { method: "GET" });
    expect(res.status).toBe(200);
  });

  test("GET /admin with valid JWT (editor role) returns 200", async () => {
    const res = await app.request("/admin?jwt=valid.test.token", {
      method: "GET",
    });
    expect(res.status).toBe(200);
  });

  test("GET / with invalid JWT returns 401", async () => {
    const res = await app.request("/?jwt=invalid.token.here", {
      method: "GET",
    });
    expect(res.status).toBe(401);
  });

  test("GET /dev returns 404 in production", async () => {
    const res = await app.request("/dev", { method: "GET" });
    expect(res.status).toBe(404);
  });

  test("GET / with Staffbase-hosted issuer_domain returns full CSP frame-ancestors", async () => {
    // company.staffbase.com → parent staffbase.com
    const res = await app.request(`/?jwt=${JWT_WITH_ISSUER}`, { method: "GET" });
    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toContain("frame-ancestors");
    expect(csp).toContain("https://staffbase.com"); // appdomain (parent)
    expect(csp).toContain("https://company.staffbase.com"); // appURL (issuer)
    expect(csp).toContain("http://staffbase.com"); // platform literal
    expect(csp).toContain("capacitor://staffbase.com"); // native + platform literal
    expect(csp).toContain("https://localhost"); // local dev
  });

  test("GET / with customer-subdomain issuer_domain returns full CSP frame-ancestors", async () => {
    // myapp.mydomain.com → parent mydomain.com
    const res = await app.request(`/?jwt=${JWT_WITH_CUSTOMER_ISSUER}`, { method: "GET" });
    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toContain("frame-ancestors");
    expect(csp).toContain("https://mydomain.com"); // appdomain (parent, https)
    expect(csp).toContain("https://myapp.mydomain.com"); // appURL (issuer, https)
    expect(csp).toContain("http://staffbase.com"); // platform literal
    expect(csp).toContain("capacitor://mydomain.com"); // appdomain on native
    expect(csp).toContain("capacitor://staffbase.com"); // platform native
    expect(csp).toContain("https://localhost"); // local dev
  });

  test("GET / without issuer_domain falls back to hardcoded Staffbase domains in CSP", async () => {
    // valid.test.token has no decodable payload → issuerDomain is null → fallback
    const res = await app.request("/?jwt=valid.test.token", { method: "GET" });
    expect(res.status).toBe(200);
    const csp = res.headers.get("Content-Security-Policy");
    expect(csp).toContain("frame-ancestors");
    expect(csp).toContain("*.staffbase.com");
    expect(csp).toContain("*.staffbase.dev");
    expect(csp).toContain("*.staffbase.rocks");
    expect(csp).toContain("http://staffbase.com"); // platform literal in fallback
    expect(csp).toContain("capacitor://staffbase.com"); // native in fallback
    expect(csp).toContain("https://localhost"); // local dev in fallback
  });

  test("GET / injects window.__SESSION_KEY__ into HTML", async () => {
    const res = await app.request("/?jwt=valid.test.token", { method: "GET" });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("window.__SESSION_KEY__");
  });
});
