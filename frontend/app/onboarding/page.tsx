"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/provisr-app";

const steps = [
  "Welcome to Provisr",
  "Sign in / sign up using Clerk",
  "Create workspace",
  "Invite team",
  "Choose cloud providers",
  "Connect first cloud account",
  "Select default environment",
  "Finish and go to chat screen",
];

export default function OnboardingPage() {
  const [activeStep, setActiveStep] = useState(0);
  const isLastStep = activeStep === steps.length - 1;

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 font-sans text-gray-800">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[1040px] flex-col rounded-lg border border-gray-100 bg-white shadow-sm">
        <header className="flex h-16 items-center justify-between border-b border-gray-100 px-6">
          <div>
            <h1 className="font-bold text-gray-900">Welcome to Provisr</h1>
            <p className="mt-0.5 text-xs text-gray-500">
              Guided setup for governed cloud infrastructure provisioning.
            </p>
          </div>
          <StatusBadge tone="blue">First-time setup</StatusBadge>
        </header>

        <div className="grid flex-1 gap-0 lg:grid-cols-[280px_1fr]">
          <aside className="border-r border-gray-100 p-4">
            <div className="space-y-1">
              {steps.map((step, index) => (
                <button
                  className={
                    activeStep === index
                      ? "w-full rounded-lg bg-slate-900 px-3 py-2 text-left text-sm font-medium text-white"
                      : "w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-600 hover:bg-gray-50"
                  }
                  key={step}
                  onClick={() => setActiveStep(index)}
                  type="button"
                >
                  {step}
                </button>
              ))}
            </div>
          </aside>

          <section className="flex flex-col justify-between p-6">
            <div className="max-w-[620px]">
              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                Step {activeStep + 1} of {steps.length}
              </div>
              <h2 className="mt-2 text-2xl font-bold text-gray-900">{steps[activeStep]}</h2>
              <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50 p-5 text-sm leading-relaxed text-gray-700">
                {activeStep === 0 ? (
                  "Provisr turns infrastructure requests into reviewed plans, policy checks, approvals, and controlled execution."
                ) : null}
                {activeStep === 1 ? (
                  "Use Clerk to sign in or create your account. Workspace roles and access are applied after authentication."
                ) : null}
                {activeStep === 2 ? (
                  "Name your workspace, choose ownership, and set the default production or staging context."
                ) : null}
                {activeStep === 3 ? (
                  "Invite admins, engineers, approvers, auditors, and guided requesters. Roles can be changed later."
                ) : null}
                {activeStep === 4 ? (
                  "Choose AWS, Azure, GCP, or any combination your workspace will provision through Provisr."
                ) : null}
                {activeStep === 5 ? (
                  "Connect through delegated provider setup. Provisr will guide role, external ID, and verification steps without asking for long-lived cloud secrets."
                ) : null}
                {activeStep === 6 ? (
                  "Select the default environment and regions used when chat requests do not specify them."
                ) : null}
                {activeStep === 7 ? (
                  "Your workspace is ready. Start in chat, describe the infrastructure you need, and review the generated plan before anything can execute."
                ) : null}
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between">
              <Button
                disabled={activeStep === 0}
                onClick={() => setActiveStep((step) => Math.max(step - 1, 0))}
                variant="secondary"
              >
                Back
              </Button>
              {isLastStep ? (
                <Button variant="primary">
                  <Link href="/chat">Go to chat</Link>
                </Button>
              ) : (
                <Button
                  onClick={() => setActiveStep((step) => Math.min(step + 1, steps.length - 1))}
                  variant="primary"
                >
                  Continue
                </Button>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
