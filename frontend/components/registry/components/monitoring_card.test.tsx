import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RegistryProvider } from "../RegistryProvider";
import { RegistryRenderer } from "../RegistryRenderer";
import {
  MonitoringCardComponent,
  formatDestination,
  monitoringCardSchema,
} from "./monitoring_card";
import type { MonitoringCardData } from "./monitoring_card";

const fullData: MonitoringCardData = monitoringCardSchema.parse({
  logGroupNames: ["/aws/ecs/checkout-api", "/aws/lambda/order-worker"],
  metricNamespaces: ["AWS/ECS", "Custom/Checkout"],
  alarmCount: 4,
  retentionDays: 30,
  notificationTargets: [
    { type: "sns", destination: "arn:aws:sns:us-east-1:123456789012:ops-alerts" },
    { type: "email", destination: "oncall@example.com" },
    { type: "webhook", destination: "https://hooks.slack.com/services/T000/B000/secret" },
  ],
  policyNotes: ["Retention below 90 days requires security sign-off in production."],
});

describe("MonitoringCardComponent (header)", () => {
  it("shows log group and alarm counts", () => {
    render(<MonitoringCardComponent data={fullData} />);

    expect(screen.getByText("Monitoring & Logging")).toBeInTheDocument();
    expect(screen.getByTestId("log-count")).toHaveTextContent("2 Log Groups");
    expect(screen.getByTestId("alarm-count")).toHaveTextContent("4 Alarms");
  });

  it("uses singular labels for counts of one", () => {
    const data = monitoringCardSchema.parse({
      logGroupNames: ["/app/api"],
      alarmCount: 1,
      retentionDays: 1,
    });

    render(<MonitoringCardComponent data={data} />);

    expect(screen.getByTestId("log-count")).toHaveTextContent("1 Log Group");
    expect(screen.getByTestId("alarm-count")).toHaveTextContent("1 Alarm");
    expect(screen.getByTestId("retention-badge")).toHaveTextContent("Retention: 1 day");
  });
});

describe("MonitoringCardComponent (details)", () => {
  it("renders the retention badge, monospace log groups and metric namespaces", () => {
    render(<MonitoringCardComponent data={fullData} />);

    expect(screen.getByTestId("retention-badge")).toHaveTextContent("Retention: 30 days");

    const logGroups = screen.getAllByTestId("log-group");
    expect(logGroups.map((el) => el.textContent)).toEqual([
      "/aws/ecs/checkout-api",
      "/aws/lambda/order-worker",
    ]);
    expect(logGroups[0]).toHaveClass("font-mono");

    expect(screen.getByText("AWS/ECS")).toBeInTheDocument();
    expect(screen.getByText("Custom/Checkout")).toBeInTheDocument();
  });

  it("renders each notification target with its type", () => {
    render(<MonitoringCardComponent data={fullData} />);

    expect(screen.getByTestId("notification-target-sns")).toHaveTextContent(
      "SNSarn:aws:sns:us-east-1:123456789012:ops-alerts",
    );
    expect(screen.getByTestId("notification-target-email")).toHaveTextContent(
      "Emailoncall@example.com",
    );
    expect(screen.getByTestId("notification-target-webhook")).toHaveTextContent(
      "Webhookhttps://hooks.slack.com/…",
    );
    expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("no-notification-targets")).not.toBeInTheDocument();
  });

  it("renders the policy notes strip", () => {
    render(<MonitoringCardComponent data={fullData} />);

    expect(screen.getByTestId("policy-notes")).toHaveTextContent(
      "Retention below 90 days requires security sign-off in production.",
    );
  });

  it("hides optional sections and warns when nothing will be notified", () => {
    const data = monitoringCardSchema.parse({
      logGroupNames: [],
      alarmCount: 0,
      retentionDays: 14,
    });

    render(<MonitoringCardComponent data={data} />);

    expect(screen.getByText("No log groups configured.")).toBeInTheDocument();
    expect(screen.queryByText("Metric Namespaces")).not.toBeInTheDocument();
    expect(screen.queryByTestId("policy-notes")).not.toBeInTheDocument();
    expect(screen.getByTestId("no-notification-targets")).toHaveTextContent(
      "alarms will not notify anyone",
    );
  });
});

