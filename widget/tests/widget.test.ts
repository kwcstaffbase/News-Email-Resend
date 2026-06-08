import { describe, expect, mock, test } from "bun:test";
import widgetPkg from "../package.json" with { type: "json" };

// The widget bundle defines a custom element via globalThis.defineBlock at
// import time. The test simulates that contract and asserts the registered
// block definition shape.

// ── Mocks ──────────────────────────────────────────────────────────────────

await mock.module("virtual:widget-meta", () => ({
  widgetName: "cc-custom-plugin-template-widget",
  widgetLabel: "Plugin Template Widget",
  widgetAuthor: "Staffbase SE",
  widgetVersion: widgetPkg.version,
}));

// SVG is loaded via a Bun build plugin (.svg → base64 data URI). The test
// runner does not apply that plugin, so stub the import.
await mock.module("../assets/icon.svg", () => ({
  default: "data:image/svg+xml;base64,PHN2ZyAvPg==",
}));

declare global {
  // biome-ignore lint/style/noVar: required for typed `globalThis` augmentation
  var __captured: unknown;
}

describe("widget bundle", () => {
  test("imports without throwing and calls defineBlock once", async () => {
    globalThis.__captured = null;
    (globalThis as unknown as { defineBlock: (d: unknown) => void }).defineBlock = (d) => {
      globalThis.__captured = d;
    };

    await import("../src/widget.ts");

    const captured = globalThis.__captured as
      | {
          blockDefinition: { name: string; attributes: string[]; uiSchema?: unknown };
          version: string;
          author: string;
        }
      | null;
    expect(captured).not.toBeNull();
    expect(captured?.blockDefinition.name).toBe("plugin-template-widget");
    expect(Array.isArray(captured?.blockDefinition.attributes)).toBe(true);
    expect(captured?.blockDefinition.attributes).toContain("installation_id");
    expect(typeof captured?.version).toBe("string");
    expect(typeof captured?.author).toBe("string");
    // uiSchema must bind the installation_id field to a custom RJSF widget
    expect(captured?.blockDefinition.uiSchema).toBeTruthy();
  });
});
