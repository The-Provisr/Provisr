import "server-only";

const CHAT_API_TIMEOUT_MS = 10_000;

export async function callChatApi(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${process.env.ORCHESTRATION_API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(CHAT_API_TIMEOUT_MS),
  });

  return response;
}
