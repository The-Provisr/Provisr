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
import { WorkspacesController } from "./routes/workspaces.controller";
import { SessionsController } from "./routes/sessions.controller";
import { ProvisioningRunsController } from "./routes/provisioning-runs.controller";
import { ApprovalsController } from "./routes/approvals.controller";
import { ArtifactsController } from "./routes/artifacts.controller";
import { SseController } from "./routes/sse.controller";
import { RunsService, createRunsService } from "./state-machine/runs.service";

@Module({
  imports: [],
  controllers: [
    AppController,
    WorkspacesController,
    SessionsController,
    ProvisioningRunsController,
    ApprovalsController,
    ArtifactsController,
    SseController,
  ],
  providers: [
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
      provide: RunsService,
      useFactory: (db: DbService) => createRunsService(db),
      inject: [DbService],
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
      useFactory: (clerk: ClerkAuthService) => new IdentityService(clerk),
      inject: [ClerkAuthService],
    },
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
