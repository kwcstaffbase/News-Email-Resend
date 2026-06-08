#!/usr/bin/env bun
/**
 * Migration validator — runs in CI before tests.
 *
 * Rule: every new `CREATE TABLE` statement in a migration SQL file must
 * include an `instance_id` column.  This enforces multi-tenant isolation by
 * construction: a missing `instance_id` means data would be shared across all
 * tenants and is almost certainly a bug.
 *
 * Explicit exemptions: add any join table (tenant isolation inherited via FK) here.
 *
 * Usage:
 *   bun src/scripts/validate-migrations.ts
 *
 * Exit 0 → all migrations valid.
 * Exit 1 → one or more violations found (error details printed to stderr).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Tables that are permitted to omit instance_id:
// - Join tables that inherit tenant isolation through FK cascade from parent tables.
const EXEMPT_TABLES = new Set<string>([]);

const MIGRATIONS_DIR = join(import.meta.dirname, "../db/migrations");

// Match CREATE TABLE (IF NOT EXISTS)? "tablename" or tablename
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|(\w+))\s*\(/gi;

let violations = 0;

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  const content = readFileSync(join(MIGRATIONS_DIR, file), "utf8");

  CREATE_TABLE_RE.lastIndex = 0;
  for (
    let match = CREATE_TABLE_RE.exec(content);
    match !== null;
    match = CREATE_TABLE_RE.exec(content)
  ) {
    const tableName = (match[1] ?? match[2]).toLowerCase();

    if (EXEMPT_TABLES.has(tableName)) continue;

    // Find the CREATE TABLE block: from the opening ( to the matching )
    const startIdx = match.index + match[0].length - 1; // start of the '('
    let depth = 0;
    let endIdx = startIdx;
    for (let i = startIdx; i < content.length; i++) {
      if (content[i] === "(") depth++;
      else if (content[i] === ")") {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }

    const tableBody = content.slice(startIdx, endIdx + 1);
    // Check for an instance_id column (quoted or unquoted)
    if (!/"?instance_id"?\s/i.test(tableBody)) {
      process.stderr.write(
        `[validate-migrations] FAIL: ${file} — table "${tableName}" is missing an instance_id column.\n` +
          `  Add "instance_id" text NOT NULL to enforce tenant isolation, or add "${tableName}" to EXEMPT_TABLES if it inherits isolation via FK.\n`
      );
      violations++;
    }
  }
}

if (violations > 0) {
  process.stderr.write(`\n[validate-migrations] ${violations} violation(s) found.\n`);
  process.exit(1);
}

console.log(`[validate-migrations] All ${files.length} migration file(s) passed.`);
