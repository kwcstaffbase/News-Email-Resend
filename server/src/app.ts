import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { createLogger } from "./lib/logger.ts";
import { deleteInstance } from "./lib/remote-calls.ts";
import { accessLog } from "./middleware/access-log.ts";
import { extractRawToken, parseTokenUser, ssoMiddleware } from "./middleware/sso.ts";
import { adminRoute } from "./routes/admin.ts";
import { changelogRoute } from "./routes/changelog.ts";
import { healthRoute } from "./routes/health.ts";
import { htmlRoutes } from "./routes/html.ts";
import { itemsRoute } from "./routes/items.ts";
import { metricsRoute } from "./routes/metrics.ts";
import { newsRoute } from "./routes/news.ts";
import { publicRoute } from "./routes/public.ts";
import { settingsRoute } from "./routes/settings.ts";
import { usersRoute } from "./routes/users.ts";
import type { AppEnv } from "./types/hono.ts";

const IS_LOCALDEV = Bun.env.IS_LOCALDEV === "true";

// Defence-in-depth: the IS_LOCALDEV bypass paths below (delete intercept,
// CORS wildcards, dev-only routes) must NEVER be reachable in a production,
// staging, CI, test, or any environment where NODE_ENV is unset / unknown.
// The gate uses an EXPLICIT allowlist on NODE_ENV === "development". An
// "unset NODE_ENV is treated as dev" fallback was rejected: a CI job, bare
// container, or staging deploy that accidentally copies `.env` without
// setting NODE_ENV would otherwise activate every bypass path. Production /
// staging / CI / test all MUST set NODE_ENV explicitly via Dockerfile,
// workflow, or test harness (see bunfig.toml [test] preload). Local dev
// must export NODE_ENV=development (bun's default for `bun run dev`).
const IS_REAL_LOCALDEV = IS_LOCALDEV && Bun.env.NODE_ENV === "development";

const gdprLogger = createLogger("gdpr");
const errorLogger = createLogger("error-handler");

export const app = new Hono<AppEnv>();

// ── Global middleware ──────────────────────────────────────────────────────
app.use("*", accessLog);

// X-Frame-Options must be disabled — the plugin renders inside a Staffbase iframe.
// Referrer-Policy: no-referrer prevents the ?jwt= query param from leaking via the
// Referer header on any subsequent subresource request (IA-5740 Layer 2).
app.use(
  "*",
  secureHeaders({
    xFrameOptions: false,
    referrerPolicy: "no-referrer",
    crossOriginResourcePolicy: false,
  })
);

// CORS is only needed in local dev (Vite 5173 → Hono 3000).
// In production the SPA is served from the same origin, so no CORS header is required.
// Set CORS_ORIGINS as a comma-separated list to enable it in other environments.
const corsOrigins = Bun.env.CORS_ORIGINS?.split(",")
  .map((o) => o.trim())
  .filter(Boolean);
if (IS_REAL_LOCALDEV || corsOrigins?.length) {
  app.use(
    "/api/*",
    cors({
      origin: corsOrigins ?? ["http://localhost:5173"],
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "X-Instance-Id"],
    })
  );
}

// ── GDPR delete intercept ──────────────────────────────────────────────────
// Staffbase sends a POST with sub="delete" in the JWT to trigger instance
// deletion. The path varies (e.g. /admin), so this must be top-level middleware.
// A POST with ?jwt= is exclusively a Staffbase remote call — return 401 on
// validation failure instead of falling through to 404.
//
// In IS_LOCALDEV mode there is no real Staffbase platform; widget POST calls
// land here with a sentinel `?jwt=dev` that parseTokenUser cannot validate,
// which would otherwise produce a spurious 401 before ssoMiddleware's
// localdev bypass runs. Narrowly bypass ONLY when the request carries that
// exact sentinel — any other ?jwt= value still goes through real validation,
// so a misconfigured IS_LOCALDEV in CI cannot disable the GDPR delete gate.
app.use("*", async (c, next) => {
  if (IS_REAL_LOCALDEV && c.req.method === "POST" && extractRawToken(c) === "dev") return next();
  if (c.req.method === "POST") {
    const rawToken = extractRawToken(c);
    if (rawToken) {
      const user = parseTokenUser(rawToken);
      if (user?.userId === "delete") {
        const ok = await deleteInstance(user.instanceId);
        return ok ? c.text("OK") : c.text("Internal Server Error", 500);
      }
      // Valid JWT but not a delete request — should not happen in practice
      if (user) {
        gdprLogger.warn("POST with valid JWT but unexpected sub.", {
          "url.path": c.req.path,
          instanceId: user.instanceId,
          sub: user.userId,
        });
      } else {
        gdprLogger.error("POST JWT validation failed — check PLUGIN_ID and PUBLIC_KEY.", {
          "url.path": c.req.path,
        });
      }
      return c.text("Unauthorized", 401);
    }
  }
  return next();
});

