import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getToken, submitClarification } = vi.hoisted(() => ({
  getToken: vi.fn(),
  submitClarification: vi.fn(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ getToken }),
  SignedIn: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SignedOut: () => null,
}));

vi.mock("@/lib/clarification/submit", () => ({ submitClarification }));

import { DatabaseEngineLogo } from "@/components/ui/database-engine-logo";
import { RegistryProvider } from "../RegistryProvider";
import { RegistryRenderer } from "../RegistryRenderer";
import {
  DatabaseEngineSelector,
  DatabaseEngineSelectorComponent,
  databaseEngineSelectorSchema,
  type DatabaseEngineSelectorData,
} from "./database_engine_selector";

const data: DatabaseEngineSelectorData = {
  runId: "run-123",
  provider: "aws",
  recommendedEngine: "postgresql",
  reasoning: "Relational workload with JSON columns.",
  availableEngines: [
    {
      engine: "postgresql",
      displayName: "PostgreSQL",
      version: "16.3",
      supported: true,
      managedServices: ["Amazon RDS", "Aurora"],
    },
    {
      engine: "mysql",
      displayName: "MySQL",
      version: "8.0",
      supported: true,
      managedServices: ["Amazon RDS"],
    },
    {
      engine: "oracle",
      displayName: "Oracle",
      version: "19c",
      supported: false,
      managedServices: [],
    },
    {
      engine: "sqlserver",
      displayName: "SQL Server",
      version: "2022",
      supported: true,
      managedServices: ["Amazon RDS"],
    },
  ],
};

function radio(name: RegExp) {
  return screen.getByRole("radio", { name });
}

function confirmButton() {
  return screen.getByRole("button", { name: /confirm engine|saving/i });
}

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getToken.mockReset().mockResolvedValue("mock-token");
  submitClarification.mockReset().mockResolvedValue(undefined);
});

