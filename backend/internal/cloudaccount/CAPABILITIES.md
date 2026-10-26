# BE-B08 capability discovery

`GET /v1/workspaces/{workspace_id}/cloud-capabilities` requires
`Authorization: Bearer <ORCHESTRATOR_SERVICE_TOKEN>`. It is an internal service
boundary; authenticated gateway/MCP consumers must check user membership first.
Unset service authentication disables the endpoint. Existing CRUD authentication
is still tracked separately in issue #28.

Responses contain `workspace_id` and `accounts`, each with `id`, `provider`,
`status`, `account_alias`, masked `account_identity`, `default_region`,
`available_regions`, `supported_domains`, `execution_ready`, nullable `checked_at`
and an optional safe `warning` code. No decrypted metadata, external IDs, role
credentials, or raw AWS errors leave this endpoint.

AWS uses the standard runtime identity chain to AssumeRole for 15 minutes with
the account's encrypted external ID. Signed DescribeRegions calls return only
opted-in regions. IAM simulation checks creation permissions; unavailable access,
missing context, denies and truncated results keep readiness false. Simulation
is advisory: it cannot guarantee SCP/resource-policy coverage or replace plan,
formal policy checks, approval, quotas, drift guards or execution authorization.

Discovery facts are cached for one hour. Every request rereads account status and
updated_at, so disconnects and metadata changes cannot reuse an old cache key.
Successful verification proactively refreshes the workspace; the service also
refreshes active workspaces at startup and daily. Old accounts without an
encrypted external ID must be reconnected/reverified. The previous BE-B05
format-only verifier alone never makes capability discovery succeed.

Azure/GCP discovery stays explicitly unsupported until their delegated onboarding
implementations land. Resource counts and quotas remain unknown, not fabricated.
Supported domains come from BE-D03's real template catalog (PR #135), so this PR
is stacked on that branch. OR-009 reads this safe endpoint instead of raw metadata.

Tests exercise request authentication, workspace isolation, masking, cache
invalidation/expiry, refresh failures, signed delegated AWS requests, region
filtering and denied permissions. Live AWS calls require runtime-injected
credentials and a delegated account; local tests use transport fixtures only.
