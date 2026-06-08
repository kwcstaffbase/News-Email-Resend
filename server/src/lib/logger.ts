/**
 * Structured logger — Staffbase internal logging standard.
 *
 * Production  (IS_LOCALDEV absent / LOG_FORMAT=json):  one JSON line per event.
 * Local dev   (IS_LOCALDEV=true  / LOG_FORMAT=pretty): coloured human-readable output.
 *
 * Field conventions follow the Staffbase logging standard and OTel semantic conventions:
 *   _time   — ISO 8601 timestamp  (VictoriaLogs time field)
 *   level   — uppercase: TRACE | DEBUG | INFO | WARN | ERROR
 *   msg     — static message string. Promoted to OTel `log.body` by the
 *             Staffbase OTel Collector (transform/logs precedence:
 *             msg → message → body), then stored as `_msg` in VictoriaLogs.
 *             Do NOT use `_msg` as the field name — it collides with the
 *             VictoriaLogs reserved field and the receiver's raw-line
 *             fallback wins non-deterministically (~22% of entries see
 *             the entire JSON line in `_msg` instead of the unwrapped msg).
 *   module  — originating component (e.g. "http", "user-cache", "gdpr")
 *
 * Environment variables:
 *   LOG_FORMAT   — "json" | "pretty" (default: auto-detected from IS_LOCALDEV)
 *   LOG_LEVEL    — "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" (default: "INFO")
 *   LOG_SECRETS  — "true" to disable PII redaction in TRACE output.
 *                  ONLY honoured when IS_LOCALDEV=true. Silently ignored in production.
 *                  WARNING: logs produced under LOG_SECRETS=true will contain raw JWT tokens,
 *                  user IDs, and other sensitive data — do not paste into tickets or share.
 *
 * Sensitive values in log output:
 *   By default all sensitive fields (JWTs, API tokens, session IDs, PII) are passed
 *   through redact() before logging. Use `redact(value)` at every call site that touches
 *   sensitive data. When LOG_SECRETS=true AND IS_LOCALDEV=true the raw value passes through
 *   unchanged; otherwise a masked form is returned.
 *
 * Note: LOG_SECRETS is enforced in code — it cannot be overridden in production even if set
 * in the environment, because IS_LOCALDEV is never true there.
 */

type Level = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR";
type Context = Record<string, unknown>;

const LEVELS: Record<Level, number> = { TRACE: -1, DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

// ── Mode detection ────────────────────────────────────────────────────────────
// LOG_LEVEL and LOG_FORMAT are read dynamically inside every log() call so that
// runtime env changes (e.g. in tests) take effect without re-importing the module.

// ── LOG_SECRETS — hard-gated to IS_LOCALDEV ───────────────────────────────────
// Enables raw PII/JWT in TRACE output. Never honoured in production because
// IS_LOCALDEV is never true there, regardless of what LOG_SECRETS is set to.
//
// Implemented as a function (not a const) so that the env check is evaluated
// at call time rather than module-load time — necessary for test isolation.
export function allowSecrets(): boolean {
  return Bun.env.IS_LOCALDEV === "true" && Bun.env.LOG_SECRETS === "true";
}

const _isLocalDev = Bun.env.IS_LOCALDEV === "true";
const _wantsSecrets = Bun.env.LOG_SECRETS === "true";

if (_wantsSecrets && !_isLocalDev) {
  // Emit directly to stdout (logger not yet initialised) to flag the misconfiguration.
  process.stdout.write(
    `${JSON.stringify({ _time: new Date().toISOString(), level: "WARN", msg: "LOG_SECRETS=true was set but IS_LOCALDEV is not true — LOG_SECRETS will be ignored.", module: "startup" })}\n`
  );
}

/**
 * Redact a sensitive value.
 *
 * When allowSecrets is true (IS_LOCALDEV=true AND LOG_SECRETS=true) the raw
 * value passes through unchanged so developers can trace auth flows fully.
 *
 * Otherwise returns "<redacted>" so that log lines are safe to collect and share.
 */
export function redact(value: string): string {
  if (allowSecrets()) return value;
  return "<redacted>";
}

// ── ANSI helpers (pretty mode only) ──────────────────────────────────────────
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const levelColor: Record<Level, string> = {
  TRACE: "\x1b[35m", // magenta
  DEBUG: "\x1b[36m", // cyan
  INFO: "\x1b[32m", // green
  WARN: "\x1b[33m", // yellow
  ERROR: "\x1b[31m", // red
};

function prettyTime(): string {
  return new Date().toISOString().slice(11, 19); // HH:MM:SS
}

function fmtVal(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "object") return JSON.stringify(v) ?? "null";
  if (typeof v === "symbol") return v.toString();
  if (typeof v === "function") return "[Function]";
  // v is string | number | boolean | bigint — safe to interpolate
  const scalar = v as string | number | boolean | bigint;
  return `${scalar}`;
}

function formatContext(ctx: Context): string {
  return Object.entries(ctx)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${DIM}${k}=${RESET}${fmtVal(v)}`)
    .join(" ");
}

// ── Emitters ──────────────────────────────────────────────────────────────────
function emitJson(level: Level, module: string, msg: string, ctx: Context): void {
  const entry: Record<string, unknown> = {
    _time: new Date().toISOString(),
    level,
    msg,
    module,
  };
  for (const [k, v] of Object.entries(ctx)) {
    if (v !== undefined) entry[k] = v;
  }
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function emitPretty(level: Level, module: string, msg: string, ctx: Context): void {
  const color = levelColor[level];
  const ctxStr = Object.keys(ctx).length ? ` ${formatContext(ctx)}` : "";
  process.stdout.write(
    `${DIM}${prettyTime()}${RESET} ${color}${level.padEnd(5)}${RESET} ${DIM}[${module}]${RESET} ${msg}${ctxStr}\n`
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface Logger {
  trace(msg: string, ctx?: Context): void;
  debug(msg: string, ctx?: Context): void;
  info(msg: string, ctx?: Context): void;
  warn(msg: string, ctx?: Context): void;
  error(msg: string, ctx?: Context): void;
}

export function createLogger(module: string): Logger {
  function log(level: Level, msg: string, ctx: Context = {}): void {
    // Re-read LOG_LEVEL and LOG_FORMAT at call time so env changes (e.g. in tests) take effect.
    const currentMinLevel =
      LEVELS[(Bun.env.LOG_LEVEL ?? "INFO").toUpperCase() as Level] ?? LEVELS.INFO;
    if (LEVELS[level] < currentMinLevel) return;
    const envFmt = (Bun.env.LOG_FORMAT ?? "").toUpperCase();
    const useJson = envFmt === "JSON" || (envFmt !== "PRETTY" && Bun.env.IS_LOCALDEV !== "true");
    const emitFn = useJson ? emitJson : emitPretty;
    emitFn(level, module, msg, ctx);
  }

  return {
    trace: (msg, ctx) => log("TRACE", msg, ctx ?? {}),
    debug: (msg, ctx) => log("DEBUG", msg, ctx ?? {}),
    info: (msg, ctx) => log("INFO", msg, ctx ?? {}),
    warn: (msg, ctx) => log("WARN", msg, ctx ?? {}),
    error: (msg, ctx) => log("ERROR", msg, ctx ?? {}),
  };
}
