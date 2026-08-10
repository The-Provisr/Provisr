import { describe, expect, it } from "vitest";
import { formatBytes, formatDurationMs } from "@/lib/format";

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(500)).toBe("500 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("formatDurationMs", () => {
  it("formats milliseconds under a second", () => {
    expect(formatDurationMs(250)).toBe("250ms");
  });

  it("formats seconds", () => {
    expect(formatDurationMs(1200)).toBe("1.2s");
  });
});