// ── Public routes (no SSO) ─────────────────────────────────────────────────
app.route("/health", healthRoute);
app.route("/api/metrics", metricsRoute);
app.route("/api/public", publicRoute);
app.route("/", htmlRoutes);

// ── Local dev utility routes — not mounted in production ───────────────────
if (IS_REAL_LOCALDEV) {
  const { localdevRoute } = await import("./routes/localdev.ts");
  app.route("/api/localdev", localdevRoute);
}

// ── API routes (SSO required) ──────────────────────────────────────────────
app.use("/api/*", ssoMiddleware);

app.route("/api/admin", adminRoute);
app.route("/api/changelog", changelogRoute);
app.route("/api/items", itemsRoute);
app.route("/api/news", newsRoute);
app.route("/api/settings", settingsRoute);
app.route("/api/users", usersRoute);

// ── Static file serving (SPA catch-all, must be last) ─────────────────────
// Content-hashed assets (Vite output under /assets/) are safe to cache forever.
app.use("/assets/*", async (c, next) => {
  await next();
  if (c.res.status === 200) {
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
  }
});
// Widget assets — served from dist/public/widget/.
// The bundle filename is stable (no version in the name). ETag-based
// conditional responses let WKWebView and HTTP caches revalidate without
// fetching the full body on every load. Cross-Origin-Resource-Policy must
// be cross-origin because Staffbase Studio loads these assets from a
// different origin; the default same-origin set by secureHeaders would
// block the load with ERR_BLOCKED_BY_RESPONSE.NotSameOrigin.
app.use("/widget/*", async (c, next) => {
  const file = Bun.file(`./dist/public${c.req.path}`);
  if (await file.exists()) {
    const etag = `"${file.lastModified.toString(36)}"`;

    if (c.req.header("If-None-Match") === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "no-cache",
          "Cross-Origin-Resource-Policy": "cross-origin",
        },
      });
    }

    await next();
    if (c.res.status === 200) {
      c.header("ETag", etag);
      c.header("Last-Modified", new Date(file.lastModified).toUTCString());
      c.header("Cache-Control", "no-cache");
      c.header("Cross-Origin-Resource-Policy", "cross-origin");
    }
  } else {
    await next();
  }
});
app.use("/*", serveStatic({ root: "./dist/public" }));

// ── Global error handler ───────────────────────────────────────────────────
app.onError((err, c) => {
  const method = c.req.method;
  const path = c.req.path;
  const status = "status" in err && typeof err.status === "number" ? err.status : 500;
  const requestId = c.req.header("x-request-id");
  // c.var.user may be absent on unauthenticated routes (health, metrics, …)
  const ctxUser = c.var.user as typeof c.var.user | undefined;

  errorLogger.error("Unhandled error.", {
    "http.request.method": method,
    "url.path": path,
    "http.response.status_code": status,
    "http.request.header.x-request-id": requestId,
    userId: ctxUser?.userId,
    instanceId: ctxUser?.instanceId,
    message: err.message,
    stack: err.stack,
    cause: "cause" in err && err.cause instanceof Error ? err.cause.message : undefined,
  });

  if (IS_REAL_LOCALDEV) {
    return c.json(
      {
        error: err.message,
        stack: err.stack?.split("\n"),
        cause: err.cause instanceof Error ? err.cause.message : undefined,
      },
      status as 500
    );
  }

  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
