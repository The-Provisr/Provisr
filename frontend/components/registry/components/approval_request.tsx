import { z } from "zod";
import { defaultRegistry } from "../registry";

export const approvalRequestSchema = z.object({
  requestId: z.string(),
  status: z.enum(["pending", "approved", "rejected", "expired"]),
  reason: z.string(),
  requiredApprovers: z.array(z.string()).optional(),
  autoApprovalEligible: z.boolean().default(false),
  expiresAt: z.string().optional(),
});

export type ApprovalRequestData = z.infer<typeof approvalRequestSchema>;

export function ApprovalRequestComponent({
  data,
}: {
  data: ApprovalRequestData;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
          Two-Person Approval Gate (PRD §9)
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${
            data.status === "approved"
              ? "bg-green-100 text-green-800"
              : data.status === "rejected"
                ? "bg-red-100 text-red-800"
                : "bg-amber-100 text-amber-800"
          }`}
        >
          {data.status}
        </span>
      </div>

      <h3 className="mt-2 text-sm font-semibold text-gray-900">
        Reason: {data.reason}
      </h3>

      {data.requiredApprovers && data.requiredApprovers.length > 0 ? (
        <div className="mt-3">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Eligible Workspace Approvers
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {data.requiredApprovers.map((appr) => (
              <span key={appr} className="rounded bg-white px-2 py-1 text-xs text-gray-700 border border-gray-200">
                {appr}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {data.expiresAt ? (
        <div className="mt-3 text-[11px] text-gray-500">
          Expires at: {data.expiresAt}
        </div>
      ) : null}
    </div>
  );
}

defaultRegistry.register({
  type: "approval_request",
  version: "1.0",
  schema: approvalRequestSchema,
  component: ApprovalRequestComponent,
});
