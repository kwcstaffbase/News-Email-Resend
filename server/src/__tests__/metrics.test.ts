/**
 * Regression tests for the Prometheus label-value escaping in
 * `server/src/routes/metrics.ts`.
 *
 * Why this exists: a 2026-05-22 prod audit on this plugin found ~3700 polluted
 * series across the three prod envs (de1=2200, au1=1405, us1=112) caused by
 * scanner-crafted URIs flowing unescaped into the `path` label. Sample exploit
 * shape:
 *
 *   GET /foo",le="+Inf"} 1\n# evil_metric{x="1"}
 *
 * Without escaping, the resulting `http_requests_total{path="..."} 1` line
 * lets the attacker close the label set, terminate the value, and inject a
 * new metric line. PR #81 fixed this with `escapeLabelValue()`; these tests
 * lock the contract.
 *
 * Spec reference (Prometheus text exposition format):
 *   https://prometheus.io/docs/instrumenting/exposition_formats/#text-format-details
 *   "The label value can be any sequence of UTF-8 characters, but the
 *    backslash (\), double-quote ("), and line-feed (\n) characters have to
 *    be escaped as \\, \", and \n, respectively."
 */

import { describe, expect, test } from "bun:test";
import { escapeLabelValue, labelKey } from "../routes/metrics.ts";

describe("escapeLabelValue", () => {
  test("passes through values with no special chars unchanged", () => {
    expect(escapeLabelValue("GET")).toBe("GET");
    expect(escapeLabelValue("/api/apps")).toBe("/api/apps");
    expect(escapeLabelValue("200")).toBe("200");
    expect(escapeLabelValue("")).toBe("");
  });

  test("escapes backslash as double-backslash", () => {
    expect(escapeLabelValue("a\\b")).toBe("a\\\\b");
    expect(escapeLabelValue("\\")).toBe("\\\\");
    expect(escapeLabelValue("\\\\")).toBe("\\\\\\\\");
  });

  test('escapes double-quote as \\"', () => {
    expect(escapeLabelValue('a"b')).toBe('a\\"b');
    expect(escapeLabelValue('"')).toBe('\\"');
  });

  test("escapes line-feed as \\n (literal backslash + n)", () => {
    expect(escapeLabelValue("a\nb")).toBe("a\\nb");
    expect(escapeLabelValue("\n")).toBe("\\n");
  });

  test("escapes carriage-return as \\r (parser-confusion bypass)", () => {
    // Spec doesn't mandate \r escaping, but `\r\n` is a known parser-
    // confusion vector — some scrapers + intermediaries treat \r\n as a
    // line break. Closing this off cheaply prevents a bypass of the
    // metric-injection defense.
    expect(escapeLabelValue("a\rb")).toBe("a\\rb");
    expect(escapeLabelValue("\r")).toBe("\\r");
    expect(escapeLabelValue("\r\n")).toBe("\\r\\n");
    expect(escapeLabelValue("foo\r\n# evil_metric 1")).toBe("foo\\r\\n# evil_metric 1");
  });

  test("escapes backslash before the spec applies the other rules (correct order)", () => {
    // If we naively escaped `"` before `\`, the value `\"` would become
    // `\\"` (correct visual but a second pass escaping the `\` introduced
    // by the quote rule produces `\\\\"`). The spec says backslash first.
    expect(escapeLabelValue('\\"')).toBe('\\\\\\"');
  });

  test("blocks the prod injection payload — cannot terminate the label set", () => {
    // The exact scanner-crafted URI shape that polluted prod. After
    // escaping, the output must be a single valid label value — no stray
    // `}` followed by `{` that introduces a new metric line.
    const exploit = '/foo",le="+Inf"} 1\n# evil_metric{x="1"}';
    const escaped = escapeLabelValue(exploit);
    // The whole payload must remain inside the value (no real newline,
    // no unescaped quote that closes the label set early).
    expect(escaped).not.toContain("\n");
    expect(escaped).toBe('/foo\\",le=\\"+Inf\\"} 1\\n# evil_metric{x=\\"1\\"}');
  });
});

describe("labelKey", () => {
  test("renders a sorted, comma-joined, escaped label set", () => {
    expect(labelKey({ method: "GET", path: "/api/apps", status: "200" })).toBe(
      'method="GET",path="/api/apps",status="200"'
    );
  });

  test("escapes inside label values", () => {
    expect(labelKey({ path: 'a"b\\c\nd' })).toBe('path="a\\"b\\\\c\\nd"');
  });

  test("returns empty string for empty label set", () => {
    expect(labelKey({})).toBe("");
  });

  test("throws on a label key that violates the Prometheus grammar", () => {
    // Today all label keys are developer-controlled literals (`method`,
    // `path`, `status`). The throw protects future code that might pass a
    // dynamic key (e.g. a header name) from silently re-opening the
    // injection vector — invalid keys are programming bugs, not user input.
    expect(() => labelKey({ "bad-key": "v" })).toThrow(/invalid label key/);
    expect(() => labelKey({ "0starts-with-digit": "v" })).toThrow(/invalid label key/);
    expect(() => labelKey({ "has space": "v" })).toThrow(/invalid label key/);
    expect(() => labelKey({ 'has"quote': "v" })).toThrow(/invalid label key/);
    expect(() => labelKey({ "": "v" })).toThrow(/invalid label key/);
  });

  test("renders the prod exploit payload as a single, well-formed label entry", () => {
    const exploit = '/foo",le="+Inf"} 1\n# evil_metric{x="1"}';
    const rendered = labelKey({ method: "GET", path: exploit, status: "200" });
    // No real newline anywhere in the rendered output — the payload's
    // newline was escaped, so the line stays single-line.
    expect(rendered).not.toContain("\n");
    // The rendered output must match exactly: 3 key=value pairs separated
    // by `,`, with the exploit payload appearing only as the escaped path
    // value (no stray label entries, no premature label-set termination).
    expect(rendered).toBe(
      'method="GET",path="/foo\\",le=\\"+Inf\\"} 1\\n# evil_metric{x=\\"1\\"}",status="200"'
    );
  });
});
