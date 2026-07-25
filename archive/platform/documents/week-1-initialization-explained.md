# Provisr Platform Week 1 Initialization Notes

This document explains the Week 1 initialization task we fixed in `provisr-platform`. It is written for beginner-level Go knowledge, so it explains both what changed and why the current code exists.

## Current Task Summary

The task was to make the first Week 1 backend initialization card properly markable as done.

The original goal was:

- initialize the Go backend workspace,
- make all Go service skeletons compile,
- make root-level build verification possible,
- fix obvious migration issues,
- keep shared backend utilities in one place,
- leave the repo in a clean, understandable state for Week 2 work.

Before the fix, the repo had the right high-level shape, but some important details blocked the Definition of Done.

## What Was Broken

### 1. `go build ./...` failed from the repo root

The repo is a Go workspace made of many smaller Go modules:

- `pkg`
- `proto`
- `services/orchestration`
- `services/state`
- `services/provisioning`
- `services/policy`
- `services/approval`
- `services/audit`
- `services/notification`
- `services/reconciler`
- `tests/integration`

That is a valid structure, but the repository root itself did not have a `go.mod`.

So when we ran:

```bash
go build ./...
```

from the root, Go did not know what module the root belonged to. That made the Week 1 Definition of Done fail.

### 2. The migration files were reversed

The file named:

```text
db/migrations/000001_init_schema.up.sql
```

contained `DROP TABLE` and `DROP TYPE` statements.

That is backwards.

An `up` migration should create or move the database forward. A `down` migration should undo it.

### 3. The shared `pkg` module had missing explicit dependencies

The shared logging middleware imports:

```go
github.com/go-chi/chi/v5/middleware
go.opentelemetry.io/otel/trace
```

But `pkg/go.mod` did not explicitly require all the packages it directly imports. Go can sometimes work this out indirectly, but it is fragile and caused build problems.

### 4. The generated gRPC code required a newer gRPC version

The generated file:

```text
proto/gen/go/state/v1/state_grpc.pb.go
```

contains this check:

```go
const _ = grpc.SupportPackageIsVersion9
```

The comment above it says it requires `gRPC-Go v1.64.0 or later`.

But `proto/go.mod` was using:

```text
google.golang.org/grpc v1.63.2
```

That mismatch made the proto module fail to build.

### 5. Service builds needed a proper output location

Each service has a `cmd/` folder. When `go build ./...` runs inside a service module, Go may try to create a binary named `cmd`, but a folder named `cmd` already exists.

That causes this kind of problem:

```text
go: build output "cmd" already exists and is a directory
```

So the build process needs to tell Go where to put service binaries.

## What We Changed

### Added a root `go.mod`

File:

```text
go.mod
```

Purpose:

- makes the repository root a valid Go module,
- allows `go build ./...` to run from the root,
- satisfies the original Week 1 build-check wording.

The root module is intentionally tiny:

```go
module github.com/provisr/platform

go 1.25.5
```

### Added `internal/workspace/doc.go`

File:

```text
internal/workspace/doc.go
```

Purpose:

- gives the root module at least one buildable Go package,
- explains that real service code lives in separate workspace modules.

This file is not business logic. It exists to make the root module behave cleanly.

### Updated `go.work`

File:

```text
go.work
```

We added:

```text
.
```

to the workspace module list.

That means the root module is now part of the Go workspace along with the service modules.

### Added a `Makefile`

File:

```text
Makefile
```

Purpose:

- gives the project a clean root-level command for building all modules,
- avoids manually entering every service folder,
- writes service binaries into `/tmp/provisr-build`,
- handles empty scaffold modules like `tests/integration`.

Important commands:

```bash
make build
make test
make tidy
```

Use `go build ./...` as a basic root sanity check. Use `make build` as the real full workspace build.

### Fixed database migration direction

Files:

```text
db/migrations/000001_init_schema.up.sql
db/migrations/000001_init_schema.down.sql
```

Now:

- `up.sql` creates enums, tables, and RLS policies,
- `down.sql` drops tables and enum types.

That matches normal migration behavior.

### Fixed Go module dependencies

Files:

```text
pkg/go.mod
proto/go.mod
go.work.sum
```

Changes:

