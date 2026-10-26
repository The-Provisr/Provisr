import {
  CloudAccountError,
  type CloudAccount,
  type CloudAccountDetail,
  type CloudCapabilities,
  type CloudProviderId,
} from "./types";

const BASE = "/api/cloud-accounts";

export type CreateCloudAccountInput = {
  provider: CloudProviderId;
  label: string;
  externalAccountId?: string;
  metadata?: Record<string, unknown>;
};

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toError(status: number, body: unknown): CloudAccountError {
  const record = body as { error?: unknown; message?: unknown; code?: unknown } | null;
  const code =
    (typeof record?.code === "string" && record.code) ||
    (typeof record?.error === "string" && record.error) ||
    undefined;
  const message =
    (typeof record?.message === "string" && record.message) ||
    (typeof record?.error === "string" && record.error) ||
    `Request failed (${status}).`;
  return new CloudAccountError(message, status, code);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }

  if (!res.ok) {
    throw toError(res.status, body);
  }
  return body as T;
}

export function isCloudAccountError(value: unknown): value is CloudAccountError {
  return value instanceof CloudAccountError;
}

export function isActiveRunsError(value: unknown): boolean {
  return isCloudAccountError(value) && value.code === "active_runs_exist";
}

export function errorMessage(value: unknown): string {
  if (isCloudAccountError(value)) {
    return value.message;
  }
  if (value instanceof Error) {
    return value.message;
  }
  return "Something went wrong.";
}

export async function listCloudAccounts(): Promise<CloudAccount[]> {
  const body = await requestJson<{ accounts: CloudAccount[] }>("");
  return body.accounts ?? [];
}

export async function getCloudAccount(accountId: string): Promise<CloudAccountDetail> {
  return requestJson<CloudAccountDetail>(`/${encodeURIComponent(accountId)}`);
}

export async function listCapabilities(): Promise<CloudCapabilities> {
  return requestJson<CloudCapabilities>("/capabilities");
}

export async function createCloudAccount(
  input: CreateCloudAccountInput,
): Promise<CloudAccount> {
  return requestJson<CloudAccount>("", {
    method: "POST",
    headers: { "Idempotency-Key": newIdempotencyKey() },
    body: JSON.stringify({
      provider: input.provider,
      label: input.label,
      ...(input.externalAccountId ? { external_account_id: input.externalAccountId } : {}),
      metadata: input.metadata ?? {},
    }),
  });
}

export async function verifyCloudAccount(
  accountId: string,
  externalId: string,
): Promise<CloudAccountDetail> {
  return requestJson<CloudAccountDetail>(
    `/${encodeURIComponent(accountId)}/verify`,
    {
      method: "POST",
      headers: { "Idempotency-Key": newIdempotencyKey() },
      body: JSON.stringify({ external_id: externalId }),
    },
  );
}

export async function deleteCloudAccount(accountId: string): Promise<void> {
  await requestJson<void>(`/${encodeURIComponent(accountId)}`, {
    method: "DELETE",
    headers: { "Idempotency-Key": newIdempotencyKey() },
  });
}
