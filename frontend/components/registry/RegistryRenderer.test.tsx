import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ComponentPayload, ComponentType } from "@provisr/shared-contracts";
import { createRegistry, type ComponentRegistry } from "./registry";
import { RegistryProvider } from "./RegistryProvider";
import { RegistryRenderer } from "./RegistryRenderer";
import { useRegistry } from "./useRegistry";

function TextComponent({ data }: { data: { text: string } }) {
  return <div data-testid="text-component">{data.text}</div>;
}

function payload(overrides: Partial<ComponentPayload>): ComponentPayload {
  return {
    type: "test_type" as ComponentType,
    version: "1.0",
    requestId: "req_1",
    data: { text: "hello" },
    ...overrides,
  };
}

function renderWithRegistry(registry: ComponentRegistry, componentPayload: ComponentPayload) {
  return render(
    <RegistryProvider registry={registry}>
      <RegistryRenderer payload={componentPayload} />
    </RegistryProvider>,
  );
}

describe("RegistryRenderer", () => {
  it("renders the matching component for a valid, version-matched payload", () => {
    const registry = createRegistry();
    registry.register({
      type: "test_type",
      version: "1.0",
      schema: z.object({ text: z.string() }),
      component: TextComponent,
    });

    renderWithRegistry(registry, payload({}));

    expect(screen.getByTestId("text-component")).toHaveTextContent("hello");
  });

  it("renders the migrated data through the component on version mismatch with a migrator", () => {
    const registry = createRegistry();
    registry.register({
      type: "test_type",
      version: "2.0",
      schema: z.object({ text: z.string() }),
      component: TextComponent,
      migrate: (data: { text: string }) => ({ text: `${data.text}-migrated` }),
    });

    renderWithRegistry(registry, payload({ version: "1.0" }));

    expect(screen.getByTestId("text-component")).toHaveTextContent("hello-migrated");
  });

  it("renders UnknownComponentFallback for an unregistered type", () => {
    const registry = createRegistry();
    renderWithRegistry(registry, payload({ type: "nope" as ComponentType }));

    expect(screen.getByText(/no renderer is registered/i)).toBeInTheDocument();
    expect(screen.getByText("nope")).toBeInTheDocument();
    expect(screen.queryByTestId("text-component")).not.toBeInTheDocument();
  });

  it("renders InvalidPayloadFallback when schema validation fails", () => {
    const registry = createRegistry();
    registry.register({
      type: "test_type",
      version: "1.0",
      schema: z.object({ text: z.string() }),
      component: TextComponent,
    });

    renderWithRegistry(registry, payload({ data: { text: 123 } }));

    expect(screen.getByText(/could not be rendered/i)).toBeInTheDocument();
    expect(screen.queryByTestId("text-component")).not.toBeInTheDocument();
  });

  it("renders InvalidPayloadFallback (version reason) on version mismatch without a migrator", () => {
    const registry = createRegistry();
    registry.register({
      type: "test_type",
      version: "2.0",
      schema: z.object({ text: z.string() }),
      component: TextComponent,
    });

    renderWithRegistry(registry, payload({ version: "1.0" }));

    expect(screen.getByText(/version mismatch/i)).toBeInTheDocument();
    expect(screen.queryByTestId("text-component")).not.toBeInTheDocument();
  });

  it("throws from useRegistry when rendered outside a RegistryProvider", () => {
    function Consumer() {
      useRegistry();
      return null;
    }

    expect(() => render(<Consumer />)).toThrow(/must be used within a <RegistryProvider>/);
  });

  it("never uses dangerouslySetInnerHTML anywhere under components/registry", () => {
    const root = path.resolve(__dirname);
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const contents = readFileSync(full, "utf8");
          if (contents.includes("dangerouslySetInnerHTML")) {
            offenders.push(full);
          }
        }
      }
    }

    walk(root);
    expect(offenders).toEqual([]);
  });

  it("escapes hostile strings instead of injecting HTML (XSS check)", () => {
    const registry = createRegistry();
    const hostile = "<img src=x onerror=alert(1)>";

    renderWithRegistry(registry, payload({ type: hostile as ComponentType }));

    expect(screen.getByText(hostile)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});