- added explicit package requirements used by `pkg`,
- updated gRPC from `v1.63.2` to `v1.64.0`,
- updated workspace checksums.

## Commands Verified

These commands passed:

```bash
rtk env GOCACHE=/tmp/provisr-go-build-cache go build ./...
rtk make build
rtk make test
```

There were warnings from the local machine's Go environment and sandbox permissions, but the commands exited successfully. The warnings were not project build failures.

## Beginner Go Concepts Used Here

### What is a Go module?

A Go module is a unit of Go code with its own `go.mod`.

Example:

```text
services/orchestration/go.mod
```

That file says: "this service is its own Go module, with its own dependencies."

### What is a Go workspace?

A Go workspace is a way to work with multiple Go modules at once.

This repo uses:

```text
go.work
```

That file tells Go:

```text
these separate modules belong together while developing locally
```

This is useful for microservice projects because each service can be independent, but local development still feels connected.

### Why do we have both `go.mod` and `go.work`?

`go.mod` defines a module.

`go.work` joins multiple modules together.

In this repo:

- the root `go.mod` exists so the root is buildable,
- `go.work` exists so all backend modules can be developed together,
- each service has its own `go.mod` so services can evolve independently.

### What is `cmd/main.go`?

In Go projects, `cmd/` usually contains executable entrypoints.

Example:

```text
services/policy/cmd/main.go
```

That file starts the Policy Service.

Later, business logic should move into internal packages, and `cmd/main.go` should stay small.

## Code Review

This section explains what currently sits in the repo and why it exists.

## Root Files

### `go.mod`

This is the root Go module.

Right now it exists mainly to make the repository root buildable. It does not contain backend business logic.

It connects to:

- `internal/workspace/doc.go`,
- `go.work`,
- the root `go build ./...` check.

### `go.work`

This is the Go workspace file.

It lists every local Go module that belongs to this backend workspace:

- root module,
- shared packages,
- protobuf package,
- each service,
- integration test module.

Without this file, each module would behave more isolated. With this file, local imports like:

```go
github.com/provisr/platform/pkg/health
```

resolve to the local `pkg` folder instead of needing a remote GitHub version.

### `go.work.sum`

This stores dependency checksums for workspace-level module resolution.

You usually do not edit this by hand.

It changes when dependency versions change, such as when we updated gRPC for the generated proto code.

### `Makefile`

This is the main developer command file.

It defines:

- `make build`
- `make test`
- `make tidy`

The important design choice is that services are built with:

```bash
go build -o /tmp/provisr-build/<service-name> ./cmd
```

That avoids binary name conflicts with the existing `cmd/` directories.

This file connects all backend modules into one practical workflow.

### `docker-compose.yml`

This currently starts only PostgreSQL:

- image: `postgres:16-alpine`
- local host port: `5433`
- container port: `5432`
- database: `provisr`
- password: `secret`

This is enough for the very first database skeleton, but it is not the full local environment yet.

Future Week 1/Week 2 infra work should add:

- Redis,
- LocalStack,
- Jaeger or OTLP collector,
- PostgreSQL image with pgvector support.

### `dockerfile`

This is a multi-stage Dockerfile for building one Go service at a time.

It uses:

```dockerfile
ARG SERVICE_NAME
```

That means the same Dockerfile can build different services.

Example concept:

```bash
docker build --build-arg SERVICE_NAME=policy .
```

The first stage builds the Go binary. The second stage copies that binary into a smaller Alpine image.

This connects to deployment later, when each service becomes its own container.

## `internal/`

### `internal/workspace/doc.go`

This is a tiny package that makes the root module buildable.

It is not part of the real Provisr backend logic.

It exists because the actual backend code is spread across workspace modules, and the root still needs to pass `go build ./...`.

## `pkg/`

The `pkg` module is for shared Go code used by multiple services.

Instead of every service writing its own health handler, logger, JWT parser, or Vault client, those common pieces live here.

### `pkg/go.mod`

This defines the shared package module:

```text
github.com/provisr/platform/pkg
```

It lists dependencies used by shared packages:

- AWS SDK,
- JWT library,
- Vault client,
- PostgreSQL driver,
- zerolog,
- OpenTelemetry,
- Chi middleware.

