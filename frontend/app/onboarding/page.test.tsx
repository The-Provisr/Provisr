import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  wizard: vi.fn(),
}));

vi.mock("@/components/onboarding/onboarding-flow", () => ({
  OnboardingFlow: (props: { clerkEnabled: boolean }) => {
    mocks.preview(props);
    return <div data-testid="keyless-preview" />;
  },
}));
vi.mock("@/components/onboarding/workspace-onboarding-wizard", () => ({
  WorkspaceOnboardingWizard: () => {
    mocks.wizard();
    return <div data-testid="workspace-wizard" />;
  },
}));

import OnboardingPage from "./page";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("OnboardingPage", () => {
  it.each([
    [undefined, undefined],
    [undefined, "sk_test_present"],
    ["pk_test_present", undefined],
    ["", "sk_test_present"],
    ["pk_test_present", ""],
  ])("uses the keyless preview when Clerk keys are incomplete: %j %j", (publishable, secret) => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", publishable);
    vi.stubEnv("CLERK_SECRET_KEY", secret);

    render(<OnboardingPage />);

    expect(screen.getByTestId("keyless-preview")).toBeInTheDocument();
    expect(mocks.preview).toHaveBeenCalledWith({ clerkEnabled: false });
    expect(mocks.wizard).not.toHaveBeenCalled();
  });

  it("renders the real workspace wizard when both Clerk keys are configured", () => {
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_present");
    vi.stubEnv("CLERK_SECRET_KEY", "sk_test_present");

    render(<OnboardingPage />);

    expect(screen.getByTestId("workspace-wizard")).toBeInTheDocument();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.wizard).toHaveBeenCalledOnce();
  });
});
