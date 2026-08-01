import { ArgumentMetadata, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";
import { ValidationError } from "../errors/typed-errors";

@Injectable()
export class ZodValidationPipe<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const details = result.error.issues.map((issue) => {
        // Body fields carry a path (e.g. "name"); scalar query/param values
        // don't, so fall back to the parameter name from metadata; whole-value
        // errors (e.g. non-object body) have neither, so use the metadata type.
        const field =
          issue.path.length > 0
            ? issue.path.join(".")
            : String(metadata.data ?? metadata.type ?? "");
        return { field, message: issue.message };
      });
      throw new ValidationError("Request validation failed", details);
    }

    return result.data;
  }
}
