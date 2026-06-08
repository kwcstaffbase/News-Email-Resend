#!/usr/bin/env bun
/**
 * Records scripted walkthrough videos via Playwright as WebM/VP8, then
 * transcodes each into an animated WebP for inline playback on Backstage
 * TechDocs (whose HTML sanitizer strips `<video>` + `<source>` tags before
 * the asset resolver can rewrite their URLs — backstage/backstage#11537,
 * #14722). `<img>` survives sanitization, so we embed the WebP via standard
 * Markdown image syntax and link the WebM as a download for full quality.
 *
 *   docs/assets/videos/<id>.webm  (recorded by Playwright)
 *   docs/assets/videos/<id>.webp  (animated WebP, transcoded if tooling present)
 *
 * Preconditions (same as scripts/capture-docs-screenshots.ts):
 *   1. `bun run dev` running — Vite :5173, Hono :3000.
 *   2. `cd widget && bun run preview` running on :5274 (not strictly required
 *      for the videos but kept consistent with the screenshot script).
 *   3. `IS_LOCALDEV=true` and `LOCALDEV_ROLE=editor` in the server's `.env`
 *      so /admin returns 200 for the admin clip.
 *   4. Seeded data — run `curl -X POST http://localhost:3000/api/localdev/seed`
 *      first if the local DB is empty (the script also issues a pre-flight
 *      seed call).
 *   5. ffmpeg + img2webp on PATH for the WebP transcode step (optional — if
 *      either is missing the script keeps the WebM and warns; install with
 *      `brew install ffmpeg webp`).
 *
 * Run: bun scripts/capture-docs-videos.ts
 *
 * The pipeline:
 *   1. Playwright records WebM/VP8 to OUT.
 *   2. `video.saveAs(dst)` moves it to its final name; the original
 *      `page@<hash>.webm` is unlinked.
 *   3. ffmpeg extracts 8 fps RGB frames to a temp directory at 640 px wide.
 *   4. `img2webp -lossy -q 70 -mixed` builds an animated WebP from the frames.
 *   5. Temp frame directory is removed; WebM stays as the download artifact.
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdtemp, readdir, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "@playwright/test";

const ROOT = path.resolve(import.meta.dir, "..");
const OUT = path.join(ROOT, "docs/assets/videos");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1440, height: 900 };

const USER_EDITOR = {
  userId: "editor-1",
  userName: "Alice Editor",
  instanceId: "dev-instance",
  pluginId: "dev-plugin",
  role: "editor",
  firstName: "Alice",
  lastName: "Editor",
  locale: "en_US",
  type: "user",
  branchId: null,
  externalId: null,
  issuerDomain: null,
  branchSlug: "_default",
};

const USER_END = {
  ...USER_EDITOR,
  userId: "user-1",
  userName: "Bob User",
  role: "user",
  firstName: "Bob",
  lastName: "User",
};

async function newContext(
  browser: Browser,
  role: typeof USER_EDITOR,
  filename: string
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: OUT, size: VIEWPORT },
  });
  const page = await ctx.newPage();
  await page.addInitScript((u) => {
    Object.defineProperty(globalThis, "__USER__", {
      value: u,
      writable: false,
      configurable: false,
    });
  }, role);
  // Stash the target filename on the context so we can rename the
  // randomly-named WebM Playwright writes on context close.
  (ctx as unknown as { _videoTarget: string })._videoTarget = filename;
  return { ctx, page };
}

/**
 * Persist the recorded video to its target path and optionally kick off the
 * WebP transcode. Returns the pending transcode promise (or null if no
 * transcode was scheduled) so the caller can collect it instead of pushing
 * into module-level shared state. The transcode runs in the background — it
 * is NOT awaited inside this function so sibling walkthroughs can keep
 * recording in parallel.
 */
async function closeContext(ctx: BrowserContext): Promise<Promise<void> | null> {
  // Capture the video reference and close the page BEFORE the context. Some
  // Playwright versions race on `video.path()` resolution if only the context
  // is closed, especially under CI. Closing the page first is the documented
  // safe pattern. `video.saveAs()` blocks until Playwright has fully flushed
  // the VP8 muxer, then moves the temp file atomically.
  const page = ctx.pages()[0];
  const target = (ctx as unknown as { _videoTarget: string })._videoTarget;
  if (!page) {
    console.warn(`⚠ no open page for ${target} — recorded video lost`);
    await ctx.close();
    return null;
  }
  const video = page.video();
  if (!video) {
    await page.close();
    await ctx.close();
    console.warn(`⚠ no video handle on page for ${target} — recording was not enabled?`);
    return null;
  }
  const srcPath = await video.path().catch(() => null);
  await page.close();
  await ctx.close();
  const dst = path.join(OUT, target);
  try {
    await video.saveAs(dst);
  } catch (err) {
    console.warn(`⚠ failed to save recorded video for ${target}: ${(err as Error).message}`);
    return null;
  }
  if (srcPath && srcPath !== dst) await unlink(srcPath).catch(() => {});
  console.log(`✓ ${target}`);

  const webp = dst.replace(/\.webm$/i, ".webp");
  if (!(await hasTranscodeTools())) {
    console.warn(
      `⚠ ffmpeg + img2webp not both on PATH — skipping WebP transcode. Install with \`brew install ffmpeg webp\` and re-run to produce ${path.basename(webp)}.`
    );
    return null;
  }
  return transcodeToWebp(dst, webp);
}

