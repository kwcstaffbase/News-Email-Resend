import { isMobileApp, isNativeApp } from "@staffbase/plugins-client-sdk";
import { useEffect, useState } from "react";

interface ClientKind {
  /** True when running in the Staffbase native app (iOS/Android). */
  isNative: boolean;
  /** True when running in the Staffbase mobile web app. */
  isMobile: boolean;
  /**
   * False until both SDK calls have resolved. Edit buttons must only be
   * shown after resolution to avoid a brief visible flash on native clients.
   */
  ready: boolean;
}

/**
 * Module-level promise cache — shared across every hook instance so that
 * many component mounts trigger only ONE pair of SDK postMessage calls
 * instead of one per consumer. Reset via `_resetCacheForTest()` in tests only.
 */
let _sharedPromise: Promise<[boolean, boolean]> | null = null;

/**
 * Synchronously readable settled result. Set once the promise resolves so
 * that components mounted *after* the first resolution can start with
 * `ready: true` immediately (no flicker) without waiting for another
 * microtask. Never set on rejection — fallback defaults are used instead.
 */
let _sharedResult: [boolean, boolean] | null = null;

/** @internal Resets the module-level SDK promise and result caches. For unit tests only. */
export function _resetCacheForTest(): void {
  _sharedPromise = null;
  _sharedResult = null;
}

function getClientKindOnce(): Promise<[boolean, boolean]> {
  if (!_sharedPromise) {
    _sharedPromise = Promise.all([
      isNativeApp() as Promise<boolean>,
      isMobileApp() as Promise<boolean>,
    ]).then(
      (result) => {
        _sharedResult = result;
        return result;
      },
      () => {
        // Transient rejection — clear the cache so the next mount can retry
        // the SDK handshake rather than permanently reusing a stale failure.
        _sharedPromise = null;
        return [false, false] as [boolean, boolean];
      }
    );
  }
  return _sharedPromise;
}

/**
 * Resolves whether the plugin is running inside the Staffbase native app or
 * mobile web app via the plugins-client-sdk postMessage handshake.
 *
 * - **Standalone / local-dev**: initial state is `ready: true` synchronously —
 *   no flash; the edit button is visible on the very first render.
 * - **Embedded (iframe)**: starts `ready: false`; flips to `true` once the SDK
 *   resolves. Falls back to `{ isNative: false, isMobile: false }` if the
 *   handshake rejects so the button is never permanently suppressed.
 * - **Caching**: the SDK promise is shared across all instances so dozens of
 *   mounted cards trigger only one pair of postMessage calls.
 */
export function useClientKind(): ClientKind {
  const [state, setState] = useState<ClientKind>(() => {
    // Synchronous initializer: outside an iframe there is no parent frame to
    // answer the SDK handshake, so default to desktop immediately — no flash.
    if (globalThis.parent === globalThis.self) {
      return { isNative: false, isMobile: false, ready: true };
    }
    // If the shared promise has already settled (a previous mount resolved it),
    // use the cached result synchronously so late-mounted components never
    // start with ready:false and then flicker to ready:true one render later.
    if (_sharedResult !== null) {
      return { isNative: _sharedResult[0], isMobile: _sharedResult[1], ready: true };
    }
    return { isNative: false, isMobile: false, ready: false };
  });

  useEffect(() => {
    // Standalone — initial state already resolved synchronously; nothing to do.
    if (globalThis.parent === globalThis.self) return;

    let cancelled = false;
    void getClientKindOnce()
      .then(([native, mobile]) => {
        if (!cancelled) setState({ isNative: native, isMobile: mobile, ready: true });
      })
      .catch(() => {
        // Handshake failure — fall back to desktop-safe defaults so the edit
        // button is never permanently hidden on real desktop clients.
        if (!cancelled) setState({ isNative: false, isMobile: false, ready: true });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
