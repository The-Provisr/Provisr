import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPROVAL_NOTE,
  LoadbalancerCardComponent,
  isPubliclyExposed,
  isTlsListener,
  loadbalancerCardSchema,
} from "./loadbalancer_card";
import type { LoadbalancerCardData } from "./loadbalancer_card";

const fullData: LoadbalancerCardData = loadbalancerCardSchema.parse({
  name: "web-alb",
  lbType: "ALB",
  scheme: "internet-facing",
  listeners: [
    {
      port: 443,
      protocol: "HTTPS",
      sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
      targetGroup: "web-tg",
    },
    { port: 80, protocol: "HTTP", targetGroup: "web-tg" },
  ],
  targetGroups: [
    {
      name: "web-tg",
      protocol: "HTTP",
      port: 8080,
      healthCheckPath: "/healthz",
      interval: 30,
    },
  ],
  policyNotes: ["HTTP listener should redirect to HTTPS"],
});

const internalData: LoadbalancerCardData = loadbalancerCardSchema.parse({
  name: "orders-nlb",
  lbType: "NLB",
  scheme: "internal",
  listeners: [{ port: 5432, protocol: "TCP", targetGroup: "orders-db-tg" }],
  targetGroups: [{ name: "orders-db-tg", protocol: "TCP", port: 5432 }],
});

describe("LoadbalancerCardComponent (header)", () => {
  it("renders the name, LB type label and traffic path", () => {
    render(<LoadbalancerCardComponent data={fullData} />);

    expect(screen.getByRole("heading", { name: "web-alb" })).toBeInTheDocument();
    expect(screen.getByTestId("lb-type-badge")).toHaveTextContent(
      "ALB · Application Load Balancer",
    );

    const path = screen.getByTestId("traffic-path");
    expect(path).toHaveTextContent("Internet");
    expect(path).toHaveTextContent("2 listeners");
    expect(path).toHaveTextContent("1 target group");
  });

  it("shows an amber internet-facing scheme badge", () => {
    render(<LoadbalancerCardComponent data={fullData} />);

    const badge = screen.getByTestId("scheme-badge");
    expect(badge).toHaveTextContent("Internet-facing");
    expect(badge.className).toContain("bg-amber-50");
  });

  it("shows a gray internal scheme badge", () => {
    render(<LoadbalancerCardComponent data={internalData} />);

    const badge = screen.getByTestId("scheme-badge");
    expect(badge).toHaveTextContent("Internal");
    expect(badge.className).toContain("bg-gray-100");
    expect(screen.getByTestId("lb-type-badge")).toHaveTextContent("Network Load Balancer");
    expect(screen.getByTestId("traffic-path")).toHaveTextContent("Private network");
  });

  it("labels AGW as an Application Gateway", () => {
    const data = loadbalancerCardSchema.parse({ ...internalData, lbType: "AGW" });

    render(<LoadbalancerCardComponent data={data} />);

    expect(screen.getByTestId("lb-type-badge")).toHaveTextContent("Application Gateway");
  });
});

describe("LoadbalancerCardComponent (public exposure)", () => {
  it("shows the exposure badge with the default approval note when internet-facing", () => {
    render(<LoadbalancerCardComponent data={fullData} />);

    const alert = screen.getByTestId("public-exposure-alert");
    expect(alert).toHaveTextContent("Public Exposure");
    expect(alert).toHaveTextContent(DEFAULT_APPROVAL_NOTE);
  });

  it("uses the payload approval note when provided", () => {
    const data = loadbalancerCardSchema.parse({
      ...fullData,
      approvalNote: "Requires security team approval (policy LB-001).",
    });

    render(<LoadbalancerCardComponent data={data} />);

    expect(screen.getByTestId("public-exposure-alert")).toHaveTextContent(
      "Requires security team approval (policy LB-001).",
    );
  });

  it("hides the exposure alert for internal load balancers", () => {
    render(<LoadbalancerCardComponent data={internalData} />);

    expect(screen.queryByTestId("public-exposure-alert")).not.toBeInTheDocument();
  });

  it("shows the exposure alert for internal load balancers flagged as publicly exposed", () => {
    const data = loadbalancerCardSchema.parse({ ...internalData, publicExposure: true });

    render(<LoadbalancerCardComponent data={data} />);

    expect(screen.getByTestId("public-exposure-alert")).toBeInTheDocument();
  });
});

