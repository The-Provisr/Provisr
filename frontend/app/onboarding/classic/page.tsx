import type { Metadata } from "next";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

export const metadata: Metadata = {
  title: "Guided setup | Provisr",
  description:
    "Walk through the full Provisr setup flow: connect a cloud provider, invite your team, and apply a policy blueprint.",
};

export default function OnboardingClassicPage() {
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  return <OnboardingFlow clerkEnabled={clerkEnabled} />;
}
