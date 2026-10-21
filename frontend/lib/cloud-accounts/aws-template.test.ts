import { describe, expect, it } from "vitest";
import {
  buildCloudFormationTemplate,
  generateExternalId,
  maskAccountId,
  TemplateInputError,
} from "./aws-template";

describe("generateExternalId", () => {
  it("produces an opaque provider-scoped id", () => {
    const id = generateExternalId("aws");
    expect(id).toMatch(/^prv_aws_[0-9a-f]{48}$/);
  });

  it("is unique across calls", () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateExternalId()));
    expect(ids.size).toBe(20);
  });
});

describe("buildCloudFormationTemplate", () => {
  const input = { externalId: "prv_aws_abc", workspaceId: "ws-123" };

  it("embeds the external id and workspace id", () => {
    const template = buildCloudFormationTemplate(input);
    expect(template).toContain("Default: prv_aws_abc");
    expect(template).toContain("sts:ExternalId: !Ref ExternalId");
    expect(template).toContain("workspace ws-123");
    expect(template).toContain("ProvisrExecutionRole");
  });

  it("is deterministic for the same input", () => {
    expect(buildCloudFormationTemplate(input)).toBe(buildCloudFormationTemplate(input));
  });

  it("uses the label when provided", () => {
    expect(buildCloudFormationTemplate({ ...input, accountLabel: "Prod account" })).toContain(
      "label: Prod account",
    );
  });

  it("rejects an empty external id", () => {
    expect(() => buildCloudFormationTemplate({ ...input, externalId: "  " })).toThrow(
      TemplateInputError,
    );
  });

  it("rejects an empty workspace id", () => {
    expect(() => buildCloudFormationTemplate({ ...input, workspaceId: "" })).toThrow(
      TemplateInputError,
    );
  });
});

describe("maskAccountId", () => {
  it("keeps the last four digits", () => {
    expect(maskAccountId("123456789012")).toBe("********9012");
  });

  it("fully masks short values", () => {
    expect(maskAccountId("12")).toBe("**");
  });

  it("returns a dash for empty or missing input", () => {
    expect(maskAccountId(undefined)).toBe("—");
    expect(maskAccountId("")).toBe("—");
  });
});
