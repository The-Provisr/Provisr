import { DependencyError, UpstreamError } from "../common/errors/typed-errors";
import type { GatewayRequestContext } from "../routes/gateway-request";
import { UpstreamClient, type UpstreamResult } from "./upstream-client";

export interface CreateCloudAccountInput {
  provider: "aws" | "azure" | "gcp";
  label: string;
  external_account_id?: string;
  metadata: Record<string, unknown>;
}

interface HeaderOptions {
  withServiceToken?: boolean;
  withIdempotency?: boolean;
}

/**
 * Adapter for cloud-account-service (BE-B01/B05/B08). The workspace scope is
 * always injected here from the route, never taken from the client payload.
 */
export class CloudAccountsClient {
  constructor(
    private readonly client: UpstreamClient,
    private readonly serviceToken: string,
  ) {}

  list(workspaceId: string, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request("/v1/cloud-accounts", {
      method: "GET",
      query: { workspace_id: workspaceId },
      headers: this.headers(ctx),
    });
  }

  get(workspaceId: string, accountId: string, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request(`/v1/cloud-accounts/${encodeURIComponent(accountId)}`, {
      method: "GET",
      query: { workspace_id: workspaceId },
      headers: this.headers(ctx),
    });
  }

  create(
    workspaceId: string,
    input: CreateCloudAccountInput,
    ctx: GatewayRequestContext,
  ): Promise<UpstreamResult> {
    return this.client.request("/v1/cloud-accounts", {
      method: "POST",
      body: { ...input, workspace_id: workspaceId },
      headers: this.headers(ctx, { withIdempotency: true }),
    });
  }

  remove(workspaceId: string, accountId: string, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    return this.client.request(`/v1/cloud-accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
      query: { workspace_id: workspaceId },
      headers: this.headers(ctx, { withIdempotency: true }),
    });
  }

  verify(
    workspaceId: string,
    accountId: string,
    externalId: string,
    ctx: GatewayRequestContext,
  ): Promise<UpstreamResult> {
    return this.client.request(`/v1/cloud-accounts/${encodeURIComponent(accountId)}/verify`, {
      method: "POST",
      query: { workspace_id: workspaceId },
      body: { external_id: externalId },
      headers: this.headers(ctx, { withIdempotency: true }),
    });
  }

  async capabilities(workspaceId: string, ctx: GatewayRequestContext): Promise<UpstreamResult> {
    try {
      return await this.client.request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/cloud-capabilities`, {
        method: "GET",
        headers: this.headers(ctx, { withServiceToken: true }),
      });
    } catch (error) {
      // A rejected service token is a gateway misconfiguration, not the
      // caller's authentication failure. Surface it as a dependency error so
      // the frontend does not treat it as a signed-out session.
      if (error instanceof UpstreamError && (error.status === 401 || error.status === 403)) {
        throw new DependencyError("Cloud capability service rejected the gateway credentials.");
      }
      throw error;
    }
  }

  private headers(ctx: GatewayRequestContext, options: HeaderOptions = {}): Record<string, string | undefined> {
    const headers: Record<string, string | undefined> = {
      "X-Request-ID": ctx.requestId,
      "X-Correlation-ID": ctx.correlationId,
    };
    if (options.withServiceToken) {
      headers["Authorization"] = `Bearer ${this.serviceToken}`;
    }
    if (options.withIdempotency && ctx.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = ctx.idempotencyKey;
    }
    return headers;
  }
}
