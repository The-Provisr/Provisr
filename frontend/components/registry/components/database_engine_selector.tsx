"use client";

import { SignedIn, SignedOut, useAuth } from "@clerk/nextjs";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { DatabaseEngineLogo } from "@/components/ui/database-engine-logo";
import {
  AlertTriangleIcon,
  BanIcon,
  CheckIcon,
  RotateCcwIcon,
  StarIcon,
} from "@/components/ui/icons";
import { submitClarification } from "@/lib/clarification/submit";
import type { ClarificationAnswers } from "@/lib/clarification/types";
import { defaultRegistry } from "../registry";

// Provider support (`supported`, `managedServices`) comes from the payload so
// the agent stays the source of truth; there is no frontend lookup table.
export const databaseEngineSelectorSchema = z.object({
  runId: z.string().min(1),
  provider: z.enum(["aws", "azure", "gcp"]),
  recommendedEngine: z.string().optional(),
  selectedEngine: z.string().optional(),
  reasoning: z.string().optional(),
  availableEngines: z
    .array(
      z.object({
        engine: z.string().min(1),
        displayName: z.string().min(1),
        version: z.string().min(1),
        supported: z.boolean(),
        managedServices: z.array(z.string()).default([]),
        bestFor: z.string().optional(),
      }),
    )
    .min(1),
});

export type DatabaseEngineSelectorData = z.infer<typeof databaseEngineSelectorSchema>;

export type DatabaseEngineSelectorState = "loading" | "default";

export interface EngineSelection {
  engine: string;
  /** Absent for custom engines. */
  version?: string;
  custom: boolean;
}

export type EngineSelectionHandler = (selection: EngineSelection) => Promise<void>;

/** Answers sent through the existing clarification endpoint. */
export function buildEngineSelectionAnswers(selection: EngineSelection): ClarificationAnswers {
  return {
    answers: {
      database_engine: selection.engine,
      ...(selection.version ? { database_engine_version: selection.version } : {}),
      database_engine_custom: selection.custom,
    },
  };
}

/** Includes the choice, so a retry reuses its idempotency key and a different choice gets a new one. */
export function engineSelectionQuestionId(selection: EngineSelection): string {
  return `database_engine:${selection.engine}:${selection.version ?? ""}`;
}

const CUSTOM_KEY = "__custom__";

const providerNames: Record<DatabaseEngineSelectorData["provider"], string> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "Google Cloud",
};

type Phase = "idle" | "pending" | "error" | "confirmed";

const CARD_CLASS = "rounded-xl border border-gray-200 bg-white p-5 shadow-xs";

const radioBase =
  "flex w-full items-start gap-3 rounded-lg border p-3 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0099ff]";

