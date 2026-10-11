"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { EditIcon } from "@/components/ui/icons";

/**
 * Minimal hand-rolled Rego syntax highlighter. Colors map onto the provisr
 * semantic tokens (accent / danger-ink / warning-ink / ink-muted) so no new
 * dependencies or editor packages are required.
 */

type RegoToken = { text: string; className?: string };

const REGO_TOKEN =
  /(#[^\n]*)|("(?:[^"\\]|\\.)*")|\b(package|import|deny|allow|warn|approval_required|not|if|else|some|with|as|input|true|false|null|sprintf)\b|\b(\d+(?:\.\d+)?)\b|(==|!=|<=|>=|:=|=|\{|\}|\(|\)|\[|\]|,|\.)/g;

const tokenClass = (match: RegExpExecArray): string | undefined => {
  if (match[1]) return "text-gray-500 italic";
  if (match[2]) return "text-red-900";
  if (match[3]) return "font-semibold text-blue-700";
  if (match[4]) return "text-amber-900";
  return "text-gray-500";
};

export function tokenizeRego(line: string): RegoToken[] {
  const tokens: RegoToken[] = [];
  let lastIndex = 0;
  REGO_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REGO_TOKEN.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index) });
    }
    tokens.push({ text: match[0], className: tokenClass(match) });
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) {
      REGO_TOKEN.lastIndex++;
    }
  }
  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex) });
  }
  return tokens;
}

type RegoEditorProps = {
  source: string;
  isAdmin?: boolean;
  onChange?: (source: string) => void;
};

export function RegoEditor({ source, isAdmin = false, onChange }: RegoEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source);

  const lines = useMemo(() => (editing ? draft : source).split("\n"), [draft, editing, source]);

  const display = (
    <pre
      aria-label="Rego policy source"
      className="provisr-rego-view"
      data-testid="rego-view"
    >
      {lines.map((line, lineIndex) => (
        <div key={`${lineIndex}-${line.slice(0, 8)}`}>
          {tokenizeRego(line).map((token, tokenIndex) =>
            token.className ? (
              <span className={token.className} key={tokenIndex}>
                {token.text}
              </span>
            ) : (
              <span key={tokenIndex}>{token.text}</span>
            ),
          )}
        </div>
      ))}
    </pre>
  );

  if (!isAdmin) {
    return (
      <div className="relative overflow-hidden rounded-lg border border-gray-100 bg-gray-100">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Raw policy (read-only)
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
            <EditIcon className="size-3.5" /> admins only
          </span>
        </div>
        {display}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-100 bg-gray-100">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          {editing ? "Editing raw policy" : "Raw policy"}
        </span>
        {editing ? (
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                setEditing(false);
                setDraft(source);
              }}
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setEditing(false);
                onChange?.(draft);
              }}
              variant="primary"
            >
              Save
            </Button>
          </div>
        ) : (
          <Button
            onClick={() => {
              setDraft(source);
              setEditing(true);
            }}
            variant="secondary"
          >
            <EditIcon className="size-3.5" /> Edit
          </Button>
        )}
      </div>
      {editing ? (
        <textarea
          aria-label="Rego policy editor"
          className="provisr-rego-editor"
          data-testid="rego-editor"
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
          value={draft}
        />
      ) : (
        display
      )}
    </div>
  );
}