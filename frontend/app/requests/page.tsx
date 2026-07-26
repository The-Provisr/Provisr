import Link from "next/link";
import {
  AppShell,
  DataTable,
  PageBody,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/ui/provisr-app";

const requests = [
  ["Deploy ECS web app", "Production", "AWS", "Plan ready", "$482", "Warning", "Needs approval", "Owen Patel", "Today"],
  ["Add Postgres read replica", "Production", "AWS", "Waiting approval", "$146", "Pass", "Pending", "Maya Chen", "Today"],
  ["Create private VPC", "Staging", "AWS", "Drafting manifest", "$88", "Unchecked", "None", "Jules Kim", "Today"],
  ["Set up staging cluster", "Staging", "Azure", "Completed", "$320", "Pass", "Approved", "Owen Patel", "Yesterday"],
  ["Review Terraform plan", "Production", "GCP", "Needs review", "$210", "Warning", "Needs approval", "Maya Chen", "Yesterday"],
  ["Legacy bucket migration", "Production", "AWS", "Blocked by policy", "$54", "Deny", "Blocked", "Jules Kim", "Jul 24"],
];

export default function RequestsPage() {
  return (
    <AppShell>
      <PageHeader
        description="Provisioning requests from chat, review, approval, and execution."
        title="Requests"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px]">
          <SectionCard title="Provisioning requests">
            <DataTable
              columns={[
                "Request name",
                "Environment",
                "Provider",
                "Status",
                "Cost estimate",
                "Policy result",
                "Approval status",
                "Created by",
                "Last updated",
              ]}
              rows={requests.map((request) => [
                <Link className="font-medium text-gray-900 hover:text-gray-600" href="/chat" key={request[0]}>
                  {request[0]}
                </Link>,
                request[1],
                request[2],
                <StatusBadge key={request[3]} tone={request[3] === "Completed" ? "green" : request[3] === "Blocked by policy" ? "amber" : "blue"}>
                  {request[3]}
                </StatusBadge>,
                request[4],
                request[5],
                request[6],
                request[7],
                request[8],
              ])}
            />
          </SectionCard>
        </div>
      </PageBody>
    </AppShell>
  );
}
