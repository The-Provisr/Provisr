import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { workspaceIdFromClaims } from "./server";

describe("workspaceIdFromClaims", () => {
  it("returns the workspace id from claims metadata", () => {
    expect(workspaceIdFromClaims({ metadata: { workspaceId: "ws-1" } })).toBe("ws-1");
  });

  it("returns null when the claim is absent or not a string", () => {
    expect(workspaceIdFromClaims(null)).toBeNull();
    expect(workspaceIdFromClaims({})).toBeNull();
    expect(workspaceIdFromClaims({ metadata: {} })).toBeNull();
    expect(workspaceIdFromClaims({ metadata: { workspaceId: 123 } })).toBeNull();
    expect(workspaceIdFromClaims({ metadata: { workspaceId: "  " } })).toBeNull();
  });
});
