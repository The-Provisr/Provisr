import "server-only";

type EnsureUserInput = {
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  workspaceId?: string;
};

type EnsureUserResult = {
  id: string;
  workspaceId: string | null;
};

const ENSURE_USER_TIMEOUT_MS = 5000;

export async function ensureUser(
  token: string,
  input: EnsureUserInput,
  idempotencyKey: string,
): Promise<EnsureUserResult> {
  try {
    const res = await fetch(`${process.env.ORCHESTRATION_API_URL}/v1/users/ensure`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        // Idempotency: must equal the JWT sub; safe to retry, safe on every sign-in.
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
      cache: "no-store",
      // AbortSignal.timeout aborts and self-cleans its timer; without a bound,
      // a silent orchestrator would hang post-auth until the platform limit.
      signal: AbortSignal.timeout(ENSURE_USER_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`ensureUser failed: ${res.status} ${await res.text()}`);
    }

    return res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new Error(`ensureUser timed out after ${ENSURE_USER_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}
