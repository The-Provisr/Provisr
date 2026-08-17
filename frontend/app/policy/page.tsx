"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { BracesIcon, LayoutGridIcon } from "@/components/ui/icons";
import { PolicyPackCard } from "@/components/ui/policy-pack-card";
import { PolicyRuleRow } from "@/components/ui/policy-rule-row";
import {
  AppShell,
  PageBody,
  PageHeader,
  WorkspaceSidebar,
} from "@/components/ui/provisr-app";
import { RegoEditor } from "@/components/ui/rego-editor";
import { Toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { resetPolicyPack, savePolicyDraft } from "@/lib/policy/api";
import { policyPacks } from "@/lib/policy/mock-data";
import type { PolicyPack, PolicyPackDraft, PolicyViewState } from "@/lib/policy/types";

type ToastState = { tone: "success" | "error"; message: string };

// @migration: roles are not yet unified in the frontend — the Clerk session
// carries no role claim until backend workspace membership roles are exposed.
// Default to non-admin until that lands; server-side policy endpoints must
// enforce the same admin check.
export default function PolicySettingsPage() {
  const { user } = useUser();
  const policyEditorIsAdmin = user?.publicMetadata?.role === "admin";

  const [draft, setDraft] = useState<PolicyPack[]>(() =>
    policyPacks.map((pack) => ({
      ...pack,
      rules: pack.rules.map((rule) => ({ ...rule, parameters: rule.parameters.map((p) => ({ ...p })) })),
    })),
  );
  const [viewState, setViewState] = useState<PolicyViewState>("loading");
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"visual" | "rego">("visual");
  const [expandedRuleKey, setExpandedRuleKey] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setViewState(draft.length === 0 ? "empty" : "default"), 700);
    return () => clearTimeout(timer);
  }, [draft.length]);

  const selectedPack = draft.find((pack) => pack.id === selectedPackId) ?? null;

  const updatePack = (packId: string, updater: (pack: PolicyPack) => PolicyPack) => {
    setDraft((current) => current.map((pack) => (pack.id === packId ? updater(pack) : pack)));
  };

  const selectPack = (packId: string) => {
    setSelectedPackId(packId);
    setConfirmReset(false);
    setExpandedRuleKey(null);
    setViewMode("visual");
    document.getElementById("policy-rules")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const regoRule = useMemo(() => {
    if (!selectedPack) return null;
    return (
      selectedPack.rules.find((rule) => rule.key === expandedRuleKey) ??
      selectedPack.rules[0] ??
      null
    );
  }, [expandedRuleKey, selectedPack]);

  const handleSave = async () => {
    if (!selectedPack) return;
    setSaving(true);
    setError(null);
    try {
      const draftPayload: PolicyPackDraft = {
        id: selectedPack.id,
        enabled: selectedPack.enabled,
        rules: selectedPack.rules.map((rule) => ({
          key: rule.key,
          enabled: rule.enabled,
          parameters: rule.parameters,
          regoSource: rule.regoSource,
        })),
      };
      await savePolicyDraft(draftPayload);
      setToast({ tone: "success", message: "Policy settings saved." });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Failed to save policy settings.";
      setError(message);
      setToast({ tone: "error", message });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!selectedPack) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await resetPolicyPack(selectedPack.id);
      const defaults = policyPacks.find((pack) => pack.id === selectedPack.id);
      if (defaults) {
        setDraft((current) =>
          current.map((pack) =>
            pack.id === selectedPack.id
              ? {
                  ...defaults,
                  rules: defaults.rules.map((rule) => ({
                    ...rule,
                    parameters: rule.parameters.map((p) => ({ ...p })),
                  })),
                }
              : pack,
          ),
        );
      }
      setConfirmReset(false);
      setToast({ tone: "success", message: `${selectedPack.name} reset to defaults.` });
    } catch (resetError) {
      const message = resetError instanceof Error ? resetError.message : "Failed to reset policy pack.";
      setError(message);
      setToast({ tone: "error", message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell sidebar={<WorkspaceSidebar active="Policies" />}>
      <PageHeader
        actions={
          <>
            <Button disabled={saving || !selectedPack} onClick={handleReset} variant="secondary">
              {confirmReset ? "Confirm reset?" : "Reset to Defaults"}
            </Button>
            <Button disabled={saving || !selectedPack} onClick={handleSave} variant="primary">
              {saving ? (
                <>
                  <span aria-hidden="true" className="provisr-spinner" />
                  <span className="inline-flex items-center gap-2">Saving…</span>
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </>
        }
        description="Manage governance rules, compliance standards, and automated remediation packs across your integrated cloud environments."
        title="Policy Settings"
      />
      <PageBody>
        <div className="mx-auto max-w-[1180px] space-y-6">
          {error ? (
            <div
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900"
              data-testid="error-banner"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <section>
            <h2 className="mb-4 text-sm font-semibold text-gray-900">Active Policy Packs</h2>
            {viewState === "loading" ? (
              <PolicyPackSkeleton />
            ) : viewState === "empty" || draft.length === 0 ? (
              <div
                className="rounded-lg border border-gray-100 bg-white p-8 text-center text-sm text-gray-500"
                data-testid="empty-state"
              >
                No policy packs configured.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {draft.map((pack) => (
                  <PolicyPackCard
                    key={pack.id}
                    onEnabledChange={(packId, enabled) =>
                      updatePack(packId, (current) => ({ ...current, enabled }))
                    }
                    onSelect={selectPack}
                    pack={pack}
                    selected={pack.id === selectedPackId}
                  />
                ))}
              </div>
            )}
          </section>

          <section
            className="overflow-hidden rounded-lg border border-gray-100 bg-white shadow-sm"
            id="policy-rules"
          >
            <div className="flex flex-col gap-4 border-b border-gray-100 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {selectedPack ? `${selectedPack.name} Rules` : "Policy Rules"}
                </h2>
                <p className="mt-1 text-xs text-gray-500">
                  Configure individual rule parameters and enforcement severities.
                </p>
              </div>
              {selectedPack ? (
                <div className="flex items-center gap-2">
                  <button
                    aria-pressed={viewMode === "visual"}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      viewMode === "visual" ? "bg-slate-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-50",
                    )}
                    onClick={() => setViewMode("visual")}
                    type="button"
                  >
                    <LayoutGridIcon className="size-3.5" /> Visual
                  </button>
                  <button
                    aria-pressed={viewMode === "rego"}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      viewMode === "rego" ? "bg-slate-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-50",
                    )}
                    onClick={() => setViewMode("rego")}
                    type="button"
                  >
                    <BracesIcon className="size-3.5" /> Raw Rego
                  </button>
                </div>
              ) : null}
            </div>

            {viewState === "loading" ? (
              <RulesSkeleton />
            ) : !selectedPack ? (
              <div className="p-8 text-center text-sm text-gray-500" data-testid="no-pack-selected">
                Select a policy pack to configure its rules.
              </div>
            ) : viewMode === "visual" ? (
              <div data-testid="visual-view">
                {selectedPack.rules.map((rule, index) => (
                  <PolicyRuleRow
                    defaultExpanded={index === 0}
                    enabled={rule.enabled}
                    isAdmin={policyEditorIsAdmin}
                    key={rule.key}
                    onEnabledChange={(ruleKey, enabled) =>
                      updatePack(selectedPack.id, (current) => ({
                        ...current,
                        rules: current.rules.map((r) => (r.key === ruleKey ? { ...r, enabled } : r)),
                      }))
                    }
                    onExpandChange={(ruleKey, expanded) => setExpandedRuleKey(expanded ? ruleKey : null)}
                    onParametersChange={(ruleKey, parameters) =>
                      updatePack(selectedPack.id, (current) => ({
                        ...current,
                        rules: current.rules.map((r) => (r.key === ruleKey ? { ...r, parameters } : r)),
                      }))
                    }
                    onRegoChange={(ruleKey, source) =>
                      updatePack(selectedPack.id, (current) => ({
                        ...current,
                        rules: current.rules.map((r) => (r.key === ruleKey ? { ...r, regoSource: source } : r)),
                      }))
                    }
                    rule={rule}
                  />
                ))}
              </div>
            ) : regoRule ? (
              <div className="p-5" data-testid="rego-view">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <code className="rounded border border-gray-100 bg-gray-100 px-2 py-1 font-mono text-xs text-gray-900">
                    {regoRule.key}
                  </code>
                  <p className="text-xs text-gray-500">
                    {policyEditorIsAdmin
                      ? "Editable for workspace admins."
                      : "Read-only unless you are a workspace admin."}
                  </p>
                </div>
                <RegoEditor
                  isAdmin={policyEditorIsAdmin}
                  onChange={(source) =>
                    updatePack(selectedPack.id, (current) => ({
                      ...current,
                      rules: current.rules.map((r) => (r.key === regoRule.key ? { ...r, regoSource: source } : r)),
                    }))
                  }
                  source={regoRule.regoSource}
                />
              </div>
            ) : null}
          </section>
        </div>
      </PageBody>

      {toast ? (
        <Toast
          message={toast.message}
          onDismiss={() => setToast(null)}
          tone={toast.tone}
        />
      ) : null}
    </AppShell>
  );
}

function PolicyPackSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="pack-skeleton">
      {[0, 1, 2].map((item) => (
        <div className="animate-pulse rounded-xl border border-gray-100 bg-gray-50 p-5" key={item}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-lg bg-gray-100" />
              <div>
                <div className="h-3 w-28 rounded bg-gray-100" />
                <div className="mt-2 h-2 w-12 rounded bg-gray-100" />
              </div>
            </div>
            <div className="h-6 w-10 rounded-full bg-gray-100" />
          </div>
          <div className="mt-4 h-2 w-full rounded bg-gray-100" />
          <div className="mt-2 h-2 w-3/4 rounded bg-gray-100" />
          <div className="mt-4 h-2 w-24 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

function RulesSkeleton() {
  return (
    <div className="space-y-4 p-5" data-testid="rules-skeleton">
      {[0, 1, 2].map((item) => (
        <div className="flex items-center gap-3 animate-pulse" key={item}>
          <div className="h-6 w-10 rounded-full bg-gray-100" />
          <div className="h-6 w-48 rounded bg-gray-100" />
          <div className="h-4 w-24 rounded-full bg-gray-100" />
          <div className="h-4 flex-1 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}