function listenerRow(index: number): HTMLElement {
  // Row 0 is the header row.
  const row = within(screen.getByRole("table")).getAllByRole("row")[index + 1];
  if (!row) throw new Error(`listener row ${index} not rendered`);
  return row;
}

describe("LoadbalancerCardComponent (listeners)", () => {
  it("renders one table row per listener with SSL policy and forwarding target", () => {
    render(<LoadbalancerCardComponent data={fullData} />);

    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);

    const httpsRow = listenerRow(0);
    expect(within(httpsRow).getByText("443")).toBeInTheDocument();
    expect(within(httpsRow).getByText("HTTPS")).toBeInTheDocument();
    expect(within(httpsRow).getByText("TLS")).toBeInTheDocument();
    expect(
      within(httpsRow).getByText("ELBSecurityPolicy-TLS13-1-2-2021-06"),
    ).toBeInTheDocument();
    expect(within(httpsRow).getByText("web-tg")).toBeInTheDocument();
  });

  it("flags plaintext listeners on internet-facing load balancers", () => {
    render(<LoadbalancerCardComponent data={fullData} />);

    expect(within(listenerRow(1)).getByText("Unencrypted")).toBeInTheDocument();
  });

  it("does not flag plaintext listeners on internal load balancers", () => {
    render(<LoadbalancerCardComponent data={internalData} />);

    expect(screen.queryByText("Unencrypted")).not.toBeInTheDocument();
  });

  it("shows an empty message when there are no listeners", () => {
    const data = loadbalancerCardSchema.parse({ ...internalData, listeners: [] });

    render(<LoadbalancerCardComponent data={data} />);

    expect(screen.getByText("No listeners defined.")).toBeInTheDocument();
  });
});

describe("LoadbalancerCardComponent (target groups)", () => {
  it("is collapsed by default and expands to show health checks", () => {
    render(<LoadbalancerCardComponent data={fullData} />);

    const toggle = screen.getByRole("button", { name: /web-tg/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("/healthz")).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("/healthz")).toBeInTheDocument();
    expect(screen.getByText("30s")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("/healthz")).not.toBeInTheDocument();
  });

  it("shows placeholders when health check details are absent", () => {
    render(<LoadbalancerCardComponent data={internalData} />);

    fireEvent.click(screen.getByRole("button", { name: /orders-db-tg/ }));

    const panel = screen.getByText("Health check path").parentElement?.parentElement;
    expect(panel).toBeDefined();
    expect(within(panel as HTMLElement).getAllByText("—")).toHaveLength(2);
  });

  it("shows an empty message when there are no target groups", () => {
    const data = loadbalancerCardSchema.parse({ ...internalData, targetGroups: undefined });

    render(<LoadbalancerCardComponent data={data} />);

    expect(screen.getByText("No target groups defined.")).toBeInTheDocument();
  });
});

describe("LoadbalancerCardComponent (policy notes)", () => {
  it("renders deduplicated policy notes", () => {
    const data = loadbalancerCardSchema.parse({
      ...fullData,
      policyNotes: ["WAF required", "WAF required", "Access logs enabled"],
    });

    render(<LoadbalancerCardComponent data={data} />);

    const strip = screen.getByTestId("policy-notes");
    expect(within(strip).getAllByRole("listitem")).toHaveLength(2);
    expect(strip).toHaveTextContent("WAF required");
    expect(strip).toHaveTextContent("Access logs enabled");
  });

  it("hides the strip when there are no policy notes", () => {
    render(<LoadbalancerCardComponent data={internalData} />);

    expect(screen.queryByTestId("policy-notes")).not.toBeInTheDocument();
  });
});

