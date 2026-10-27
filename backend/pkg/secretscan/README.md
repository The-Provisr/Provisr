# BE-D06 — Secret scanning for artifacts

PRD §19. `secretscan` detects credentials in generated artifacts and execution
output before they are stored or displayed. A `Finding` holds only the type,
location and detector. It has no field for the matched value, so findings are
safe to return to clients, log and audit.

## Detectors

| Detector  | Finds |
|-----------|-------|
| `regex`   | Private keys (PEM/OpenSSH/PGP), AWS access key IDs (`AKIA`/`ASIA`/…), AWS secret keys in `aws…secret` context, Azure subscription keys (`Ocp-Apim-Subscription-Key`, `AccountKey=`, `SharedAccessKey=`, SAS `sig=`), GCP service-account JSON and `private_key_id`, GCP `AIza` API keys, JWTs, connection strings with credentials, vendor API keys (GitHub, GitLab, Slack, Stripe, Anthropic, OpenAI, SendGrid), bearer tokens |
| `keyword` | Literal values assigned to secret-like keys (`password`, `secret`, `token`, `api_key`, `access_key`, `private_key`, `credential`, …) in HCL, JSON, YAML, env and log formats |
| `base64`  | Printable base64 payloads that decode to any `regex`/`keyword` match |
| `entropy` | Standalone tokens of 32+ chars, mixed case and digits, Shannon entropy ≥ 4.3 bits/char |

These are treated as references, not literals, and are never flagged:
- Terraform traversals (`var.`, `local.`, `data.`, `module.`, `random_password.…`)
- Interpolations (`${…}`, `{{…}}`, `$VAR`) and `<placeholders>`
- Secret store references (`vault:`, `arn:aws:secretsmanager:`, `arn:aws:ssm:`, `projects/…`)
- URLs, booleans and numbers

Keys ending in `_name`, `_id`, `_arn`, `_ttl`, `_tokens`, `_url` and similar suffixes are not treated as secret-bearing, and neither are keys starting with `manage_` or `enable_`. This is why `manage_master_user_password = true` and `http_tokens = "required"` are accepted. Hex digests and UUIDs are never entropy findings.

## API

| Function | Use |
|----------|-----|
| `ScanFiles([]File)` / `ScanText(name, s)` | Terraform and plan text. Location is `path:line:col` |
| `ScanJSON(name, data)` | Manifests. Location is `name:<JSON pointer>`, e.g. `manifest:/resources/0/properties/master_password` |
| `Redact(name, s)` | Returns text with each secret replaced by `[REDACTED:<type>]`, plus findings |
| `NewRedactingWriter(w, name)` | Line-buffered streaming redaction for Terraform stdout/stderr. It holds private-key blocks until their END marker. `Close` flushes; `Findings` returns what was redacted |
| `Check(kind, findings)` | Returns a `*BlockedError`; `Body()` is the uniform 422 response |
| `RecordFindings(ctx, tx, AuditInput)` | Appends a hash-chained `secret_detected` audit event (migration `000028`) |

Blocked responses are always:

```json
{"error": "secret_detected", "message": "...",
 "findings": [{"type": "password", "location": "terraform.tfvars:3:14", "detector": "keyword", "line": 3, "column": 14}]}
```

The audit payload is `{artifact_kind, action, finding_count, findings:[{type, location, detector}]}`.

## Where it runs

| Artifact | Path | On findings |
|----------|------|-------------|
| Terraform | `iacartifact.DBGenerator.Generate` (BE-D04) | No artifact row. The audit commits, then 422. A stored artifact replayed by idempotency key is rescanned and refused |
| Manifest draft | state-service `POST /v1/manifests` | Audited against the caller's own run, then 422, before MCP validation. `/validate` returns 422 without audit |
| Manifest version | manifest-service `POST /v1/runs/{id}/manifests` | Audited against the run's workspace and correlation, then 422 |
| Manifest display | manifest-service `GET …/latest`, `GET …/{version}` | 422 instead of the content, so legacy rows are never shown |

## Integration contract for BE-D05, BE-D07 and BE-D11

- **Plans** are generated artifacts. Run `ScanText` on the rendered plan and its JSON before storing an artifact of type `plan`. On findings, write `RecordFindings` with `ActionBlocked` and do not execute.
- **Execution logs** are redacted, not blocked. Wrap Terraform stdout/stderr in `NewRedactingWriter` before anything reaches storage, SSE or zerolog. After the run, call `RecordFindings` with `ArtifactKind: "log"`, `ActionRedacted` and `Findings()` whenever there are any.
- Never log the scanned text when reporting findings. Log `finding_count` or the findings themselves.

## Tests

```bash
go test -race ./pkg/secretscan
go test ./pkg/secretscan -run x -fuzz FuzzFindingsNeverContainSecret -fuzztime 30s
go test ./internal/terraform -run Secret   # reviewed templates must scan clean
```
