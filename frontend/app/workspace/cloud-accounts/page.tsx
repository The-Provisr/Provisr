"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AppShell,
  PageBody,
  PageHeader,
  SectionCard,
  WorkspaceSidebar,
} from "@/components/ui/provisr-app";
import { AwsConnectPanel } from "@/components/cloud-accounts/aws-connect-panel";
import { ProviderCard } from "@/components/cloud-accounts/provider-card";
import { generateExternalId } from "@/lib/cloud-accounts/aws-template";
import {
  createCloudAccount,
  deleteCloudAccount,
  errorMessage,
  isActiveRunsError,
  listCapabilities,
  listCloudAccounts,
  verifyCloudAccount,
} from "@/lib/cloud-accounts/client";
import {
  PROVIDERS,
  type CapabilityAccount,
  type CloudAccount,
  type CloudCapabilities,
  type CloudProviderId,
} from "@/lib/cloud-accounts/types";

type ViewState = "loading" | "ready" | "error";

export default function CloudAccountsPage() {
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [accounts, setAccounts] = useState<CloudAccount[]>([]);
  const [capabilities, setCapabilities] = useState<CloudCapabilities | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelExternalId, setPanelExternalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const accountByProvider = useMemo(() => {
    const map = new Map<string, CloudAccount>();
    for (const account of accounts) {
      if (!map.has(account.provider)) {
        map.set(account.provider, account);
      }
    }
    return map;
  }, [accounts]);

  const capabilityById = useMemo(() => {
    const map = new Map<string, CapabilityAccount>();
    for (const capability of capabilities?.accounts ?? []) {
      map.set(capability.id, capability);
    }
    return map;
  }, [capabilities]);

  const load = useCallback(async (): Promise<boolean> => {
    setViewState("loading");
    setLoadError(null);
    try {
      const [accountList, capabilityList] = await Promise.all([
        listCloudAccounts(),
        listCapabilities().catch(() => ({ workspace_id: "", accounts: [] })),
      ]);
      setAccounts(accountList);
      setCapabilities(capabilityList);
      setViewState("ready");
      return true;
    } catch (error) {
      setLoadError(errorMessage(error));
      setViewState("error");
      return false;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Onboarding redirect: /workspace/cloud-accounts?connect=aws opens the panel.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const connect = new URLSearchParams(window.location.search).get("connect");
    if (connect === "aws") {
      openConnect("aws");
    }
    // openConnect is stable for this one-shot effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openConnect(provider: CloudProviderId) {
    if (provider !== "aws") {
      return;
    }
    setPanelExternalId(generateExternalId("aws"));
    setPanelError(null);
    setPanelOpen(true);
  }

  const awsAccount = accountByProvider.get("aws");
  const onOpenAws = awsAccount && awsAccount.status !== "active" ? openConnect : undefined;

  function openVerify(account: CloudAccount) {
    setPanelExternalId(generateExternalId("aws"));
    setPanelError(null);
    setPanelOpen(true);
  }

  async function handleVerify(params: { externalId: string; roleArn: string; label: string }) {
    setBusy(true);
    setPanelError(null);
    try {
      let accountId = awsAccount?.id;
      if (!accountId) {
        const created = await createCloudAccount({
          provider: "aws",
          label: params.label,
          externalAccountId: params.externalId,
          metadata: { role_arn: params.roleArn },
        });
        accountId = created.id;
      }

      await verifyCloudAccount(accountId, params.externalId);
      setPanelOpen(false);
      setFeedback("AWS account verified and connected.");
      await load();
    } catch (error) {
      setPanelError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(account: CloudAccount) {
    setBusy(true);
    setFeedback(null);
    try {
      await deleteCloudAccount(account.id);
      setFeedback("Cloud account removed.");
      await load();
    } catch (error) {
      setFeedback(
        isActiveRunsError(error)
          ? "Cannot remove this account while provisioning runs are active."
          : errorMessage(error),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell sidebar={<WorkspaceSidebar active="Cloud Accounts" />}>
      <PageHeader
        actions={
          <Button disabled={busy || viewState === "loading"} onClick={() => openConnect("aws")}>
            Connect AWS
          </Button>
        }
        description="Connect cloud providers through delegated identity flows. No long-lived credentials."
        title="Cloud Accounts"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          {feedback ? (
            <SectionCard>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-green-700">{feedback}</span>
                <button
                  aria-label="Dismiss feedback"
                  className="text-gray-400 hover:text-gray-600"
                  onClick={() => setFeedback(null)}
                  type="button"
                >
                  ✕
                </button>
              </div>
            </SectionCard>
          ) : null}

          {viewState === "error" ? (
            <SectionCard>
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-red-900">
                    Could not load cloud accounts
                  </div>
                  <div className="mt-0.5 text-xs text-gray-500">{loadError}</div>
                </div>
                <Button onClick={() => load()} variant="secondary">
                  Retry
                </Button>
              </div>
            </SectionCard>
          ) : null}

          {viewState === "loading" ? (
            <div aria-busy="true" aria-label="Loading cloud accounts" className="grid gap-4 lg:grid-cols-3">
              {PROVIDERS.map((provider) => (
                <SectionCard className="animate-pulse" key={provider}>
                  <div className="h-24 rounded-lg bg-gray-100" />
                </SectionCard>
              ))}
            </div>
          ) : null}

          {viewState === "ready" ? (
            <div className="grid gap-4 lg:grid-cols-3">
              {PROVIDERS.map((provider) => {
                const account = accountByProvider.get(provider);
                return (
                  <ProviderCard
                    account={account}
                    busy={busy}
                    capability={account ? capabilityById.get(account.id) : undefined}
                    key={provider}
                    onConnect={(next) => (next === "aws" ? openConnect(next) : undefined)}
                    onDelete={handleDelete}
                    onVerify={openVerify}
                    provider={provider}
                  />
                );
              })}
            </div>
          ) : null}

          {panelOpen && viewState !== "loading" ? (
            <AwsConnectPanel
              accountId={awsAccount?.id}
              busy={busy}
              errorMessage={panelError}
              externalId={panelExternalId}
              onCancel={() => setPanelOpen(false)}
              onVerify={handleVerify}
              workspaceId={capabilities?.workspace_id ?? ""}
            />
          ) : null}

          <p className="text-xs text-gray-400">
            {onOpenAws
              ? "Finish the AWS connection to make it available for provisioning requests."
              : "Azure and Google Cloud connections arrive in a later milestone."}
          </p>
        </div>
      </PageBody>
    </AppShell>
  );
}
