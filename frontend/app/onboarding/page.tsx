import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { WorkspaceOnboardingWizard } from "@/components/onboarding/workspace-onboarding-wizard";

export const metadata: Metadata = {
  title: "Set up your workspace | Provisr",
  description:
    "Create a governed Provisr workspace, choose its environment, and select the cloud providers you plan to use.",
};

export default function OnboardingPage() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    return <OnboardingFlow clerkEnabled={false} />;
  }
  return <WorkspaceOnboardingWizard />;
}
