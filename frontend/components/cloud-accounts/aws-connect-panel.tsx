"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { CloudProviderLogo } from "@/components/ui/cloud-provider-logo";
import { AlertTriangleIcon, CheckIcon, CopyIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { buildCloudFormationTemplate } from "@/lib/cloud-accounts/aws-template";
import { TemplateViewer } from "./template-viewer";

export type AwsConnectPanelProps = {
  workspaceId: string;
  externalId: string;
  /** Existing AWS account id when a connection already exists (pending/failed). */
  accountId?: string;
  busy: boolean;
  errorMessage?: string | null;
  onVerify: (params: { externalId: string; roleArn: string; label: string }) => void;
  onCancel: () => void;
};

const INSTRUCTIONS = [
  "Copy the external ID and the CloudFormation template below.",
  "In the AWS console, deploy the template (CloudFormation → Create stack).",
  "Confirm the stack created the ProvisrExecutionRole with the external ID condition.",
  "Copy the role ARN from the stack Outputs and paste it here.",
  "Select Verify connection to confirm delegated access.",
];

export function AwsConnectPanel({
  workspaceId,
  externalId,
  accountId,
  busy,
  errorMessage,
  onVerify,
  onCancel,
}: AwsConnectPanelProps) {
  const [roleArn, setRoleArn] = useState("");
  const [label, setLabel] = useState("AWS account");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const template = useMemo(
    () =>
      buildCloudFormationTemplate({
        externalId,
        workspaceId,
        accountLabel: label.trim() || undefined,
      }),
    [externalId, workspaceId, label],
  );

  const roleArnValid = /^arn:aws(-[a-z]+)?:iam::\d{12}:role\/.+/.test(roleArn.trim());
  const canVerify = roleArnValid && label.trim().length > 0 && !busy;

  async function copyExternalId() {
    try {
      await navigator.clipboard.writeText(externalId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
      <div className="flex items-center gap-3">
        <CloudProviderLogo provider="aws" />
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            {accountId ? "AWS connection" : "Connect AWS"}
          </div>
          <h2 className="mt-0.5 text-sm font-semibold text-gray-900">
            Delegated IAM role setup
          </h2>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            External ID
          </span>
          <div className="flex gap-2">
            <Button onClick={() => setRevealed((value) => !value)} variant="ghost">
              {revealed ? "Hide" : "Reveal"}
            </Button>
            <Button onClick={copyExternalId} variant="secondary">
              <CopyIcon className="size-3.5" />
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
        <div
          aria-label="External ID"
          className="rounded-lg border border-gray-100 bg-white px-3 py-2 font-mono text-xs text-gray-800"
        >
          {revealed ? externalId : `${externalId.slice(0, 12)}${"•".repeat(12)}`}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Paste this into the stack as the external ID. It is not a secret credential.
        </p>
      </div>

      <TemplateViewer
        fileName={`provisr-aws-role-${workspaceId}.yaml`}
        template={template}
      />

      <ol className="space-y-1.5 text-xs text-gray-600">
        {INSTRUCTIONS.map((step, index) => (
          <li className="flex gap-2" key={step}>
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
              {index + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Account label</span>
          <input
            aria-label="Account label"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            onChange={(event) => setLabel(event.target.value)}
            value={label}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-gray-600">Role ARN</span>
          <input
            aria-invalid={roleArn !== "" && !roleArnValid}
            aria-label="Role ARN"
            className={cn(
              "w-full rounded-lg border bg-white px-3 py-2 text-sm",
              roleArn !== "" && !roleArnValid ? "border-red-300" : "border-gray-200",
            )}
            onChange={(event) => setRoleArn(event.target.value)}
            placeholder="arn:aws:iam::123456789012:role/ProvisrExecutionRole"
            value={roleArn}
          />
        </label>
      </div>

      {errorMessage ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700"
          role="alert"
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={!canVerify}
          onClick={() => onVerify({ externalId, roleArn: roleArn.trim(), label: label.trim() })}
          variant="primary"
        >
          {busy ? "Verifying…" : "Verify connection"}
        </Button>
        <Button disabled={busy} onClick={onCancel} variant="ghost">
          Cancel
        </Button>
        {!roleArnValid && roleArn !== "" ? (
          <span className="text-xs text-red-600">Enter a valid IAM role ARN.</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-500">
        <CheckIcon className="size-3.5 text-green-600" />
        Provisr never stores long-lived access keys.
      </div>
    </div>
  );
}
