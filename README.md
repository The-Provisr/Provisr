# Provisr

**Multi-cloud infrastructure provisioning via an agentic control plane.**

Five-layer monorepo:
- **frontend** — Next.js UX, Clerk auth, 22x component registry
- **orchestrator** — NestJS API gateway, workflow state machine, SSE
- **agent** — Python ReAct loop, manifest drafting, prompt registry
- **mcp** — Python MCP tool servers (policy, cloud, IaC, cost, domains)
- **backend** — Go services (policy, state, provisioning, approval, audit, notification, reconciler)

## Quick start

```bash
# Prerequisites: Node 22, pnpm 9, Go 1.23, Python 3.12, uv, Docker

git clone <repo-url> ~/Documents/Provisr
cd ~/Documents/Provisr
./scripts/setup.sh

# Start everything (native hot-reload)
./scripts/dev.sh

# Or start by layer
./scripts/dev-backend.sh    # Go services only
./scripts/dev-agent.sh      # Agent + MCP only
./scripts/dev-frontend.sh   # Next.js frontend
./scripts/dev-orchestrator.sh

# Or Docker
docker compose --profile all up
```

## Documentation

| Doc | Purpose |
|---|---|
| [AGENTS.md](AGENTS.md) | AI coding assistant instructions (universal) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture overview |
| [DESIGN.md](DESIGN.md) | Design philosophy and decisions |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Design discussion → implement → PR workflow |
| [ONBOARDING.md](ONBOARDING.md) | First-time developer setup |
| [GLOSSARY.md](GLOSSARY.md) | Domain terminology |
| [SECURITY.md](SECURITY.md) | Security policy |

Design specs live in the **docs-provisor** repository (architecture PDFs, ERD, SRS, PRD).

