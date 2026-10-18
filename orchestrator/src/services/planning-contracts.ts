import { z } from "zod";
import { COMPONENT_SCHEMA_VERSION, componentSchemasByVersion } from "@provisr/shared-contracts";

export const cloudAccountSchema = z.object({
  id: z.string().uuid(), workspace_id: z.string().uuid(), provider: z.enum(["aws", "azure", "gcp"]),
  label: z.string(), status: z.enum(["pending", "active", "failed", "disconnected"]),
  verified_at: z.string().datetime({ offset: true }).nullish(),
});
export const cloudContextSchema = z.object({
  connected_providers: z.array(z.enum(["aws", "azure", "gcp"])).min(1),
  active_accounts: z.array(cloudAccountSchema.extend({
    supported_regions: z.array(z.string().min(1)).min(1),
    resource_counts: z.record(z.number().int().nonnegative()).nullable(),
    quota_limits: z.record(z.number().nonnegative()).nullable(),
  })).min(1),
});
export type CloudContext = z.infer<typeof cloudContextSchema>;

const answerFieldSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/).max(64),
  type: z.enum(["string", "number", "boolean", "strings"]),
  options: z.array(z.string().min(1)).min(1).nullish(),
}).strict().refine(f => !f.options || f.type === "string" || f.type === "strings", "Answer options are only allowed for string fields");
export const questionSchema = z.object({
  question: z.string().trim().min(1).max(10000),
  fields: z.array(answerFieldSchema).min(1).max(20).default([{ name: "answer", type: "string" }]),
  // Optional FE-C03 presentation detail from the agent's question bank; answers are still validated against `fields`.
  question_id: z.string().min(1).max(64).nullish(),
  input_type: z.enum(["text", "select", "multi_select", "boolean", "confirmation"]).nullish(),
  options: z.array(z.string().min(1)).max(50).nullish(),
  required: z.boolean().nullish(),
  field_mapping: z.string().min(1).max(128).nullish(),
}).strict().refine(q => new Set(q.fields.map(f => f.name)).size === q.fields.length, "Duplicate answer fields");
export type ClarificationQuestion = z.infer<typeof questionSchema>;

export function validateAnswers(question: ClarificationQuestion, answers: unknown): Record<string, unknown> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of question.fields) {
    let schema: z.ZodTypeAny = field.type === "number" ? z.number().finite()
      : field.type === "boolean" ? z.boolean()
      : field.type === "strings" ? z.array(z.string().trim().min(1).max(2000)).min(1).max(50)
      : z.string().trim().min(1).max(10000);
    if (field.options) {
      const options = field.options;
      schema = schema.refine(value => Array.isArray(value)
        ? value.every(v => options.includes(v)) : options.includes(value as string), "Invalid answer option");
    }
    shape[field.name] = schema;
  }
  return z.object(shape).strict().parse(answers);
}

const text = z.string().trim().min(1).max(10000);
export const agentEnvelopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assistant_message"), data: z.object({ message: text }).strict() }),
  z.object({ type: z.literal("clarification_question"), data: questionSchema }),
  z.object({ type: z.literal("manifest_draft"), data: z.object({ message: text, manifest: z.record(z.unknown()) }).strict() }),
  z.object({ type: z.literal("component_payload"), data: z.object({ component_id: z.string(), component_version: z.string().max(128).regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/).default(COMPONENT_SCHEMA_VERSION), payload: z.record(z.unknown()) }).strict() }),
  z.object({ type: z.literal("tool_summary"), data: z.object({ tool_name: text, summary: text }).strict() }),
  z.object({ type: z.literal("error"), data: z.object({ code: text, message: text, retryable: z.boolean().default(false) }).strict() }),
]);
export const agentResponseSchema = z.object({
  result: z.object({
    type: z.string(), data: z.unknown(), version: z.string().regex(/^\d+\.\d+\.\d+$/),
    request_id: z.string().uuid(),
    metadata: z.object({ confidence: z.number().min(0).max(1), source: z.enum(["llm_generated", "template", "user_input"]), warnings: z.array(z.string()).default([]) }).strict(),
  }).strict(),
}).strict();

export type ComponentPayloadIssue = { path: string; code: string };

export class ComponentPayloadValidationError extends Error {
  constructor(readonly componentType: string, readonly componentVersion: string, readonly issues: ComponentPayloadIssue[]) {
    super("Component payload failed schema validation");
    this.name = "ComponentPayloadValidationError";
  }
}

export function validateComponent(id: string, payload: unknown, version: string = COMPONENT_SCHEMA_VERSION): Record<string, unknown> {
  const versions = Object.hasOwn(componentSchemasByVersion, id)
    ? componentSchemasByVersion[id as keyof typeof componentSchemasByVersion] : undefined;
  const schema = versions && Object.hasOwn(versions, version)
    ? versions[version as keyof typeof versions] : undefined;
  if (!schema) throw new ComponentPayloadValidationError(versions ? id : "unknown", version === COMPONENT_SCHEMA_VERSION ? version : "unsupported", [{ path: "$", code: "unknown_component_or_version" }]);
  const result = schema.safeParse(payload);
  if (!result.success) throw new ComponentPayloadValidationError(id, version,
    result.error.issues.map(issue => ({ path: "$", code: issue.code })));
  return result.data as Record<string, unknown>;
}

/** Project validated manifest data into the existing domain registry. */
export function manifestComponents(manifest: Record<string, unknown>, requestId: string, version: number) {
  const resources: Array<Record<string, unknown> & { name: string; type: string }> = z.array(z.object({ name: z.string().optional(), logical_name: z.string().optional(), type: z.string() }).passthrough())
    .parse(manifest.resources).map(resource => ({ ...resource, name: resource.name ?? resource.logical_name ?? "resource" }));
  const component = (type: string, data: unknown) => ({ type, version: "1.0.0", requestId, data: validateComponent(type, data) });
  return [component("architecture_summary", { provider: manifest.provider, region: manifest.region,
    environment: manifest.environment, resources: resources.map((resource, index) => ({ id: `${version}:${index}`, name: resource.name, type: resource.type })) }),
    ...resources.map((resource, index) => {
      switch (resource.type) {
        case "aws_ec2": return component("compute_plan", { service: "Amazon EC2", instanceType: resource.instance_type, replicaCount: resource.count ?? 1, os: resource.image });
        case "aws_rds": return component("database_config", { engine: resource.engine, instanceClass: resource.instance_class, allocatedStorageGb: resource.allocated_storage_gb });
        case "aws_s3": return component("storage_card", { bucketName: resource.name, versioning: resource.versioning ?? true });
        default: return component("resource_table", { rows: [{ id: `${version}:${index}`, name: resource.name,
          type: resource.type, provider: manifest.provider, status: "draft" }] });
      }
    })];
}
