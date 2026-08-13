"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AppShell,
  DataTable,
  PageBody,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/ui/provisr-app";

const resources = [
  ["web-prod-service", "AWS", "ECS Service", "Production", "us-east-1", "Healthy", "Deploy ECS web app", "In sync", "$128"],
  ["web-prod-db", "AWS", "RDS Postgres", "Production", "us-east-1", "Healthy", "Deploy ECS web app", "In sync", "$214"],
  ["public-web-alb", "AWS", "Load Balancer", "Production", "us-east-1", "Healthy", "Deploy ECS web app", "Policy drift", "$44"],
  ["staging-aks", "Azure", "Kubernetes", "Staging", "eastus", "Healthy", "Set up staging cluster", "In sync", "$320"],
];

export default function ResourcesPage() {
  const [selectedResource, setSelectedResource] = useState(resources[0]);

  return (
    <AppShell>
      <PageHeader
        description="Cloud resources known to Provisr through managed requests and state sync."
        title="Resources"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-4">
          <SectionCard>
            <div className="flex flex-wrap gap-2">
              {["Provider", "Environment", "Resource type", "Drift status"].map((filter) => (
                <Button key={filter} variant="secondary">
                  {filter}
                </Button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Resource inventory">
            <DataTable
              columns={["Resource name", "Provider", "Type", "Environment", "Region", "Status", "Owner request", "Drift status", "Monthly cost"]}
              rows={resources.map((resource) => [
                <button
                  className="text-left font-medium text-gray-900 hover:text-gray-600"
                  key={resource[0]}
                  onClick={() => setSelectedResource(resource)}
                  type="button"
                >
                  {resource[0]}
                </button>,
                resource[1],
                resource[2],
                resource[3],
                resource[4],
                <StatusBadge key={resource[5]} tone="green">{resource[5]}</StatusBadge>,
                resource[6],
                <StatusBadge key={resource[7]} tone={resource[7] === "In sync" ? "green" : "amber"}>{resource[7]}</StatusBadge>,
                resource[8],
              ])}
            />
          </SectionCard>
        </div>
      </PageBody>

      <aside className="absolute inset-y-0 right-0 hidden w-[340px] flex-col border-l border-gray-100 bg-white p-5 shadow-xl xl:flex">
        <div className="text-sm font-semibold text-gray-900">Resource detail</div>
        <div className="mt-1 text-xs text-gray-500">{selectedResource?.[0]}</div>
        <div className="mt-6 space-y-4 text-sm">
          <SectionCard title="Metadata">
            <dl className="space-y-2">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-400">Provider</dt>
                <dd>{selectedResource?.[1]}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-400">Region</dt>
                <dd>{selectedResource?.[4]}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-400">Last sync</dt>
                <dd>8 minutes ago</dd>
              </div>
            </dl>
          </SectionCard>
          <SectionCard title="Tags">
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="blue">workspace: acme</StatusBadge>
              <StatusBadge tone="blue">env: production</StatusBadge>
            </div>
          </SectionCard>
          <SectionCard title="Linked request">
            <div>{selectedResource?.[6]}</div>
          </SectionCard>
          <SectionCard title="Drift status">
            <StatusBadge tone={selectedResource?.[7] === "In sync" ? "green" : "amber"}>
              {selectedResource?.[7]}
            </StatusBadge>
          </SectionCard>
          <SectionCard title="Related audit events">
            <div className="space-y-2 text-gray-700">
              <div>Cloud state synced</div>
              <div>Policy check completed</div>
            </div>
          </SectionCard>
        </div>
      </aside>
    </AppShell>
  );
}
