# GLOSSARY.md — Domain Terminology

| Term | Definition |
|---|---|
| **Manifest** | Canonical provider-neutral infrastructure intent. JSON with resources, dependencies, security, cost, confidence metadata. Source of truth for what to build. |
| **ReAct** | Reasoning + Acting loop. Agent iterates (max 8) to gather context, call tools, and produce a manifest. |
| **MCP** | Model Context Protocol. Structured tool layer exposing safe capabilities to the agent. |
| **OPA** | Open Policy Agent. Rego-based policy engine for deterministic policy evaluation. |
| **Rego** | OPA's declarative policy language. Rules encoded as `allow { … }`, `deny { … }`. |
| **IaC** | Infrastructure as Code. Terraform generated from validated manifests. |
| **SSE** | Server-Sent Events. Resumable event stream from orchestrator to frontend. |
| **EDA** | Event-Driven Architecture. State changes publish events to subscribers (agent, notification, audit). |
| **FSM** | Finite State Machine. Strict workflow state machine enforcing the provisioning flow order. |
| **Execution guard** | Orchestrator component that blocks `execute_iac` unless all gates pass. |
| **Idempotency key** | Unique key per mutation. Retries with same key don't duplicate. |
| **Drift** | Cloud resource state differs from desired spec. Detected via webhooks (real-time) or nightly sweep. |
| **Reconciler** | Go service that ingests cloud webhooks, detects drift, produces drift events. |
| **Component registry** | Frontend registry of 22 typed UI components. Agent emits typed payloads, registry renders them. |
| **Provider-neutral** | Manifest format that works across AWS, Azure, GCP with provider-specific extensions. |
| **Domain-first templates** | Terraform templates organized by infrastructure domain (compute, database, networking), then provider. |
| **StateVersion** | Optimistic lock counter on provisioning requests. Prevents concurrent state mutations. |
| **Correlation ID** | Trace ID spanning all services for a single request flow. Used in logs and events. |