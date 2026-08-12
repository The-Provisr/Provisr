import { describe, expect, it } from "vitest";
import { validateResourceManifest } from "../src";

describe("canonical resource manifest", () => {
  it("accepts a supported AWS manifest", () => {
    const result = validateResourceManifest({
      region: "ap-southeast-1",
      environment: "staging",
      resources: [{ type: "aws_ec2", name: "api", instance_type: "t3.small", image: "ubuntu-24.04" }],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unsupported resource", () => {
    const result = validateResourceManifest({ region: "ap-southeast-1", environment: "staging", resources: [{ type: "aws_lambda" }] });
    expect(result.ok).toBe(false);
  });
});
