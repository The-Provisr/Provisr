"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CloudProviderLogo,
  type CloudProviderId,
} from "@/components/ui/cloud-provider-logo";
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
    providerId: "aws",
    region: "us-east-1",
    status: "Connected",
    verified: "12 minutes ago",
  },
  {
    account: "acme-platform-prod",
    environment: "Production",
    provider: "Azure",
    providerId: "azure",
    region: "eastus",
    status: "Connected",
    verified: "1 hour ago",
  },
  {
    account: "acme-platform",
    environment: "Production",
    provider: "GCP",
    providerId: "gcp",
    region: "us-central1",
    status: "Needs verification",
    verified: "Yesterday",
  },
] as const satisfies readonly {
  account: string;
  environment: string;
  provider: string;
  providerId: CloudProviderId;
  region: string;
  status: string;
  verified: string;
}[];

const setupSteps = [
  "Select provider",
  "Setup instructions",
  "Delegated identity setup",
  "Verify connection",
  "Success state",
];

export default function CloudAccountsPage() {
  const [selectedProvider, setSelectedProvider] = useState<CloudProviderId>("aws");
  const selectedProviderName =
    providers.find(({ providerId }) => providerId === selectedProvider)?.provider ?? "AWS";

  return (
    <AppShell sidebar={<WorkspaceSidebar active="Cloud Accounts" />}>
      <PageHeader
        description="Connect AWS, Azure, and GCP through delegated provider flows."
        title="Cloud Accounts"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            {providers.map(
              ({ account, environment, provider, providerId, region, status, verified }) => (
              <SectionCard key={provider}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <CloudProviderLogo provider={providerId} />
                    <h2 className="text-sm font-semibold text-gray-900">{provider}</h2>
                  </div>
                  <StatusBadge tone={status === "Connected" ? "green" : "amber"}>
                    {status}
                  </StatusBadge>
                </div>
                <div className="space-y-3 text-sm">
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
                    <Button onClick={() => setSelectedProvider(providerId)} variant="primary">
                      Verify connection
                    </Button>
                  </div>
                </div>
              </SectionCard>
              ),
            )}
          </div>

          <SectionCard>
            <div className="mb-4 flex items-center gap-3">
              <CloudProviderLogo provider={selectedProvider} />
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Connection flow
                </div>
                <h2 className="mt-1 text-sm font-semibold text-gray-900">
                  {selectedProviderName} delegated setup
                </h2>
              </div>
            </div>
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
                Provisr uses a delegated provider connection flow. Complete the
                provider-native identity setup using the workspace reference,
                grant only the required provisioning permissions, then return
                here to verify the connection. Do not paste long-lived cloud
                credentials.
              </div>
            </div>
          </SectionCard>
        </div>
      </PageBody>
    </AppShell>
  );
}
