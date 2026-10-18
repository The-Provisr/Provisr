import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { alt, src, ...rest } = props;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={String(alt ?? "")} src={String(src ?? "")} {...rest} />;
  },
}));

vi.mock("@/components/auth/post-auth-handoff", () => ({
  PostAuthHandoff: (props: { target: string; expectedWorkspaceId: string | null }) => (
    <div
      data-expected-workspace={props.expectedWorkspaceId ?? ""}
      data-target={props.target}
      data-testid="handoff"
    />
  ),
}));

import { WorkspaceOnboardingWizard } from "./workspace-onboarding-wizard";

function fillName(value: string) {
  fireEvent.change(screen.getByTestId("workspace-name-input"), { target: { value } });
}

function clickNext() {
  fireEvent.click(screen.getByTestId("wizard-next"));
}

function mockFetch(impl: (url: string, init: RequestInit) => Promise<unknown>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("WorkspaceOnboardingWizard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders step 1 with the name field and no back button", () => {
    render(<WorkspaceOnboardingWizard />);

    expect(screen.getByTestId("wizard-step-1")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-name-input")).toBeInTheDocument();
    expect(screen.getByTestId("slug-preview")).toHaveTextContent("provisr.app/your-workspace");
    expect(screen.queryByTestId("wizard-back")).not.toBeInTheDocument();
  });

  it("blocks advancing with an empty name and shows an inline error", () => {
    render(<WorkspaceOnboardingWizard />);

    clickNext();

    expect(screen.getByTestId("workspace-name-error")).toHaveTextContent("Enter a workspace name");
    expect(screen.getByTestId("wizard-step-1")).toBeInTheDocument();
  });

  it("rejects a name shorter than three characters", () => {
    render(<WorkspaceOnboardingWizard />);

    fillName("ab");
    clickNext();

    expect(screen.getByTestId("workspace-name-error")).toHaveTextContent("at least 3 characters");
    expect(screen.getByTestId("wizard-step-1")).toBeInTheDocument();
  });

  it("advances to step 2 with the development environment selected by default", () => {
    render(<WorkspaceOnboardingWizard />);

    fillName("Acme Platform");
    clickNext();

    expect(screen.getByTestId("wizard-step-2")).toBeInTheDocument();
    expect(screen.getByTestId("environment-card-development")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("wizard-back")).toBeInTheDocument();
  });

  it("selects an environment and advances to the provider step", () => {
    render(<WorkspaceOnboardingWizard />);

    fillName("Acme Platform");
    clickNext();
    fireEvent.click(screen.getByTestId("environment-card-production"));
    clickNext();

    expect(screen.getByTestId("wizard-step-3")).toBeInTheDocument();
    expect(screen.getByTestId("provider-card-aws")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-skip")).toBeInTheDocument();
    expect(screen.queryByTestId("environment-card-production")).not.toBeInTheDocument();
  });

  it("toggles providers on and off", () => {
    render(<WorkspaceOnboardingWizard />);
    fillName("Acme Platform");
    clickNext();
    clickNext();

    fireEvent.click(screen.getByTestId("provider-card-aws"));
    expect(screen.getByTestId("provider-card-aws")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("provider-card-aws"));
    expect(screen.getByTestId("provider-card-aws")).toHaveAttribute("aria-pressed", "false");
  });

  it("navigates back to the previous step", () => {
    render(<WorkspaceOnboardingWizard />);
    fillName("Acme Platform");
    clickNext();

    fireEvent.click(screen.getByTestId("wizard-back"));

    expect(screen.getByTestId("wizard-step-1")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-name-input")).toHaveValue("Acme Platform");
  });

  it("submits the workspace with name, environment and providers, then hands off", async () => {
    const fetchMock = mockFetch(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ workspaceId: "ws_1", slug: "acme-platform-1a2b3c4d", environment: "production" }),
    }));

    render(<WorkspaceOnboardingWizard />);
    fillName("Acme Platform");
    clickNext();
    fireEvent.click(screen.getByTestId("environment-card-production"));
    clickNext();
    fireEvent.click(screen.getByTestId("provider-card-aws"));
    fireEvent.click(screen.getByTestId("provider-card-gcp"));
    clickNext();

    await waitFor(() => expect(screen.getByTestId("handoff")).toBeInTheDocument());

    const handoff = screen.getByTestId("handoff");
    expect(handoff).toHaveAttribute("data-target", "/dashboard");
    expect(handoff).toHaveAttribute("data-expected-workspace", "ws_1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/workspace/create");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      name: "Acme Platform",
      environment: "production",
      providers: ["aws", "gcp"],
    });
    expect(init.headers).toMatchObject({ "Idempotency-Key": expect.any(String) });
  });

  it("lets the user skip remaining steps and creates a workspace with defaults", async () => {
    const fetchMock = mockFetch(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ workspaceId: "ws_skip", slug: "acme-platform", environment: "development" }),
    }));

    render(<WorkspaceOnboardingWizard />);
    fillName("Acme Platform");
    clickNext();
    fireEvent.click(screen.getByTestId("wizard-skip"));

    await waitFor(() => expect(screen.getByTestId("handoff")).toBeInTheDocument());

    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init.body))).toMatchObject({
      name: "Acme Platform",
      environment: "development",
      providers: [],
    });
  });

  it("maps a slug conflict back to a name error on step 1", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 409,
      json: async () => ({ code: "slug_taken", error: "slug taken" }),
    }));

    render(<WorkspaceOnboardingWizard />);
    fillName("Acme Platform");
    clickNext();
    clickNext();
    clickNext();

    await waitFor(() =>
      expect(screen.getByTestId("workspace-name-error")).toHaveTextContent("already taken"),
    );
    expect(screen.getByTestId("wizard-step-1")).toBeInTheDocument();
  });

  it("shows a retryable error banner when the server fails", async () => {
    mockFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    }));

    render(<WorkspaceOnboardingWizard />);
    fillName("Acme Platform");
    clickNext();
    clickNext();
    clickNext();

    await waitFor(() => expect(screen.getByTestId("wizard-error-banner")).toBeInTheDocument());
    expect(screen.getByTestId("wizard-error-banner")).toHaveTextContent("Please try again");
    expect(screen.getByTestId("wizard-next")).not.toBeDisabled();
  });
});
