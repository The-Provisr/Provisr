"use client";

import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  DatabaseEngineSelector,
  DatabaseEngineSelectorComponent,
  type DatabaseEngineSelectorData,
  type EngineSelection,
} from "@/components/registry/components/database_engine_selector";

const aws: DatabaseEngineSelectorData = {
  runId: "run-preview",
  provider: "aws",
  recommendedEngine: "postgresql",
  reasoning: "Relational workload with JSON columns and moderate write volume.",
  availableEngines: [
    {
      engine: "postgresql",
      displayName: "PostgreSQL",
      version: "16.3",
      supported: true,
      managedServices: ["Amazon RDS", "Aurora"],
    },
    {
      engine: "mysql",
      displayName: "MySQL",
      version: "8.0",
      supported: true,
      managedServices: ["Amazon RDS", "Aurora"],
    },
    {
      engine: "oracle",
      displayName: "Oracle",
      version: "19c",
      supported: true,
      managedServices: ["Amazon RDS"],
    },
    {
      engine: "sqlserver",
      displayName: "SQL Server",
      version: "2022",
      supported: true,
      managedServices: ["Amazon RDS"],
    },
  ],
};

const gcp: DatabaseEngineSelectorData = {
  ...aws,
  provider: "gcp",
  recommendedEngine: "postgresql",
  selectedEngine: "mysql",
  availableEngines: aws.availableEngines.map((item) =>
    item.engine === "oracle"
      ? { ...item, supported: false, managedServices: [] }
      : { ...item, managedServices: ["Cloud SQL"] },
  ),
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function succeed(selection: EngineSelection) {
  await wait(1200);
  console.log("[preview] engine selected", selection);
}

async function fail() {
  await wait(1200);
  throw new Error("submitClarification failed: 500 Internal Server Error");
}

function Sample({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</h2>
      {children}
    </section>
  );
}

// Dev-only preview of the FE-C08A database_engine_selector with sample payloads.
// Uses fake submit handlers, so no orchestrator is needed.
export default function DatabaseEngineSelectorPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <main className="mx-auto max-w-[850px] space-y-6 px-4 py-8">
      <h1 className="text-sm font-semibold text-gray-900">database_engine_selector preview</h1>
      <Sample label="AWS, recommended engine, submit succeeds">
        <DatabaseEngineSelector data={aws} onSelect={succeed} />
      </Sample>
      <Sample label="Google Cloud, Oracle unsupported, current engine set, submit fails">
        <DatabaseEngineSelector data={gcp} onSelect={fail} />
      </Sample>
      <Sample label="Narrow chat column (320px)">
        <div style={{ maxWidth: 320 }}>
          <DatabaseEngineSelector data={aws} onSelect={succeed} />
        </div>
      </Sample>
      <Sample label="Loading">
        <DatabaseEngineSelectorComponent state="loading" />
      </Sample>
      <Sample label="Invalid payload">
        <DatabaseEngineSelectorComponent />
      </Sample>
    </main>
  );
}
