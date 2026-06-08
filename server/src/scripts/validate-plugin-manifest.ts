#!/usr/bin/env bun
/**
 * Validate plugin.json against plugin.schema.json.
 * Runs in CI; exits 1 if the manifest is invalid.
 *
 * We use Zod (already a server dependency) to avoid pulling in a separate
 * JSON-schema library.  The Zod schema mirrors plugin.schema.json exactly.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

const ROOT = join(import.meta.dirname, "../../..");

const manifestSchema = z
  .object({
    $schema: z.string().optional(),
    _comment_pluginId: z.string().optional(),
    name: z.string().min(1),
    title: z.object({ en_US: z.string() }).passthrough(),
    description: z.string().optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    pluginId: z.string().optional(),
    entryPoints: z
      .object({
        frontend: z.string(),
        backoffice: z.string(),
        api: z.string(),
      })
      .passthrough(),
    permissions: z.array(z.string()).min(1),
    scopes: z.array(z.string()).min(1),
    storage: z
      .object({
        database: z.string().optional(),
        tables: z.array(z.string()).optional(),
      })
      .optional(),
    widgets: z
      .array(
        z.object({
          tagName: z.string(),
          title: z.string(),
          description: z.string().optional(),
          module: z.string(),
          configAttributes: z.array(z.string()).optional(),
        })
      )
      .optional(),
    // .strict() so unknown top-level keys are rejected, mirroring
    // plugin.schema.json's root `additionalProperties: false`. Without this Zod
    // strips extra keys and would pass manifests the JSON schema rejects.
  })
  .strict();

const raw = JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8"));
const result = manifestSchema.safeParse(raw);

if (!result.success) {
  process.stderr.write("[validate-plugin-manifest] FAIL: plugin.json is invalid:\n");
  for (const issue of result.error.issues) {
    process.stderr.write(`  ${issue.path.join(".")} — ${issue.message}\n`);
  }
  process.exit(1);
}

console.log("[validate-plugin-manifest] plugin.json is valid.");