function probeBinary(cmd: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const child = spawn(cmd, ["-version"], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", (code) => resolve(code === 0));
  });
}

async function probeTools(): Promise<boolean> {
  const [ffmpeg, img2webp] = await Promise.all([probeBinary("ffmpeg"), probeBinary("img2webp")]);
  return ffmpeg && img2webp;
}

let _hasToolsCache: Promise<boolean> | null = null;
function hasTranscodeTools(): Promise<boolean> {
  _hasToolsCache ??= probeTools();
  return _hasToolsCache;
}

function runCommand(cmd: string, args: string[], label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "ignore" });
    child.on("error", (err) => {
      reject(new Error(`${cmd} spawn failed for ${label}: ${err.message}`));
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${label} failed with exit code ${code}`));
    });
  });
}

async function transcodeToWebp(src: string, dst: string): Promise<void> {
  const tmp = await mkdtemp(path.join(tmpdir(), "plugin-webp-"));
  try {
    await runCommand(
      "ffmpeg",
      [
        "-y",
        "-i",
        src,
        "-vf",
        "fps=8,scale=640:-1:flags=lanczos",
        "-an",
        path.join(tmp, "f%04d.png"),
      ],
      `${path.basename(dst)} (frames)`
    );
    const frames = (await readdir(tmp))
      .filter((f) => f.endsWith(".png"))
      .sort()
      .map((f) => path.join(tmp, f));
    await runCommand(
      "img2webp",
      [
        "-loop",
        "0",
        "-d",
        "125", // 125 ms/frame ≈ 8 fps
        "-lossy",
        "-q",
        "70",
        "-mixed",
        ...frames,
        "-o",
        dst,
      ],
      `${path.basename(dst)} (encode)`
    );
    console.log(`✓ ${path.basename(dst)}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function pause(page: Page, ms: number) {
  await page.waitForTimeout(ms);
}

/** Fire-and-forget seed before the walkthroughs so tables have data. */
async function seedIfPossible(browser: Browser) {
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  try {
    await ctx.request.post("http://localhost:3000/api/localdev/seed").catch(() => null);
  } finally {
    await ctx.close();
  }
}

// ── Scenarios ───────────────────────────────────────────────────────────────

type Scenario = {
  id: string;
  description: string;
  /** Output WebM filename written into docs/assets/videos/. */
  file: string;
  /** Path to navigate to under the dev server (Vite :5173). */
  url: string;
  /** Which seeded user the page should render as. */
  role: typeof USER_EDITOR;
  /** Drives the page through the walkthrough; pauses define the pacing. */
  walkthrough: (page: Page) => Promise<void>;
};

// CUSTOMIZE PER PLUGIN: each entry describes one walkthrough video to record.
// Replace the placeholder below with real scenarios when forking this template.
// See docs/reference/visual-tour.md for the rendering target. Typical entries
// drive Playwright through a multi-step UX flow (search, hover, dialog open,
// form fill, dialog cancel) with `pause(page, ms)` between steps so the
// recording reads naturally on playback.
const SCENARIOS: Scenario[] = [
  {
    id: "example-walkthrough",
    description: "Replace this placeholder with a real walkthrough.",
    file: "01-example-walkthrough.webm",
    url: "/",
    role: USER_END,
    walkthrough: async (page) => {
      // Land on the page and hold for a moment so the recording has a
      // recognisable opening frame.
      await page.waitForLoadState("networkidle");
      await pause(page, 1500);
    },
  },
];

async function runScenario(
  browser: Browser,
  scenario: Scenario,
  collectTranscode: (p: Promise<void>) => void
): Promise<void> {
  const { ctx, page } = await newContext(browser, scenario.role, scenario.file);
  try {
    await page.goto(`http://localhost:5173${scenario.url}`);
    await scenario.walkthrough(page);
  } finally {
    const transcode = await closeContext(ctx);
    if (transcode) collectTranscode(transcode);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  // Seed up-front so walkthroughs have content to interact with.
  await seedIfPossible(browser);
  // Capture the walkthrough error separately so a later transcode rejection
  // can't mask the root cause. A naked `await Promise.all(...)` in `finally`
  // would re-throw the second error (JS finally-throw rule) and lose the
  // original walkthrough stack — the operator needs the first failure most.
  let walkthroughError: unknown;
  const pendingTranscodes: Promise<void>[] = [];
  const collect = (p: Promise<void>) => {
    pendingTranscodes.push(p);
  };
  try {
    // Each scenario uses its own browser context and writes to a distinct
    // file, so they can record in parallel. Halves the recording wall-clock
    // when there are two or more scenarios.
    await Promise.all(SCENARIOS.map((s) => runScenario(browser, s, collect)));
  } catch (err) {
    walkthroughError = err;
  } finally {
    await browser.close();
  }
  const transcodeResults = await Promise.allSettled(pendingTranscodes);
  const transcodeErrors = transcodeResults
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => r.reason);
  if (walkthroughError && transcodeErrors.length > 0) {
    throw new AggregateError(
      [walkthroughError, ...transcodeErrors],
      "Walkthrough and transcode both failed"
    );
  }
  if (walkthroughError) throw walkthroughError;
  if (transcodeErrors.length > 0) {
    throw transcodeErrors.length === 1
      ? transcodeErrors[0]
      : new AggregateError(transcodeErrors, "One or more WebP transcodes failed");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
