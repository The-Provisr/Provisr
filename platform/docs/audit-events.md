# Audit Events — Pipeline Reference

Every step in the Provisr provisioning pipeline writes a row to `provisr_audit.audit_events`.
This document lists which event fires at each step, the expected field values, and example payloads.

---

## Pipeline Flow

```
User submits request
  ↓ [STATE_TRANSITION]  RECEIVED
Agent processes request (ReAct loop)
  ↓ [STATE_TRANSITION]  PENDING_AGENT
  ↓ [AGENT_TOOL_CALL]   per tool invocation
  ↓ [LLM_INVOCATION]    per LLM call
Agent commits manifest
  ↓ [STATE_TRANSITION]  POLICY_CHECK
Policy Engine evaluates (OPA)
  ↓ [POLICY_RESULT]     ALLOW | DENY
Approval Service sends tokens
  ↓ [APPROVAL_DECISION] per approver response
  ↓ [STATE_TRANSITION]  PENDING_APPROVAL → PROVISIONING
Provisioning executes Terraform
  ↓ [PROVISIONING_RESULT]  SUCCEEDED | FAILED
  ↓ [STATE_TRANSITION]  PROVISIONING → LIVE | FAILED
Reconciler detects changes
  ↓ [DRIFT_DETECTED] / [DRIFT_RESOLVED]
```

---

## Event Types

| Event Type | When It Fires | Source Service |
|---|---|---|
| `STATE_TRANSITION` | A provisioning request changes status | orchestration |
| `AGENT_TOOL_CALL` | Agent invokes a tool (get_pricing, check_policy, etc.) | agent |
| `LLM_INVOCATION` | Agent makes an LLM API call | agent |
| `POLICY_RESULT` | OPA policy evaluation completes | policy |
| `POLICY_WAIVER` | A time-bound policy waiver is granted | policy |
| `APPROVAL_DECISION` | An approver approves or rejects | approval |
| `APPROVAL_DELEGATED` | An approver delegates to another user | approval |
| `PROVISIONING_RESULT` | Terraform execution completes | provisioning |
| `RESOURCE_MUTATION` | A resource is created, updated, or deleted | state |
| `DRIFT_DETECTED` | Reconciler finds a resource drifted from spec | reconciler |
| `DRIFT_RESOLVED` | Drift is resolved (auto-reconciled or accepted) | reconciler |
| `AUTH` | Authentication or authorization event | any |
| `ROLE_GRANT` | A role is assigned to a user | identity |
| `ROLE_REVOKE` | A role is removed from a user | identity |
| `SECRET_ACCESS` | A Vault secret is accessed | any |
| `DATA_EXPORT` | Bulk data export (auditor report, etc.) | any |
| `PII_REDACTION` | PII is redacted from stored data | any |

---

## State Transition Events

Fired by the Orchestration Service when a provisioning request changes status.

**Fields:**
| Field | Value |
|---|---|
| `event_type` | `STATE_TRANSITION` |
| `event_severity` | `INFO` |
| `actor_type` | `system` |
| `action` | `transition` |
| `outcome` | `success` |
| `from_state` | Previous status value |
| `to_state` | New status value |
| `request_id` | The provisioning request UUID |
| `source_service` | `orchestration` |

**Example:**
```json
{
  "org_id": "00000000-0000-0000-0000-000000000001",
  "event_type": "STATE_TRANSITION",
  "event_severity": "INFO",
  "actor_type": "system",
  "action": "transition",
  "outcome": "success",
  "from_state": "PENDING_AGENT",
  "to_state": "POLICY_CHECK",
  "request_id": "11111111-1111-1111-1111-111111111111",
  "source_service": "orchestration"
}
```

---

## Policy Result Events

Fired by the Policy Engine after OPA evaluation.

**Fields:**
| Field | Value |
|---|---|
| `event_type` | `POLICY_RESULT` |
| `event_severity` | `INFO` (ALLOW) or `HIGH` (DENY) |
| `actor_type` | `system` |
| `action` | `evaluate` |
| `outcome` | `success` (ALLOW) or `denied` (DENY) |
| `reason` | Required when outcome is `denied` |
| `policy_violations` | Array of violation objects |
| `source_service` | `policy` |

**Example (ALLOW):**
```json
{
  "org_id": "00000000-0000-0000-0000-000000000001",
  "event_type": "POLICY_RESULT",
  "actor_type": "system",
  "action": "evaluate",
  "outcome": "success",
  "source_service": "policy"
}
```

**Example (DENY):**
```json
{
  "org_id": "00000000-0000-0000-0000-000000000001",
  "event_type": "POLICY_RESULT",
  "event_severity": "HIGH",
  "actor_type": "system",
  "action": "evaluate",
  "outcome": "denied",
  "reason": "Budget limit exceeded: estimated $1,200 exceeds remaining $500",
  "policy_violations": [
    {
      "policy_key": "budget_limit",
      "severity": "HIGH",
      "message": "Estimated cost exceeds remaining monthly budget",
      "rule_path": "provisr.cost.budget_limit"
    }
  ],
  "source_service": "policy"
}
```

---

## Approval Decision Events

Fired by the Approval Service when an approver responds.

**Fields:**
| Field | Value |
|---|---|
| `event_type` | `APPROVAL_DECISION` |
| `event_severity` | `INFO` |
| `actor_type` | `user` |
| `actor_id` | The approver's user UUID |
| `actor_role_snapshot` | The approver's role at time of decision |
| `action` | `approve` or `reject` |
| `outcome` | `success` (approved) or `denied` (rejected) |
| `reason` | Required when rejected |
| `source_service` | `approval` |

**Example:**
```json
{
  "org_id": "00000000-0000-0000-0000-000000000001",
  "event_type": "APPROVAL_DECISION",
  "actor_type": "user",
  "actor_id": "22222222-2222-2222-2222-222222222222",
  "actor_role_snapshot": "admin",
  "action": "approve",
  "outcome": "success",
  "source_service": "approval"
}
```

---

## Provisioning Result Events

Fired by the Provisioning Service after Terraform execution.

**Fields:**
| Field | Value |
|---|---|
| `event_type` | `PROVISIONING_RESULT` |
| `event_severity` | `INFO` (success) or `HIGH` (failure) |
| `actor_type` | `system` |
| `action` | `provision` |
| `outcome` | `success` or `failure` |
| `reason` | Required when outcome is `failure` |
| `source_service` | `provisioning` |

**Example (success):**
```json
{
  "org_id": "00000000-0000-0000-0000-000000000001",
  "event_type": "PROVISIONING_RESULT",
  "actor_type": "system",
  "action": "provision",
  "outcome": "success",
  "source_service": "provisioning"
}
```

---

## Drift Events

Fired by the Reconciler when cloud resource state diverges from desired spec.

**Fields:**
| Field | Value |
|---|---|
| `event_type` | `DRIFT_DETECTED` or `DRIFT_RESOLVED` |
| `event_severity` | `MEDIUM` or `HIGH` |
| `actor_type` | `system` |
| `action` | `drift_detected` or `drift_resolved` |
| `outcome` | `success` |
| `resource_id` | The drifted resource UUID |
| `source_service` | `reconciler` |

**Example:**
```json
{
  "org_id": "00000000-0000-0000-0000-000000000001",
  "event_type": "DRIFT_DETECTED",
  "event_severity": "HIGH",
  "actor_type": "system",
  "action": "drift_detected",
  "outcome": "success",
  "resource_id": "33333333-3333-3333-3333-333333333333",
  "source_service": "reconciler"
}
```