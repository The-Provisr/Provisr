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
    expect(within(screen.getByRole("table")).getAllByRole("cell", { name: "ap-southeast-1" })).toHaveLength(2);
    expect(within(screen.getByRole("table")).getByRole("cell", { name: /other-cloud/ })).toBeInTheDocument();
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

  it("redacts named credential entries and explicitly sensitive values", () => {
    const spec = {
      env: [
        { name: "AWS_SECRET_ACCESS_KEY", value: "hidden-cloud-value" },
        { key: "DB_PASSWORD", value: "hidden-db-value" },
        { name: "APP_MODE", value: "production" },
      ],
      output: { sensitive: true, value: "hidden-output-value" },
    };
    render(<ResourceTableComponent data={{ rows: [{ ...data.rows[1]!, spec }] }} />);
    fireEvent.click(screen.getByRole("button", { name: "Show specification for web-app" }));
    const details = screen.getByTestId("resource-spec-app-1");
    expect(details).not.toHaveTextContent("hidden-cloud-value");
    expect(details).not.toHaveTextContent("hidden-db-value");
    expect(details).not.toHaveTextContent("hidden-output-value");
    expect(details).toHaveTextContent("production");
    expect(spec.env[0]?.value).toBe("hidden-cloud-value");
  });

  it("navigates within its own table and moves focus to the revealed dependency", () => {
    const scrolled: HTMLElement[] = [];
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: HTMLElement) { scrolled.push(this); },
    });
    render(<><ResourceTableComponent data={data} /><ResourceTableComponent data={data} /></>);
    const tables = screen.getAllByRole("table");
    const activeTable = tables[1]!;
    const dependency = within(activeTable).getByRole("button", { name: "network" });
    dependency.focus();
    fireEvent.click(dependency);
    const target = within(activeTable).getByRole("button", { name: "Open domain card for network" }).closest("tr");
    expect(scrolled.at(-1)).toBe(target);
    expect(target).toHaveFocus();
    expect(within(tables[0]!).queryByTestId("resource-spec-vpc-1")).not.toBeInTheDocument();
  });

  it("searches dependency names when the graph references resource IDs", () => {
    const rows = data.rows.map((row) => row.id === "app-1" ? { ...row, dependsOn: ["vpc-1"] } : row);
    render(<ResourceTableComponent data={{ rows }} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search resources" }), { target: { value: "network" } });
    expect(screen.getByRole("button", { name: "Open domain card for web-app" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "network" })).toBeInTheDocument();
  });

  it("clears search and all filters with one action", () => {
    render(<ResourceTableComponent data={data} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search resources" }), { target: { value: "web" } });
    fireEvent.change(screen.getByLabelText("Filter by type"), { target: { value: "aws_ec2" } });
    fireEvent.change(screen.getByLabelText("Filter by provider"), { target: { value: "aws" } });
    fireEvent.change(screen.getByLabelText("Filter by region"), { target: { value: "ap-southeast-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("textbox", { name: "Search resources" })).toHaveValue("");
    expect(screen.getAllByRole("rowheader")).toHaveLength(3);
  });

  it("drops removed filter choices when a refreshed manifest replaces rows", () => {
    const { rerender } = render(<ResourceTableComponent data={data} />);
    fireEvent.change(screen.getByLabelText("Filter by type"), { target: { value: "custom_cache" } });
    fireEvent.change(screen.getByLabelText("Filter by provider"), { target: { value: "other-cloud" } });
    fireEvent.change(screen.getByLabelText("Filter by region"), { target: { value: "local-zone-1" } });
    rerender(<ResourceTableComponent data={{ rows: data.rows.slice(0, 2) }} />);
    expect(screen.getByRole("button", { name: "Open domain card for web-app" })).toBeInTheDocument();
    expect(screen.getByLabelText("Filter by type")).toHaveValue("all");
    expect(screen.getByLabelText("Filter by provider")).toHaveValue("all");
    expect(screen.getByLabelText("Filter by region")).toHaveValue("all");
  });
});
