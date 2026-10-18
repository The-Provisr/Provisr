import type { Metadata } from "next";
import { WorkspaceOnboardingWizard } from "@/components/onboarding/workspace-onboarding-wizard";

export const metadata: Metadata = {
  title: "Set up your workspace | Provisr",
  description:
    "Create a governed Provisr workspace, choose its environment, and select the cloud providers you plan to use.",
};

export default function OnboardingPage() {
  return <WorkspaceOnboardingWizard />;
}
