import type { ComponentType as ReactComponentType } from "react";
import { z } from "zod";
import type { ComponentRegistry } from "./registry";

export type PayloadIssue = { field: string; message: string };

export type DispatchResult =
  | { kind: "unknown"; type: string }
  | { kind: "invalid"; type: string; reason: "schema" | "version"; issues: PayloadIssue[] }
  | { kind: "render"; type: string; Component: ReactComponentType<{ data: unknown }>; data: unknown };

export const componentPayloadEnvelopeSchema = z.object({
  type: z.string().min(1, "Component type is required"),
  version: z.string().min(1, "Component version is required"),
  requestId: z.string().min(1, "Component requestId is required"),
  data: z.unknown(),
});

export function resolvePayload(
  registry: ComponentRegistry,
  rawPayload: unknown,
): DispatchResult {
  const envelopeResult = componentPayloadEnvelopeSchema.safeParse(rawPayload);
  if (!envelopeResult.success) {
    const rawType =
      typeof rawPayload === "object" && rawPayload !== null && "type" in rawPayload
        ? String((rawPayload as { type?: unknown }).type || "unknown")
        : "unknown";

    return {
      kind: "invalid",
      type: rawType,
      reason: "schema",
      issues: envelopeResult.error.issues.map((issue) => ({
        field: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    };
  }

  const payload = envelopeResult.data;
  const entry = registry.get(payload.type);
  if (!entry) return { kind: "unknown", type: payload.type };

  const parsed = entry.schema.safeParse(payload.data);
  if (!parsed.success) {
    return {
      kind: "invalid",
      type: payload.type,
      reason: "schema",
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || "(root)",
        message: issue.message,
      })),
    };
  }

  if (payload.version === entry.version) {
    return { kind: "render", type: payload.type, Component: entry.component, data: parsed.data };
  }

  if (!entry.migrate) {
    return {
      kind: "invalid",
      type: payload.type,
      reason: "version",
      issues: [
        {
          field: "version",
          message: `Expected version "${entry.version}", received "${payload.version}".`,
        },
      ],
    };
  }

  const migrated = entry.migrate(parsed.data, payload.version);
  return { kind: "render", type: payload.type, Component: entry.component, data: migrated };
}

