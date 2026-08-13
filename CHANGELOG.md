# Changelog

All notable changes to Provisr are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Initial monorepo scaffold with 5-layer structure
- Go backend with 7 service stubs (go.work multi-module)
- NestJS orchestrator skeleton
- Python agent + MCP skeletons (uv workspace)
- Next.js frontend scaffold
- Protobuf contract definitions
- pnpm + uv + Go workspace configuration
- Docker Compose with profiles (all, backend, agent, orchestrator, frontend)
- Native dev scripts with hot-reload
- AGENTS.md files (root + per-layer) for universal AI tool support
- DESIGN.md, ARCHITECTURE.md, CONTRIBUTING.md, ONBOARDING.md, GLOSSARY.md, SECURITY.md
- GitHub Actions CI (matrix: Go, TS, Python, proto)
- Design discussion RFC workflow