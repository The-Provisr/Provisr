# MCP-028 — Monitoring manifest tools

The existing MCP app (`src.servers.policy_server:app`) registers both tools through
`src.servers.domain_server.router`. Both require the normal validated `context`
envelope, live workspace membership, and `manifest:write`. Authorization runs
before parsing tool-specific data. Missing/malformed/unauthorized context returns
the existing HTTP 403 `invalid_context` response.

These are stateless, deterministic draft operations. They do not persist manifests,
change run state, create cloud resources, execute Terraform, or send notifications.
They therefore require no mutation idempotency key or state-transition audit event.
Persisting or executing the resulting intent still requires the existing strict
policy, confirmation, approval, idempotency, and audit gates.

## Calls and results

```text
POST /tools/generate_monitoring_manifest
{"context": <MCP context>, "requirements": <provider example below>}

POST /tools/validate_monitoring_request
{"context": <MCP context>, "fragment": <provider example below>}
```

Requirements and fragments have the same explicit typed shape: `provider`, `region`,
and a nonempty `resources` array. Callers must supply every retention choice,
metric identity/aggregation, alarm threshold/comparison/window/missing-data choice,
and notification target they request. A logging-only or metric-only fragment is
also valid. Generation normalizes validated Pydantic data without inferring settings.

Both tools return HTTP 200 with `valid`, `errors`, and `deferred_resource_refs`.
Generation additionally returns `fragment` (null on failure). Errors contain
`field`, `code`, and actionable `message`; raw input values are not echoed.

```json
{"valid": false, "errors": [{"field": "resources.2.metric_ref", "code": "value_error", "message": "Value error, Reference must resolve to a metric in these resources"}], "deferred_resource_refs": []}
```

Complete, tested examples (illustrative choices, never defaults):

| Provider | Example | Supported intent |
| --- | --- | --- |
| AWS | [aws.json](examples/monitoring/aws.json) | CloudWatch log groups, metric identities/dimensions/statistics, static metric alarms, existing SNS topic ARNs |
| Azure | [azure.json](examples/monitoring/azure.json) | Monitor Log Analytics workspaces (`PerGB2018`), platform metric identities/aggregation, static metric alerts/severity, existing action group ARM IDs |
| GCP | [gcp.json](examples/monitoring/gcp.json) | Cloud Logging buckets/filter intent, Monitoring metric identities/alignment, threshold policies, existing notification channel names |

For example, load `aws.json` into `requirements` and send it with an authorized
context. Use the returned `fragment` as the validation tool's `fragment` argument.
Repeat with the Azure/GCP examples for their native contracts. Resource names,
destinations, recipients and thresholds in examples must be replaced with explicit
user requirements before use; they are not recommendations.

## Constraints and references

- AWS retention is one of CloudWatch's supported day counts (1 through 3653,
  discrete values); explicit null means never expire. Missing retention is invalid.
  Alarm periods are 10/20/30 seconds or multiples of 60; sub-minute alarms require
  an explicitly high-resolution metric. Evaluation windows are at most one day
  for periods below one hour, otherwise seven days. Datapoints cannot exceed
  evaluation periods. SNS references must use the manifest region.
- Azure workspace retention is 30–730 days for the supported SKU. Metric namespaces
  must match native monitored resource types. Static alert windows/frequencies use
  the allowed discrete values; frequency cannot exceed the window, severity is
  0–4, and `missing_data` is explicitly `ignore` (no CloudWatch mapping).
- GCP bucket retention is 1–3650 days; system buckets are excluded. Alignment is
  60–90000 seconds. Alert durations are whole minutes from 60–86400 seconds for
  explicit missing-data evaluation. Comparisons are strictly greater/less-than;
  trigger counts are positive. Notification channels must belong to the explicit
  alert policy project. Metric filters support equality selectors joined by AND,
  with exactly one matching `metric.type` and `resource.type`. Logging filter text
  is required and preserved; this tool is not a complete Cloud Logging query parser.
- Names and native resource/notification reference formats are checked per provider.
  Metric names must be unique resource identifiers in the fragment; alarm
  `metric_ref` resolves to a metric in the same resources array. Cross-provider
  resources, duplicate names, missing metrics and unknown fields are rejected.
- Workload references are either native ARNs/ARM IDs/GCP full resource names, or
  `manifest:<resource-name>`. Native references are syntax-checked only; existence,
  account ownership, metric availability, IAM, agents/exporters and log routing
  must be checked by authoritative cloud/policy stages. No cloud API is called.
  Local workload references are explicitly deferred by fragment validation; a
  full manifest must resolve them to non-monitoring resources. Azure/GCP workloads
  are not added by this task, so their monitoring examples use external resources.

## Full-manifest composition and contract ownership

Check that fragment provider and region equal the intended manifest, then append
`fragment.resources` to `manifest.resources`. Include the existing environment,
security, backup and loaded-policy fields. A monitoring-only manifest is accepted.
Submit the complete result through both existing manifest validators; fragment
validation does not replace either validation or policy checks.

The authoritative runtime Pydantic models are in
`packages/manifest-contracts/provisr_contracts`: monitoring domain first, provider
second. The agent's existing `app.domain.manifest` path re-exports the shared
contract. MCP applies the generated JSON Schema plus the same semantic validators
(JSON Schema alone cannot enforce resource graph integrity).

Proto `ResourceType` retains `LOG_GROUP` and `MONITORING_ALARM` and adds
`MONITORING_METRIC` without renumbering existing fields/enums. Its generic string
property map can carry provider-native typed configuration as JSON; the source
documents that transport convention. Existing runtime JSON has not been replaced
with protobuf JSON. No protobuf transport adapter is introduced here.

Regenerate the runtime schema, then run the retained drift check:

```sh
uv run --package provisr-mcp python scripts/generate-manifest-schema.py
uv run --all-packages pytest mcp/tests agent/tests -q
uv run --package provisr-mcp ruff check mcp/src packages/manifest-contracts
buf lint
```

## Terraform support boundary

MCP-014 PR #157, commit `277076b127a926985e5936c03a3886dcb0da7183`, delegates
`generate_iac` to BE-D04. Its paired implementation, PR #156 commit
`646944515ba81ddb925eaa70eb387746120ebb6f`, advertises only AWS compute, database,
network and storage domains. Its reviewed template catalog has **no monitoring
resources** and returns unsupported resources rather than partial deployment.
Neither implementation is present in this checkout. This task does not add
Terraform templates, a provisioning adapter, agent tool dispatch or a new prompt
version. Accepted monitoring intent therefore does not establish end-to-end
provisioning support. Existing pinned agent prompts remain intact.
