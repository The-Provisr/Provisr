import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export const metadata: Metadata = {
  title: "Set up your workspace | Provisr",
  description:
    "Create a governed Provisr workspace, invite your team, choose policy guardrails, and connect a cloud provider.",
};

export default function OnboardingPage() {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return <OnboardingFlow clerkEnabled={clerkEnabled} />;
}
