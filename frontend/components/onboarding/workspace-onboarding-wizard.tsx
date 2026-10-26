"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { CloudProviderLogo } from "@/components/ui/cloud-provider-logo";
import { PostAuthHandoff } from "@/components/auth/post-auth-handoff";

type WorkspaceEnvironment = "development" | "staging" | "production";
type Provider = "aws" | "azure" | "gcp";

const steps = ["Create workspace", "Set environment", "Connect intent"] as const;

const NAME_MIN = 3;
const NAME_MAX = 64;

const environments: ReadonlyArray<{
  id: WorkspaceEnvironment;
  label: string;
  dotClass: string;
  activeClass: string;
  description: string;
}> = [
  {
    id: "development",
    label: "Development",
    dotClass: "bg-green-500",
    activeClass: "border-green-200 bg-green-100",
    description: "For experimentation and testing. Loose guardrails, fast iteration.",
  },
  {
    id: "staging",
    label: "Staging",
    dotClass: "bg-amber-500",
    activeClass: "border-amber-200 bg-amber-50",
    description: "For pre-production validation. Mirrors production with softer approvals.",
  },
  {
    id: "production",
    label: "Production",
    dotClass: "bg-red-500",
    activeClass: "border-red-200 bg-red-50",
    description: "For live infrastructure. Strict approvals and policy gates.",
  },
];

const providers: ReadonlyArray<{ id: Provider; name: string; description: string }> = [
  { id: "aws", name: "Amazon Web Services", description: "EC2, S3, RDS and more via a delegated IAM role." },
  { id: "azure", name: "Microsoft Azure", description: "VMs, Blob Storage and more via Entra ID." },
  { id: "gcp", name: "Google Cloud", description: "Compute Engine and more via Workload Identity." },
];

const avatarOptions = ["🚀", "🏗️", "☁️", "⚡", "🔒", "🧭"] as const;

const stepMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: "easeOut" as const },
};

function createIdempotencyKey(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function deriveSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "your-workspace";
}

