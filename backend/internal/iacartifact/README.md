# BE-D04 — Terraform artifact generation

`POST /v1/iac/generate` is a private manifest-service route on port 8090. Set
`ORCHESTRATOR_SERVICE_TOKEN` in the environment for both the backend and MCP.
Missing service authorization fails closed. This route does not accept Terraform
or mutable manifest content; its request is:

```json
{
  "manifest_id": "immutable-manifest-uuid",
  "context": {
    "workspace_id": "uuid", "user_id": "uuid", "request_id": "run-uuid",
    "session_id": "uuid", "correlation_id": "uuid",
    "permissions": ["iac:write"], "idempotency_key": "generate-run-version-1"
  }
}
```

Apply migration `000022_terraform_artifact_generation` after the existing
migrations. Generation checks live admin/engineer membership and locks the run.
The manifest must belong to that run and match its active, validated, and
manifest-confirmed version, session, requester, and correlation. New generation
requires `IAC_GENERATING`. This is OR-012's manifest lock, not final execution
confirmation. An identical retry remains available after the state advances while
the selected manifest remains current. Conflicting keys fail with 409.

Individual files and metadata are stored together in `provisr_iac.artifacts`;
`storage_path` is a private `db://provisr_iac/artifacts/<id>` locator, not a public
download URL. The immutable JSON bundle contains file/byte counts, template source,
manifest ID/version, workspace, run and session linkage. A hash-chained audit event
commits in the same transaction. Existing artifact rows remain compatible.
Rollback refuses to discard generated bundles: archive and explicitly remove those
rows under a separately reviewed maintenance procedure before rolling back.

The bundle loads `resources/` as a local module. Root and module variables carry
validated resource properties; `terraform.tfvars` supplies manifest values.
Template branching and security defaults remain bound to the confirmed manifest.
The S3 `name` property retained by MCP-012 maps losslessly to template `bucket`.
Conflicting aliases fail. Other missing template inputs, including concrete AMIs,
network IDs or engine versions, are never guessed.

Provider/backend configuration builders cover AWS, Azure and GCP. The reviewed
BE-D03 resource catalog currently covers AWS only; unsupported resource types
produce structured 422 diagnostics and no partial artifact. No AI fallback exists.
Remote backend blocks are partial: `statebackend.Manager.Prepare` (BE-D08, see
`internal/statebackend/README.md`) supplies the provisioner-controlled
bucket/container and locking configuration before initialization. This service
does not create remote state, initialize Terraform, plan, apply, acquire cloud
credentials, or advance orchestration. OR-013 and BE-D05 remain separate tasks.

Run `go test ./...` and `go test -race ./internal/iacartifact ./internal/terraform`.
Database tests additionally require `TEST_DATABASE_URL` pointing to a disposable
`provisr_or_planning_test_*` database with all migrations and `provisr_app` role.
They prove concurrent replay, immutable storage, access/version guards, audit
rollback, and generation under the application database role.

## BE-D06 — secret scanning

Before storage, rendered files are scanned with `pkg/secretscan` (see its
README). Any finding blocks the artifact: no row is inserted, a hash-chained
`secret_detected` audit event commits (apply migration `000028_secret_scanning`),
and the route returns `422 {"error":"secret_detected","findings":[{type,location,detector,line,column}]}`.
Findings never include the secret value. Artifacts replayed by idempotency key
are rescanned before they are returned. MCP-014 forwards the findings in the
same structure.
