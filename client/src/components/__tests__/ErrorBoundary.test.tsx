import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../ErrorBoundary.tsx";

function Thrower(): never {
  throw new Error("Test crash");
}

function GoodChild() {
  return <div data-testid="child">OK</div>;
}

describe("ErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ErrorBoundary>
        <GoodChild />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("renders fallback UI when child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Thrower />
      </ErrorBoundary>
    );
    // ErrorFallback uses t("error-boundary.title") which returns the key in test
    expect(screen.getByText("error-boundary.title")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("renders custom fallback when provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary fallback={<div data-testid="custom">Custom Error</div>}>
        <Thrower />
      </ErrorBoundary>
    );
    expect(screen.getByTestId("custom")).toBeInTheDocument();
    spy.mockRestore();
  });
});