describe("DatabaseEngineSelector", () => {
  it("renders a labelled radio group with engine, version and managed services", () => {
    render(<DatabaseEngineSelector data={data} onSelect={vi.fn()} />);

    expect(
      screen.getByRole("radiogroup", { name: "Choose a database engine for AWS" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(5);

    const postgres = radio(/PostgreSQL/);
    expect(postgres).toHaveTextContent("v16.3");
    expect(postgres).toHaveTextContent("Amazon RDS, Aurora");
    expect(radio(/Custom/)).toBeInTheDocument();
  });

  it("preselects and labels the recommended engine", () => {
    render(<DatabaseEngineSelector data={data} onSelect={vi.fn()} />);

    const postgres = radio(/PostgreSQL/);
    expect(postgres).toHaveAttribute("aria-checked", "true");
    expect(postgres).toHaveTextContent("Recommended");
    expect(postgres).toHaveTextContent("Selected");
    expect(radio(/MySQL/)).toHaveAttribute("aria-checked", "false");
  });

  it("preselects the current engine over the recommended one and labels both", () => {
    render(
      <DatabaseEngineSelector data={{ ...data, selectedEngine: "mysql" }} onSelect={vi.fn()} />,
    );

    expect(radio(/MySQL/)).toHaveAttribute("aria-checked", "true");
    expect(radio(/MySQL/)).toHaveTextContent("Current");
    expect(radio(/PostgreSQL/)).toHaveAttribute("aria-checked", "false");
    expect(radio(/PostgreSQL/)).toHaveTextContent("Recommended");
  });

  it("does not preselect a recommended engine the provider does not support", () => {
    render(
      <DatabaseEngineSelector data={{ ...data, recommendedEngine: "oracle" }} onSelect={vi.fn()} />,
    );

    for (const item of screen.getAllByRole("radio")) {
      expect(item).toHaveAttribute("aria-checked", "false");
    }
    expect(confirmButton()).toBeDisabled();
  });

  it("emits the engine and version when a supported engine is selected and confirmed", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<DatabaseEngineSelector data={data} onSelect={onSelect} />);

    fireEvent.click(radio(/MySQL/));
    expect(radio(/MySQL/)).toHaveAttribute("aria-checked", "true");
    expect(radio(/PostgreSQL/)).toHaveAttribute("aria-checked", "false");
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(confirmButton());

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ engine: "mysql", version: "8.0", custom: false });
    expect(await screen.findByRole("status")).toHaveTextContent("Engine confirmed: MySQL v8.0");
  });

  it("marks unsupported engines as disabled with a badge and ignores clicks", () => {
    const onSelect = vi.fn();
    render(<DatabaseEngineSelector data={data} onSelect={onSelect} />);

    const oracle = radio(/Oracle/);
    expect(oracle).toHaveAttribute("aria-disabled", "true");
    expect(oracle).toHaveAttribute("tabindex", "-1");
    expect(oracle).toHaveTextContent("Not supported on AWS");
    expect(oracle.querySelector("svg")).not.toBeNull();

    fireEvent.click(oracle);
    expect(oracle).toHaveAttribute("aria-checked", "false");
    expect(radio(/PostgreSQL/)).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(oracle, { key: " " });
    fireEvent.keyDown(oracle, { key: "Enter" });
    expect(oracle).toHaveAttribute("aria-checked", "false");
  });

  it("moves selection and focus with arrow keys, skipping unsupported engines", () => {
    render(<DatabaseEngineSelector data={data} onSelect={vi.fn()} />);

    fireEvent.keyDown(radio(/PostgreSQL/), { key: "ArrowDown" });
    expect(radio(/MySQL/)).toHaveAttribute("aria-checked", "true");
    expect(radio(/MySQL/)).toHaveFocus();

    // Oracle is unsupported, so the next stop is SQL Server.
    fireEvent.keyDown(radio(/MySQL/), { key: "ArrowRight" });
    expect(radio(/SQL Server/)).toHaveAttribute("aria-checked", "true");
    expect(radio(/SQL Server/)).toHaveFocus();
    expect(radio(/Oracle/)).toHaveAttribute("aria-checked", "false");

    fireEvent.keyDown(radio(/SQL Server/), { key: "ArrowLeft" });
    expect(radio(/MySQL/)).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(radio(/MySQL/), { key: "End" });
    expect(radio(/Custom/)).toHaveAttribute("aria-checked", "true");

    // Wraps from the last option to the first.
    fireEvent.keyDown(radio(/Custom/), { key: "ArrowDown" });
    expect(radio(/PostgreSQL/)).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(radio(/PostgreSQL/), { key: "ArrowUp" });
    expect(radio(/Custom/)).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(radio(/Custom/), { key: "Home" });
    expect(radio(/PostgreSQL/)).toHaveAttribute("aria-checked", "true");
  });

  it("keeps a single tab stop on the selected radio", () => {
    render(<DatabaseEngineSelector data={data} onSelect={vi.fn()} />);

    fireEvent.click(radio(/MySQL/));
    const tabbable = screen.getAllByRole("radio").filter((item) => item.tabIndex === 0);
    expect(tabbable).toEqual([radio(/MySQL/)]);
  });

  it("requires non-empty custom text before submitting", () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<DatabaseEngineSelector data={data} onSelect={onSelect} />);

    fireEvent.click(radio(/Custom/));
    const input = screen.getByLabelText("Custom engine name");
    expect(
      screen.getByText("Provider support can't be checked for a custom engine."),
    ).toBeInTheDocument();

    fireEvent.click(confirmButton());
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter an engine name to continue.");
    expect(input).toHaveAttribute("aria-invalid", "true");

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(confirmButton());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("emits trimmed custom text flagged as custom", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<DatabaseEngineSelector data={data} onSelect={onSelect} />);

    fireEvent.click(radio(/Custom/));
    fireEvent.change(screen.getByLabelText("Custom engine name"), {
      target: { value: "  CockroachDB " },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(confirmButton());

    expect(onSelect).toHaveBeenCalledWith({ engine: "CockroachDB", custom: true });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Engine confirmed: CockroachDB (custom)",
    );
  });

  it("preselects Custom with the current engine when it is not in the list", () => {
    render(
      <DatabaseEngineSelector data={{ ...data, selectedEngine: "cockroachdb" }} onSelect={vi.fn()} />,
    );
    expect(radio(/Custom/)).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Custom engine name")).toHaveValue("cockroachdb");
  });

  it("shows a pending state, blocks double submission, and confirms only on success", async () => {
    const pending = deferred();
    const onSelect = vi.fn().mockReturnValue(pending.promise);
    render(<DatabaseEngineSelector data={data} onSelect={onSelect} />);

    fireEvent.click(confirmButton());

    const button = confirmButton();
    expect(button).toHaveTextContent("Saving…");
    expect(button).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(button);
    fireEvent.click(radio(/MySQL/));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(radio(/MySQL/)).toHaveAttribute("aria-checked", "false");
    expect(radio(/PostgreSQL/)).toHaveAttribute("aria-disabled", "true");

    pending.resolve();
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Engine confirmed: PostgreSQL v16.3",
    );
    expect(screen.queryByRole("button", { name: /confirm engine/i })).not.toBeInTheDocument();
  });

  it("shows an error with retry on failure and does not confirm the selection", async () => {
    const onSelect = vi
      .fn()
      .mockRejectedValueOnce(new Error("submitClarification failed: 500"))
      .mockResolvedValueOnce(undefined);
    render(<DatabaseEngineSelector data={data} onSelect={onSelect} />);

    fireEvent.click(radio(/MySQL/));
    fireEvent.click(confirmButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Engine choice was not saved.");
    expect(alert).toHaveTextContent("submitClarification failed: 500");
    expect(alert.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith({ engine: "mysql", version: "8.0", custom: false });
    expect(await screen.findByRole("status")).toHaveTextContent("Engine confirmed: MySQL v8.0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clears the error when a different engine is chosen after a failure", async () => {
    const onSelect = vi.fn().mockRejectedValue(new Error("boom"));
    render(<DatabaseEngineSelector data={data} onSelect={onSelect} />);

    fireEvent.click(confirmButton());
    await screen.findByRole("alert");

    fireEvent.click(radio(/MySQL/));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });
});

describe("DatabaseEngineSelectorComponent (registry entry)", () => {
  it("sends the choice through submitClarification with the run id and token", async () => {
    render(<DatabaseEngineSelectorComponent data={data} />);

    fireEvent.click(radio(/MySQL/));
    fireEvent.click(confirmButton());

    await waitFor(() => expect(submitClarification).toHaveBeenCalledTimes(1));
    expect(submitClarification).toHaveBeenCalledWith(
      "run-123",
      "database_engine:mysql:8.0",
      {
        answers: {
          database_engine: "mysql",
          database_engine_version: "8.0",
          database_engine_custom: false,
        },
      },
      "mock-token",
    );
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("fails without calling orchestration when there is no auth token", async () => {
    getToken.mockResolvedValue(null);
    render(<DatabaseEngineSelectorComponent data={data} />);

    fireEvent.click(confirmButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Authentication required");
    expect(submitClarification).not.toHaveBeenCalled();
  });

  it("renders a loading skeleton for state=loading", () => {
    render(<DatabaseEngineSelectorComponent state="loading" />);
    expect(screen.getByTestId("database-engine-selector-skeleton")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("renders the error fallback for a missing or invalid payload", () => {
    const { rerender } = render(<DatabaseEngineSelectorComponent />);
    expect(screen.getByTestId("database-engine-selector-error")).toHaveTextContent(
      "Database engine options unavailable",
    );

    rerender(
      <DatabaseEngineSelectorComponent
        data={{ ...data, availableEngines: [] } as DatabaseEngineSelectorData}
      />,
    );
    expect(screen.getByTestId("database-engine-selector-error")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("renders through the default registry, and falls back for an invalid payload", () => {
    const { unmount } = render(
      <RegistryProvider>
        <RegistryRenderer
          payload={{ type: "database_engine_selector", version: "1.0", requestId: "req_1", data }}
        />
      </RegistryProvider>,
    );
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    unmount();

    render(
      <RegistryProvider>
        <RegistryRenderer
          payload={{
            type: "database_engine_selector",
            version: "1.0",
            requestId: "req_1",
            data: { provider: "aws", availableEngines: [{ engine: "mysql" }] },
          }}
        />
      </RegistryProvider>,
    );
    expect(screen.getByText(/could not be rendered/i)).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});

describe("databaseEngineSelectorSchema", () => {
  it("accepts a complete payload and defaults managedServices", () => {
    const parsed = databaseEngineSelectorSchema.parse({
      runId: "run-1",
      provider: "gcp",
      availableEngines: [
        { engine: "mysql", displayName: "MySQL", version: "8.0", supported: true },
      ],
    });
    expect(parsed.availableEngines[0]?.managedServices).toEqual([]);
  });

  it.each(["runId", "provider", "availableEngines"])("rejects a payload without %s", (field) => {
    const { [field as keyof DatabaseEngineSelectorData]: _omitted, ...rest } = data;
    expect(databaseEngineSelectorSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an engine without a support flag", () => {
    const result = databaseEngineSelectorSchema.safeParse({
      ...data,
      availableEngines: [{ engine: "mysql", displayName: "MySQL", version: "8.0" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("DatabaseEngineLogo", () => {
  it("loads the engine logo and falls back to the icon tile when it fails", () => {
    const { container } = render(<DatabaseEngineLogo engine="postgresql" />);
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toContain("/assets/engines/postgresql.svg");

    fireEvent.error(image as HTMLImageElement);
    expect(screen.getByTestId("engine-logo-fallback")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("uses the icon tile for engines without a logo file", () => {
    render(<DatabaseEngineLogo engine="cockroachdb" />);
    expect(screen.getByTestId("engine-logo-fallback")).toBeInTheDocument();
  });
});
