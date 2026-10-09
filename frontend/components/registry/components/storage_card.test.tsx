import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  StorageCardComponent,
  isEncryptionEnabled,
  storageCardSchema,
} from "./storage_card";
import type { StorageCardData } from "./storage_card";

const fullData: StorageCardData = storageCardSchema.parse({
  bucketName: "prod-assets-bucket",
  storageClass: "STANDARD",
  versioning: true,
  encryption: "aws:kms",
  publicAccessBlocked: true,
  lifecycleRulesCount: 3,
});

describe("StorageCardComponent (header + details)", () => {
  it("renders the bucket name, storage class, versioning and lifecycle tiles", () => {
    render(<StorageCardComponent data={fullData} />);

    expect(screen.getByText("prod-assets-bucket")).toBeInTheDocument();
    expect(screen.getByText("STANDARD")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("3 Rules")).toBeInTheDocument();
  });

  it("omits the class and lifecycle tiles when those fields are absent", () => {
    const data = storageCardSchema.parse({ bucketName: "logs-bucket" });

    render(<StorageCardComponent data={data} />);

    expect(screen.getByText("logs-bucket")).toBeInTheDocument();
    expect(screen.queryByText("Class")).not.toBeInTheDocument();
    expect(screen.queryByText("Lifecycle")).not.toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });
});

describe("StorageCardComponent (encryption badge)", () => {
  it("shows a green encrypted badge with the method when encryption is enabled", () => {
    render(<StorageCardComponent data={fullData} />);

    const badge = screen.getByTestId("encryption-badge");
    expect(badge).toHaveTextContent("Encrypted");
    expect(badge.className).toContain("bg-green-100");
    expect(screen.getByText("aws:kms")).toBeInTheDocument();
  });

  it("shows a red unencrypted badge when encryption is explicitly disabled", () => {
    const data = storageCardSchema.parse({ bucketName: "logs-bucket", encryption: "none" });

    render(<StorageCardComponent data={data} />);

    const badge = screen.getByTestId("encryption-badge");
    expect(badge).toHaveTextContent("Unencrypted");
    expect(badge.className).toContain("bg-red-50");
  });

  it("shows a red unencrypted badge when encryption is absent", () => {
    const data = storageCardSchema.parse({ bucketName: "logs-bucket" });

    render(<StorageCardComponent data={data} />);

    const badge = screen.getByTestId("encryption-badge");
    expect(badge).toHaveTextContent("Unencrypted");
    expect(badge.className).toContain("bg-red-50");
  });
});

describe("StorageCardComponent (public access)", () => {
  it("shows the green blocked badge and no alert when public access is blocked", () => {
    render(<StorageCardComponent data={fullData} />);

    const badge = screen.getByTestId("public-access-badge");
    expect(badge).toHaveTextContent("Public Access Blocked");
    expect(badge.className).toContain("bg-green-100");
    expect(screen.queryByTestId("public-access-alert")).not.toBeInTheDocument();
  });

  it("shows the red allowed badge and a prominent alert when public access is allowed", () => {
    const data = storageCardSchema.parse({
      bucketName: "public-bucket",
      publicAccessBlocked: false,
    });

    render(<StorageCardComponent data={data} />);

    const badge = screen.getByTestId("public-access-badge");
    expect(badge).toHaveTextContent("Public Access Allowed");
    expect(badge.className).toContain("bg-red-50");

    const alert = screen.getByTestId("public-access-alert");
    expect(alert).toHaveTextContent("Public access blocking is disabled.");
    expect(alert).toHaveTextContent("may be publicly reachable");
    expect(alert).toHaveTextContent("Check its access policy before approval.");
  });
});

describe("isEncryptionEnabled", () => {
  it("treats real encryption methods as enabled", () => {
    expect(isEncryptionEnabled("KMS")).toBe(true);
    expect(isEncryptionEnabled("SSE-S3")).toBe(true);
    expect(isEncryptionEnabled("aws:kms")).toBe(true);
    expect(isEncryptionEnabled("AES256")).toBe(true);
    expect(isEncryptionEnabled("  AWS:KMS ")).toBe(true);
  });

  it("treats missing or disabling values as unencrypted", () => {
    expect(isEncryptionEnabled(undefined)).toBe(false);
    expect(isEncryptionEnabled("")).toBe(false);
    expect(isEncryptionEnabled(" \t\n ")).toBe(false);
    expect(isEncryptionEnabled("  NONE ")).toBe(false);
    expect(isEncryptionEnabled("disabled")).toBe(false);
    expect(isEncryptionEnabled("plaintext")).toBe(false);
  });
});

describe("StorageCardComponent (states)", () => {
  it("renders a loading skeleton when state=loading", () => {
    render(<StorageCardComponent data={fullData} state="loading" />);

    expect(screen.getByRole("status", { name: "Loading storage resource" })).toBeInTheDocument();
    expect(screen.queryByText("prod-assets-bucket")).not.toBeInTheDocument();
  });

  it("renders the loading skeleton when data is missing", () => {
    render(<StorageCardComponent />);

    expect(screen.getByRole("status", { name: "Loading storage resource" })).toBeInTheDocument();
  });

  it("renders the error fallback when state=error", () => {
    render(<StorageCardComponent data={fullData} state="error" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Storage resource unavailable");
    expect(screen.getByText("Storage resource unavailable")).toBeInTheDocument();
  });

  it("surfaces a custom error message in the error fallback", () => {
    render(
      <StorageCardComponent
        data={fullData}
        state="error"
        errorMessage="Storage feed is offline."
      />,
    );

    expect(screen.getByText("Storage feed is offline.")).toBeInTheDocument();
  });
});

describe("storageCardSchema", () => {
  it("defaults versioning to false and public access to blocked when omitted", () => {
    const data = storageCardSchema.parse({ bucketName: "defaults-bucket" });

    expect(data.versioning).toBe(false);
    expect(data.publicAccessBlocked).toBe(true);
    expect(data.encryption).toBeUndefined();
  });
});
