#!/usr/bin/env bun

/**
 * Bun.build script for the Plugin Template widget.
 *
 * Produces:
 *   dist/staffbase.plugin-template-widget.min.js  — minified IIFE bundle
 *   dist/manifest.json                            — Staffbase Studio manifest
 *
 * Replace the bundle base name + manifest contents when forking this template
 * for a real plugin.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const widgetDir = resolve(import.meta.dir, "..");
const distDir = join(widgetDir, "dist");

// ── Read package metadata ────────────────────────────────────────────────────

const pkg = JSON.parse(await Bun.file(join(widgetDir, "package.json")).text()) as {
  name?: string;
  label?: string;
  version?: string;
};

const widgetName = pkg.name ?? "widget";
const widgetLabel = pkg.label ?? widgetName;
const widgetVersionBase = pkg.version ?? "0.0.0";

// Append the git short SHA as semver build metadata so Studio always treats
// each new commit as a distinct bundle version (cache-buster — does not
// affect version ordering).
const gitSha = (() => {
  try {
    const proc = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: widgetDir });
    if (proc.exitCode === 0) return proc.stdout.toString().trim();
  } catch {
    /* outside a git repo — fall back to timestamp */
  }
  return Date.now().toString(36);
})();
const widgetVersion = `${widgetVersionBase}+${gitSha}`;
const bundleBaseName = "staffbase.plugin-template-widget";

// ── Plugins ──────────────────────────────────────────────────────────────────

function createWidgetMetaPlugin() {
  return {
    name: "widget-meta",
    setup(build: { onResolve: Function; onLoad: Function }) {
      build.onResolve({ filter: /^virtual:widget-meta$/ }, () => ({
        path: "virtual:widget-meta",
        namespace: "widget-meta",
      }));
      build.onLoad({ filter: /.*/, namespace: "widget-meta" }, () => ({
        contents: [
          `export const widgetName = ${JSON.stringify(widgetName)};`,
          `export const widgetLabel = ${JSON.stringify(widgetLabel)};`,
          `export const widgetAuthor = "Staffbase SE";`,
          `export const widgetVersion = ${JSON.stringify(widgetVersion)};`,
        ].join("\n"),
        loader: "js" as const,
      }));
    },
  };
}

function createSvgBase64Plugin() {
  return {
    name: "svg-base64",
    setup(build: { onLoad: Function }) {
      build.onLoad({ filter: /\.svg$/ }, async (args: { path: string }) => {
        const raw = await Bun.file(args.path).text();
        const base64 = Buffer.from(raw).toString("base64");
        return {
          contents: `export default "data:image/svg+xml;base64,${base64}";`,
          loader: "js" as const,
        };
      });
    },
  };
}

// ── Build ────────────────────────────────────────────────────────────────────

await mkdir(distDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(widgetDir, "src/widget.ts")],
  outdir: distDir,
  target: "browser",
  format: "iife",
  minify: true,
  naming: `${bundleBaseName}.min.js`,
  plugins: [createWidgetMetaPlugin(), createSvgBase64Plugin()],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// ── Manifest ─────────────────────────────────────────────────────────────────

const manifest = {
  flag: {
    protected: true,
    title: widgetLabel,
    description:
      "Scaffolding widget for a Staffbase custom plugin. Replace the placeholder rendering in src/widget.ts with your plugin-specific UI.",
  },
  bundles: [
    {
      module: `${bundleBaseName}.min.js`,
      tagNames: ["plugin-template-widget"],
      attributes: ["installation_id"],
    },
  ],
};

await writeFile(join(distDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

console.log(`✓ ${bundleBaseName}.min.js  (${result.outputs[0]?.size ?? 0} bytes)`);
console.log("✓ manifest.json");
