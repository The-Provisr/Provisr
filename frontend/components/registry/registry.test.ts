import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRegistry } from "./registry";

function StubComponent() {
  return null;
}

describe("createRegistry", () => {
  it("round-trips a registered entry", () => {
    const registry = createRegistry();
    const schema = z.object({ text: z.string() });

    registry.register({
      type: "test_type",
      version: "1.0",
      schema,
      component: StubComponent,
    });

    expect(registry.has("test_type")).toBe(true);
    expect(registry.get("test_type")).toMatchObject({
      type: "test_type",
      version: "1.0",
      schema,
      component: StubComponent,
    });
  });

  it("returns undefined for an unregistered type", () => {
    const registry = createRegistry();
    expect(registry.get("does_not_exist")).toBeUndefined();
    expect(registry.has("does_not_exist")).toBe(false);
  });

  it("throws when the same type is registered twice", () => {
    const registry = createRegistry();
    const schema = z.object({});

    registry.register({ type: "dup", version: "1.0", schema, component: StubComponent });

    expect(() =>
      registry.register({ type: "dup", version: "1.0", schema, component: StubComponent }),
    ).toThrow(/already registered/);
  });

  it("keeps separate registry instances independent", () => {
    const a = createRegistry();
    const b = createRegistry();
    const schema = z.object({});

    a.register({ type: "shared_name", version: "1.0", schema, component: StubComponent });

    expect(a.has("shared_name")).toBe(true);
    expect(b.has("shared_name")).toBe(false);

    expect(() =>
      b.register({ type: "shared_name", version: "1.0", schema, component: StubComponent }),
    ).not.toThrow();
  });
});
