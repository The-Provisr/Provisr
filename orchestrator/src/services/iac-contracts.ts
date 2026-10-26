import { createHash } from "node:crypto";
import { posix } from "node:path";
import { z } from "zod";
import type { ProvisioningRun } from "../state-machine/runs.service";

// MCP-014, PR #157 (277076b): synchronous response; no generator stage feed.
const uuid = z.string().uuid().refine(value => value !== "00000000-0000-0000-0000-000000000000");
export const iacArtifactSchema = z.object({
  iac_artifact_id: uuid, manifest_id: uuid, manifest_version: z.number().int().positive(),
  run_id: uuid, workspace_id: uuid, session_id: uuid,
  terraform_files: z.array(z.object({ path: z.string().min(1).max(256), content: z.string().max(4 * 1024 * 1024) }).strict()).min(1).max(1000),
  file_list: z.array(z.string()).min(1).max(1000), file_count: z.number().int().min(1).max(1000),
  total_size: z.number().int().min(1).max(4 * 1024 * 1024), hash: z.string().regex(/^[a-f0-9]{64}$/),
  template_source: z.literal("template"),
  summary: z.object({ resource_count: z.number().int().min(1).max(1000), file_count: z.number().int().min(1).max(1000) }).strict(),
}).strict();
export type IacArtifact = z.infer<typeof iacArtifactSchema>;

export class IacGenerationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function assertConfirmedManifest(run: ProvisioningRun): void {
  if (!run.manifestVersion || run.manifestVersion !== run.manifestValidatedVersion
    || run.manifestVersion !== run.manifestConfirmedVersion || !run.manifestConfirmedAt) {
    throw new IacGenerationError("IAC_MANIFEST_NOT_CONFIRMED", "IaC generation requires the active validated and confirmed manifest.");
  }
}

export function verifyIacArtifact(value: unknown, run: ProvisioningRun, manifestId: string): IacArtifact {
  const invalid = () => new IacGenerationError("IAC_INVALID_ARTIFACT", "Generated Terraform could not be verified.");
  const parsed = iacArtifactSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const a = parsed.data;
  if (a.manifest_id !== manifestId || a.manifest_version !== run.manifestVersion || a.run_id !== run.id
    || a.workspace_id !== run.workspaceId || a.session_id !== run.sessionId) throw invalid();
  const paths = a.terraform_files.map(file => file.path);
  if (paths.some(path => path.includes("\\") || path.includes("\0") || path.split("/").includes("..")
    || posix.isAbsolute(path) || posix.normalize(path) !== path || !/\.(tf|tfvars)$/.test(path))
    || JSON.stringify(paths) !== JSON.stringify([...new Set(paths)].sort())
    || JSON.stringify(paths) !== JSON.stringify(a.file_list) || a.file_count !== paths.length
    || a.summary.file_count !== paths.length || !["main.tf", "outputs.tf", "variables.tf", "terraform.tfvars"].every(path => paths.includes(path))
    || !paths.some(path => path.startsWith("resources/"))) throw invalid();
  const hash = createHash("sha256");
  let size = 0;
  for (const file of a.terraform_files) { hash.update(`${file.path}\0${file.content}\0`, "utf8"); size += Buffer.byteLength(file.content, "utf8"); }
  if (size !== a.total_size || hash.digest("hex") !== a.hash) throw invalid();
  return a;
}

export function iacIdempotencyKey(run: ProvisioningRun, manifestId: string): string {
  return `iac:${run.id}:${manifestId}`;
}
