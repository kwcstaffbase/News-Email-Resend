import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "../hooks/useI18n.ts";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

function ErrorFallback() {
  const { t } = useI18n();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: "1rem",
        fontFamily: "sans-serif",
      }}
    >
      <h2>{t("error-boundary.title")}</h2>
      <button
        type="button"
        onClick={() => globalThis.location.reload()}
        style={{
          background: "var(--color-brand-primary, #0066cc)",
          color: "#fff",
          border: "none",
          borderRadius: 4,
          padding: "0.6rem 1.4rem",
          fontSize: "1rem",
          cursor: "pointer",
        }}
      >
        {t("error-boundary.reload")}
      </button>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Uncaught error:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? <ErrorFallback />;
    }
    return this.props.children;
  }
}
