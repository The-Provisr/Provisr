"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "@/components/ui/chat-composer";
import { ChatSidebar } from "@/components/ui/chat-sidebar";
import {
  CopyIcon,
  RotateCcwIcon,
  SettingsIcon,
  SparklesIcon,
  ThumbsDownIcon,
  UploadIcon,
  VolumeIcon,
} from "@/components/ui/icons";
import { IconButton } from "@/components/ui/icon-button";
import { MessageBubble } from "@/components/ui/message-bubble";
import { NavigationRail } from "@/components/ui/navigation-rail";

const progressSteps = [
  "Request",
  "Policy",
  "Manifest",
  "Plan",
  "Review",
  "Approval",
  "Execute",
];

const summaryItems = [
  ["Provider", "AWS"],
  ["Environment", "Production"],
  ["Resources", "ECS, RDS, ALB, CloudWatch"],
  ["Status", "Plan ready for review"],
];

const drawerTabs = ["Manifest", "Policy", "Terraform Plan", "Approval"];

export default function ChatPage() {
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(drawerTabs[0]);

  return (
    <main className="flex h-screen overflow-hidden bg-gray-50 font-sans text-gray-800">
      <NavigationRail />
      <ChatSidebar />

      <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-gray-50 px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-gray-900">Provisr</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              className="hidden sm:inline-flex"
              onClick={() => setIsReviewOpen(true)}
              variant="secondary"
            >
              Preview &amp; Review
              <SettingsIcon className="size-3.5 text-gray-500" />
            </Button>
            <Button className="hidden sm:inline-flex" variant="secondary">
              Share Request
              <UploadIcon className="size-3.5 text-gray-500" />
            </Button>
            <Button variant="primary">
              New Request
              <SparklesIcon className="size-3" />
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-8 sm:px-6 sm:py-10">
          <div className="mx-auto max-w-[850px] space-y-10">
            <MessageBubble>
              Deploy a production web app on AWS with ECS, RDS Postgres, ALB,
              and CloudWatch.
            </MessageBubble>

            <div className="space-y-5">
              <p className="max-w-[680px] text-sm leading-relaxed text-gray-600">
                I&apos;ll check your workspace policy, draft a manifest,
                generate a Terraform plan, and ask for approval before
                execution.
              </p>

              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                {progressSteps.map((step, index) => (
                  <div className="flex items-center gap-2" key={step}>
                    <span
                      className={
                        index < 5
                          ? "text-xs font-medium text-slate-900"
                          : "text-xs font-medium text-gray-400"
                      }
                    >
                      {step}
                    </span>
                    {index < progressSteps.length - 1 ? (
                      <span className="h-px w-4 bg-gray-200" />
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="max-w-[520px] rounded-lg border border-gray-100 bg-white p-4 shadow-sm">
                <div className="mb-3 text-sm font-semibold text-gray-900">
                  Infrastructure summary
                </div>
                <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-2 text-sm">
                  {summaryItems.map(([label, value]) => (
                    <div className="contents" key={label}>
                      <dt className="text-gray-400">{label}</dt>
                      <dd className="font-medium text-gray-700">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="flex items-center gap-4 pt-2 text-gray-400">
                <IconButton className="size-6" label="Read response aloud">
                  <VolumeIcon className="size-4" />
                </IconButton>
                <IconButton className="size-6" label="Copy response">
                  <CopyIcon className="size-4" />
                </IconButton>
                <IconButton className="size-6" label="Dislike response">
                  <ThumbsDownIcon className="size-4" />
                </IconButton>
                <IconButton className="size-6" label="Regenerate response">
                  <RotateCcwIcon className="size-4" />
                </IconButton>
              </div>
            </div>
          </div>
        </div>

        <ChatComposer />

        {isReviewOpen ? (
          <aside className="absolute inset-y-0 right-0 z-20 flex w-full max-w-[380px] flex-col border-l border-gray-100 bg-white shadow-xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-gray-100 px-5">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  Preview &amp; Review
                </h2>
                <p className="mt-0.5 text-xs text-gray-400">
                  req-prod-web-042
                </p>
              </div>
              <Button onClick={() => setIsReviewOpen(false)} variant="ghost">
                Close
              </Button>
            </div>

            <div className="border-b border-gray-100 px-3 py-2">
              <div className="grid grid-cols-2 gap-1">
                {drawerTabs.map((tab) => (
                  <button
                    className={
                      activeTab === tab
                        ? "rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                        : "rounded-lg px-3 py-2 text-xs font-semibold text-gray-500 hover:bg-gray-50"
                    }
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    type="button"
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <section className="rounded-lg border border-gray-100 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Resource summary
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-700">
                  AWS production web service with ECS tasks, RDS Postgres, an
                  internet-facing ALB, and CloudWatch logs and alarms.
                </p>
              </section>

              <section className="rounded-lg border border-gray-100 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Estimated monthly cost
                </h3>
                <p className="mt-2 text-2xl font-bold text-gray-900">$482</p>
                <p className="mt-1 text-xs text-gray-500">
                  Based on production sizing and regional AWS pricing.
                </p>
              </section>

              <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                  Policy warning
                </h3>
                <p className="mt-2 text-sm font-medium text-amber-900">
                  Public load balancer requires approval.
                </p>
              </section>

              <section className="rounded-lg border border-gray-100 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Approval status
                </h3>
                <p className="mt-2 text-sm font-medium text-gray-800">
                  Production change requires workspace approval.
                </p>
              </section>
            </div>
          </aside>
        ) : null}
      </section>
    </main>
  );
}
