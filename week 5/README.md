# Week 5 — Policy Engine MVP

This directory collects the files related to **Policy Engine MVP — OPA Integration, Rego Rules & Approval Flow Wiring**.

The directory structure mirrors the original archived service layout:

- `services/policy/` — Go HTTP endpoint, OPA SDK integration, Rego policies, repository, configuration, and tests.
- `services/orchestration/internal/policy/` — policy-service client and response contract.
- `services/orchestration/internal/handler/` — provisioning flow policy/approval wiring.
- `services/approval/internal/handler/` — approval handler and tests.
- `services/approval/internal/orchestration/` — approval-to-orchestration callback client.

Original source: `archive/platform/services/`.
