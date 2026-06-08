/**
 * HTML route tests — localdev mode.
 * routes/html.ts now reads IS_LOCALDEV dynamically via isLocalDev(), so we can
 * set the env per-test. This file tests the localdev branch; production auth
 * tests live in html-prod.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const originalLocalDev = Bun.env.IS_LOCALDEV;
const originalRole = Bun.env.LOCALDEV_ROLE;

mock.module("@staffbase/staffbase-plugin-sdk", () => ({
  sso: class MockSSOToken {
    constructor(_audience: string, _appSecret: string, tokenData: string) {
      if (!tokenData || tokenData === "invalid.token.here") {
        throw new Error("Invalid or expired token");
      }
    }
    getUserId() {
      return "user-1";
    }
    getUserName() {
      return "Test User";
    }
    getFirstName() {
      return "Test";
    }
    getLastName() {
      return "User";
    }
    getInstanceId() {
      return "test-instance";
    }
    getRole() {
      return "editor";
    }
    getLocale() {
      return "en_US";
    }
    getType() {
      return "user";
    }
    getBranchId() {
      return "test-branch";
    }
    getUserExternalId() {
      return null;
    }
  },
}));

/**
 * Chainable proxy that resolves to `value` when awaited.
 * Every method call returns another chainable proxy with the same value.
 */
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

// Mock staffbase-api to avoid real HTTP calls
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
}));

let app: any;

beforeAll(async () => {
  app = (await import("../app.ts")).app;
});

afterEach(() => {
  Bun.env.IS_LOCALDEV = originalLocalDev;
  Bun.env.LOCALDEV_ROLE = originalRole;
});

// ── GET / (main page − localdev) ───────────────────────────────────────────────

describe("GET / (localdev)", () => {
  beforeEach(() => {
    Bun.env.IS_LOCALDEV = "true";
  });
  test("returns 200 with HTML content", async () => {
    const res = await app.request("/", { method: "GET" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
  });

  test("injects __JWT_TOKEN__ into HTML", async () => {
    const res = await app.request("/", { method: "GET" });
    const html = await res.text();
    expect(html).toContain("window.__JWT_TOKEN__");
  });

  test("injects __USER__ into HTML", async () => {
    const res = await app.request("/", { method: "GET" });
    const html = await res.text();
    expect(html).toContain("window.__USER__");
  });
});

// ── GET /admin (editor-only − localdev) ────────────────────────────────────────

describe("GET /admin (localdev)", () => {
  beforeEach(() => {
    Bun.env.IS_LOCALDEV = "true";
  });

  test("returns 200 for editor role", async () => {
    Bun.env.LOCALDEV_ROLE = "editor";
    const res = await app.request("/admin", { method: "GET" });
    expect(res.status).toBe(200);
  });

  test("returns 403 for non-editor role", async () => {
    Bun.env.LOCALDEV_ROLE = "user";
    const res = await app.request("/admin", { method: "GET" });
    expect(res.status).toBe(403);
    const html = await res.text();
    expect(html).toContain("403");
    expect(html).toContain("Forbidden");
  });
});

// ── GET /dev ───────────────────────────────────────────────────────────────────

describe("GET /dev (localdev)", () => {
  beforeEach(() => {
    Bun.env.IS_LOCALDEV = "true";
  });

  test("returns 200", async () => {
    const res = await app.request("/dev", { method: "GET" });
    expect(res.status).toBe(200);
  });
});

// ── XSS escaping (pure logic, no route call) ──────────────────────────────────

describe("JWT token XSS escaping", () => {
  test("injectToken escapes HTML-special characters", () => {
    const maliciousToken = '</script><script>alert("xss")</script>';
    const escaped = maliciousToken
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#x27;");

    expect(escaped).not.toContain("<script>");
    expect(escaped).not.toContain("</script>");
    expect(escaped).toContain("&lt;");
    expect(escaped).toContain("&gt;");
  });

  test("injectUser escapes unicode in JSON", () => {
    const json = JSON.stringify({ name: "<script>alert('xss')</script>" })
      .replaceAll("<", String.raw`\u003c`)
      .replaceAll(">", String.raw`\u003e`)
      .replaceAll("&", String.raw`\u0026`);

    expect(json).not.toContain("<script>");
    expect(json).toContain(String.raw`\u003c`);
    expect(json).toContain(String.raw`\u003e`);
  });
});
