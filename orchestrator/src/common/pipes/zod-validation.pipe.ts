import { ArgumentMetadata, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";
import { ValidationError } from "../errors/typed-errors";

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, metadata: ArgumentMetadata): T {
    if (metadata.type !== "body") {
      return value as T;
    }

    const result = this.schema.safeParse(value);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      }));
      throw new ValidationError("Request validation failed", details);
    }

    return result.data;
  }
}
