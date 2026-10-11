# Terraform Templates

This directory is a reserved namespace for reusable Terraform templates,
organized by resource category and cloud provider. It currently contains
only directory scaffolding — no templates have been authored yet. This
README documents the convention future templates in this directory must
follow.

## Structure

```
terraform-templates/
├── <category>/
│   ├── aws/
│   ├── azure/
│   └── gcp/
```

Categories:

| Category        | Purpose                                              |
|------------------|-------------------------------------------------------|
| `compute`        | Compute instances, container services, autoscaling    |
| `database`       | Managed database instances (RDS, Cloud SQL, etc.)      |
| `loadbalancing`  | Load balancers, target groups, listeners               |
| `monitoring`     | Metrics, logging, tracing, alerting resources           |
| `networking`     | VPCs, subnets, gateways, routing                         |
| `storage`        | Object storage, block storage, file systems              |

Each `<category>/<cloud>/` leaf directory holds a self-contained template
for that resource category on that cloud provider.

## Template contract

Every template added under a leaf directory should contain:

- `main.tf` — the resource definitions
- `variables.tf` — every input variable, each with a `description` and
  `type`, and a `default` only where a safe one exists
- `outputs.tf` — values other templates/modules need to reference (IDs,
  ARNs, endpoints)
- `versions.tf` — a `terraform {}` block pinning `required_version` and the
  provider version (see `infra/terraform/versions.tf` for the pattern used
  elsewhere in this repo)
- `terraform.tfvars.example` — an example tfvars file documenting expected
  values, safe to commit (no real secrets)

## Required environment variables by provider

To run `terraform plan`/`apply` against a template once authored, the
provider needs credentials supplied via environment variables (never
committed to `.tfvars`):

**AWS**
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (or `AWS_PROFILE` for a
  local credentials profile)
- `AWS_DEFAULT_REGION`

**Azure**
- `ARM_CLIENT_ID`
- `ARM_CLIENT_SECRET`
- `ARM_SUBSCRIPTION_ID`
- `ARM_TENANT_ID`

**GCP**
- `GOOGLE_APPLICATION_CREDENTIALS` (path to a service account key file, or
  `GOOGLE_CREDENTIALS` for inline JSON)
- `GOOGLE_PROJECT`

Template-specific input variables (declared in each template's
`variables.tf`) can be supplied without a `.tfvars` file via the
`TF_VAR_<name>` environment variable convention, e.g. `TF_VAR_instance_type`
for a `variable "instance_type"`.
