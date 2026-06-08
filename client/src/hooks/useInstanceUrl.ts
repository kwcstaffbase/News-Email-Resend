import { getInstanceUrl } from "@staffbase/plugins-client-sdk";
import { useEffect, useState } from "react";

/**
 * Returns the Staffbase instance URL (e.g. "https://company.staffbase.com").
 *
 * In production the value comes from the parent frame via the plugins-client-sdk
 * postMessage handshake (`instance.url`). In local dev the SDK fallback uses
 * `window.location.ancestorOrigins[0]` or `document.referrer`, which may be
 * empty — the empty-string fallback is harmless since Studio links simply won't
 * render without a host.
 */
export function useInstanceUrl(): string {
  const [instanceUrl, setInstanceUrl] = useState("");

  useEffect(() => {
    // Only attempt SDK handshake when running inside an iframe (i.e. embedded
    // in Staffbase). Outside an iframe there is no parent frame to respond and
    // the call would always reject with "No answer from Staffbase App".
    if (globalThis.parent === globalThis.self) return;
    getInstanceUrl()
      .then(setInstanceUrl)
      .catch(() => {});
  }, []);

  return instanceUrl;
}
