import { z } from "zod";

const identifier = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const region = z.string().min(3).max(32).regex(/^[a-z]{2}-[a-z]+-\d$/);

const ec2 = z.object({
  type: z.literal("aws_ec2"),
  name: identifier,
  instance_type: z.string().min(1).max(64),
  image: z.string().min(1).max(128),
  count: z.number().int().min(1).max(20).default(1),
}).strict();

const rds = z.object({
  type: z.literal("aws_rds"),
  name: identifier,
  engine: z.enum(["postgres", "mysql"]),
  instance_class: z.string().min(1).max(64),
  allocated_storage_gb: z.number().int().min(20).max(16384),
}).strict();

const s3 = z.object({
  type: z.literal("aws_s3"),
  name: z.string().min(3).max(63).regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/),
  versioning: z.boolean().default(true),
}).strict();

/** Cross-layer source of truth for agent-generated AWS manifest candidates. */
export const ResourceManifestSchema = z.object({
  schema_version: z.literal("1.0").default("1.0"),
  provider: z.literal("aws").default("aws"),
  region,
  environment: z.enum(["development", "staging", "production", "sandbox"]),
  monthly_budget_usd: z.number().positive().optional(),
  tags: z.record(z.string()).default({}),
  resources: z.array(z.discriminatedUnion("type", [ec2, rds, s3])).min(1).max(50),
}).strict();

export type CanonicalResourceManifest = z.infer<typeof ResourceManifestSchema>;

export function validateResourceManifest(candidate: unknown):
  | { ok: true; manifest: CanonicalResourceManifest }
  | { ok: false; issues: Array<{ path: string; message: string }> } {
  const parsed = ResourceManifestSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  };
}
