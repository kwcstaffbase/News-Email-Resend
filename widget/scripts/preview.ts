#!/usr/bin/env bun
/**
 * widget/scripts/preview.ts — standalone local preview server for the widget.
 *
 * Serves widget/preview/index.html on http://localhost:5174 with a freshly
 * built widget bundle at /widget/bundle.js. Watches src/ and rebuilds on
 * change.
 *
 * Run: bun run preview  (scripts entry in widget/package.json)
 */

import { watch } from "node:fs";
import { resolve } from "node:path";

const widgetDir = resolve(import.meta.dir, "..");
const previewHtml = Bun.file(resolve(widgetDir, "preview/index.html"));
const bundlePath = resolve(widgetDir, "dist/staffbase.plugin-template-widget.min.js");

const PORT = Number.parseInt(process.env["PREVIEW_PORT"] ?? "5174", 10);

// ── Build pipeline ───────────────────────────────────────────────────────────

async function rebuild(reason: string): Promise<void> {
  const started = Date.now();
  process.stdout.write(`[preview] rebuild (${reason})…\n`);
  const proc = Bun.spawn({
    cmd: ["bun", "scripts/build.ts"],
    cwd: widgetDir,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.stderr.write(`[preview] build failed (exit ${code})\n`);
    return;
  }
  process.stdout.write(`[preview] rebuilt in ${Date.now() - started}ms\n`);
}

await rebuild("initial");

// Debounce — fs.watch fires bursts for editor saves.
let watchTimer: ReturnType<typeof setTimeout> | null = null;
watch(resolve(widgetDir, "src"), { recursive: true }, (_event, filename) => {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    void rebuild(`src/${filename ?? "?"}`);
  }, 150);
});

// ── Server ───────────────────────────────────────────────────────────────────

function cors(headers: HeadersInit = {}): HeadersInit {
  return {
    ...headers,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(await previewHtml.text(), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    if (url.pathname === "/widget/bundle.js") {
      const file = Bun.file(bundlePath);
      if (!(await file.exists())) {
        return new Response("// bundle not built yet", {
          status: 503,
          headers: { "Content-Type": "application/javascript" },
        });
      }
      return new Response(file, {
        headers: cors({
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-cache",
        }),
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

process.stdout.write(
  `\n[preview] serving at http://localhost:${server.port}\n` +
    `[preview] watching ${resolve(widgetDir, "src")}\n\n`
);
