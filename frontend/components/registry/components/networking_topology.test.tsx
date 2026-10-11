import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  NetworkingTopologyComponent,
  findPublicIngressExposures,
  networkingTopologySchema,
} from "./networking_topology";
import type { NetworkingTopologyData } from "./networking_topology";

const fullData: NetworkingTopologyData = networkingTopologySchema.parse({
  vpcName: "prod-vpc",
  vpcCidr: "10.0.0.0/16",
  subnets: [
    { name: "web-public-a", cidr: "10.0.1.0/24", type: "public", zone: "us-east-1a" },
    { name: "app-private-a", cidr: "10.0.2.0/24", type: "private", zone: "us-east-1b" },
    { name: "db-isolated-a", cidr: "10.0.3.0/24", type: "isolated" },
  ],
  internetGateway: true,
  natGateway: true,
  securityGroups: [
    {
      name: "web-sg",
      rules: [
        { direction: "ingress", protocol: "tcp", portRange: "443", source: "0.0.0.0/0" },
        {
          direction: "egress",
          protocol: "tcp",
          portRange: "443",
          destination: "10.0.0.0/16",
        },
      ],
    },
  ],
});

describe("NetworkingTopologyComponent (header + subnets)", () => {
  it("renders the VPC name, primary CIDR badge and gateway chips", () => {
    render(<NetworkingTopologyComponent data={fullData} />);

    expect(screen.getByText("prod-vpc")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.0/16")).toBeInTheDocument();
    expect(screen.getByText("Internet Gateway (IGW)")).toBeInTheDocument();
    expect(screen.getByText("NAT Gateway")).toBeInTheDocument();
  });

  it("renders the subnets table with name, CIDR, AZ and type badges", () => {
    render(<NetworkingTopologyComponent data={fullData} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("web-public-a")).toBeInTheDocument();
    expect(screen.getByText("10.0.1.0/24")).toBeInTheDocument();
    expect(screen.getByText("us-east-1a")).toBeInTheDocument();
    expect(screen.getByText("us-east-1b")).toBeInTheDocument();
    expect(screen.getByText("public")).toBeInTheDocument();
    expect(screen.getByText("private")).toBeInTheDocument();
    expect(screen.getByText("isolated")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders an empty state when there are no subnets", () => {
    const data = networkingTopologySchema.parse({
      vpcCidr: "10.0.0.0/16",
      subnets: [],
    });

    render(<NetworkingTopologyComponent data={data} />);

    expect(screen.getByText("No subnets defined.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("NetworkingTopologyComponent (security group rules)", () => {
  it("renders rule direction, protocol, port range and source/destination", () => {
    render(<NetworkingTopologyComponent data={fullData} />);

    expect(screen.getByText("web-sg")).toBeInTheDocument();
    expect(screen.getByText("2 rules")).toBeInTheDocument();
    expect(screen.getByText("ingress")).toBeInTheDocument();
    expect(screen.getByText("egress")).toBeInTheDocument();
    expect(screen.getAllByText("tcp")).toHaveLength(2);
    expect(screen.getAllByText("443")).toHaveLength(2);
    expect(screen.getByText("from 0.0.0.0/0")).toBeInTheDocument();
    expect(screen.getByText("to 10.0.0.0/16")).toBeInTheDocument();
  });

  it("shows a count-only summary for legacy groups without rule detail", () => {
    const data = networkingTopologySchema.parse({
      vpcCidr: "10.0.0.0/16",
      subnets: [],
      securityGroups: [{ name: "legacy-sg", rulesCount: "4" }],
    });

    render(<NetworkingTopologyComponent data={data} />);

    expect(screen.getByText("legacy-sg")).toBeInTheDocument();
    expect(screen.getByText("4 rules")).toBeInTheDocument();
    expect(screen.queryByText("ingress")).not.toBeInTheDocument();
  });
});

describe("NetworkingTopologyComponent (public exposure)", () => {
  it("flags, highlights and summarises a 0.0.0.0/0 ingress exposure", () => {
    render(<NetworkingTopologyComponent data={fullData} />);

    expect(screen.getByTestId("public-exposure-badge")).toHaveTextContent(
      "Public Exposure Detected",
    );
    expect(
      screen.getByText(/1 public ingress rule allows traffic from the public internet/),
    ).toBeInTheDocument();

    const exposedSource = screen.getByText("from 0.0.0.0/0");
    expect(exposedSource.closest("div.border-red-200")).not.toBeNull();
    expect(exposedSource).toHaveClass("text-red-900");

    const safeDestination = screen.getByText("to 10.0.0.0/16");
    expect(safeDestination.closest("div.border-red-200")).toBeNull();
  });

  it("does not flag ingress rules limited to private CIDRs", () => {
    const data = networkingTopologySchema.parse({
      vpcCidr: "10.0.0.0/16",
      subnets: [],
      securityGroups: [
        {
          name: "internal-sg",
          rules: [
            { direction: "ingress", protocol: "tcp", portRange: "5432", source: "10.0.0.0/16" },
          ],
        },
      ],
    });

    render(<NetworkingTopologyComponent data={data} />);

    expect(screen.queryByTestId("public-exposure-badge")).not.toBeInTheDocument();
    expect(screen.queryByText(/public ingress/)).not.toBeInTheDocument();
  });

  it("does not flag egress traffic destined for 0.0.0.0/0", () => {
    const data = networkingTopologySchema.parse({
      vpcCidr: "10.0.0.0/16",
      subnets: [],
      securityGroups: [
        {
          name: "egress-sg",
          rules: [
            {
              direction: "egress",
              protocol: "all",
              portRange: "all",
              destination: "0.0.0.0/0",
            },
          ],
        },
      ],
    });

    render(<NetworkingTopologyComponent data={data} />);

    expect(screen.queryByTestId("public-exposure-badge")).not.toBeInTheDocument();
  });

  it("treats an IPv6 ::/0 ingress source as a public exposure", () => {
    const data = networkingTopologySchema.parse({
      vpcCidr: "10.0.0.0/16",
      subnets: [],
      securityGroups: [
        {
          name: "v6-sg",
          rules: [
            { direction: "ingress", protocol: "tcp", portRange: "80", source: "::/0" },
          ],
        },
      ],
    });

    render(<NetworkingTopologyComponent data={data} />);

    expect(screen.getByTestId("public-exposure-badge")).toBeInTheDocument();
  });

  it("reports the count when multiple public ingress rules exist", () => {
    const data = networkingTopologySchema.parse({
      vpcCidr: "10.0.0.0/16",
      subnets: [],
      securityGroups: [
        {
          name: "open-sg",
          rules: [
            { direction: "ingress", protocol: "tcp", portRange: "80", source: "0.0.0.0/0" },
            { direction: "ingress", protocol: "tcp", portRange: "22", source: "0.0.0.0/0" },
          ],
        },
      ],
    });

    render(<NetworkingTopologyComponent data={data} />);

    expect(
      screen.getByText(/2 public ingress rules allow traffic from the public internet/),
    ).toBeInTheDocument();
  });

  it("detects exposures even when the CIDR has surrounding whitespace", () => {
    const data = networkingTopologySchema.parse({
      vpcCidr: "10.0.0.0/16",
      subnets: [],
      securityGroups: [
        {
          name: "padded-sg",
          rules: [
            { direction: "ingress", protocol: "tcp", portRange: "443", source: " 0.0.0.0/0 " },
          ],
        },
      ],
    });

    expect(findPublicIngressExposures(data)).toHaveLength(1);
  });
});

describe("NetworkingTopologyComponent (states)", () => {
  it("renders a loading skeleton when state=loading", () => {
    render(<NetworkingTopologyComponent data={fullData} state="loading" />);

    expect(screen.getByTestId("networking-topology-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("prod-vpc")).not.toBeInTheDocument();
  });

  it("renders the loading skeleton when data is missing", () => {
    render(<NetworkingTopologyComponent />);

    expect(screen.getByTestId("networking-topology-skeleton")).toBeInTheDocument();
  });

  it("renders the error fallback when state=error", () => {
    render(<NetworkingTopologyComponent data={fullData} state="error" />);

    expect(screen.getByTestId("networking-topology-error")).toBeInTheDocument();
    expect(screen.getByText("Networking topology unavailable")).toBeInTheDocument();
    expect(screen.queryByText("prod-vpc")).not.toBeInTheDocument();
  });

  it("surfaces a custom error message in the error fallback", () => {
    render(
      <NetworkingTopologyComponent
        state="error"
        errorMessage="Topology feed is offline."
      />,
    );

    expect(screen.getByText("Topology feed is offline.")).toBeInTheDocument();
  });
});

describe("networkingTopologySchema", () => {
  it("coerces a string rulesCount into a number", () => {
    const data = networkingTopologySchema.parse({
      vpcCidr: "10.0.0.0/16",
      subnets: [],
      securityGroups: [{ name: "legacy", rulesCount: "4" }],
    });

    expect(data.securityGroups?.[0]?.rulesCount).toBe(4);
  });

  it("rejects invalid subnet types and rule directions", () => {
    expect(() =>
      networkingTopologySchema.parse({
        vpcCidr: "10.0.0.0/16",
        subnets: [{ name: "a", cidr: "10.0.1.0/24", type: "dmz" }],
      }),
    ).toThrow();

    expect(() =>
      networkingTopologySchema.parse({
        vpcCidr: "10.0.0.0/16",
        subnets: [],
        securityGroups: [
          {
            name: "sg",
            rules: [{ direction: "sideways", protocol: "tcp", portRange: "1" }],
          },
        ],
      }),
    ).toThrow();
  });
});
