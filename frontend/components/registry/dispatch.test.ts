import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ComponentPayload, ComponentType } from "@provisr/shared-contracts";
import { createRegistry } from "./registry";
import { resolvePayload } from "./dispatch";

function StubComponent() {
  return null;
}

function payload(overrides: Partial<ComponentPayload>): ComponentPayload {
  return {
    type: "test_type" as ComponentType,
    version: "1.0",
    requestId: "req_1",
    data: {},
    ...overrides,
  };
}

describe("resolvePayload", () => {
  it("returns unknown for an unregistered type", () => {
    const registry = createRegistry();
    const result = resolvePayload(registry, payload({ type: "nonexistent" as ComponentType }));
    expect(result).toEqual({ kind: "unknown", type: "nonexistent" });
  });

  it("returns invalid/schema when data fails validation", () => {
    const registry = createRegistry();
    registry.register({
      type: "test_type",
      version: "1.0",
      schema: z.object({ text: z.string() }),
      component: StubComponent,
    });

    const result = resolvePayload(registry, payload({ data: { text: 123 } }));

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") throw new Error("expected invalid");
    expect(result.reason).toBe("schema");
    expect(result.issues).toEqual([{ field: "text", message: expect.any(String) }]);
  });

  it("returns invalid/version on version mismatch with no migrator", () => {
    const registry = createRegistry();
    registry.register({
      type: "test_type",
      version: "2.0",
      schema: z.object({ text: z.string() }),
      component: StubComponent,
    });

    const result = resolvePayload(
      registry,
      payload({ version: "1.0", data: { text: "hello" } }),
    );

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") throw new Error("expected invalid");
    expect(result.reason).toBe("version");
  });

  it("runs the migrator and renders on version mismatch when a migrator is provided", () => {
    const registry = createRegistry();
    const migrate = vi.fn((data: { text: string }, fromVersion: string) => ({
      text: `${data.text} (migrated from ${fromVersion})`,
    }));

    registry.register({
      type: "test_type",
      version: "2.0",
      schema: z.object({ text: z.string() }),
      component: StubComponent,
      migrate,
    });

    const result = resolvePayload(
      registry,
      payload({ version: "1.0", data: { text: "hello" } }),
    );

    expect(migrate).toHaveBeenCalledWith({ text: "hello" }, "1.0");
    expect(result).toEqual({
      kind: "render",
      type: "test_type",
      Component: StubComponent,
      data: { text: "hello (migrated from 1.0)" },
    });
  });

  it("renders directly when data is valid and version matches, without calling migrate", () => {
    const registry = createRegistry();
    const migrate = vi.fn();

    registry.register({
      type: "test_type",
      version: "1.0",
      schema: z.object({ text: z.string() }),
      component: StubComponent,
      migrate,
    });

    const result = resolvePayload(registry, payload({ version: "1.0", data: { text: "hello" } }));

    expect(migrate).not.toHaveBeenCalled();
    expect(result).toEqual({
      kind: "render",
      type: "test_type",
      Component: StubComponent,
      data: { text: "hello" },
    });
  });

  describe("envelope validation", () => {
    it("returns invalid/schema when payload is null or not an object", () => {
      const registry = createRegistry();
      const nullResult = resolvePayload(registry, null);
      expect(nullResult.kind).toBe("invalid");
      if (nullResult.kind !== "invalid") throw new Error("expected invalid");
      expect(nullResult.type).toBe("unknown");
      expect(nullResult.reason).toBe("schema");

      const stringResult = resolvePayload(registry, "not-an-object");
      expect(stringResult.kind).toBe("invalid");
      if (stringResult.kind !== "invalid") throw new Error("expected invalid");
      expect(stringResult.type).toBe("unknown");
    });

    it("returns invalid/schema when envelope fields are missing", () => {
      const registry = createRegistry();
      const result = resolvePayload(registry, { type: "test_type" });
      expect(result.kind).toBe("invalid");
      if (result.kind !== "invalid") throw new Error("expected invalid");
      expect(result.type).toBe("test_type");
      expect(result.reason).toBe("schema");
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "version" }),
          expect.objectContaining({ field: "requestId" }),
        ]),
      );
    });
  });
});

