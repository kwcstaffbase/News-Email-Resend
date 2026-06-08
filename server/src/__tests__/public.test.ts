import { afterAll, beforeAll, expect, mock, test } from "bun:test";

mock.module("@staffbase/staffbase-plugin-sdk", () => ({
  sso: class MockSSOToken {
    getRole() {
      return "user";
    }
  },
}));

function chainResult(value: unknown): unknown {
  const promise = Promise.resolve(value);
  return new Proxy(promise as object, {
    get(target, prop: string | symbol): unknown {
      const own = (target as Record<string | symbol, unknown>)[prop];
      if (own !== undefined) return typeof own === "function" ? own.bind(target) : own;
      return (..._args: unknown[]) => chainResult(value);
    },
  });
}

const mockInstances = [
  { instanceId: "inst-1", staffbaseUrl: "https://customer.staffbase.com" },
  { instanceId: "inst-2", staffbaseUrl: "https://other.staffbase.com" },
];

mock.module("../db/client.ts", () => ({
  db: {
    select: () => chainResult(mockInstances),
  },
}));

const originalPluginId = Bun.env.PLUGIN_ID;

let app: any;

beforeAll(async () => {
  Bun.env.PLUGIN_ID = "my-plugin-id";
  app = (await import("../app.ts")).app;
});

afterAll(() => {
  Bun.env.PLUGIN_ID = originalPluginId;
});

test("GET /api/public/instance returns pluginId and all instances", async () => {
  const res = await app.request("/api/public/instance");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    pluginId: string;
    instances: { instanceId: string; staffbaseUrl: string | null }[];
  };
  expect(body.pluginId).toBe("my-plugin-id");
  expect(body.instances).toHaveLength(2);
  expect(body.instances[0]).toEqual({
    instanceId: "inst-1",
    staffbaseUrl: "https://customer.staffbase.com",
  });
});

test("GET /api/public/instance sets CORS header allowing any origin", async () => {
  const res = await app.request("/api/public/instance", {
    headers: { Origin: "https://example.staffbase.com" },
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
});

test("OPTIONS /api/public/instance responds to preflight", async () => {
  const res = await app.request("/api/public/instance", {
    method: "OPTIONS",
    headers: {
      Origin: "https://example.staffbase.com",
      "Access-Control-Request-Method": "GET",
    },
  });
  expect(res.status).toBe(204);
});
