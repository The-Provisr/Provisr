import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  RegionSelectorComponent,
  regionSelectorSchema,
  type RegionSelectorData,
} from "./region_selector";

const data: RegionSelectorData = {
  provider: "aws",
  selectedRegion: "ap-southeast-1",
  availableRegions: [
    { id: "ap-southeast-1", name: "Asia Pacific — Singapore", latencyMs: 80, available: true, restrictedByPolicy: false },
    { id: "us-east-1", name: "US East — N. Virginia", latencyMs: 180, available: true, restrictedByPolicy: false },
    { id: "eu-west-1", name: "Europe — Ireland", latencyMs: 300, available: false, restrictedByPolicy: false },
    { id: "ap-northeast-1", name: "Asia Pacific — Tokyo", available: true, restrictedByPolicy: true },
  ],
  providers: [
    {
      provider: "aws",
      selectedRegion: "ap-southeast-1",
      availableRegions: [
        { id: "ap-southeast-1", name: "Asia Pacific — Singapore", latencyMs: 80, available: true, restrictedByPolicy: false },
        { id: "us-east-1", name: "US East — N. Virginia", latencyMs: 180, available: true, restrictedByPolicy: false },
        { id: "eu-west-1", name: "Europe — Ireland", latencyMs: 300, available: false, restrictedByPolicy: false },
        { id: "ap-northeast-1", name: "Asia Pacific — Tokyo", available: true, restrictedByPolicy: true },
      ],
    },
    {
      provider: "azure",
      selectedRegion: "southeastasia",
      availableRegions: [{ id: "southeastasia", name: "Southeast Asia", latencyMs: 70, available: true, restrictedByPolicy: false }],
    },
  ],
};

describe("RegionSelectorComponent", () => {
  it("validates latency and availability metadata", () => {
    expect(regionSelectorSchema.safeParse(data).success).toBe(true);
    expect(
      regionSelectorSchema.safeParse({
        ...data,
        availableRegions: [{ id: "bad", name: "Bad", latencyMs: -1 }],
      }).success,
    ).toBe(false);
  });

  it("emits a typed selection update for an available region", () => {
    const onUpdate = vi.fn();
    render(<RegionSelectorComponent data={data} onUpdate={onUpdate} />);

    fireEvent.click(screen.getByRole("radio", { name: /US East/ }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      type: "region_selection",
      provider: "aws",
      regionId: "us-east-1",
    });
  });

  it("prevents selection of unavailable and policy restricted regions", () => {
    const onUpdate = vi.fn();
    render(<RegionSelectorComponent data={data} onUpdate={onUpdate} />);

    expect(screen.getByRole("radio", { name: /Ireland.*not available/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Tokyo.*restricted by policy/i })).toBeDisabled();
    expect(screen.getByText("Not available")).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("switches providers and displays that provider's supplied regions", () => {
    render(<RegionSelectorComponent data={data} />);

    fireEvent.click(screen.getByRole("button", { name: "Azure" }));

    expect(screen.getByRole("radio", { name: /Southeast Asia/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Singapore/ })).not.toBeInTheDocument();
  });

  it("renders loading and empty states with a connect action", () => {
    const { rerender } = render(<RegionSelectorComponent data={{ ...data, loading: true }} />);
    expect(screen.getByRole("region", { name: "Loading regions" })).toHaveAttribute("aria-busy", "true");

    rerender(<RegionSelectorComponent data={{ ...data, availableRegions: [], providers: [{ provider: "aws", availableRegions: [] }] }} />);
    expect(screen.getByText("No connected provider regions")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect provider" })).toHaveAttribute("href", "/onboarding");
  });

  it("renders latency levels with text labels for assistive technology", () => {
    render(<RegionSelectorComponent data={data} />);
    expect(screen.getByText("Low latency")).toBeInTheDocument();
    expect(screen.getByText("Medium latency")).toBeInTheDocument();
    expect(screen.getByText("High latency")).toBeInTheDocument();
  });
});
