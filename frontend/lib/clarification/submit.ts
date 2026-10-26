import type { ClarificationAnswers } from "@/lib/clarification/types";
import { orchestrationBaseUrl } from "@/lib/orchestration/base-url";

const CLARIFY_TIMEOUT_MS = 10_000;

/**
 * POST /v1/runs/:id/clarify — resumes the suspended run with the answers.
 *
 * Idempotency key is stable per run+question, so the retry button resubmits
 * safely (AGENTS.md: every mutation needs an idempotency key).
 */
export async function submitClarification(
  runId: string,
  questionId: string,
  answers: ClarificationAnswers,
  token: string,
): Promise<void> {
  const res = await fetch(
    `${orchestrationBaseUrl()}/v1/runs/${runId}/clarify`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": `clarify:${runId}:${questionId}`,
      },
      body: JSON.stringify(answers),
      cache: "no-store",
      signal: AbortSignal.timeout(CLARIFY_TIMEOUT_MS),
    },
  );

  if (!res.ok) {
    throw new Error(
      `submitClarification failed: ${res.status} ${await res.text()}`,
    );
  }
}
