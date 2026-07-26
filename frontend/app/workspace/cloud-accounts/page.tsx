"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AppShell,
  PageBody,
  PageHeader,
  SectionCard,
  StatusBadge,
  WorkspaceSidebar,
} from "@/components/ui/provisr-app";

const providers = [
  {
    account: "Acme Production",
    environment: "Production",
    provider: "AWS",
    region: "us-east-1",
    status: "Connected",
    verified: "12 minutes ago",
  },
  {
    account: "acme-platform-prod",
    environment: "Production",
    provider: "Azure",
    region: "eastus",
    status: "Connected",
    verified: "1 hour ago",
  },
  {
    account: "acme-platform",
    environment: "Production",
    provider: "GCP",
    region: "us-central1",
    status: "Needs verification",
    verified: "Yesterday",
  },
];

const setupSteps = [
  "Select provider",
  "Setup instructions",
  "External ID / role setup for AWS",
  "Verify connection",
  "Success state",
];

export default function CloudAccountsPage() {
  const [selectedProvider, setSelectedProvider] = useState("AWS");

  return (
    <AppShell sidebar={<WorkspaceSidebar active="Cloud Accounts" />}>
      <PageHeader
        description="Connect AWS, Azure, and GCP through delegated provider flows."
        title="Cloud Accounts"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            {providers.map(({ account, environment, provider, region, status, verified }) => (
              <SectionCard key={provider} title={provider}>
                <div className="space-y-3 text-sm">
                  <StatusBadge tone={status === "Connected" ? "green" : "amber"}>{status}</StatusBadge>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-xs text-gray-400">Account / subscription / project</dt>
                      <dd className="font-medium text-gray-900">{account}</dd>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <dt className="text-xs text-gray-400">Default region</dt>
                        <dd>{region}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-gray-400">Environment</dt>
                        <dd>{environment}</dd>
                      </div>
                    </div>
                    <div>
                      <dt className="text-xs text-gray-400">Last verified</dt>
                      <dd>{verified}</dd>
                    </div>
                  </dl>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button variant="secondary">Manage</Button>
                    <Button onClick={() => setSelectedProvider(provider)} variant="primary">
                      Verify connection
                    </Button>
                  </div>
                </div>
              </SectionCard>
            ))}
          </div>

          <SectionCard eyebrow="Connection flow" title={`${selectedProvider} delegated setup`}>
            <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
              <div className="space-y-2">
                {setupSteps.map((step, index) => (
                  <div
                    className={
                      index < 3
                        ? "rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                        : "rounded-lg bg-gray-50 px-3 py-2 text-sm font-medium text-gray-500"
                    }
                    key={step}
                  >
                    {step}
                  </div>
                ))}
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm leading-relaxed text-gray-700">
                Provisr uses a delegated provider connection flow. For AWS,
                create an IAM role using the workspace external ID, attach the
                least-privilege provisioning policy, then return here to verify
                the role. Do not paste long-lived cloud credentials.
              </div>
            </div>
          </SectionCard>
        </div>
      </PageBody>
    </AppShell>
  );
}
