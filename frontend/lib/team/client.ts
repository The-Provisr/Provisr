import type { WorkspaceRole } from "@/components/layout/permissions";
import { TeamError, type Invitation, type Member } from "./types";

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toError(status: number, body: unknown): TeamError {
  const record = body as { error?: unknown; message?: unknown; code?: unknown } | null;
  const code =
    (typeof record?.code === "string" && record.code) ||
    (typeof record?.error === "string" && record.error) ||
    undefined;
  const message =
    (typeof record?.message === "string" && record.message) ||
    (typeof record?.error === "string" && record.error) ||
    `Request failed (${status}).`;
  return new TeamError(message, status, code);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
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

function mutation(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Idempotency-Key": newIdempotencyKey() },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

export function isTeamError(value: unknown): value is TeamError {
  return value instanceof TeamError;
}

export function hasErrorCode(value: unknown, code: string): boolean {
  return isTeamError(value) && value.code === code;
}

/** True when the gateway denied the call (non-admins cannot list members or invitations). */
export function isForbidden(value: unknown): boolean {
  return isTeamError(value) && value.status === 403 && value.code !== "email_mismatch";
}

const FRIENDLY_MESSAGES: Record<string, string> = {
  last_admin:
    "A workspace must keep at least one admin. Promote another member to admin before changing or removing this one.",
  active_runs_exist:
    "This member has active provisioning runs. Wait for them to finish or cancel them before removing the member.",
  email_mismatch:
    "This invitation was sent to a different email address than the one you are signed in with.",
  expired: "This invitation has expired. Ask a workspace admin to send a new one.",
  revoked: "This invitation is no longer valid. It was revoked or has already been used.",
  not_found: "We couldn't find that invitation. Check the link or code and try again.",
  already_member: "You are already a member of this workspace.",
};

export function errorMessage(value: unknown): string {
  if (isTeamError(value)) {
    return (value.code && FRIENDLY_MESSAGES[value.code]) || value.message;
  }
  if (value instanceof Error) {
    return value.message;
  }
  return "Something went wrong.";
}

export async function listMembers(): Promise<Member[]> {
  return (await requestJson<Member[] | null>("/api/team/members")) ?? [];
}

export async function changeMemberRole(userId: string, role: WorkspaceRole): Promise<void> {
  await requestJson<void>(
    `/api/team/members/${encodeURIComponent(userId)}`,
    mutation("PATCH", { role }),
  );
}

export async function removeMember(userId: string): Promise<void> {
  await requestJson<void>(`/api/team/members/${encodeURIComponent(userId)}`, mutation("DELETE"));
}

export async function listInvitations(): Promise<Invitation[]> {
  return (await requestJson<Invitation[] | null>("/api/team/invitations")) ?? [];
}

export async function createInvitation(email: string, role: WorkspaceRole): Promise<Invitation> {
  return requestJson<Invitation>("/api/team/invitations", mutation("POST", { email, role }));
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  await requestJson<void>(
    `/api/team/invitations/${encodeURIComponent(invitationId)}/revoke`,
    mutation("POST"),
  );
}

export async function lookupInvitation(code: string): Promise<Invitation> {
  return requestJson<Invitation>(`/api/invitations?code=${encodeURIComponent(code)}`);
}

export async function acceptInvitation(code: string, name: string): Promise<Member> {
  return requestJson<Member>(
    `/api/invitations/accept?code=${encodeURIComponent(code)}`,
    mutation("POST", { name }),
  );
}

export function invitationLink(origin: string, code: string): string {
  return `${origin}/invitations/accept?code=${encodeURIComponent(code)}`;
}
