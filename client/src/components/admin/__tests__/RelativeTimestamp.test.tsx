import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RelativeTimestamp } from "../RelativeTimestamp.tsx";

describe("RelativeTimestamp", () => {
  it("renders a <time> element with the provided ISO string", () => {
    const { container } = render(<RelativeTimestamp isoString="2026-01-15T12:00:00Z" />);
    const time = container.querySelector("time");

    expect(time).toBeInTheDocument();
    expect(time?.getAttribute("dateTime")).toBe("2026-01-15T12:00:00Z");
  });

  it("displays some text content (relative time string)", () => {
    const { container } = render(<RelativeTimestamp isoString="2026-01-15T12:00:00Z" />);
    const time = container.querySelector("time");
    expect(time?.textContent?.trim().length).toBeGreaterThan(0);
  });
});