describe("LoadbalancerCardComponent (states)", () => {
  it("renders a loading skeleton when state=loading", () => {
    render(<LoadbalancerCardComponent data={fullData} state="loading" />);

    expect(screen.getByRole("status", { name: "Loading load balancer" })).toBeInTheDocument();
    expect(screen.queryByText("web-alb")).not.toBeInTheDocument();
  });

  it("renders the loading skeleton when data is missing", () => {
    render(<LoadbalancerCardComponent />);

    expect(screen.getByRole("status", { name: "Loading load balancer" })).toBeInTheDocument();
  });

  it("renders the error fallback when state=error", () => {
    render(<LoadbalancerCardComponent data={fullData} state="error" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Load balancer unavailable");
  });

  it("surfaces a custom error message in the error fallback", () => {
    render(
      <LoadbalancerCardComponent
        data={fullData}
        state="error"
        errorMessage="Load balancer feed is offline."
      />,
    );

    expect(screen.getByText("Load balancer feed is offline.")).toBeInTheDocument();
  });
});

describe("helpers", () => {
  it("isPubliclyExposed covers scheme and explicit exposure", () => {
    expect(isPubliclyExposed({ scheme: "internet-facing" })).toBe(true);
    expect(isPubliclyExposed({ scheme: "internal" })).toBe(false);
    expect(isPubliclyExposed({ scheme: "internal", publicExposure: true })).toBe(true);
    expect(isPubliclyExposed({ scheme: "internal", publicExposure: false })).toBe(false);
  });

  it("isTlsListener detects TLS protocols and SSL policies", () => {
    expect(isTlsListener({ port: 443, protocol: "HTTPS" })).toBe(true);
    expect(isTlsListener({ port: 443, protocol: " tls " })).toBe(true);
    expect(isTlsListener({ port: 8443, protocol: "TCP", sslPolicy: "tls-1-2" })).toBe(false);
    expect(isTlsListener({ port: 80, protocol: "HTTP" })).toBe(false);
    expect(isTlsListener({ port: 80, protocol: "HTTP", sslPolicy: "  " })).toBe(false);
  });
});

describe("exposure review regressions", () => {
  it("does not mark plaintext as TLS because a policy string is present", () => {
    const data=loadbalancerCardSchema.parse({...fullData,listeners:[{port:80,protocol:"HTTP",sslPolicy:"tls-policy"}]});
    render(<LoadbalancerCardComponent data={data} />);
    expect(screen.queryByText("TLS")).not.toBeInTheDocument();
    expect(screen.getByText("Unencrypted")).toBeInTheDocument();
  });
  it("warns about plaintext on explicitly exposed internal-scheme balancers", () => {
    render(<LoadbalancerCardComponent data={{...internalData,publicExposure:true}} />);
    expect(screen.getByText("Unencrypted")).toBeInTheDocument();
  });
  it("does not invent a required approval decision", () => {
    expect(DEFAULT_APPROVAL_NOTE).not.toMatch(/require approval/i);
  });
});

describe("loadbalancerCardSchema", () => {
  const base = {
    name: "web-alb",
    lbType: "ALB",
    scheme: "internal",
    listeners: [{ port: 80, protocol: "HTTP" }],
  };

  it("defaults targetGroups and policyNotes to empty arrays", () => {
    const data = loadbalancerCardSchema.parse(base);

    expect(data.targetGroups).toEqual([]);
    expect(data.policyNotes).toEqual([]);
    expect(data.publicExposure).toBeUndefined();
  });

  it("rejects a payload without a scheme", () => {
    const { scheme: _scheme, ...withoutScheme } = base;

    expect(loadbalancerCardSchema.safeParse(withoutScheme).success).toBe(false);
  });

  it("rejects an unknown lbType", () => {
    expect(loadbalancerCardSchema.safeParse({ ...base, lbType: "application" }).success).toBe(
      false,
    );
  });

  it("rejects out-of-range ports", () => {
    for (const port of [0, 70000, 80.5]) {
      expect(
        loadbalancerCardSchema.safeParse({
          ...base,
          listeners: [{ port, protocol: "HTTP" }],
        }).success,
      ).toBe(false);
      expect(
        loadbalancerCardSchema.safeParse({
          ...base,
          targetGroups: [{ name: "tg", protocol: "HTTP", port }],
        }).success,
      ).toBe(false);
    }
  });
});
