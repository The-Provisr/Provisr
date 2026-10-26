"use client";

import { Button } from "@/components/ui/button";
import { CloudProviderLogo } from "@/components/ui/cloud-provider-logo";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { maskAccountId } from "@/lib/cloud-accounts/aws-template";
import {
  cardStateFor,
  PROVIDER_META,
  type CapabilityAccount,
  type CardState,
  type CloudAccount,
  type CloudProviderId,
} from "@/lib/cloud-accounts/types";

type StateStyle = {
  label: string;
  badgeClass: string;
  dotClass: string;
};

const STATE_STYLES: Record<CardState, StateStyle> = {
  active: {
    label: "Active",
    badgeClass: "border-green-100 bg-green-50 text-green-700",
    dotClass: "bg-green-500",
  },
  pending: {
    label: "Pending verification",
    badgeClass: "border-amber-100 bg-amber-50 text-amber-700",
    dotClass: "bg-amber-500",
  },
  failed: {
    label: "Failed",
    badgeClass: "border-red-100 bg-red-50 text-red-700",
    dotClass: "bg-red-500",
  },
  disconnected: {
    label: "Disconnected",
    badgeClass: "border-gray-200 bg-gray-100 text-gray-600",
    dotClass: "bg-gray-400",
  },
  not_connected: {
    label: "Not connected",
    badgeClass: "border-gray-200 bg-gray-100 text-gray-500",
    dotClass: "bg-gray-300",
  },
};

export type ProviderCardProps = {
  provider: CloudProviderId;
  account: CloudAccount | undefined;
  capability: CapabilityAccount | undefined;
  busy: boolean;
  onConnect: (provider: CloudProviderId) => void;
  onVerify: (account: CloudAccount) => void;
  onDelete: (account: CloudAccount) => void;
};

export function ProviderCard({
  provider,
  account,
  capability,
  busy,
  onConnect,
  onVerify,
  onDelete,
}: ProviderCardProps) {
  const meta = PROVIDER_META[provider];
  const state = cardStateFor(account, provider);
  const style = STATE_STYLES[state];

  const executionReady = capability?.execution_ready ?? false;
  const maskedId = maskAccountId(capability?.account_identity);
  const region = capability?.default_region || capability?.available_regions?.[0] || "—";

  return (
    <section
      aria-label={`${meta.name} account`}
      className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <CloudProviderLogo provider={provider} />
          <div>
            <h2 className="text-sm font-semibold text-gray-900">{meta.name}</h2>
            <p className="text-xs text-gray-500">
              {account ? account.label : meta.description}
            </p>
          </div>
        </div>
        <Badge className={style.badgeClass}>
          <span className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", style.dotClass)} />
            {style.label}
          </span>
        </Badge>
      </div>

      {state === "not_connected" ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            {meta.connectable
              ? "No account connected yet."
              : "Connection support is not available yet."}
          </p>
          <Button
            disabled={!meta.connectable || busy}
            onClick={() => onConnect(provider)}
            variant="primary"
          >
            {meta.connectable ? "Connect account" : meta.comingSoonLabel ?? "Coming soon"}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-gray-400">Account ID</dt>
              <dd className="font-medium text-gray-900">{maskedId}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-400">Default region</dt>
              <dd className="text-gray-900">{region}</dd>
            </div>
            {state === "active" ? (
              <div className="col-span-2">
                <dt className="text-xs text-gray-400">Supported services</dt>
                <dd className="text-gray-900">
                  {capability?.supported_domains?.length
                    ? capability.supported_domains.join(", ")
                    : "—"}
                </dd>
              </div>
            ) : null}
          </dl>

          {state === "active" ? (
            <div className="flex items-center gap-2 text-xs">
              <Badge
                className={
                  executionReady
                    ? "border-green-100 bg-green-50 text-green-700"
                    : "border-amber-100 bg-amber-50 text-amber-700"
                }
              >
                {executionReady ? "Execution ready" : "Permissions not verified"}
              </Badge>
              {capability?.warning && !executionReady ? (
                <span className="text-gray-400">{capability.warning}</span>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            {state !== "active" ? (
              <Button disabled={busy} onClick={() => account && onVerify(account)} variant="primary">
                {state === "failed" ? "Retry verification" : "Verify connection"}
              </Button>
            ) : null}
            <Button
              aria-label={`Remove ${meta.name} account`}
              disabled={busy}
              onClick={() => account && onDelete(account)}
              variant="ghost"
            >
              {state === "disconnected" ? "Remove" : "Disconnect"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
