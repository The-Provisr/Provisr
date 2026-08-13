# CONTRIBUTING.md — Contributing to Provisr

## Development workflow

Every task follows a 4-stage design discussion process:

### Stage 1: Design Discussion (RFC)
- Open an issue using the `design-discussion` template
- Title format: `Design: [brief description]`
- Content must include:
  - Problem statement
  - Proposed solution
  - Affected layers (frontend/orchestrator/agent/mcp/backend/infra)
  - Alternatives considered
  - Open questions
- Tag relevant CODEOWNERS

### Stage 2: Review & Approval
- Minimum 48-hour review window
- 2 approvals required, at least 1 from the affected layer's CODEOWNER
- Discussion happens in issue comments
- Approved issues labeled `design:approved`
- Rejected issues closed with explanation

### Stage 3: Implementation
- Branch from `main`: `feat/NNN-short-description`
- Reference the RFC issue in your branch and PR description
- Implement per approved design. Scope changes require consensus.
- Write or update tests for changes.
- Run `task lint` and `task test` for affected layers before pushing.

### Stage 4: PR Review & Merge
- Open PR using the PR template
- PR description must reference the design discussion issue (#NNN)
- CODEOWNERS auto-requested based on changed files
- Same reviewers from stage 2 preferred
- Squash-merge with conventional commit:
  - `feat(layer): description` — new feature
  - `fix(layer): description` — bug fix
  - `docs(layer): description` — documentation
  - `refactor(layer): description` — refactor
  - `test(layer): description` — tests
  - `chore(layer): description` — maintenance

## Layer CODEOWNERS

| Layer | Owner | Backup |
|---|---|---|
| frontend | @Shalitha | @Hesanda |
| orchestrator | @Hesanda | @Shalitha |
| agent | @Pasindu | @Hesanda |
| mcp | @Pasindu | @Hesanda |
| backend | @Hesanda | @Sathmal |
| infra | @Chethaka | @Hesanda |

## Branch naming
- `feat/NNN-desc` — features
- `fix/NNN-desc` — bug fixes
- `docs/NNN-desc` — documentation
- `refactor/NNN-desc` — refactoring

## Pre-commit
Install hooks: `pre-commit install`
Hooks: trailing whitespace, end-of-file fixer, YAML/JSON validation, ruff (Python), golangci-lint (Go)

## First time setup
See `ONBOARDING.md` for environment setup steps.