# BE-E01 approval rule engine

`POST /v1/approval-requirements/evaluate` on approval-service (8084) requires
`Authorization: Bearer <ORCHESTRATOR_SERVICE_TOKEN>`. It is an internal service
boundary called by MCP-019 `get_approval_requirements`; the caller authorizes
the end user first. Unset service authentication disables the endpoint (503).

## Input
`workspace_id`, `user_id` (UUIDs), optional `run_id`, `environment`
(dev/staging/prod, aliases development/test/stage/production), `provider`,
`region`, `public_exposure`, `resource_changes[]` (`address`, `type`, `action`
create/update/delete/replace/no-op/read, defaulting to create, `public`,
`properties`), `cost_estimate.estimated_monthly_usd` (required, non-negative)
with `source` (default `manifest_estimate`; until OR-M05 it is the agent's
manifest estimate), and `policy` (`decision`, `violations`) from check_policy.
Unknown fields are rejected, so callers cannot supply the requester role.

The service resolves the requester role from `provisr_identity.memberships`, the
workspace environment from `provisr_identity.workspaces`, and the cost threshold
from `workspaces.settings.approval_rules.cost_threshold_usd` (default 500).
Non-members get 404; malformed settings fail closed with 500. A `DENY` policy
decision returns 409 `policy_denied`: approval can never override a deny.

## Rules (`be-e01.v1`, evaluated in this order)
| Rule | Triggers when | Approver | Risk |
|---|---|---|---|
| environment | run or workspace environment is prod | admin | high |
| cost | estimate > threshold (high at >= 5x) | finance | medium/high |
| resource_type | database delete/replace | admin | critical |
| resource_type | any IAM change | security | high |
| resource_type | security group/firewall allows inbound from 0.0.0.0/0, ::/0, `*`/Internet | security | high |
| public_exposure | `public_exposure` flag or any resource `public` | security | high |
| policy_violation | decision REQUIRES_APPROVAL or an `approval`-severity violation | security | medium |
| role | approver/auditor/viewer making any change; engineer making delete/replace | admin | medium |

Types match Terraform names and manifest `{domain}.{provider}.{kind}` types.
Aggregation: `risk_level` is the highest triggered risk, escalated to critical
when production combines with another high-risk rule. `required_approver_role`
comes from the highest-risk rule (ties: admin > security > finance) and is null
when no rule fires. `reason` joins rule reasons in order. Changes are sorted by
address and violations by rule key, so input order never changes the result.

## Audit
Every successful evaluation appends an `approval_requirements_evaluated` event
(migration 000023) to the hash chain before the response is returned; if the
append fails the request fails. The payload carries the decision, triggered
rules, `rule_set_version`, `input_digest` (SHA-256 over the normalized input,
server-resolved role/environment and config), config and cost source. Raw
resource properties are covered by the digest but not copied. Evaluation does
not mutate domain state, so it takes no Idempotency-Key; a retry appends a new
record with the same `input_digest`.

Out of scope: approval tickets/tokens (BE-E02), the MCP-019 tool, orchestrator
wiring (OR-017) and an `ApprovalRequirement` proto message.
