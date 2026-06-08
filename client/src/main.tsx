import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { initI18n } from "./i18n/init.ts";
import { readServerToken, setToken } from "./token.ts";
import "./index.css";

declare global {
  // eslint-disable-next-line no-var -- must use var for globalThis augmentation
  var __JWT_TOKEN__: string;
  // eslint-disable-next-line no-var -- must use var for globalThis augmentation
  var __SESSION_KEY__: string;
}

async function main() {
  // 1. Read the server-injected token. Prefers __SESSION_KEY__ (session UUID,
  //    valid for the full TTL, bypasses Safari ITP) over __JWT_TOKEN__ (raw
  //    JWT, expires in ~1 min — kept as fallback for Vite dev-server path).
  setToken(readServerToken());

  // 2. Delete __JWT_TOKEN__ from window once read — removes the raw JWT from
  //    devtools / extensions after it has been consumed (Layer 3 complement).
  //    __SESSION_KEY__ is intentionally kept: the api layer reads getToken()
  //    from the module singleton, not the global, but keeping it avoids a
  //    white-screen if the module is somehow re-imported after this point.
  delete (globalThis as Record<string, unknown>).__JWT_TOKEN__;

  // 3. Clean the URL — remove ?jwt= query param
  const url = new URL(globalThis.location.href);
  url.searchParams.delete("jwt");
  history.replaceState({}, "", url.toString());

  // 4. Initialise i18n before mounting so the first render is already translated
  await initI18n();

  // 5. Mount the React app
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

main();
