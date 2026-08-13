# AGENTS.md — backend

## Stack
Go 1.23, net/http, OPA/Rego, PostgreSQL 16, golang-migrate, zerolog.

## Dev
```bash
cd backend
go run ./cmd/<service>             # Run one service
go build ./cmd/...                 # Build all
go test ./...                      # Test all
golangci-lint run ./...            # Lint
```

## Module layout
Multi-module monorepo. `go.work` links services + shared pkgs.
```
backend/
├── cmd/⟨service⟩/main.go          # Binary entrypoint, thin
├── pkg/health/                    # Shared health check handler
├── pkg/middleware/                 # Shared auth/logging/telemetry
├── pkg/vault/                     # Vault credential wrapper
├── pkg/protos/                    # Generated proto stubs
├── internal/                      # Service-private packages
└── migrations/                    # golang-migrate SQL
```

## Service ports
| Service | Port |
|---|---|
| policy-service | 8081 |
| state-service | 8082 |
| provisioning-service | 8083 |
| approval-service | 8084 |
| audit-service | 8085 |
| notification-service | 8086 |
| reconciler | 8087 |

## Patterns
- net/http standard library + middleware pattern. No heavy frameworks.
- `pkg/health.Handler()` returns `/health/live` and `/health/ready`.
- Config from env vars via `os.Getenv`, validated at startup.
- zerolog structured logger. Include `service`, `request_id`, `correlation_id` in every log.
- DB migrations: golang-migrate, `.up.sql` creates, `.down.sql` drops.

## Critical rules
- Every mutation requires idempotency key and audit event
- `execute_iac` blocked unless orchestration execution authorization present
- Execution locking prevents concurrent applies for same request/state
- Cloud credentials: short-lived via Vault, never stored in code or config
- Audit events: immutable, hash-chained, append-only DB role