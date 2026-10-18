# BE-D03 phase 1

`Render(*manifest.Manifest)` returns deterministic in-memory Terraform files and
explicit unsupported diagnostics. It does not execute Terraform, persist files,
or grant execution permission. BE-D04 is responsible for audited/idempotent
artifact storage after orchestration validates and selects a manifest version.

The embedded templates use `templates/<domain>/aws/<resource>.hcl`. Supported
canonical types are `compute.aws.instance`, `storage.aws.s3`, `database.aws.rds`,
`network.aws.vpc`, `network.aws.subnet`, and `network.aws.security_group`.
Required property names are declared in `render.go`; unknown properties are
rejected. Current agent drafts must be normalized to this canonical contract by
the generation adapter, preserving actual cloud names in properties. No direct
free-form draft-to-Terraform fallback exists.

Network IDs reference existing infrastructure in this single-resource slice.
`depends_on` orders known resources but does not synthesize ID references.
Security groups start with no ingress/egress; networking rules, additional
domains, and multi-cloud templates are later phases. RDS explicitly requires
the requested engine/version and existing subnet/security groups, uses managed
passwords, encryption, private access, seven-day backups and deletion protection.
Destroy/snapshot naming is outside this phase and needs a separate reviewed flow.

Explicit encryption-type overrides are unsupported in this phase and fail before files are returned; fixed defaults never silently replace a requested mode.

All resources must be supported before any files are returned. HCL strings escape
Terraform interpolation; generated files remain subject to plan, formal policy
checks, confirmation and approval gates. Run `go test ./internal/terraform`.
