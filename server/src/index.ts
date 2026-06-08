import app from "./app.ts";
import { LOG_SQL } from "./db/client.ts";
import { createLogger } from "./lib/logger.ts";
import { cleanExpiredSessions } from "./lib/sessions.ts";
import { refreshAllUsers } from "./lib/user-cache.ts";
import { incBackgroundError, incBackgroundTask } from "./routes/metrics.ts";

const IS_LOCALDEV = Bun.env.IS_LOCALDEV === "true";
const startupLogger = createLogger("startup");
const bgLogger = createLogger("background");

// Guard: IS_LOCALDEV must never be true in a production build.
// A misconfigured deployment would bypass all SSO checks — fail fast before
// accepting any traffic rather than running silently in an insecure state.
if (Bun.env.NODE_ENV === "production" && IS_LOCALDEV) {
  throw new Error(
    "IS_LOCALDEV=true is not allowed when NODE_ENV=production. " +
      "Remove IS_LOCALDEV or set it to false before deploying."
  );
}

// Fail fast if required production env vars are missing
if (!IS_LOCALDEV) {
  const missing = (["PLUGIN_ID", "PUBLIC_KEY", "ENCRYPTION_KEY"] as const).filter(
    (key) => !Bun.env[key]
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars: ${missing.join(", ")}. Set IS_LOCALDEV=true to bypass.`
    );
  }
  // Validate ENCRYPTION_KEY length (must be 64 hex chars = 32 bytes for AES-256)
  if ((Bun.env.ENCRYPTION_KEY ?? "").length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes).");
  }
}

const basePort = Number.parseInt(Bun.env.PORT ?? "3000", 10);

/** Maximum number of sequential ports to try before giving up (local dev only). */
const MAX_PORT_ATTEMPTS = 10;

function startServer(port: number, attempt = 0): ReturnType<typeof Bun.serve> {
  if (!IS_LOCALDEV) {
    return Bun.serve({ port, fetch: app.fetch });
  }
  try {
    return Bun.serve({ port, fetch: app.fetch });
  } catch (err) {
    // Only retry on address-in-use errors; surface all other failures immediately.
    const isAddrInUse = err instanceof Error && err.message.includes("address already in use");
    if (isAddrInUse && attempt < MAX_PORT_ATTEMPTS) {
      startupLogger.warn(`Port ${port} in use, trying ${port + 1}…`);
      return startServer(port + 1, attempt + 1);
    }
    throw err;
  }
}

const server = startServer(basePort);

startupLogger.info("Server started.", {
  port: server.port,
  mode: IS_LOCALDEV ? "localdev" : "production",
});

if (IS_LOCALDEV) {
  // Sanitize DB URL — strip password before logging
  const dbUrl = Bun.env.DATABASE_URL?.replace(/:\/\/[^:]+:[^@]+@/, "://<redacted>@") ?? "(not set)";
  startupLogger.info("Local dev config.", {
    db: dbUrl,
    cors: Bun.env.CORS_ORIGINS ?? "http://localhost:5173 (default)",
    userId: Bun.env.LOCALDEV_USER_ID ?? "local-user-1",
    userName: Bun.env.LOCALDEV_USER_NAME ?? "Local Dev User",
    role: Bun.env.LOCALDEV_ROLE ?? "user",
    log_sql: LOG_SQL ? "enabled" : "disabled",
  });
}

process.on("SIGTERM", () => {
  startupLogger.info("SIGTERM received — shutting down gracefully.");
  server.stop(true);
  process.exit(0);
});

// Catch unhandled promise rejections and log them (Bun exits by default, this
// adds context before the process dies)
process.on("unhandledRejection", (reason, promise) => {
  startupLogger.error("Unhandled promise rejection.", {
    promise: String(promise),
    reason: String(reason),
  });
});

// ─── Background tasks ─────────────────────────────────────────────────────────
const REFRESH_HOURS = Number(Bun.env.USER_CACHE_REFRESH_HOURS) || 2.5;
const CLEANUP_HOURS = Number(Bun.env.SESSION_CLEANUP_HOURS) || 1;
const REFRESH_MS = REFRESH_HOURS * 60 * 60 * 1000;
const CLEANUP_MS = CLEANUP_HOURS * 60 * 60 * 1000;

async function runUserCacheRefresh() {
  incBackgroundTask("user-cache");
  try {
    await refreshAllUsers();
  } catch (err) {
    incBackgroundError("user-cache");
    bgLogger.error("User cache refresh failed.", {
      message: (err as Error).message,
    });
  }
}

async function runSessionCleanup() {
  incBackgroundTask("session-cleanup");
  try {
    const cleaned = await cleanExpiredSessions();
    bgLogger.info("Session cleanup ran.", { cleaned });
  } catch (err) {
    incBackgroundError("session-cleanup");
    bgLogger.error("Session cleanup failed.", {
      message: (err as Error).message,
    });
  }
}

// Initial run 30s after startup to allow DB to be ready
setTimeout(() => {
  runUserCacheRefresh();
  runSessionCleanup();
}, 30_000);

setInterval(() => {
  runUserCacheRefresh();
}, REFRESH_MS);

setInterval(() => {
  runSessionCleanup();
}, CLEANUP_MS);
