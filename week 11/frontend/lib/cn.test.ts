import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins valid class names and drops falsy values", () => {
    expect(cn("btn", false, "primary", null, "large")).toBe("btn primary large");
  });

  it("returns an empty string when all values are empty", () => {
    expect(cn(false, null, undefined)).toBe("");
  });
});