const pillBase =
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold";

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
      {children}
    </span>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-gray-100 ${className}`} />;
}

function DatabaseEngineSelectorSkeleton() {
  return (
    <div data-testid="database-engine-selector-skeleton" aria-busy="true" className={CARD_CLASS}>
      <span className="sr-only">Loading database engines</span>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-3 w-3/4" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    </div>
  );
}

function DatabaseEngineSelectorError() {
  return (
    <div
      data-testid="database-engine-selector-error"
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="text-sm font-semibold">Database engine options unavailable</p>
        <p className="mt-1 text-xs leading-relaxed">
          The engine options are missing or invalid, so an engine cannot be chosen here.
        </p>
      </div>
    </div>
  );
}

type SelectorOption = {
  key: string;
  disabled: boolean;
};

function initialSelection(data: DatabaseEngineSelectorData): { key: string | null; custom: string } {
  const find = (id?: string) => data.availableEngines.find((item) => item.engine === id);
  if (data.selectedEngine) {
    const current = find(data.selectedEngine);
    if (!current) return { key: CUSTOM_KEY, custom: data.selectedEngine };
    if (current.supported) return { key: current.engine, custom: "" };
  }
  const recommended = find(data.recommendedEngine);
  return { key: recommended?.supported ? recommended.engine : null, custom: "" };
}

export function DatabaseEngineSelector({
  data,
  onSelect,
}: {
  data: DatabaseEngineSelectorData;
  onSelect: EngineSelectionHandler;
}) {
  const [initial] = useState(() => initialSelection(data));
  const [selectedKey, setSelectedKey] = useState<string | null>(initial.key);
  const [customText, setCustomText] = useState(initial.custom);
  const [customTouched, setCustomTouched] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastSelection, setLastSelection] = useState<EngineSelection | null>(null);
  const inFlight = useRef(false);
  const radioRefs = useRef(new Map<string, HTMLButtonElement>());
  const baseId = useId();

  const providerName = providerNames[data.provider];
  const locked = phase === "pending" || phase === "confirmed";
  const options: SelectorOption[] = [
    ...data.availableEngines.map((item) => ({ key: item.engine, disabled: !item.supported })),
    { key: CUSTOM_KEY, disabled: false },
  ];
  const enabledKeys = options.filter((option) => !option.disabled).map((option) => option.key);
  const tabbableKey = selectedKey ?? enabledKeys[0];

  const customSelected = selectedKey === CUSTOM_KEY;
  const customInvalid = customSelected && customText.trim() === "";
  const showCustomError = customInvalid && customTouched && !locked;
  const labelId = `${baseId}-label`;
  const customInputId = `${baseId}-custom`;
  const customErrorId = `${baseId}-custom-error`;
  const customNoteId = `${baseId}-custom-note`;

  function currentSelection(): EngineSelection | null {
    if (customSelected) {
      return customInvalid ? null : { engine: customText.trim(), custom: true };
    }
    const chosen = data.availableEngines.find((item) => item.engine === selectedKey);
    if (!chosen || !chosen.supported) return null;
    return { engine: chosen.engine, version: chosen.version, custom: false };
  }

  function choose(key: string) {
    if (locked) return;
    setSelectedKey(key);
    if (phase === "error") setPhase("idle");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, key: string) {
    if (locked) return;
    const index = enabledKeys.indexOf(key);
    let nextIndex: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        nextIndex = (index + 1) % enabledKeys.length;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        nextIndex = (index - 1 + enabledKeys.length) % enabledKeys.length;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = enabledKeys.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const nextKey = enabledKeys[nextIndex];
    if (nextKey === undefined) return;
    choose(nextKey);
    radioRefs.current.get(nextKey)?.focus();
  }

  async function submit(selection: EngineSelection | null) {
    if (inFlight.current) return;
    if (!selection) {
      setCustomTouched(true);
      return;
    }
    inFlight.current = true;
    setLastSelection(selection);
    setPhase("pending");
    try {
      await onSelect(selection);
      setPhase("confirmed");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save the engine choice");
      setPhase("error");
    } finally {
      inFlight.current = false;
    }
  }

  function radioProps(key: string, disabled: boolean) {
    const checked = selectedKey === key;
    return {
      ref: (node: HTMLButtonElement | null) => {
        if (node) radioRefs.current.set(key, node);
        else radioRefs.current.delete(key);
      },
      type: "button" as const,
      role: "radio",
      "aria-checked": checked,
      "aria-disabled": disabled || locked ? true : undefined,
      tabIndex: !disabled && key === tabbableKey ? 0 : -1,
      onClick: disabled ? undefined : () => choose(key),
      onKeyDown: disabled
        ? undefined
        : (event: KeyboardEvent<HTMLButtonElement>) => handleKeyDown(event, key),
      className: `${radioBase} ${
        disabled
          ? "cursor-not-allowed border-dashed border-gray-200 bg-gray-50"
          : checked
            ? "border-blue-200 bg-blue-50"
            : "border-gray-200 bg-gray-100"
      }`,
      // The remapped blue hairline is faint, so the selected border uses the accent token.
      style: checked ? { borderColor: "var(--provisr-accent-blue)" } : undefined,
    };
  }

  const selectedPill = (
    <span className={`${pillBase} border-blue-200 bg-blue-50 text-white`}>
      <CheckIcon className="size-3 shrink-0" />
      Selected
    </span>
  );

  return (
    <div data-testid="database-engine-selector" className={CARD_CLASS}>
      <Eyebrow>Database Engine</Eyebrow>
      <h3 id={labelId} className="mt-1 text-base font-semibold text-gray-900">
        Choose a database engine for {providerName}
      </h3>
      {data.reasoning ? (
        <p className="mt-1 text-xs leading-relaxed text-gray-500">{data.reasoning}</p>
      ) : null}

      <div role="radiogroup" aria-labelledby={labelId} className="mt-4 grid gap-2 sm:grid-cols-2">
        {data.availableEngines.map((item) => {
          const disabled = !item.supported;
          const checked = selectedKey === item.engine;
          return (
            <button key={item.engine} {...radioProps(item.engine, disabled)}>
              <DatabaseEngineLogo engine={item.engine} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`text-sm font-semibold ${disabled ? "text-gray-500" : "text-gray-900"}`}
                  >
                    {item.displayName}
                  </span>
                  <span className="font-mono text-gray-500">v{item.version}</span>
                </span>
                {disabled ? null : (
                  <span className="mt-1 block text-gray-500">
                    {item.managedServices.length > 0
                      ? item.managedServices.join(", ")
                      : `No managed service listed for ${providerName}`}
                  </span>
                )}
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {disabled ? (
                    <span className={`${pillBase} border-gray-200 bg-gray-100 text-gray-500`}>
                      <BanIcon className="size-3 shrink-0" />
                      Not supported on {providerName}
                    </span>
                  ) : null}
                  {checked ? selectedPill : null}
                  {item.engine === data.recommendedEngine ? (
                    <span className={`${pillBase} border-amber-200 bg-amber-50 text-amber-900`}>
                      <StarIcon className="size-3 shrink-0" />
                      Recommended
                    </span>
                  ) : null}
                  {item.engine === data.selectedEngine ? (
                    <span className={`${pillBase} border-gray-200 bg-white text-gray-900`}>
                      Current
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}

        <button {...radioProps(CUSTOM_KEY, false)}>
          <DatabaseEngineLogo engine="custom" />
          <span className="min-w-0 flex-1">
            <span className="text-sm font-semibold text-gray-900">Custom</span>
            <span className="mt-1 block text-gray-500">Enter another engine by name</span>
            {customSelected ? <span className="mt-2 flex">{selectedPill}</span> : null}
          </span>
        </button>
      </div>

      {customSelected ? (
        <div className="mt-3">
          <label htmlFor={customInputId} className="text-xs font-medium text-gray-900">
            Custom engine name
          </label>
          <input
            id={customInputId}
            type="text"
            value={customText}
            disabled={locked}
            onChange={(event) => setCustomText(event.target.value)}
            onBlur={() => setCustomTouched(true)}
            aria-invalid={showCustomError || undefined}
            aria-describedby={showCustomError ? `${customErrorId} ${customNoteId}` : customNoteId}
            className={`mt-1 w-full rounded-lg border bg-gray-50 px-3 py-2 text-sm text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0099ff] ${
              showCustomError ? "border-red-200" : "border-gray-200"
            }`}
          />
          {showCustomError ? (
            <p id={customErrorId} role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-red-900">
              <AlertTriangleIcon className="size-3.5 shrink-0" />
              Enter an engine name to continue.
            </p>
          ) : null}
          <p id={customNoteId} className="mt-2 flex items-start gap-1.5 text-xs text-amber-900">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            Provider support can&apos;t be checked for a custom engine.
          </p>
        </div>
      ) : null}

      {phase === "error" ? (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900"
        >
          <span className="flex items-start gap-2">
            <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            <span>
              <span className="font-semibold">Engine choice was not saved.</span> {errorMessage}
            </span>
          </span>
          <Button variant="secondary" onClick={() => submit(lastSelection)}>
            Retry
          </Button>
        </div>
      ) : null}

      {phase === "confirmed" && lastSelection ? (
        <p
          role="status"
          className="mt-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700"
        >
          <CheckIcon className="size-3.5 shrink-0" />
          Engine confirmed: {confirmedLabel(data, lastSelection)}
        </p>
      ) : (
        <div className="mt-4 flex items-center justify-end">
          <Button
            className="disabled:opacity-50"
            variant="primary"
            disabled={phase === "pending" || selectedKey === null}
            onClick={() => submit(currentSelection())}
          >
            {phase === "pending" ? (
              <>
                <RotateCcwIcon className="size-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Confirm engine"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function confirmedLabel(data: DatabaseEngineSelectorData, selection: EngineSelection): string {
  if (selection.custom) return `${selection.engine} (custom)`;
  const chosen = data.availableEngines.find((item) => item.engine === selection.engine);
  return `${chosen?.displayName ?? selection.engine} v${selection.version}`;
}

/**
 * Registry entry point. Mirrors AuthenticatedClarificationQuestion: binds the
 * Clerk token and sends the choice through POST /v1/runs/:id/clarify.
 */
export function DatabaseEngineSelectorComponent({
  data,
  state = "default",
}: {
  data?: DatabaseEngineSelectorData;
  state?: DatabaseEngineSelectorState;
}) {
  const { getToken } = useAuth();

  if (state === "loading") return <DatabaseEngineSelectorSkeleton />;

  const parsed = databaseEngineSelectorSchema.safeParse(data);
  if (!parsed.success) return <DatabaseEngineSelectorError />;
  const config = parsed.data;

  const onSelect: EngineSelectionHandler = async (selection) => {
    const token = await getToken();
    if (!token) {
      throw new Error("Authentication required");
    }
    await submitClarification(
      config.runId,
      engineSelectionQuestionId(selection),
      buildEngineSelectionAnswers(selection),
      token,
    );
  };

  return (
    <>
      <SignedIn>
        <DatabaseEngineSelector data={config} onSelect={onSelect} />
      </SignedIn>
      <SignedOut>
        <div className={CARD_CLASS}>
          <Eyebrow>Database Engine</Eyebrow>
          <p className="mt-1 text-sm font-medium text-gray-900">Choose a database engine</p>
          <p className="mt-2 text-xs text-gray-500">Sign in to choose an engine.</p>
        </div>
      </SignedOut>
    </>
  );
}

defaultRegistry.register({
  type: "database_engine_selector",
  version: "1.0",
  schema: databaseEngineSelectorSchema,
  component: DatabaseEngineSelectorComponent,
});
