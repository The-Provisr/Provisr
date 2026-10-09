"use client";

import { useState } from "react";
import { ChevronDownIcon, ExternalLinkIcon, LinkIcon, TuneIcon } from "@/components/ui/icons";
import { PolicySeverityBadge } from "@/components/ui/policy-severity-badge";
import { RegoEditor } from "@/components/ui/rego-editor";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/cn";
import type { PolicyParameter, PolicyRule } from "@/lib/policy/types";

type PolicyRuleRowProps = {
  rule: PolicyRule;
  enabled: boolean;
  defaultExpanded?: boolean;
  isAdmin?: boolean;
  onEnabledChange?: (ruleKey: string, enabled: boolean) => void;
  onExpandChange?: (ruleKey: string, expanded: boolean) => void;
  onParametersChange?: (ruleKey: string, parameters: PolicyParameter[]) => void;
  onRegoChange?: (ruleKey: string, source: string) => void;
};

export function PolicyRuleRow({
  rule,
  enabled,
  defaultExpanded = false,
  isAdmin = false,
  onEnabledChange,
  onExpandChange,
  onParametersChange,
  onRegoChange,
}: PolicyRuleRowProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggleExpanded = () => {
    setExpanded((value) => {
      const next = !value;
      onExpandChange?.(rule.key, next);
      return next;
    });
  };
  const [parameters, setParameters] = useState(rule.parameters);

  const updateParameter = (key: string, value: PolicyParameter["value"]) => {
    const next = parameters.map((parameter) => {
      if (parameter.key !== key) return parameter;
      switch (parameter.type) {
        case "text":
          return { ...parameter, value: value as string };
        case "number":
          return { ...parameter, value: value as number };
        case "multi_select":
          return { ...parameter, value: value as string[] };
        case "boolean":
          return { ...parameter, value: value as boolean };
      }
    });
    setParameters(next);
    onParametersChange?.(rule.key, next);
  };

  return (
    <div className="border-b border-gray-100">
      <div
        aria-expanded={expanded}
        className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 sm:px-6"
        data-testid="rule-row"
        onClick={toggleExpanded}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleExpanded();
          }
        }}
      >
        <Toggle
          checked={enabled}
          label={`Toggle rule ${rule.key}`}
          onChange={(checked) => onEnabledChange?.(rule.key, checked)}
          onClick={(event) => event.stopPropagation()}
        />
        <code className="rounded border border-gray-100 bg-gray-100 px-2 py-1 font-mono text-xs text-gray-900">
          {rule.key}
        </code>
        <PolicySeverityBadge severity={rule.severity} />
        <p className="min-w-0 flex-1 text-sm text-gray-700">{rule.description}</p>
        <ChevronDownIcon
          className={cn("size-4 shrink-0 text-gray-500 transition-transform", expanded && "rotate-180")}
        />
      </div>

      {expanded ? (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-4 pl-12 sm:px-6" data-testid="rule-detail">
          <div className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  <TuneIcon className="size-4" /> Rule Parameters
                </h4>
                <div className="space-y-4">
                  {parameters.length === 0 ? (
                    <p className="text-sm text-gray-500">No configurable parameters.</p>
                  ) : (
                    parameters.map((parameter) => (
                      <PolicyParameterField
                        key={parameter.key}
                        onChange={(value) => updateParameter(parameter.key, value)}
                        parameter={parameter}
                      />
                    ))
                  )}
                </div>
              </div>
              <div className="md:border-l md:border-gray-100 md:pl-8">
                <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Rule definition
                </h4>
                <p className="text-sm leading-relaxed text-gray-700">{rule.definition}</p>
                <h4 className="mb-3 mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                  Remediation hint
                </h4>
                <p className="rounded-md border border-gray-100 bg-white p-3 text-sm text-gray-700">
                  {rule.remediationHint}
                </p>
                {rule.docsUrl ? (
                  <a
                    className="mt-3 inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
                    href={rule.docsUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <LinkIcon className="size-3.5" /> View documentation
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                ) : null}
              </div>
            </div>

            <div>
              <h4 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                Raw policy (advanced)
              </h4>
              <RegoEditor
                isAdmin={isAdmin}
                onChange={(source) => onRegoChange?.(rule.key, source)}
                source={rule.regoSource}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type PolicyParameterFieldProps = {
  parameter: PolicyParameter;
  onChange: (value: PolicyParameter["value"]) => void;
};

export function PolicyParameterField({ parameter, onChange }: PolicyParameterFieldProps) {
  if (parameter.type === "boolean") {
    return (
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm font-medium text-gray-900" htmlFor={`param-${parameter.key}`}>
          {parameter.label}
        </label>
        <Toggle
          checked={Boolean(parameter.value)}
          label={parameter.label}
          onChange={(checked) => onChange(checked)}
        />
      </div>
    );
  }

  if (parameter.type === "multi_select" && parameter.options) {
    return (
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-900">{parameter.label}</label>
        <div className="flex flex-wrap gap-2">
          {parameter.options.map((option) => {
            const selected = (parameter.value as string[]).includes(option);
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  selected ? "bg-slate-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-50",
                )}
                key={option}
                onClick={() =>
                  onChange(
                    selected
                      ? (parameter.value as string[]).filter((value) => value !== option)
                      : [...(parameter.value as string[]), option],
                  )
                }
                type="button"
              >
                {option}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (parameter.type === "number") {
    return (
      <div>
        <label className="mb-2 block text-sm font-medium text-gray-900" htmlFor={`param-${parameter.key}`}>
          {parameter.label}
        </label>
        <input
          className="w-full rounded-md border border-gray-100 bg-white px-3 py-2 text-sm text-gray-900 focus-visible:ring-blue-100"
          id={`param-${parameter.key}`}
          max={parameter.max}
          min={parameter.min}
          onChange={(event) => onChange(Number(event.target.value))}
          step={parameter.step}
          type="number"
          value={String(parameter.value)}
        />
      </div>
    );
  }

  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-gray-900" htmlFor={`param-${parameter.key}`}>
        {parameter.label}
      </label>
      <input
        className="w-full rounded-md border border-gray-100 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus-visible:ring-blue-100"
        id={`param-${parameter.key}`}
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={String(parameter.value)}
      />
    </div>
  );
}