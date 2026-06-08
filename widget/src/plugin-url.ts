/**
 * Resolves the plugin-server origin (e.g. `https://my-plugin.staffbase.com`)
 * from the bundle's own `<script>` tag at module-load time.
 *
 * Used by the editor-side installation picker to look up which plugin
 * installations exist + by viewer-side fetches that need to talk to the
 * plugin server (not the Staffbase host).
 *
 * Resolution chain — first hit wins, caller must tolerate `""`:
 *   1. `document.currentScript.src` — fast path for classic `<script src>`
 *   2. DOM scan for the bundle filename — survives WKWebView loaders that
 *      null out `currentScript`
 *   3. `""` — caller renders a localised "server URL unavailable" error
 */

const BUNDLE_FILENAME = "staffbase.plugin-template-widget.min.js";

export function originFromSrc(src: string): string | null {
  if (!src) return null;
  try {
    const origin = new URL(src).origin;
    // `new URL("blob:https://host/...").origin` returns the literal "null"
    if (origin === "null" || origin === "") return null;
    return origin;
  } catch {
    return null;
  }
}

export function resolvePluginUrl(
  currentSrc: string,
  scripts: Iterable<{ src: string }>
): string {
  const fromCurrent = originFromSrc(currentSrc);
  if (fromCurrent) return fromCurrent;

  for (const script of scripts) {
    if (script.src.endsWith(BUNDLE_FILENAME)) {
      const fromScan = originFromSrc(script.src);
      if (fromScan) return fromScan;
    }
  }

  return "";
}

function _initPluginUrl(): string {
  if (typeof document === "undefined") return "";
  const scripts =
    typeof document.querySelectorAll === "function"
      ? document.querySelectorAll<HTMLScriptElement>("script[src]")
      : ([] as Iterable<{ src: string }>);
  return resolvePluginUrl(
    (document.currentScript as HTMLScriptElement | null)?.src ?? "",
    scripts
  );
}

export const PLUGIN_URL: string = _initPluginUrl();
