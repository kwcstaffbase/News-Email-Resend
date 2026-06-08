import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { clearUnauthorizedHandler, setUnauthorizedHandler } from "../api/index.ts";
import { useI18n } from "../hooks/useI18n.ts";
import { getToken } from "../token.ts";

interface SessionContextValue {
  sessionExpired: boolean;
  setSessionExpired: (v: boolean) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function SessionExpiredOverlay() {
  const { t } = useI18n();
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: "2rem 3rem",
          textAlign: "center",
          maxWidth: 360,
        }}
      >
        <h2 style={{ marginTop: 0, fontWeight: "bold" }}>{t("session.expired-title")}</h2>
        <p>{t("session.expired-body")}</p>
      </div>
    </div>
  );
}

export function SessionProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [sessionExpired, setSessionExpired] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Never expire in local dev
      if (getToken() !== "dev") {
        setSessionExpired(true);
      }
    });
    return () => clearUnauthorizedHandler();
  }, []);

  const value = useMemo(() => ({ sessionExpired, setSessionExpired }), [sessionExpired]);

  return (
    <SessionContext.Provider value={value}>
      {sessionExpired && <SessionExpiredOverlay />}
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