Not every dependency is heavily used yet. Some are foundation dependencies for upcoming service work.

### `pkg/health/handler.go`

This file defines a reusable health endpoint.

Main pieces:

```go
type Response struct {
    Status  string `json:"status"`
    Service string `json:"service"`
}
```

This struct controls the JSON response shape.

```go
func Handler(serviceName string) http.HandlerFunc
```

This returns an HTTP handler function.

Each service uses it like this:

```go
r.Get("/health", health.Handler(appConfig.ServiceName))
```

So if the service is `policy`, `/health` returns something like:

```json
{
  "status": "healthy",
  "service": "policy"
}
```

Why this matters:

- all services expose health the same way,
- local testing becomes easier,
- future Docker/Kubernetes/ECS health checks can reuse the same endpoint.

### `pkg/middleware/auth.go`

This file defines JWT authentication middleware.

Important idea:

```go
func JWTAuth(secret string) func(http.Handler) http.Handler
```

This function returns middleware. Middleware wraps an HTTP handler and runs logic before or after it.

What it does:

1. Reads the `Authorization` header.
2. Checks that it starts with `Bearer `.
3. Parses the JWT token.
4. Rejects the request with `401 Unauthorized` if invalid.
5. Stores token claims in the request context.

This is not currently wired into the service routes. It is a foundation for authenticated endpoints later.

Important note:

The code currently uses a shared secret:

```go
return []byte(secret), nil
```

For real Cognito production usage, this should be replaced with JWKS key validation from AWS Cognito.

### `pkg/middleware/logging.go`

This file defines structured request logging.

It wraps HTTP requests and logs:

- method,
- URL path,
- status code,
- latency,
- trace ID,
- remote IP.

Important line:

```go
ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
```

This wrapper lets the middleware see what status code the handler wrote.

Without this wrapper, logging middleware often cannot easily know if the response was `200`, `404`, `500`, etc.

It also reads OpenTelemetry trace context:

```go
span := trace.SpanFromContext(r.Context())
traceID := span.SpanContext().TraceID().String()
```

That prepares the project for distributed tracing across services.

### `pkg/telemetry/tracer.go`

This file initializes OpenTelemetry tracing.

Function:

```go
func InitTracer(ctx context.Context, serviceName, endpoint string) (*sdktrace.TracerProvider, error)
```

What it does:

1. Creates an OTLP gRPC exporter.
2. Adds service metadata, especially the service name.
3. Creates a trace provider.
4. Registers it globally with OpenTelemetry.

Why this matters:

Provisr will have many services. A single user request may go through:

```text
orchestration -> agent -> policy -> approval -> provisioning -> audit
```

Tracing lets you follow that request across service boundaries.

This package is not fully wired into the service skeletons yet, but it is the correct foundation.

### `pkg/vault/client.go`

This file wraps the official HashiCorp Vault client.

Function:

```go
func NewClient(address, token string) (*Client, error)
```

What it does:

1. Creates a Vault API config.
2. Sets the Vault address.
3. Creates the Vault client.
4. Sets the token.
5. Returns a small wrapper type.

Why this matters:

The architecture says cloud credentials should not live in PostgreSQL. They should live in Vault, and the database should only store references/paths.

This package will later be used by provisioning and cloud-adapter code.

## `services/`

The `services` folder contains eight Go microservice skeletons.

Each service currently has:

- its own `go.mod`,
- its own `go.sum`,
- a `config.json`,
- a `cmd/main.go`.

Right now these services are HTTP stubs. They expose:

- `GET /health`
- `GET /`

They do not yet contain the real business endpoints.

### Common service structure

Every service `main.go` follows the same pattern:

1. Import standard Go packages.
2. Import Chi router.
3. Import zerolog.
4. Import shared `pkg/health`.
5. Import shared `pkg/middleware`.
6. Define `Config`.
7. Load `config.json`.
8. Create router.
9. Add middleware.
10. Add `/health`.
11. Add `/`.
12. Start HTTP server.
13. Handle graceful shutdown.

### `Config` struct

Each service has:

```go
type Config struct {
    ServiceName string `json:"service_name"`
    Port        string `json:"port"`
    Environment string `json:"environment"`
}
```

