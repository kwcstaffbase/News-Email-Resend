#!/usr/bin/env bun
/**
 * scripts/dev.ts — orchestrated local development bootstrap
 *
 * Ensures Docker + Postgres are running, applies migrations, then starts the
 * Hono server and Vite client in parallel. Ctrl+C cleanly stops both child
 * processes (Docker containers are left running for fast restarts).
 *
 * Usage: bun scripts/dev.ts   (invoked via `bun run dev` in root package.json)
 */

import { copyFileSync, existsSync, watch as fsWatch, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Helpers ──────────────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function log(step: string, msg: string) {
  console.log(`${BOLD}${CYAN}[dev]${RESET} ${step.padEnd(12)} ${msg}`);
}

function warn(msg: string) {
  console.warn(`${BOLD}${YELLOW}[dev] warn${RESET}      ${msg}`);
}

function fatal(msg: string): never {
  console.error(`\n${BOLD}${RED}[dev] error${RESET}     ${msg}\n`);
  process.exit(1);
}

function run(cmd: string[], opts?: { cwd?: string; silent?: boolean }) {
  const result = Bun.spawnSync(cmd, {
    cwd: opts?.cwd ?? ROOT,
    stdout: opts?.silent ? "pipe" : "inherit",
    stderr: opts?.silent ? "pipe" : "inherit",
  });
  return result;
}

/**
 * Parse a .env file into a plain object.
 * Handles: blank lines, # comment lines, inline comments (KEY=val # comment),
 * and single/double-quoted values. Does NOT support multi-line values.
 *
 * We parse manually rather than using --env-file so Bun's --watch flag never
 * sees the env file: without --env-file in the command, bun won't watch it
 * and won't perform its own (env-preserving) internal restarts on .env changes.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return {};
  }
  const env: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1);
    if (val.startsWith('"') || val.startsWith("'")) {
      // quoted value — strip surrounding quotes, ignore everything after closing quote
      const q = val[0];
      const closeIdx = val.indexOf(q, 1);
      val = closeIdx > 0 ? val.slice(1, closeIdx) : val.slice(1);
    } else {
      // unquoted — strip trailing inline comment and whitespace
      val = val.replace(/\s+#.*$/, "").trim();
    }
    env[key] = val;
  }
  return env;
}

function runOrFail(cmd: string[], label: string, opts?: { cwd?: string }) {
  const result = run(cmd, opts);
  if (result.exitCode !== 0) {
    fatal(`${label} failed (exit ${result.exitCode})`);
  }
}

// ── Step 0: ensure .env exists ────────────────────────────────────────────────

const envFile = path.join(ROOT, ".env");
const envExample = path.join(ROOT, ".env.example");

if (existsSync(envFile)) {
  log(".env", `found ${DIM}${envFile}${RESET}`);
} else {
  if (!existsSync(envExample)) {
    fatal(".env.example not found — cannot bootstrap .env");
  }
  copyFileSync(envExample, envFile);
  log(".env", `created from .env.example ${DIM}(edit it to customise)${RESET}`);
}

// ── Step 1: install / refresh dependencies ───────────────────────────────────
//
// We use a sentinel file (node_modules/.install-stamp) to detect whether
// bun.lock has changed since the last successful install. This ensures deps
// are automatically refreshed after `git pull` without forcing a full install
// on every `bun run dev` run.

const nodeModules = path.join(ROOT, "node_modules");
const stampFile = path.join(nodeModules, ".install-stamp");
const lockFile = path.join(ROOT, "bun.lock");

function needsInstall(): boolean {
  if (!existsSync(nodeModules)) return true;
  if (!existsSync(stampFile)) return true;
  try {
    const stampMtime = statSync(stampFile).mtimeMs;
    const lockMtime = statSync(lockFile).mtimeMs;
    return lockMtime > stampMtime;
  } catch {
    return true;
  }
}

if (needsInstall()) {
  if (!Bun.env.NPM_TOKEN) {
    fatal(
      "@staffbase/* packages require a GitHub npm token.\n" +
        "       Set it and re-run:\n\n" +
        "         export NPM_TOKEN=<your-token> && bun run dev\n" +
        "\n" +
        "       Add it to your shell profile (e.g. ~/.zshrc) so it persists."
    );
  }
  log("install", "running bun install…");
  const installResult = run(["bun", "install"]);
  if (installResult.exitCode !== 0) {
    fatal(
      "bun install failed.\n" +
        "       Ensure NPM_TOKEN is valid and has read:packages permission.\n" +
        "       export NPM_TOKEN=<token> && bun run dev"
    );
  }
  await Bun.write(stampFile, new Date().toISOString());
  log("install", `${GREEN}done${RESET}`);
} else {
  log("install", `deps up to date ${DIM}(skipping bun install)${RESET}`);
}

// ── Step 2: verify Docker daemon is running ───────────────────────────────────

log("docker", "checking daemon…");
const dockerInfo = run(["docker", "info"], { silent: true });

if (dockerInfo.exitCode !== 0) {
  const stderr = dockerInfo.stderr?.toString() ?? "";
  if (stderr.includes("command not found") || dockerInfo.exitCode === 127) {
    fatal(
      "Docker is not installed.\n" +
        "       Install Docker Desktop from https://docs.docker.com/get-docker/"
    );
  }
  fatal("Docker daemon is not running.\n" + "       Please start Docker Desktop and try again.");
}

// ── Step 2: start containers if postgres is not healthy ───────────────────────

log("docker", "checking postgres container…");

function isPostgresHealthy(): boolean {
  // `docker-compose ps --services --filter status=running` lists running services
  const result = run(["docker", "compose", "ps", "--services", "--filter", "status=running"], {
    silent: true,
  });
  const running = result.stdout?.toString() ?? "";
  return running.split("\n").some((s) => s.trim() === "postgres");
}

if (isPostgresHealthy()) {
  log("docker", `postgres already running ${DIM}(skipping up)${RESET}`);
} else {
  log("docker", `starting containers…`);
  runOrFail(["docker", "compose", "up", "-d"], "docker compose up");

  // Poll until postgres passes its healthcheck (up to 30 s)
  log("docker", "waiting for postgres to be healthy…");
  const deadline = Date.now() + 30_000;
  let healthy = false;

  while (Date.now() < deadline) {
    // Use docker inspect to check the health status directly
    const inspect = run(["docker", "compose", "ps", "--format", "json"], {
      silent: true,
    });

    const output = inspect.stdout?.toString() ?? "";
    // docker compose ps --format json can output one JSON object per line
    const lines = output.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as {
          Service?: string;
          Health?: string;
          State?: string;
        };
        if (obj.Service === "postgres" && obj.Health === "healthy") {
          healthy = true;
          break;
        }
      } catch {
        // malformed line — ignore
      }
    }

    if (healthy) break;
    await Bun.sleep(1_000);
  }

  if (healthy) {
    log("docker", `postgres ${GREEN}healthy${RESET}`);
  } else {
    warn(
      "postgres health check timed out after 30 s — proceeding anyway.\n" +
        "       Migrations may fail if the DB is not ready."
    );
  }
}

// ── Step 3: run migrations ────────────────────────────────────────────────────

log("migrate", "applying pending migrations…");
runOrFail(["bun", "run", "migrate"], "migrations");
log("migrate", `${GREEN}done${RESET}`);

// ── Step 4: start server + client in parallel ─────────────────────────────────

log("dev", `starting ${BOLD}server${RESET} (port 3000) + ${BOLD}client${RESET} (port 5173)…`);
console.log("");

function spawnServer() {
  // Spawn directly (not via `bun run --filter`) so server.kill() reaches the
  // process that holds port 3000 — the filter wrapper would orphan the inner
  // --watch process on kill, causing EADDRINUSE on the next respawn.
  //
  // Env vars are injected via the `env` option instead of `--env-file`. This
  // is critical: when --env-file is present, bun's --watch also watches that
  // file and performs its own internal restart (preserving stale env vars)
  // before our kill+respawn can complete. Without --env-file in the command,
  // bun never sees the file and our fsWatch has full control over reloads.
  return Bun.spawn(["bun", "--watch", "src/index.ts"], {
    cwd: path.join(ROOT, "server"),
    env: { ...process.env, ...parseEnvFile(envFile) },
    stdout: "inherit",
    stderr: "inherit",
  });
}

let server = spawnServer();

const client = Bun.spawn(["bun", "run", "--filter", "./client", "dev"], {
  cwd: ROOT,
  stdout: "inherit",
  stderr: "inherit",
});

// ── .env watcher — respawn server so --env-file picks up fresh values ─────────
// Bun's --watch preserves env vars from the initial run and only watches
// imported source files, so editing .env alone never takes effect.

let envReloadTimer: ReturnType<typeof setTimeout> | null = null;

// Watch the ROOT directory, not the file directly. On macOS, VS Code writes
// files atomically (write temp → rename into place), which changes the inode.
// fs.watch on a file loses track after a rename and silently stops firing.
// Watching the directory is immune to inode changes.
const envWatcher = fsWatch(ROOT, (_event: string, filename: string | null) => {
  if (filename !== ".env") return;
  if (envReloadTimer) clearTimeout(envReloadTimer);
  envReloadTimer = setTimeout(async () => {
    log(".env", `changed — restarting server…`);
    try {
      server.kill();
    } catch {}
    await server.exited;
    server = spawnServer();
  }, 200);
});

// ── Graceful shutdown on Ctrl+C ───────────────────────────────────────────────
// Docker containers are intentionally left running so the next `bun run dev`
// starts instantly without waiting for postgres to boot again.

function shutdown() {
  console.log(`\n${DIM}[dev] shutting down server + client…${RESET}`);
  envWatcher.close();
  if (envReloadTimer) clearTimeout(envReloadTimer);
  try {
    server.kill();
  } catch {}
  try {
    client.kill();
  } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Wait for the client to exit (e.g. a fatal crash) and mirror the exit code.
// The server subprocess can be replaced by the .env watcher, so we anchor on
// the client process and let the server restart independently.
const clientExit = await client.exited;
process.exit(clientExit);
