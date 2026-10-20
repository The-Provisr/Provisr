import type { GatewayRequestContext } from "../routes/gateway-request";
import { UpstreamClient, type UpstreamResult } from "./upstream-client";

export type WorkspaceRole = "admin" | "engineer" | "approver" | "auditor" | "viewer";

export interface AddMemberInput {
  user_id: string;
  role: WorkspaceRole;
}

export interface UpdateMemberRoleInput {
  role: WorkspaceRole;
}

export interface CreateInvitationInput {
  email: string;
  role: WorkspaceRole;
}

export interface AcceptInvitationInput {
  user_id: string;
  name: string;
  email: string;
}

export interface PermissionCheckInput {
  user_id: string;
  workspace_id: string;
  resource_type: string;
  action: string;
  resource_id?: string | undefined;
}

/**
 * Adapter for workspace-service (BE-A03). The service performs no
 * authentication of its own, so every caller-supplied identity field is
 * injected by the gateway (never forwarded from the browser).
 */
export class WorkspaceServiceClient {
  constructor(private readonly client: UpstreamClient) {}

  listMembers(
    workspaceId: string,
    role: WorkspaceRole | undefined,
    ctx: GatewayRequestContext,
  ): Promise<UpstreamResult> {
    return this.client.request(`/workspaces/${encodeURIComponent(workspaceId)}/members`, {
      method: "GET",
      query: { role },
      headers: this.headers(ctx),
    });
  }

  addMember(workspaceId: string, input: AddMemberInput, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request(`/workspaces/${encodeURIComponent(workspaceId)}/members`, {
      method: "POST",
      body: input,
      headers: this.headers(ctx, true),
    });
  }

  updateMemberRole(
    workspaceId: string,
    userId: string,
    input: UpdateMemberRoleInput,
    ctx: GatewayRequestContext,
  ): Promise<UpstreamResult> {
    return this.client.request(
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: input, headers: this.headers(ctx, true) },
    );
  }

  removeMember(workspaceId: string, userId: string, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request(
      `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: this.headers(ctx, true) },
    );
  }

  listInvitations(workspaceId: string, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request(`/workspaces/${encodeURIComponent(workspaceId)}/invitations`, {
      method: "GET",
      headers: this.headers(ctx),
    });
  }

  createInvitation(
    workspaceId: string,
    input: CreateInvitationInput,
    ctx: GatewayRequestContext,
  ): Promise<UpstreamResult> {
    return this.client.request(`/workspaces/${encodeURIComponent(workspaceId)}/invitations`, {
      method: "POST",
      body: input,
      headers: this.headers(ctx, true),
    });
  }

  getInvitation(workspaceId: string, invitationId: string, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request(
      `/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}`,
      { method: "GET", headers: this.headers(ctx) },
    );
  }

  revokeInvitation(workspaceId: string, invitationId: string, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request(
      `/workspaces/${encodeURIComponent(workspaceId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
      { method: "POST", headers: this.headers(ctx, true) },
    );
  }

  getInvitationByCode(code: string, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request("/invitations", {
      method: "GET",
      query: { code },
      headers: this.headers(ctx),
    });
  }

  acceptInvitation(
    code: string,
    input: AcceptInvitationInput,
    ctx: GatewayRequestContext,
  ): Promise<UpstreamResult> {
    return this.client.request("/invitations/accept", {
      method: "POST",
      query: { code },
      body: input,
      headers: this.headers(ctx, true),
    });
  }

  checkPermission(input: PermissionCheckInput, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request("/permissions/check", {
      method: "POST",
      body: input,
      headers: this.headers(ctx),
    });
  }

  checkBatch(checks: PermissionCheckInput[], ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request("/permissions/check-batch", {
      method: "POST",
      body: { checks },
      headers: this.headers(ctx),
    });
  }

  private headers(ctx: GatewayRequestContext, withIdempotency = false): Record<string, string | undefined> {
    const headers: Record<string, string | undefined> = {
      "X-Request-ID": ctx.requestId,
      "X-Correlation-ID": ctx.correlationId,
    };
    if (withIdempotency && ctx.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = ctx.idempotencyKey;
    }
    return headers;
  }
}