This struct maps JSON config into Go fields.

Example config:

```json
{
  "service_name": "policy",
  "port": "8083",
  "environment": "dev"
}
```

### Config loading

Each service tries to read:

```go
os.ReadFile("config.json")
```

That means when you run a service manually, run it from the service folder.

Example:

```bash
cd services/policy
go run ./cmd
```

If the config file is missing, the service uses fallback defaults.

### Router and middleware

Each service uses Chi:

```go
r := chi.NewRouter()
```

Chi is a lightweight HTTP router for Go.

The services use standard middleware:

- request ID,
- real IP,
- panic recovery,
- timeout.

Then they use the shared structured logger:

```go
r.Use(middleware.StructuredLogger)
```

### Graceful shutdown

Each service listens for OS signals:

```go
signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)
```

This lets the service stop cleanly when the process is interrupted.

Why this matters:

In containers, services often receive `SIGTERM` when they are being stopped. Graceful shutdown gives in-flight requests a short chance to finish.

### Service-specific roles

#### `services/orchestration`

Purpose in the architecture:

This will become the main request coordinator. It should own the provisioning request state machine.

Future endpoints:

- `POST /v1/provision`
- request status transitions,
- calls to agent, policy, approval, provisioning, and audit.

Current state:

- HTTP skeleton only.

#### `services/state`

Purpose in the architecture:

This will own resource state and resource queries.

Future behavior:

- create resources,
- get resources,
- list resources by organization,
- update resource status,
- support agent tools like `get_org_resources`.

Current state:

- HTTP skeleton only,
- proto contracts exist in `proto/state/v1`.

#### `services/provisioning`

Purpose in the architecture:

This will create provisioning jobs and coordinate Terraform execution.

Future behavior:

- write `provisioning_jobs`,
- publish SQS jobs,
- track job attempts,
- update final status.

Current state:

- HTTP skeleton only.

#### `services/policy`

Purpose in the architecture:

This will evaluate infrastructure manifests against policy rules.

Future behavior:

- initialize OPA,
- evaluate Rego rules,
- block invalid regions,
- block over-budget requests,
- block missing required tags.

Current state:

- HTTP skeleton only.

#### `services/approval`

Purpose in the architecture:

This will manage approval tickets and approval decisions.

Future behavior:

- create approval tickets,
- create HMAC approval tokens,
- consume approve/reject decisions,
- notify orchestration when approved.

Current state:

- HTTP skeleton only.

#### `services/audit`

Purpose in the architecture:

This will write append-only audit events.

Future behavior:

- accept state transition events,
- write hash-chained audit rows,
- preserve security/compliance history.

Current state:

- HTTP skeleton only.

#### `services/notification`

Purpose in the architecture:

This will create and send notification records.

Future behavior:

- approval notifications,
- provisioning-complete notifications,
- drift notifications,
- dashboard notification reads.

Current state:

- HTTP skeleton only.

#### `services/reconciler`

Purpose in the architecture:

This will receive cloud events and detect drift between desired and actual infrastructure.

Future behavior:

- receive AWS EventBridge webhook events,
- store webhook receipts,
- deduplicate events,
- compare actual and desired state,
- create drift incidents.

Current state:

- HTTP skeleton only.

## `db/migrations/`

This folder contains SQL database migrations.

### `000001_init_schema.up.sql`

This creates the first database baseline.

It currently creates enums:

- `user_role`
- `request_intent`
- `request_status`
- `cloud_provider`
- `resource_status`

It creates tables:

- `organizations`
- `users`
- `provisioning_requests`
- `resources`
- `agent_sessions`
- `conversation_messages`

It enables Row Level Security on the tables.

RLS is important because Provisr is multi-tenant. Every organization should only see its own data.

Example:

```sql
CREATE POLICY tenant_isolation_users ON users
FOR ALL USING (org_id = current_setting('provisr.current_org', true)::uuid);
```

This says: only allow access to rows where `org_id` matches the current database session's organization setting.

### `000001_init_schema.down.sql`

This undoes the first migration.

It drops:

- conversation messages,
- agent sessions,
- resources,
- provisioning requests,
- users,
- organizations,
- enum types.

