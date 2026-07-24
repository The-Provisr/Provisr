# ONBOARDING.md — First-Time Setup

## Prerequisites
- Node.js 22+
- pnpm 9+ (`npm install -g pnpm`)
- Go 1.23+
- Python 3.12+
- uv (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- Docker Desktop (for infra services)
- buf CLI (`brew install buf`)
- Task (`brew install go-task`)
- pre-commit (`brew install pre-commit`)

## Clone & setup
```bash
git clone <repo-url> ~/Documents/Provisr
cd ~/Documents/Provisr

# Install all dependencies
task install

# Install pre-commit hooks
pre-commit install
```

## Directory map
See `AGENTS.md` for per-layer directory map and commands.

## Start developing

### All services (native, hot-reload)
```bash
# Start infra dependencies (Postgres, Redis, LocalStack)
cd infra/docker && docker compose up postgres redis localstack jaeger

# In another terminal, start all services
./scripts/dev.sh
```

### By layer
```bash
./scripts/dev-backend.sh          # Go services only
./scripts/dev-agent.sh            # Agent + MCP only
./scripts/dev-frontend.sh         # Frontend only (Next.js)
./scripts/dev-orchestrator.sh     # Orchestrator only
./scripts/dev-service.sh policy   # Single Go service
```

### Docker (full stack)
```bash
cd infra/docker
docker compose --profile all up   # Everything in containers
```

## Verify it works
```bash
# Health checks
curl localhost:4000/health/live   # Orchestrator
curl localhost:5000/health/live   # Agent
curl localhost:8081/health/live   # Policy service

# Run all tests
task test

# Lint all code
task lint
```

## Design discussion workflow
See `CONTRIBUTING.md` for RFC → implement → PR process.