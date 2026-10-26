"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyIcon, DownloadIcon } from "@/components/ui/icons";

export type TemplateViewerProps = {
  template: string;
  fileName: string;
};

function downloadText(fileName: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/yaml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function TemplateViewer({ template, fileName }: TemplateViewerProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(template);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          CloudFormation template
        </span>
        <div className="flex gap-2">
          <Button onClick={copy} variant="secondary">
            <CopyIcon className="size-3.5" />
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button onClick={() => downloadText(fileName, template)} variant="secondary">
            <DownloadIcon className="size-3.5" />
            Download
          </Button>
        </div>
      </div>
      <pre
        aria-label="CloudFormation template"
        className="max-h-72 overflow-auto rounded-lg border border-gray-100 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-700"
      >
        <code>{template}</code>
      </pre>
    </div>
  );
}
