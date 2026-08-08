import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "@/lib/time";

const NOW = new Date(2026, 7, 8, 12, 0, 0);

describe("formatRelativeTime", () => {
  it("returns just now within 30 seconds", () => {
    expect(
      formatRelativeTime(new Date(2026, 7, 8, 11, 59, 50).toISOString(), NOW),
    ).toBe("just now");
  });

  it("returns minutes for under an hour", () => {
    expect(
      formatRelativeTime(new Date(2026, 7, 8, 11, 55).toISOString(), NOW),
    ).toBe("5m ago");
  });

  it("returns hours for the same calendar day", () => {
    expect(
      formatRelativeTime(new Date(2026, 7, 8, 9, 0).toISOString(), NOW),
    ).toBe("3h ago");
  });

  it("returns yesterday for the previous calendar day", () => {
    expect(
      formatRelativeTime(new Date(2026, 7, 7, 22, 0).toISOString(), NOW),
    ).toBe("yesterday");
  });

  it("returns yesterday across midnight even under 24 hours", () => {
    const from = new Date(2026, 7, 7, 23, 0);
    const to = new Date(2026, 7, 8, 8, 0);
    expect(formatRelativeTime(from.toISOString(), to)).toBe("yesterday");
  });

  it("returns a short date for older messages", () => {
    expect(
      formatRelativeTime(new Date(2026, 7, 5, 10).toISOString(), NOW),
    ).toBe("Aug 5");
  });

  it("returns empty string for invalid input", () => {
    expect(formatRelativeTime("not-a-date", NOW)).toBe("");
  });
});
