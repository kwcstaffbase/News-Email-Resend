import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "../AuthContext.tsx";

function Consumer() {
  const user = useAuth();
  return (
    <div>
      <span data-testid="userId">{user.userId}</span>
      <span data-testid="role">{user.role}</span>
      <span data-testid="isEditor">{String(user.isEditor)}</span>
    </div>
  );
}

describe("AuthContext", () => {
  it("provides user data from __USER__ global", () => {
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    expect(screen.getByTestId("userId").textContent).toBe("test-user-1");
    expect(screen.getByTestId("role").textContent).toBe("editor");
    expect(screen.getByTestId("isEditor").textContent).toBe("true");
  });

  it("defaults to user role when __USER__ has non-editor role", () => {
    const original = globalThis.__USER__;
    if (!original) throw new Error("__USER__ not set by setup.ts");
    globalThis.__USER__ = { ...original, role: "user" };
    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );
    expect(screen.getByTestId("isEditor").textContent).toBe("false");
    globalThis.__USER__ = original;
  });

  it("throws when useAuth is called outside AuthProvider", () => {
    // Suppress React error boundary console output for this test
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow();
    spy.mockRestore();
  });
});
