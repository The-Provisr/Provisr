import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ResourceTableComponent,
  resourceTableSchema,
  type ResourceTableData,
} from "./resource_table";

const data: ResourceTableData = {
  title: "Manifest resources",
  rows: [
    {
      id: "vpc-1",
      name: "network",
      type: "aws_vpc",
      provider: "aws",
      region: "ap-southeast-1",
      status: "ready",
      dependsOn: [],
      warningCount: 0,
      spec: { cidr: "10.0.0.0/16" },
    },
    {
      id: "app-1",
      name: "web-app",
      type: "aws_ec2",
      provider: "aws",
      region: "ap-southeast-1",
      status: "draft",
      dependsOn: ["network"],
      warningCount: 2,
      spec: { instance_type: "t3.medium", tags: { owner: "platform" } },
    },
    {
      id: "unknown-1",
      name: "external-cache",
      type: "custom_cache",
      provider: "other-cloud",
      region: "local-zone-1",
      status: "provisioning",
      dependsOn: [],
      warningCount: 0,
    },
  ],
};

describe("ResourceTableComponent", () => {
  it("renders the exact empty state", () => {
    render(<ResourceTableComponent data={{ rows: [] }} />);
    expect(screen.getByText("No resources in the manifest yet.")).toBeInTheDocument();
  });

  it("renders resource metadata and forward-compatible icon/status labels", () => {
    render(<ResourceTableComponent data={data} />);
    expect(screen.getByText("web-app")).toBeInTheDocument();
    expect(screen.getByText("ap-southeast-1")).toBeInTheDocument();
    expect(screen.getByText("other-cloud")).toBeInTheDocument();
    expect(screen.getByText("provisioning")).toBeInTheDocument();
    expect(screen.getByLabelText("2 warnings")).toHaveTextContent("2");
  });

  it("searches and filters resources by type, provider, and region", () => {
    render(<ResourceTableComponent data={data} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search resources" }), { target: { value: "web" } });
    expect(screen.getByText("web-app")).toBeInTheDocument();
    expect(screen.queryByText("external-cache")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search resources" }), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter by type"), { target: { value: "custom_cache" } });
    fireEvent.change(screen.getByLabelText("Filter by provider"), { target: { value: "other-cloud" } });
    fireEvent.change(screen.getByLabelText("Filter by region"), { target: { value: "local-zone-1" } });
    expect(screen.getByText("external-cache")).toBeInTheDocument();
    expect(screen.queryByText("web-app")).not.toBeInTheDocument();
  });

  it("sorts logical names in both directions", () => {
    render(<ResourceTableComponent data={data} />);
    const table = screen.getByRole("table");
    const names = () => within(table).getAllByRole("rowheader").map((cell) => cell.textContent);

    fireEvent.click(screen.getByRole("button", { name: /Logical name/ }));
    expect(names()).toEqual(["web-app", "network", "external-cache"]);
    fireEvent.click(screen.getByRole("button", { name: /Logical name/ }));
    expect(names()).toEqual(["external-cache", "network", "web-app"]);
  });

  it("expands a row and renders the full spec as text", () => {
    render(<ResourceTableComponent data={{ ...data, rows: [{ ...data.rows[1]!, spec: { note: "<script>alert(1)</script>", clientSecret: "do-not-show" } }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Show specification for web-app" }));
    expect(screen.getByTestId("resource-spec-app-1")).toHaveTextContent("<script>alert(1)</script>");
    expect(screen.getByTestId("resource-spec-app-1")).toHaveTextContent("[REDACTED]");
    expect(screen.queryByText("do-not-show")).not.toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("clears filters and expands a dependency target when it is clicked", () => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    render(<ResourceTableComponent data={data} />);
    fireEvent.change(screen.getByLabelText("Filter by type"), { target: { value: "aws_ec2" } });
    fireEvent.click(screen.getByRole("button", { name: "network" }));
    expect(screen.getByTestId("resource-spec-vpc-1")).toBeInTheDocument();
  });

  it("emits a typed domain-card navigation request", () => {
    const onNavigateResource = vi.fn();
    render(<ResourceTableComponent data={data} onNavigateResource={onNavigateResource} />);
    fireEvent.click(screen.getByRole("button", { name: "Open domain card for web-app" }));
    expect(onNavigateResource).toHaveBeenCalledExactlyOnceWith({
      type: "resource_navigation",
      target: "domain_card",
      resourceId: "app-1",
      resourceName: "web-app",
    });
  });

  it("applies defaults and rejects invalid warning counts", () => {
    const parsed = resourceTableSchema.parse({ rows: [{ id: "r1", name: "db", type: "aws_rds", provider: "aws", status: "draft" }] });
    expect(parsed.rows[0]?.warningCount).toBe(0);
    expect(parsed.rows[0]?.dependsOn).toEqual([]);
    expect(resourceTableSchema.safeParse({ rows: [{ id: "r1", name: "db", type: "aws_rds", provider: "aws", status: "draft", warningCount: -1 }] }).success).toBe(false);
  });
});
