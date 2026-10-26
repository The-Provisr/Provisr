import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core";
import { AppController } from "./routes/app.controller";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { AuthGuard } from "./middleware/auth.guard";
import { CorrelationIdMiddleware } from "./middleware/correlation-id.middleware";
import { AuthConfig, AUTH_CONFIG, loadAuthConfig } from "./auth/auth.config";
import { ClerkAuthService } from "./auth/clerk-auth.service";
import { IdentityService } from "./auth/identity.service";
import {
  DbConfig,
  DB_CONFIG,
  DbService,
  createDbService,
  loadDbConfig,
} from "./db/db.service";
import {
  AuditService,
  createAuditService,
} from "./services/audit.service";
import {
  ChatEventsService,
  createChatEventsService,
} from "./services/chat-events.service";
import {
  ChatPersistenceService,
  createChatPersistenceService,
} from "./services/chat-persistence.service";
import { UsersController } from "./routes/users.controller";
import { WorkspaceBootstrapService } from "./services/workspace-bootstrap.service";
import { WorkspacesController } from "./routes/workspaces.controller";
import { SessionsController } from "./routes/sessions.controller";
import { ProvisioningRunsController } from "./routes/provisioning-runs.controller";
import { ApprovalsController } from "./routes/approvals.controller";
import { ArtifactsController } from "./routes/artifacts.controller";
import { SseController } from "./routes/sse.controller";
import { RunsService, createRunsService } from "./state-machine/runs.service";
import { PlanningClients, loadPlanningConfig } from "./services/planning-clients";
import { CloudAccountsController, CloudCapabilitiesController } from "./routes/cloud-accounts.controller";
import { MembersController } from "./routes/members.controller";
import { InvitationsController } from "./routes/invitations.controller";
import { PermissionsController } from "./routes/permissions.controller";
import { GATEWAY_CONFIG, GatewayConfig, loadGatewayConfig } from "./services/gateway-config";
import { UpstreamClient } from "./services/upstream-client";
import { CloudAccountsClient } from "./services/cloud-accounts.client";
import { WorkspaceServiceClient } from "./services/workspace-service.client";
import { WorkspaceAccessService } from "./services/workspace-access.service";

@Module({
  imports: [],
  controllers: [
    AppController,
    WorkspacesController,
    UsersController,
    SessionsController,
    ProvisioningRunsController,
    ApprovalsController,
    ArtifactsController,
    SseController,
    CloudAccountsController,
    CloudCapabilitiesController,
    MembersController,
    InvitationsController,
    PermissionsController,
  ],
  providers: [
    { provide: WorkspaceBootstrapService,
      useFactory: (db: DbService, audit: AuditService) => new WorkspaceBootstrapService(db, audit,
        (process.env.WORKSPACE_SERVICE_URL ?? "http://localhost:8088").replace(/\/+$/, "")),
      inject: [DbService, AuditService] },
    {
      provide: DB_CONFIG,
      useFactory: () => loadDbConfig(),
    },
    {
      provide: DbService,
      useFactory: (config: DbConfig) => createDbService(config),
      inject: [DB_CONFIG],
    },
    {
      // Config read once at wiring time and passed in (never read from
      // process.env inside services). Fails fast in production without
      // CLERK_SECRET_KEY.
      provide: AUTH_CONFIG,
      useFactory: () => loadAuthConfig(),
    },
    {
      provide: ClerkAuthService,
      useFactory: (config: AuthConfig) => new ClerkAuthService(config),
      inject: [AUTH_CONFIG],
    },
    {
      provide: IdentityService,
      useFactory: (db: DbService, clerk: ClerkAuthService) => new IdentityService(db, clerk),
      inject: [DbService, ClerkAuthService],
    },
    {
      provide: ChatEventsService,
      useFactory: (db: DbService) => createChatEventsService(db),
      inject: [DbService],
    },
    {
      provide: ChatPersistenceService,
      useFactory: (db: DbService, events: ChatEventsService) =>
        createChatPersistenceService(db, events),
      inject: [DbService, ChatEventsService],
    },
    {
      provide: AuditService,
      useFactory: (db: DbService) => createAuditService(db),
      inject: [DbService],
    },
    {
      provide: RunsService,
      useFactory: (db: DbService, audit: AuditService) => createRunsService(db, audit,
        process.env.NODE_ENV === "test" ? undefined : new PlanningClients(loadPlanningConfig(process.env))),
      inject: [DbService, AuditService],
    },
    {
      provide: GATEWAY_CONFIG,
      useFactory: () => loadGatewayConfig(),
    },
    {
      // Adapter to workspace-service (BE-A03); no auth header: the service
      // performs no authentication itself and the gateway is the boundary.
      provide: WorkspaceServiceClient,
      useFactory: (config: GatewayConfig) =>
        new WorkspaceServiceClient(new UpstreamClient(config.workspaceServiceUrl, fetch, config.timeoutMs)),
      inject: [GATEWAY_CONFIG],
    },
    {
      provide: CloudAccountsClient,
      useFactory: (config: GatewayConfig) =>
        new CloudAccountsClient(
          new UpstreamClient(config.cloudAccountServiceUrl, fetch, config.timeoutMs),
          config.serviceToken,
        ),
      inject: [GATEWAY_CONFIG],
    },
    {
      provide: WorkspaceAccessService,
      useFactory: (workspace: WorkspaceServiceClient) => new WorkspaceAccessService(workspace),
      inject: [WorkspaceServiceClient],
    },
    {
      // useFactory + inject instead of useClass so the guard works under
      // esbuild (vitest) as well as tsc (nest build): esbuild emits no
      // design:paramtypes metadata for constructor injection.
      provide: APP_GUARD,
      useFactory: (reflector: Reflector, clerk: ClerkAuthService, identity: IdentityService) =>
        new AuthGuard(reflector, clerk, identity),
      inject: [Reflector, ClerkAuthService, IdentityService],
    },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // "{*splat}" is the path-to-regexp v8 named wildcard for "all routes"
    // (a bare "*" is deprecated and triggers a LegacyRouteConverter warning).
    consumer.apply(CorrelationIdMiddleware).forRoutes("{*splat}");
  }
}
