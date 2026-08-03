import "server-only";

type EnsureUserInput = {
  clerkId: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

type EnsureUserResult = {
  id: string;
  workspaceId: string | null;
};

export async function ensureUser(
  token: string,
  input: EnsureUserInput,
): Promise<EnsureUserResult> {
  const res = await fetch(`${process.env.ORCHESTRATION_API_URL}/v1/users/ensure`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      // Idempotency: safe to retry, safe on every sign-in.
      "Idempotency-Key": input.clerkId,
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`ensureUser failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
