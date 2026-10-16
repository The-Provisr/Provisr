# FE-C16 security warning panel

Registry type `security_warning`, version `1.0`, accepts either the original
single-finding payload or `{ findings: [...] }`. A finding includes `title`,
`severity` (`critical`, `high`, `medium`, `low`), `description`, and optional
`affectedResource`, `suggestedFix`, or `mitigationSteps`.

Lists are grouped in descending severity with counts and plain-language fixes.
High/critical findings announce an accessible alert. Text is rendered as text,
never HTML. Findings remain visible; the card has no dismiss, approval or direct
manifest-edit control.

Only an explicit `{ findings: [] }` renders the clear state. Missing, malformed,
mixed legacy/list and unknown-severity payloads fail safely. Empty findings do
not assert that all policy, approval or execution gates have passed. Upstream
orchestration remains responsible for producing actual findings before review.

The card supports loading/error states. The development-only preview is
`/dev/security-warning` (404 in production). Page/run integration is separate
from this component task; this PR does not claim the existing demo chat is wired.
