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

export async function ensureUser(
  token: string,
  input: EnsureUserInput,
  idempotencyKey: string,
): Promise<EnsureUserResult> {
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
  });

  if (!res.ok) {
    throw new Error(`ensureUser failed: ${res.status} ${await res.text()}`);
  }

  return res.json();
}
