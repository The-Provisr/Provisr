import { describe, expect, it } from "vitest";
import { ValidationError } from "../../src/common/errors/typed-errors";
import { ZodValidationPipe } from "../../src/common/pipes/zod-validation.pipe";
import { z } from "zod";

describe("ZodValidationPipe", () => {
  const schema = z.object({
    name: z.string().min(3).max(64),
    environment: z
      .enum(["development", "staging", "production"])
      .default("development"),
  });
  const pipe = new ZodValidationPipe(schema);

  it("passes non-body values through untouched", () => {
    const value = { id: "abc" };
    expect(pipe.transform(value, { type: "query" })).toBe(value);
    expect(pipe.transform(value, { type: "param" })).toBe(value);
  });

  it("returns parsed data (with defaults) for a valid body", () => {
    expect(pipe.transform({ name: "prod" }, { type: "body" })).toEqual({
      name: "prod",
      environment: "development",
    });
  });

  it("throws ValidationError with field details for an invalid body", () => {
    try {
      pipe.transform({ name: "ab" }, { type: "body" });
      throw new Error("expected ValidationError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const e = err as ValidationError;
      expect(e.code).toBe("VALIDATION_FAILED");
      expect(e.status).toBe(400);
      expect(e.details).toEqual([
        { field: "name", message: "String must contain at least 3 character(s)" },
      ]);
    }
  });

  it("throws for an unknown enum value", () => {
    try {
      pipe.transform({ name: "prod", environment: "prod" }, { type: "body" });
      throw new Error("expected ValidationError to be thrown");
    } catch (err) {
      const e = err as ValidationError;
      expect(e.details).toEqual([
        {
          field: "environment",
          message:
            "Invalid enum value. Expected 'development' | 'staging' | 'production', received 'prod'",
        },
      ]);
    }
  });
});
