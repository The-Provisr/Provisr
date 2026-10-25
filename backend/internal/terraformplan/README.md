# BE-D05 — Terraform Plan Service

Private `POST /v1/iac/plans` on provisioning-service (8083), protected by
`ORCHESTRATOR_SERVICE_TOKEN`. Request:

```json
{
  "iac_artifact_id": "uuid",
  "context": {
    "workspace_id": "uuid", "user_id": "uuid", "request_id": "run-uuid",
    "session_id": "uuid", "correlation_id": "uuid",
    "permissions": ["iac:write"], "idempotency_key": "plan-attempt-1"
  }
}
```

Only persisted BE-D04 artifacts are accepted. Live membership must be admin or
engineer. Requester/session/correlation, selected IaC artifact and current
validated/confirmed manifest version must all agree. New plans require
`PLAN_CREATING`; replay of an existing key also works after orchestration moves
forward, provided the same confirmed version remains selected.

Planning reuses delegated 15-minute AWS STS credentials and BE-D08's controlled
remote backend. No credentials arrive through HTTP or persist in configuration.
Azure/GCP fail closed until delegated onboarding and executable templates exist.
The delegated role needs the same backend access documented by BE-D08, plus
read/describe access needed to refresh the selected resource types. No execution
authorization is issued: final policy, confirmation and approval still follow.

Commands execute without a shell in a private temporary directory:

1. `terraform init -input=false -no-color -backend-config=backend.hcl`
2. `terraform plan -input=false -no-color -lock-timeout=10s -out=plan.tfplan`
3. `terraform show -json plan.tfplan`

[`plan -json`](https://developer.hashicorp.com/terraform/cli/commands/plan)
is a UI event stream. The saved plan is converted with
[`show -json`](https://developer.hashicorp.com/terraform/cli/commands/show)
to obtain the complete resource-change document. Terraform JSON can contain
plaintext sensitive values; it is never returned directly or logged.

Child processes receive only explicit delegated credentials, private HOME/CLI
configuration and fixed automation settings. Ambient TF arguments, logs, cloud
profiles and credential helpers are excluded. Cancellation kills the Terraform
process group, including provider children. Temporary files are removed on
success/failure. Request deadline is 100 seconds; provisioning HTTP timeout is
120 seconds. Docker runtime includes Terraform 1.15.8. Native development must
install Terraform on PATH. No `apply`, destroy, provisioner command or caller
command surface is exposed.

Response contains plan/IaC/manifest/run/workspace/session IDs, content hash,
private `raw_plan_json_reference`, and summary counts/resource changes/risk tags.
A replacement increments both create and delete counts. Data reads do not count
as managed-resource changes. Summary risks include destructive changes, cost
impact and public exposure; they are advisory inputs, not policy decisions.

Migration `000028_terraform_plans` adds immutable plan storage and a metadata
immutability trigger. Binary plan plus full JSON and redacted JSON are encrypted
with a separate workspace/domain key derived from `CLOUD_ACCOUNT_MASTER_KEY`.
No plan download route is added. Later artifact access must authorize the
workspace and redact before display; later apply must revalidate all gates and
use the same Terraform version. BE-D06 remains responsible for the broader
artifact secret-scanning gate. Storage and hash-chained audit append are atomic;
failed authorized attempts append safe error codes. No workflow state changes.

Proof:

```sh
cd backend
go test -race ./internal/terraformplan/... ./cmd/provisioning-service/...
TEST_TERRAFORM_BINARY=/absolute/path/terraform go test ./internal/terraformplan -run TestRealTerraform
TEST_DATABASE_URL='postgres://.../provisr_or_planning_test_NAME?sslmode=disable' go test -race ./internal/terraformplan
```

Database proof requires a disposable migrated database, including application
role and migration 028. It covers concurrent replay, cross-context/stale-version
rejection, encryption, application-role grants, failure audit and rollback when
audit persistence fails. The real CLI proof uses only built-in `terraform_data`
and a local test backend; it makes no AWS calls or resource changes.

Design: [discussion #171](https://github.com/The-Provisr/Provisr/discussions/171).
MCP-015 consumes this endpoint; OR-014 invokes it in the following sprint.