This is useful when resetting local development databases.

## `proto/`

The `proto` module defines gRPC contracts.

gRPC is a communication style where services call strongly typed methods instead of plain JSON endpoints.

### `proto/state/v1/resources.proto`

This defines a `Resource` message.

Fields include:

- `resource_id`
- `org_id`
- `provider`
- `resource_type`
- `display_name`
- `status`
- `region`

This is a simplified version of a cloud resource.

Later, State Service can return this message to the agent or frontend-facing APIs.

### `proto/state/v1/state.proto`

This defines `StateService`.

Current RPCs:

```proto
rpc GetOrgResources(GetOrgResourcesRequest) returns (GetOrgResourcesResponse)
rpc GetHistoricalDeployments(GetHistoricalDeploymentsRequest) returns (GetHistoricalDeploymentsResponse)
```

These are useful for the agent because the agent needs context.

Example:

If a user says:

```text
Create another EC2 instance like our existing dev server
```

The agent needs to ask the State Service what resources already exist.

### `proto/gen/go/state/v1/`

This folder contains generated Go code from the `.proto` files.

Important:

Do not manually edit generated files.

Instead:

1. edit `.proto` files,
2. regenerate Go code using the protobuf tooling.

Generated files include:

- Go structs for messages,
- gRPC client interface,
- gRPC server interface.

### `proto/buf.yaml`

This configures Buf linting and breaking-change rules for protobuf files.

Buf helps keep proto files clean and compatible.

### `proto/buf.gen.yaml`

This configures code generation.

It says to generate:

- Go protobuf code,
- Go gRPC code,

into:

```text
proto/gen/go
```

## `tests/integration/`

This module currently only has `go.mod`.

It exists as a placeholder for future integration tests.

The `Makefile` handles it safely. If there are no Go packages inside yet, it prints:

```text
no packages to test
```

That is expected during the skeleton phase.

## How The Pieces Connect

At a high level:

```text
User request
  -> orchestration service
  -> agent service in separate repo
  -> policy service
  -> approval service
  -> provisioning service
  -> state service
  -> audit service
  -> notification service
  -> reconciler later watches cloud drift
```

Inside this repo today:

```text
services/* use pkg/health and pkg/middleware
services/state will use proto/state contracts
db/migrations define the first database tables
Makefile builds all modules together
docker-compose starts local PostgreSQL
dockerfile prepares service container builds
```

## What Is Done Now

For the first Week 1 initialization task, these are now true:

- root `go build ./...` passes,
- `make build` builds all current modules and service binaries,
- `make test` runs across all modules,
- migration direction is correct,
- service configs use unique local ports,
- service skeletons expose `/health`,
- shared packages compile.

## What Is Still Skeleton-Only

This repo is not yet a working provisioning platform.

These are still missing and belong to later tasks:

- real orchestration state machine,
- real State Service gRPC implementation,
- real Policy Service OPA rules,
- real Approval Service endpoints,
- real Audit Service insert logic,
- real Provisioning Service SQS job flow,
- real Reconciler webhook logic,
- full Docker Compose stack with Redis, LocalStack, and Jaeger,
- real integration tests.

That is normal for this stage. The point of this task was to make the foundation correct.

## Useful Commands

Run a basic root build:

```bash
rtk env GOCACHE=/tmp/provisr-go-build-cache go build ./...
```

Build all modules and service binaries:

```bash
rtk make build
```

Run all current tests:

```bash
rtk make test
```

Run one service manually:

```bash
cd services/policy
go run ./cmd
```

Then test:

```bash
curl http://localhost:8083/health
```

## Suggested Next Learning Path For Go

Since you are beginner-level in Go, learn the repo in this order:

1. Read `pkg/health/handler.go`.
2. Read one service `cmd/main.go`, such as `services/policy/cmd/main.go`.
3. Learn what `http.HandlerFunc` means.
4. Learn how Chi routes work.
5. Learn what middleware is.
6. Read `pkg/middleware/logging.go`.
7. Read `go.mod` and `go.work`.
8. Read the migration SQL.
9. Read the proto files.
10. Only then start implementing real endpoints.

The best first real coding task after this is probably the Policy Service endpoint, because it is isolated and easier than orchestration.