export function WorkspaceOnboardingWizard() {
  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<WorkspaceEnvironment>("development");
  const [selectedProviders, setSelectedProviders] = useState<Provider[]>([]);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [payloadLocked, setPayloadLocked] = useState(false);
  const [createdWorkspaceId, setCreatedWorkspaceId] = useState<string | null>(null);
  const idempotencyKey = useRef<string>(createIdempotencyKey());
  const submittedPayload = useRef<string | null>(null);
  const submitInFlight = useRef(false);

  const trimmedName = name.trim();
  const slug = deriveSlug(name);

  function validateName(): boolean {
    if (trimmedName.length === 0) {
      setNameError("Enter a workspace name.");
      return false;
    }
    if (trimmedName.length < NAME_MIN) {
      setNameError(`Workspace name must be at least ${NAME_MIN} characters.`);
      return false;
    }
    if (trimmedName.length > NAME_MAX) {
      setNameError(`Workspace name must be at most ${NAME_MAX} characters.`);
      return false;
    }
    setNameError(null);
    return true;
  }

  function toggleProvider(provider: Provider) {
    if (submittedPayload.current !== null) return;
    setSelectedProviders((current) =>
      current.includes(provider)
        ? current.filter((item) => item !== provider)
        : [...current, provider],
    );
  }

  async function submit() {
    if (submitInFlight.current) return;
    if (submittedPayload.current === null && !validateName()) {
      setStepIndex(0);
      return;
    }

    const retryingUnknownOutcome = submittedPayload.current !== null;
    submitInFlight.current = true;
    submittedPayload.current ??= JSON.stringify({
      name: trimmedName,
      ...(description.trim() ? { description: description.trim() } : {}),
      environment,
      providers: selectedProviders,
      ...(avatar ? { avatar } : {}),
    });
    setPayloadLocked(true);
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/workspace/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: submittedPayload.current,
      });

      const body = (await res.json().catch(() => null)) as
        | { workspaceId?: string; code?: string; error?: string }
        | null;

      if (!res.ok) {
        const definitiveFailure = body?.code !== "duplicate_idempotency_key" &&
          ([400, 401, 403, 422].includes(res.status) || body?.code === "slug_taken");
        if (definitiveFailure && !retryingUnknownOutcome) {
          submittedPayload.current = null;
          setPayloadLocked(false);
          idempotencyKey.current = createIdempotencyKey();
        }
        if (body?.code === "slug_taken" && !retryingUnknownOutcome) {
          setNameError("That workspace name is already taken. Try a different one.");
          setStepIndex(0);
          return;
        }
        setSubmitError(
          "We couldn't finish workspace setup. Please try again in a moment.",
        );
        return;
      }

      if (!body?.workspaceId) {
        setSubmitError("We couldn't finish workspace setup. Please try again.");
        return;
      }

      setCreatedWorkspaceId(body.workspaceId);
    } catch {
      setSubmitError("We couldn't reach Provisr. Check your connection and try again.");
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }

  function goNext() {
    if (submittedPayload.current !== null) {
      void submit();
      return;
    }
    if (stepIndex === 0 && !validateName()) {
      return;
    }
    setSubmitError(null);
    if (stepIndex < steps.length - 1) {
      setStepIndex((index) => index + 1);
      return;
    }
    void submit();
  }

  function goBack() {
    if (submittedPayload.current !== null) return;
    setSubmitError(null);
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  if (createdWorkspaceId) {
    return (
      <main className="flex min-h-full items-center justify-center bg-gray-50 px-4 py-8">
        <div
          className="flex w-full max-w-[480px] flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white p-6 text-center shadow-sm"
          data-testid="wizard-handoff"
        >
          <PostAuthHandoff target={selectedProviders.includes("aws") ? "/workspace/cloud-accounts?connect=aws" : "/dashboard"} expectedWorkspaceId={createdWorkspaceId} />
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-full flex-col items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-[480px]">
        <header className="mb-6">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-500">
            Workspace setup
          </span>
          <h1 className="mt-1 text-sm font-bold text-gray-900">
            {stepIndex === 0
              ? "Give your team a home"
              : stepIndex === 1
                ? "Set the environment"
                : "Where do you plan to build?"}
          </h1>
          <p className="mt-1 text-xs text-gray-500">
            {stepIndex === 0
              ? "Every request, approval, and audit event belongs to a workspace. You'll be its first admin."
              : stepIndex === 1
                ? "Pick the default boundary for new requests. You can change it per request later."
                : "Select the providers you plan to use. This helps Provisr prepare the right setup."}
          </p>
        </header>

        <ol
          aria-label="Onboarding progress"
          className="mb-6 flex items-center gap-2"
        >
          {steps.map((label, index) => (
            <li className="flex items-center gap-2" key={label}>
              <span
                aria-current={index === stepIndex ? "step" : undefined}
                className={
                  index <= stepIndex
                    ? "flex size-5 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold text-white"
                    : "flex size-5 items-center justify-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500"
                }
              >
                {index + 1}
              </span>
              {index < steps.length - 1 ? <span className="h-0.5 w-8 bg-gray-100" /> : null}
            </li>
          ))}
        </ol>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          {payloadLocked ? (
            <p className="mb-3 text-xs text-gray-700" data-testid="wizard-recovery-notice" role="status">
              Your choices are locked while Provisr confirms this workspace. If setup is interrupted,
              retry to finish using the same choices.
            </p>
          ) : null}
          {submitError ? (
            <div
              className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900"
              data-testid="wizard-error-banner"
              role="alert"
            >
              {submitError}
            </div>
          ) : null}

          <motion.div data-testid={`wizard-step-${stepIndex + 1}`} key={stepIndex} {...stepMotion}>
            {stepIndex === 0 ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-blue-500">
                    {avatar ?? (trimmedName.charAt(0).toUpperCase() || "W")}
                  </span>
                  <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Workspace avatar">
                    {avatarOptions.map((option) => (
                      <button
                        aria-pressed={avatar === option}
                        className={
                          avatar === option
                            ? "flex size-8 items-center justify-center rounded-full border-2 border-blue-500 text-sm"
                            : "flex size-8 items-center justify-center rounded-full border border-gray-200 text-sm"
                        }
                        key={option}
                        disabled={payloadLocked}
                        onClick={() => {
                          if (submittedPayload.current === null) setAvatar(avatar === option ? null : option);
                        }}
                        type="button"
                      >
                        {option}
                      </button>
                    ))}
                  </span>
                </div>

                <label className="space-y-1 text-xs">
                  <span className="font-semibold text-gray-700">Workspace name</span>
                  <input
                    aria-invalid={nameError ? true : undefined}
                    autoComplete="organization"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                    data-testid="workspace-name-input"
                    disabled={payloadLocked}
                    maxLength={NAME_MAX + 8}
                    onBlur={validateName}
                    onChange={(event) => {
                      if (submittedPayload.current !== null) return;
                      setName(event.target.value);
                      if (nameError) setNameError(null);
                    }}
                    placeholder="Acme Platform"
                    value={name}
                  />
                  {nameError ? (
                    <span className="block text-red-900" data-testid="workspace-name-error" role="alert">
                      {nameError}
                    </span>
                  ) : (
                    <span className="block text-gray-400" data-testid="slug-preview">
                      provisr.app/{slug}
                    </span>
                  )}
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-semibold text-gray-700">
                    Description <span className="text-gray-400">(optional)</span>
                  </span>
                  <textarea
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
                    data-testid="workspace-description-input"
                    disabled={payloadLocked}
                    maxLength={500}
                    onChange={(event) => {
                      if (submittedPayload.current === null) setDescription(event.target.value);
                    }}
                    placeholder="What will this workspace be used for?"
                    rows={2}
                    value={description}
                  />
                </label>
              </div>
            ) : null}

            {stepIndex === 1 ? (
              <div className="space-y-2" role="radiogroup" aria-label="Default environment">
                {environments.map((option) => {
                  const active = environment === option.id;
                  return (
                    <button
                      aria-checked={active}
                      className={
                        active
                          ? `flex w-full items-start gap-3 rounded-lg border p-3 text-left ${option.activeClass}`
                          : "flex w-full items-start gap-3 rounded-lg border border-gray-200 p-3 text-left"
                      }
                      data-testid={`environment-card-${option.id}`}
                      disabled={payloadLocked}
                      key={option.id}
                      onClick={() => {
                        if (submittedPayload.current === null) setEnvironment(option.id);
                      }}
                      role="radio"
                      type="button"
                    >
                      <span className={`mt-1 size-3 shrink-0 rounded-full ${option.dotClass}`} />
                      <span>
                        <span className="block text-xs font-bold text-gray-900">{option.label}</span>
                        <span className="block text-xs text-gray-500">{option.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {stepIndex === 2 ? (
              <div className="space-y-2">
                {providers.map((option) => {
                  const active = selectedProviders.includes(option.id);
                  return (
                    <button
                      aria-pressed={active}
                      className={
                        active
                          ? "flex w-full items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-left"
                          : "flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left"
                      }
                      data-testid={`provider-card-${option.id}`}
                      disabled={payloadLocked}
                      key={option.id}
                      onClick={() => toggleProvider(option.id)}
                      type="button"
                    >
                      <CloudProviderLogo provider={option.id} size="sm" />
                      <span>
                        <span className="block text-xs font-bold text-gray-900">{option.name}</span>
                        <span className="block text-xs text-gray-500">{option.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </motion.div>
        </section>

        <footer className="mt-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {stepIndex > 0 ? (
              <button
                className="rounded-full border border-gray-200 px-4 py-2 text-xs font-medium text-gray-700"
                data-testid="wizard-back"
                disabled={submitting || payloadLocked}
                onClick={goBack}
                type="button"
              >
                ← Back
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {stepIndex > 0 ? (
              <button
                className="text-xs font-medium text-gray-500"
                data-testid="wizard-skip"
                disabled={submitting}
                onClick={() => void submit()}
                type="button"
              >
                Skip for now
              </button>
            ) : null}
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-blue-500 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              data-testid="wizard-next"
              disabled={submitting}
              onClick={goNext}
              type="button"
            >
              {submitting ? (
                <>
                  <span aria-hidden="true" className="provisr-spinner" />
                  Creating workspace…
                </>
              ) : (
                "Get Started"
              )}
            </button>
          </div>
        </footer>
      </div>
    </main>
  );
}
