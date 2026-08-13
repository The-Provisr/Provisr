import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockResources } from "@/lib/resources/mock-data";
import {
  diffLines,
  ResourceTable,
} from "./resource-table";

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => (
    <span aria-hidden="true" data-testid="mock-cloud-logo" />
  ),
}));

const rowNames = () =>
  screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => {
      const cell = within(row).getAllByRole("cell")[1];
      return cell?.querySelector("div.font-medium")?.textContent ?? "";
    });

const expandRowWith = (name: string) => {
  const row = screen
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryByText(name));
  fireEvent.click(
    within(row as HTMLElement).getByRole("button", { name: "Expand resource" }),
  );
};

describe("ResourceTable", () => {
  it("renders every resource with provider, region, status and drift", () => {
    render(<ResourceTable resources={mockResources} />);
    expect(rowNames()).toHaveLength(7);
    expect(rowNames().find((name) => name.includes("staging-aks"))).toBe("staging-aks");
    expect(screen.getAllByText("us-east-1")).toHaveLength(3);
    expect(screen.getAllByText("Running")).toHaveLength(4);
    const tbody = screen.getByRole("table").querySelector("tbody") as HTMLElement;
    expect(within(tbody).getAllByText("Drift")).toHaveLength(2);
    expect(within(tbody).getAllByText("In sync")).toHaveLength(5);
  });

  it("filters by search query", () => {
    render(<ResourceTable resources={mockResources} />);
    fireEvent.change(screen.getByLabelText("Search resources"), {
      target: { value: "aks" },
    });
    expect(rowNames().filter((name) => name.includes("staging-aks"))).toEqual(["staging-aks"]);
  });

  it("filters by provider", () => {
    render(<ResourceTable resources={mockResources} />);
    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "azure" },
    });
    expect(rowNames()).toEqual(["shared-vnet", "staging-aks"]);
  });

  it("filters by drift status", () => {
    render(<ResourceTable resources={mockResources} />);
    fireEvent.change(screen.getByLabelText("Drift status"), {
      target: { value: "drift" },
    });
    expect(rowNames()).toEqual(["public-web-alb", "web-prod-db"]);
  });

  it("clears all filters", () => {
    render(<ResourceTable resources={mockResources} />);
    fireEvent.change(screen.getByLabelText("Search resources"), {
      target: { value: "aks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(rowNames()).toHaveLength(7);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("shows an empty message when nothing matches", () => {
    render(<ResourceTable resources={mockResources} />);
    fireEvent.change(screen.getByLabelText("Search resources"), {
      target: { value: "zzz-no-match" },
    });
    expect(screen.getByText("No resources match your filters")).toBeInTheDocument();
  });

  it("sorts by name ascending by default and toggles to descending", () => {
    render(<ResourceTable resources={mockResources} />);
    expect(rowNames()[0]).toBe("acme-data-lake");
    fireEvent.click(screen.getByRole("button", { name: "Resource" }));
    expect(rowNames()[0]).toBe("web-prod-service");
  });

  it("expands a row to show metadata, tags, ownership and drift comparison", () => {
    render(<ResourceTable resources={mockResources} />);
    expandRowWith("web-prod-db");
    expect(screen.getByText("Metadata")).toBeInTheDocument();
    expect(screen.getByText("env: production")).toBeInTheDocument();
    expect(screen.getByText("Planned state")).toBeInTheDocument();
    expect(screen.getByText("Actual state")).toBeInTheDocument();
    expect(screen.getByText("run_8f2d91")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Collapse resource" });
    fireEvent.click(toggle);
    expect(screen.queryByText("Planned state")).not.toBeInTheDocument();
  });

  it("does not render a drift comparison for in-sync resources", () => {
    render(<ResourceTable resources={mockResources} />);
    expandRowWith("staging-aks");
    expect(screen.queryByText("Planned state")).not.toBeInTheDocument();
    expect(screen.getByText("run_5ea2c4")).toBeInTheDocument();
    expect(
      screen.queryByText("No linked provisioning run"),
    ).not.toBeInTheDocument();
  });

  it("annotates sortable columns with aria-sort", () => {
    render(<ResourceTable resources={mockResources} />);
    const header = screen.getByRole("columnheader", { name: "Resource" });
    expect(header).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(screen.getByRole("button", { name: "Resource" }));
    expect(header).toHaveAttribute("aria-sort", "descending");
  });
});

describe("diffLines", () => {
  it("flags no lines for identical objects", () => {
    const state = { engine: "postgres", multiAz: true };
    const { left, right } = diffLines(state, state);
    expect(left.every((flag) => flag === "")).toBe(true);
    expect(right.every((flag) => flag === "")).toBe(true);
  });

  it("flags changed lines on both sides", () => {
    const expected = { engine: "postgres", instanceClass: "db.r6g.large" };
    const actual = { engine: "postgres", instanceClass: "db.r6g.xlarge" };
    const { left, right } = diffLines(expected, actual);
    expect(left.filter((flag) => flag === "changed")).toHaveLength(1);
    expect(right.filter((flag) => flag === "changed")).toHaveLength(1);
  });
});