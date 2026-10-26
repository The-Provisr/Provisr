import { createHash, randomUUID } from "node:crypto";
import { expect, vi } from "vitest";
import { RunsService } from "../../src/state-machine/runs.service";
import { AuditService } from "../../src/services/audit.service";
import { PlanningClients } from "../../src/services/planning-clients";
import { iacIdempotencyKey } from "../../src/services/iac-contracts";
import { makeRun, memoryDb } from "./planning-fixture";

export function iacFixture() {
  const run = makeRun({ state: "IAC_GENERATING", manifestVersion: 2, manifestValidatedVersion: 2,
    manifestConfirmedVersion: 2, manifestConfirmedAt: new Date(), agentTurnPending: false });
  const manifestId = randomUUID();
  const files = ["main.tf", "outputs.tf", "resources/storage.tf", "terraform.tfvars", "variables.tf"].map(path => ({ path, content: "# verified template é\n" }));
  const hash = createHash("sha256");
  for (const f of files) hash.update(`${f.path}\0${f.content}\0`);
  const artifact = { iac_artifact_id: randomUUID(), manifest_id: manifestId, manifest_version: 2,
    run_id: run.id, workspace_id: run.workspaceId, session_id: run.sessionId, terraform_files: files,
    file_list: files.map(f => f.path), file_count: files.length, total_size: files.reduce((sum, f) => sum + Buffer.byteLength(f.content), 0),
    hash: hash.digest("hex"), template_source: "template", summary: { resource_count: 1, file_count: files.length } };
  const db = memoryDb(run);
  const original = db.query.getMockImplementation()!;
  let locked = false;
  db.query.mockImplementation(async (sql, params) => {
    if (sql.includes("pg_try_advisory_lock")) { const acquired = !locked; locked = true; return { rows: [{ locked: acquired }] }; }
    if (sql.includes("pg_advisory_unlock")) { locked = false; return { rows: [] }; }
    if (sql.includes("SELECT m.id FROM")) {
      expect(params).toEqual([run.id, 2, run.workspaceId]);
      expect(sql).toContain("r.workspace_id = $3");
      return { rows: [{ id: manifestId }] };
    }
    if (sql.includes("SELECT a.generation")) return { rows: [{ generation: artifact, manifestId, hash: artifact.hash,
      idempotencyKey: iacIdempotencyKey(run, manifestId) }] };
    return original(sql, params);
  });
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(artifact)));
  const clients = new PlanningClients({ agentUrl: "http://agent", cloudAccountUrl: "http://cloud", policyUrl: "http://policy",
    mcpUrl: "http://mcp", manifestUrl: "http://state", serviceToken: "SECRET" }, fetcher);
  const service = new RunsService(db.db, new AuditService(db.db), clients);
  return { run, manifestId, artifact, db, fetcher, clients, service, process: () => service.processRun(run.id, run.workspaceId) };
}

