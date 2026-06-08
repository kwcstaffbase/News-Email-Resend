import { beforeAll, expect, mock, test } from "bun:test";

// Mock private package and DB before app is loaded
mock.module("@staffbase/staffbase-plugin-sdk", () => ({
  sso: class MockSSOToken {
    getRole() {
      return "user";
    }
  },
}));

mock.module("../db/client.ts", () => ({ db: {} }));

let app: any;

beforeAll(async () => {
  app = (await import("../app.ts")).app;
});

test("GET /health returns 200 with status ok", async () => {
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  const data = (await res.json()) as { status: string; timestamp: string };
  expect(data.status).toBe("ok");
  expect(typeof data.timestamp).toBe("string");
});
