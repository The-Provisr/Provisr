import { describe, expect, it } from "vitest";
import { cardStateFor, PROVIDER_META, PROVIDERS } from "./types";

describe("cardStateFor", () => {
  it("is not_connected without an account", () => {
    expect(cardStateFor(undefined, "aws")).toBe("not_connected");
  });

  it.each([
    ["active", "active"],
    ["pending", "pending"],
    ["failed", "failed"],
    ["disconnected", "disconnected"],
  ] as const)("maps %s status to %s", (status, expected) => {
    expect(
      cardStateFor(
        {
          id: "a1",
          workspace_id: "ws",
          provider: "aws",
          label: "x",
          status,
          created_at: "",
          updated_at: "",
        },
        "aws",
      ),
    ).toBe(expected);
  });

  it("treats an unknown status conservatively as pending", () => {
    expect(
      cardStateFor(
        {
          id: "a1",
          workspace_id: "ws",
          provider: "aws",
          label: "x",
          status: "weird" as never,
          created_at: "",
          updated_at: "",
        },
        "aws",
      ),
    ).toBe("pending");
  });
});

describe("provider metadata", () => {
  it("lists exactly three providers", () => {
    expect(PROVIDERS).toEqual(["aws", "azure", "gcp"]);
  });

  it("only AWS is connectable today", () => {
    expect(PROVIDER_META.aws.connectable).toBe(true);
    expect(PROVIDER_META.azure.connectable).toBe(false);
    expect(PROVIDER_META.gcp.connectable).toBe(false);
    expect(PROVIDER_META.azure.comingSoonLabel).toBe("Coming soon");
  });
});
