import type { ComponentType as ReactComponentType } from "react";
import type { ComponentPayload } from "@provisr/shared-contracts";
import type { ComponentRegistry } from "./registry";

export type PayloadIssue = { field: string; message: string };

export type DispatchResult =
  | { kind: "unknown"; type: string }
  | { kind: "invalid"; type: string; reason: "schema" | "version"; issues: PayloadIssue[] }
  | { kind: "render"; type: string; Component: ReactComponentType<{ data: unknown }>; data: unknown };

export function resolvePayload(
  registry: ComponentRegistry,
  payload: ComponentPayload,
): DispatchResult {
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
