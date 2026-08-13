# SECURITY.md — Security Policy

## Supported versions
MVP stage. All active development on `main`.

## Reporting a vulnerability
Open a security issue in the repo. Do not post public details. Tag `@HesandaLiyanage`.

## Security principles
- **Defense in depth.** Agent plans, orchestration guards, services enforce. No single layer is trusted.
- **Least privilege.** Every tool call scoped to workspace + user permissions. Execution uses short-lived delegated credentials.
- **Zero trust agent.** Agent outputs are untrusted until validated by orchestrator and backend services.
- **Immutable audit.** Every privileged action recorded in append-only audit log with hash chain.
- **No secrets in code.** Cloud credentials via Vault short-lived tokens. No .env committed. No access keys in browser.

## Key controls
- Every mutation requires idempotency key and audit event
- `execute_iac` blocked unless: policy passed + user confirmed + approval granted (if required) + no drift conflict
- Agent cannot execute IaC directly. Cannot bypass policy checks. Cannot expose secrets.
- Approval tokens HMAC-signed, stored hashed, expire after 72h, consume-once
- Terraform/plan artifacts scanned for secrets before storage/display
- Users cannot directly edit manifests or Terraform in MVP
- Cloud account metadata encrypted at rest (role ARNs, external IDs, service identity metadata)