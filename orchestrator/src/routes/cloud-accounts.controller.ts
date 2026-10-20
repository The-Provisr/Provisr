import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  DependencyError,
  NotFoundError,
  NotImplementedError,
  ValidationError,
} from "../common/errors/typed-errors";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../middleware/current-user.decorator";
import type { RequestUser } from "../middleware/auth.types";
import { CloudAccountsClient, type CreateCloudAccountInput } from "../services/cloud-accounts.client";
import { WorkspaceAccessService } from "../services/workspace-access.service";
import { gatewayContext, sendUpstream } from "./gateway-request";

export const cloudAccountProviderSchema = z.enum(["aws", "azure", "gcp"]);

export const createCloudAccountSchema = z
  .object({
    provider: cloudAccountProviderSchema,
    label: z.string().trim().min(1).max(255),
    external_account_id: z.string().trim().min(1).max(255).optional(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const verifyCloudAccountSchema = z
  .object({ external_id: z.string().trim().min(1).max(1024) })
  .strict();

export type CreateCloudAccountDto = z.infer<typeof createCloudAccountSchema>;
export type VerifyCloudAccountDto = z.infer<typeof verifyCloudAccountSchema>;

const PROVIDERS = ["aws", "azure", "gcp"] as const;
type Provider = (typeof PROVIDERS)[number];

function asProvider(segment: string): Provider | undefined {
  return (PROVIDERS as readonly string[]).includes(segment) ? (segment as Provider) : undefined;
}

const accountListSchema = z.object({
  accounts: z.array(z.object({ id: z.string().min(1), provider: z.string() })),
});

const UUID_SCHEMA = z.string().uuid();

@Controller("workspaces/:workspaceId/cloud-accounts")
export class CloudAccountsController {
  constructor(
    private readonly cloud: CloudAccountsClient,
    private readonly access: WorkspaceAccessService,
  ) {}

  @Get()
  async list(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user);
    await this.access.assertAllowed(user.userId, workspaceId, "cloud_account", "view", ctx);
    sendUpstream(res, await this.cloud.list(workspaceId, ctx));
  }

  @Get(":accountId")
  async get(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user);
    await this.access.assertAllowed(user.userId, workspaceId, "cloud_account", "view", ctx);
    sendUpstream(res, await this.cloud.get(workspaceId, accountId, ctx));
  }

  @Post()
  async create(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Body(new ZodValidationPipe(createCloudAccountSchema)) dto: CreateCloudAccountDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user, idempotencyKey);
    await this.access.assertAllowed(user.userId, workspaceId, "cloud_account", "create", ctx);
    const input: CreateCloudAccountInput = {
      provider: dto.provider,
      label: dto.label,
      metadata: dto.metadata,
      ...(dto.external_account_id !== undefined ? { external_account_id: dto.external_account_id } : {}),
    };
    sendUpstream(res, await this.cloud.create(workspaceId, input, ctx));
  }

  @Delete(":accountId")
  async remove(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user, idempotencyKey);
    await this.access.assertAllowed(user.userId, workspaceId, "cloud_account", "delete", ctx);
    sendUpstream(res, await this.cloud.remove(workspaceId, accountId, ctx));
  }

  /**
   * Verify a connection. Two shapes share this handler:
   *  - `:idOrProvider` is a UUID → verify that account (AWS today);
   *  - `:idOrProvider` is a provider name → resolve the workspace's account for
   *    that provider and verify it. Azure/GCP verification is not implemented
   *    in the backend yet, so those return 501.
   */
  @Post(":idOrProvider/verify")
  async verify(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("idOrProvider") idOrProvider: string,
    @Body(new ZodValidationPipe(verifyCloudAccountSchema)) dto: VerifyCloudAccountDto,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user, idempotencyKey);
    await this.access.assertAllowed(user.userId, workspaceId, "cloud_account", "update", ctx);

    const provider = asProvider(idOrProvider);
    let accountId: string;
    if (provider !== undefined) {
      accountId = await this.resolveProviderAccount(workspaceId, provider, ctx);
    } else {
      const parsed = UUID_SCHEMA.safeParse(idOrProvider);
      if (!parsed.success) {
        throw new ValidationError("account id must be a valid UUID");
      }
      accountId = parsed.data;
    }

    sendUpstream(res, await this.cloud.verify(workspaceId, accountId, dto.external_id, ctx));
  }

  @Get(":accountId/template")
  async template(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user);
    await this.access.assertAllowed(user.userId, workspaceId, "cloud_account", "view", ctx);
    // TODO(OR-M02 follow-up): cloud-account-service has no template endpoint
    // yet. The contract is fixed here so FE-M05 can render a pending state;
    // the generator becomes a backend task.
    void accountId;
    throw new NotImplementedError("CloudFormation template generation");
  }

  private async resolveProviderAccount(
    workspaceId: string,
    provider: Provider,
    ctx: ReturnType<typeof gatewayContext>,
  ): Promise<string> {
    if (provider !== "aws") {
      throw new NotImplementedError(`${provider} account verification`);
    }
    const { body } = await this.cloud.list(workspaceId, ctx);
    const parsed = accountListSchema.safeParse(body);
    if (!parsed.success) {
      throw new DependencyError("Cloud account service returned an unreadable response.");
    }
    const account = parsed.data.accounts.find((candidate) => candidate.provider === "aws");
    if (account === undefined) {
      throw new NotFoundError("No AWS account is connected to this workspace");
    }
    return account.id;
  }
}

@Controller("workspaces/:workspaceId")
export class CloudCapabilitiesController {
  constructor(
    private readonly cloud: CloudAccountsClient,
    private readonly access: WorkspaceAccessService,
  ) {}

  @Get("cloud-capabilities")
  async get(
    @Param("workspaceId", new ParseUUIDPipe()) workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const ctx = gatewayContext(req, res, user);
    await this.access.assertAllowed(user.userId, workspaceId, "cloud_account", "view", ctx);
    sendUpstream(res, await this.cloud.capabilities(workspaceId, ctx));
  }
}
