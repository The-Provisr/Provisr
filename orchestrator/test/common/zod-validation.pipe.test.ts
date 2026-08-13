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

  it("validates scalar query values using the parameter name as field", () => {
    const uuidPipe = new ZodValidationPipe(z.string().uuid());

    expect(uuidPipe.transform("a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a", {
      type: "query",
      data: "workspaceId",
    })).toBe("a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a");

    try {
      uuidPipe.transform("not-a-uuid", { type: "query", data: "workspaceId" });
      throw new Error("expected ValidationError to be thrown");
    } catch (err) {
      const e = err as ValidationError;
      expect(e.details).toEqual([{ field: "workspaceId", message: "Invalid uuid" }]);
    }
  });

  it("lets optional query values pass when absent", () => {
    const optionalPipe = new ZodValidationPipe(z.string().uuid().optional());
    expect(optionalPipe.transform(undefined, { type: "query", data: "sessionId" })).toBeUndefined();
  });

  it("uses the metadata type as field for whole-value errors", () => {
    try {
      pipe.transform("not-an-object", { type: "body" });
      throw new Error("expected ValidationError to be thrown");
    } catch (err) {
      const e = err as ValidationError;
      expect(e.details).toEqual([{ field: "body", message: "Expected object, received string" }]);
    }

    try {
      pipe.transform(undefined, { type: "body" });
      throw new Error("expected ValidationError to be thrown");
    } catch (err) {
      const e = err as ValidationError;
      expect(e.details).toEqual([{ field: "body", message: "Required" }]);
    }
  });
});
