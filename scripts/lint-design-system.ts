#!/usr/bin/env bun
/**
 * scripts/lint-design-system.ts
 *
 * Enforce that the **admin** surfaces of the React client use Staffbase
 * design-system components (`@staffbase/design`) rather than raw HTML form
 * controls. The admin area is the most visible part of the plugin in Studio
 * and is where styling drift hurts the most: a native `<select>` next to a
 * design-system `Select` reads as broken UX even when functionally fine.
 *
 * Scope: every `.tsx`/`.ts` file under `client/src/components/admin/` and the
 * `client/src/pages/AdminView.tsx` entry point.
 *
 * Forbidden tags (with design-system replacements):
 *   <select>             →  Select.Root / SingleSelect / Searchable*Select
 *   <input type=checkbox> →  Checkbox / CheckboxGroup
 *   <input type=radio>    →  Radio / RadioGroup
 *   <input type=text|…>   →  TextField (or NumberStepper)
 *   <textarea>            →  TextArea
 *   <hr>                  →  Divider
 *
 * Plain `<input>` (without a recognised `type`) and `<button>` are NOT blocked
 * here — they appear inside design-system primitives (e.g. trailing-icon
 * buttons, custom Field.Root wrappers, hidden file inputs wrapped in accessible
 * drag-drop labels) and a blanket block would force gymnastics. If future drift
 * becomes a problem, extend RULES below.
 *
 * Comments and string literals are scrubbed before scanning so JSDoc /
 * documentation mentions of `<select>` don't trip the rule.
 *
 * Run: `bun scripts/lint-design-system.ts` (wired into `bun run check`).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

interface Rule {
  pattern: RegExp;
  /** Human-readable element name shown in the error. */
  name: string;
  /** Suggested replacement from `@staffbase/design`. */
  replacement: string;
}

/**
 * Each rule maps a native HTML element/input shape to the Staffbase
 * design-system component that should be used instead. Storybook is the
 * canonical reference: https://design.staffbase.rocks/
 *
 * Rules are intentionally selective: a blanket `<button>` / `<input>` ban
 * would force gymnastics around legitimate uses (trailing-icon buttons inside
 * Field.Root, hidden file inputs wrapped in accessible drag-drop labels,
 * `<a>` links with custom routing). Add only patterns where the design
 * system has a clear, drop-in replacement.
 */
const RULES: Rule[] = [
  {
    // `\b` so the pattern matches `<select>`, `<select\n`, `<select ...`, but
    // not React component names like `<SelectFoo>`.
    pattern: /<select\b/,
    name: "<select>",
    replacement: "Select.Root / SingleSelect / SearchableSingleSelect / SearchableMultiSelect",
  },
  {
    pattern: /<input\b[^>]*\stype=["']checkbox["']/,
    name: '<input type="checkbox">',
    replacement: "Checkbox / CheckboxGroup",
  },
  {
    pattern: /<input\b[^>]*\stype=["']radio["']/,
    name: '<input type="radio">',
    replacement: "Radio / RadioGroup",
  },
  {
    // Text-style inputs all map to the same `TextField` primitive in the DS.
    // Native `<input type="number">` would technically have NumberStepper as
    // an alternative; TextField with `type="number"` is also fine — both keep
    // the design tokens consistent vs. a bare native control.
    pattern: /<input\b[^>]*\stype=["'](?:text|email|url|search|tel|password|number)["']/,
    name: '<input type="text|email|url|search|tel|password|number">',
    replacement: "TextField (or NumberStepper for stepper UX)",
  },
  {
    pattern: /<textarea\b/,
    name: "<textarea>",
    replacement: "TextArea",
  },
  {
    pattern: /<hr\b/,
    name: "<hr>",
    replacement: "Divider",
  },
];

const SCAN_ROOTS = ["client/src/components/admin", "client/src/pages/AdminView.tsx"];

const SCAN_EXTENSIONS = [".tsx", ".ts"];

function walk(path: string, out: string[]): void {
  const stat = statSync(path);
  if (stat.isFile()) {
    if (SCAN_EXTENSIONS.some((ext) => path.endsWith(ext))) out.push(path);
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of readdirSync(path)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    walk(join(path, entry), out);
  }
}

/**
 * Strip JS/TS line/block comments and quoted string literals so that prose
 * mentions of forbidden tags inside docs / strings don't trigger the rule.
 * Not a full parser — sufficient for our line-based grep.
 */
function stripCommentsAndStrings(source: string): string {
  // Preserve newlines inside multi-line block comments + template literals
  // so cleaned-source line numbers stay in lock-step with the raw source.
  const keepNewlines = (match: string): string => match.replace(/[^\n]/g, " ");
  let out = source.replace(/\/\*[\s\S]*?\*\//g, keepNewlines);
  out = out.replace(/\/\/.*$/gm, "");
  out = out.replace(/"(?:\\.|[^"\\])*"/g, '""');
  out = out.replace(/'(?:\\.|[^'\\])*'/g, "''");
  out = out.replace(/`(?:\\.|[^`\\])*`/g, keepNewlines);
  return out;
}

interface Violation {
  file: string;
  line: number;
  text: string;
  rule: Rule;
}

function scanFile(file: string): Violation[] {
  const raw = readFileSync(file, "utf8");
  const cleaned = stripCommentsAndStrings(raw);
  const rawLines = raw.split("\n");
  const cleanedLines = cleaned.split("\n");
  const violations: Violation[] = [];
  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i];
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        violations.push({
          file,
          line: i + 1,
          text: rawLines[i].trim(),
          rule,
        });
      }
    }
  }
  return violations;
}

const files: string[] = [];
for (const root of SCAN_ROOTS) {
  try {
    walk(root, files);
  } catch (err) {
    console.error(`[design-system] cannot read ${root}: ${(err as Error).message}`);
    process.exit(2);
  }
}

const violations = files.flatMap(scanFile);

if (violations.length === 0) {
  console.log(
    `[design-system] ${files.length} admin file(s) scanned — no forbidden native HTML controls found.`
  );
  process.exit(0);
}

console.error(
  `\n[design-system] ${violations.length} violation(s) — admin code must use Staffbase design-system components from \`@staffbase/design\`.\n`
);
for (const v of violations) {
  console.error(
    `  ${relative(process.cwd(), v.file)}:${v.line}\n    found:   ${v.rule.name}\n    replace: ${v.rule.replacement}\n    code:    ${v.text}\n`
  );
}
console.error(
  `Reference: https://design.staffbase.rocks/?path=/docs/components-select--documentation\n`
);
process.exit(1);
