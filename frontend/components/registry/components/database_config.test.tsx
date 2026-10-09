import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegistryProvider } from "../RegistryProvider";
import { RegistryRenderer } from "../RegistryRenderer";
import {
  DatabaseConfigComponent,
  databaseConfigSchema,
  getDatabaseRisks,
  type DatabaseConfigData,
} from "./database_config";

const safeConfig: DatabaseConfigData = {
  engine: "postgres",
  version: "16.3",
  instanceClass: "db.t3.medium",
  allocatedStorageGb: 100,
  maxAllocatedStorageGb: 500,
  storageType: "gp3",
  multiAz: true,
  backupRetentionDays: 7,
  maintenanceWindow: "Sun 03:00-04:00 UTC",
  storageEncrypted: true,
  publiclyAccessible: false,
  deletionProtection: true,
};

function callouts() {
  return within(screen.getByRole("alert")).getAllByRole("listitem");
}

function expectIconAndText(element: HTMLElement) {
  expect(element.querySelector("svg")).not.toBeNull();
  expect(element.textContent?.trim()).not.toBe("");
}

describe("DatabaseConfigComponent", () => {
  it("renders a fully safe configuration with no callouts", () => {
    render(<DatabaseConfigComponent data={safeConfig} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "PostgreSQL" })).toBeInTheDocument();
    expect(screen.getByText("v16.3")).toBeInTheDocument();
    expect(screen.getByText("db.t3.medium")).toBeInTheDocument();
    expect(screen.getByText("Multi-AZ")).toBeInTheDocument();
    expect(screen.getByText("100 GB of 500 GB")).toBeInTheDocument();
    expect(screen.getByText("7 days")).toBeInTheDocument();
    expect(screen.getByText("Sun 03:00-04:00 UTC")).toBeInTheDocument();

    const encryption = screen.getByTestId("indicator-encryption");
    expect(encryption).toHaveAttribute("data-tone", "safe");
    expect(encryption).toHaveTextContent("Encrypted");
    const network = screen.getByTestId("indicator-network");
    expect(network).toHaveAttribute("data-tone", "safe");
    expect(network).toHaveTextContent("Private");
    const deletion = screen.getByTestId("indicator-deletion-protection");
    expect(deletion).toHaveAttribute("data-tone", "safe");
    expect(deletion).toHaveTextContent("On");
  });

  it("shows a red callout and warning indicator when storage is unencrypted", () => {
    render(<DatabaseConfigComponent data={{ ...safeConfig, storageEncrypted: false }} />);

    const items = callouts();
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-severity", "critical");
    expect(items[0]).toHaveTextContent("Storage is not encrypted");

    const encryption = screen.getByTestId("indicator-encryption");
    expect(encryption).toHaveAttribute("data-tone", "critical");
    expect(encryption).toHaveTextContent("Not encrypted");
  });

  it("shows a red callout and public warning when publicly accessible", () => {
    render(<DatabaseConfigComponent data={{ ...safeConfig, publiclyAccessible: true }} />);

    const items = callouts();
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-severity", "critical");
    expect(items[0]).toHaveTextContent("Publicly accessible");

    const network = screen.getByTestId("indicator-network");
    expect(network).toHaveAttribute("data-tone", "critical");
    expect(network).toHaveTextContent("Public");
    expect(network).not.toHaveTextContent("Private");
  });

  it("shows an amber callout when deletion protection is disabled", () => {
    render(<DatabaseConfigComponent data={{ ...safeConfig, deletionProtection: false }} />);

    const items = callouts();
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-severity", "warning");
    expect(items[0]).toHaveTextContent("Deletion protection is off");

    const deletion = screen.getByTestId("indicator-deletion-protection");
    expect(deletion).toHaveAttribute("data-tone", "warning");
    expect(deletion).toHaveTextContent("Off");
  });

  it("shows an amber callout when backup retention is zero days", () => {
    render(<DatabaseConfigComponent data={{ ...safeConfig, backupRetentionDays: 0 }} />);

    const items = callouts();
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveAttribute("data-severity", "warning");
    expect(items[0]).toHaveTextContent("Backups disabled");
    expect(screen.getByText("0 days")).toBeInTheDocument();
  });

  it("shows every callout, critical first, when all risky settings apply", () => {
    render(
      <DatabaseConfigComponent
        data={{
          ...safeConfig,
          storageEncrypted: false,
          publiclyAccessible: true,
          deletionProtection: false,
          backupRetentionDays: 0,
        }}
      />,
    );

    const items = callouts();
    expect(items.map((item) => item.getAttribute("data-severity"))).toEqual([
      "critical",
      "critical",
      "warning",
      "warning",
    ]);
    expect(items[0]).toHaveTextContent("Storage is not encrypted");
    expect(items[1]).toHaveTextContent("Publicly accessible");
    expect(items[2]).toHaveTextContent("Deletion protection is off");
    expect(items[3]).toHaveTextContent("Backups disabled");
  });

  it("gives every callout and indicator both an icon and a text label", () => {
    render(
      <DatabaseConfigComponent
        data={{
          ...safeConfig,
          storageEncrypted: false,
          publiclyAccessible: true,
          deletionProtection: false,
          backupRetentionDays: 0,
        }}
      />,
    );
    callouts().forEach(expectIconAndText);
    for (const id of ["indicator-encryption", "indicator-network", "indicator-deletion-protection"]) {
      expectIconAndText(screen.getByTestId(id));
    }
  });

  it("gives safe indicators an icon and a text label too", () => {
    render(<DatabaseConfigComponent data={safeConfig} />);
    for (const id of ["indicator-encryption", "indicator-network", "indicator-deletion-protection"]) {
      expectIconAndText(screen.getByTestId(id));
    }
  });

  it("renders deletion protection as read-only, with no interactive controls", () => {
    render(<DatabaseConfigComponent data={safeConfig} />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders allocated storage as a progress bar against the autoscaling ceiling", () => {
    render(<DatabaseConfigComponent data={safeConfig} />);
    const bar = screen.getByRole("progressbar", { name: "Allocated storage" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuemax", "500");
    expect(bar.firstElementChild).toHaveStyle({ width: "20%" });
  });

  it("omits the progress bar when there is no autoscaling ceiling", () => {
    render(<DatabaseConfigComponent data={{ ...safeConfig, maxAllocatedStorageGb: undefined }} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText("100 GB · autoscaling off")).toBeInTheDocument();
  });

  it("falls back to the raw engine name and 'Not set' for optional fields", () => {
    render(
      <DatabaseConfigComponent
        data={{ ...safeConfig, engine: "cockroachdb", maintenanceWindow: undefined }}
      />,
    );
    expect(screen.getByRole("heading", { name: "cockroachdb" })).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
  });

  it("renders a loading skeleton for state=loading", () => {
    render(<DatabaseConfigComponent state="loading" />);
    expect(screen.getByTestId("database-config-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("database-config-card")).not.toBeInTheDocument();
  });

  it("renders the error fallback for a missing payload", () => {
    render(<DatabaseConfigComponent />);
    const error = screen.getByTestId("database-config-error");
    expect(error).toHaveTextContent("Database configuration unavailable");
    expectIconAndText(error);
    expect(screen.queryByTestId("database-config-card")).not.toBeInTheDocument();
  });

  it("renders the error fallback instead of a safe-looking card when security fields are missing", () => {
    const { storageEncrypted: _omitted, ...withoutEncryption } = safeConfig;
    render(<DatabaseConfigComponent data={withoutEncryption as DatabaseConfigData} />);
    expect(screen.getByTestId("database-config-error")).toBeInTheDocument();
    expect(screen.queryByTestId("indicator-encryption")).not.toBeInTheDocument();
  });
});

describe("databaseConfigSchema", () => {
  it("accepts a complete payload", () => {
    expect(databaseConfigSchema.safeParse(safeConfig).success).toBe(true);
  });

  it.each(["storageEncrypted", "publiclyAccessible", "deletionProtection", "backupRetentionDays"])(
    "rejects a payload without %s",
    (field) => {
      const { [field as keyof DatabaseConfigData]: _omitted, ...rest } = safeConfig;
      expect(databaseConfigSchema.safeParse(rest).success).toBe(false);
    },
  );

  it("rejects a negative backup retention", () => {
    expect(
      databaseConfigSchema.safeParse({ ...safeConfig, backupRetentionDays: -1 }).success,
    ).toBe(false);
  });
});

describe("getDatabaseRisks", () => {
  it("returns no risks for a safe configuration", () => {
    expect(getDatabaseRisks(safeConfig)).toEqual([]);
  });
});

describe("database_config registry entry", () => {
  function renderPayload(data: unknown) {
    return render(
      <RegistryProvider>
        <RegistryRenderer
          payload={{ type: "database_config", version: "1.0", requestId: "req_db", data }}
        />
      </RegistryProvider>,
    );
  }

  it("renders the card through the default registry instead of a fallback", () => {
    renderPayload(safeConfig);
    expect(screen.getByTestId("database-config-card")).toBeInTheDocument();
    expect(screen.queryByText(/no renderer is registered/i)).not.toBeInTheDocument();
  });

  it("renders the invalid payload fallback for a payload missing security fields", () => {
    renderPayload({ engine: "postgres", allocatedStorageGb: 100 });
    expect(screen.getByText(/could not be rendered/i)).toBeInTheDocument();
    expect(screen.getByText("storageEncrypted")).toBeInTheDocument();
    expect(screen.queryByTestId("database-config-card")).not.toBeInTheDocument();
  });
});