describe("formatDestination", () => {
  it("leaves SNS and email destinations unchanged", () => {
    expect(
      formatDestination({ type: "sns", destination: "arn:aws:sns:us-east-1:1:topic" }),
    ).toBe("arn:aws:sns:us-east-1:1:topic");
    expect(formatDestination({ type: "email", destination: "ops@example.com" })).toBe(
      "ops@example.com",
    );
  });

  it("redacts webhook paths, queries, fragments and credentials", () => {
    expect(
      formatDestination({ type: "webhook", destination: "https://hooks.slack.com/services/T/B/x" }),
    ).toBe("https://hooks.slack.com/…");
    expect(
      formatDestination({ type: "webhook", destination: "https://api.example.com/alerts?token=abc" }),
    ).toBe("https://api.example.com/…");
    expect(
      formatDestination({ type: "webhook", destination: "https://user:pass@example.com/hook" }),
    ).toBe("https://example.com/…");
    expect(formatDestination({ type: "webhook", destination: "https://example.com" })).toBe(
      "https://example.com",
    );
  });

  it("hides single-segment tokens and opaque URL payloads", () => {
    expect(formatDestination({ type: "webhook", destination: "https://example.com/SECRET" })).toBe("https://example.com/…");
    expect(formatDestination({ type: "webhook", destination: "data:text/plain,SECRET" })).toBe("Unrecognized webhook URL");
  });

  it("does not echo unparseable webhook destinations", () => {
    expect(formatDestination({ type: "webhook", destination: "not a url token=abc" })).toBe(
      "Unrecognized webhook URL",
    );
  });
});

describe("MonitoringCardComponent (states)", () => {
  it("renders a loading skeleton when state=loading", () => {
    render(<MonitoringCardComponent data={fullData} state="loading" />);

    expect(
      screen.getByRole("status", { name: "Loading monitoring configuration" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("/aws/ecs/checkout-api")).not.toBeInTheDocument();
  });

  it("renders the loading skeleton when data is missing", () => {
    render(<MonitoringCardComponent />);

    expect(
      screen.getByRole("status", { name: "Loading monitoring configuration" }),
    ).toBeInTheDocument();
  });

  it("renders the error fallback when state=error", () => {
    render(<MonitoringCardComponent data={fullData} state="error" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Monitoring configuration unavailable");
  });

  it("surfaces a custom error message in the error fallback", () => {
    render(
      <MonitoringCardComponent data={fullData} state="error" errorMessage="Feed is offline." />,
    );

    expect(screen.getByText("Feed is offline.")).toBeInTheDocument();
  });
});

describe("monitoringCardSchema", () => {
  it("defaults optional arrays to empty", () => {
    const data = monitoringCardSchema.parse({
      logGroupNames: ["/app"],
      alarmCount: 0,
      retentionDays: 7,
    });

    expect(data.metricNamespaces).toEqual([]);
    expect(data.notificationTargets).toEqual([]);
    expect(data.policyNotes).toEqual([]);
  });
});

describe("MonitoringCardComponent (registry)", () => {
  function renderPayload(data: unknown) {
    return render(
      <RegistryProvider>
        <RegistryRenderer
          payload={{ type: "monitoring_card", version: "1.0", requestId: "req_mon", data }}
        />
      </RegistryProvider>,
    );
  }

  it("renders the card through the default registry", () => {
    renderPayload(fullData);

    expect(screen.getByTestId("monitoring-card")).toBeInTheDocument();
    expect(screen.queryByText(/could not be rendered/i)).not.toBeInTheDocument();
  });

  it.each([
    ["missing log groups", { alarmCount: 1, retentionDays: 30 }],
    [
      "unknown notification type",
      {
        logGroupNames: ["/app"],
        alarmCount: 1,
        retentionDays: 30,
        notificationTargets: [{ type: "slack", destination: "#ops" }],
      },
    ],
    ["negative alarm count", { logGroupNames: ["/app"], alarmCount: -1, retentionDays: 30 }],
    ["zero retention", { logGroupNames: ["/app"], alarmCount: 1, retentionDays: 0 }],
  ])("renders the invalid payload fallback for %s", (_label, data) => {
    renderPayload(data);

    expect(screen.getByText(/could not be rendered/i)).toBeInTheDocument();
    expect(screen.queryByTestId("monitoring-card")).not.toBeInTheDocument();
  });
});
