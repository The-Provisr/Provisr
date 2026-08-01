import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, Reflector } from "@nestjs/core";
import { AppController } from "./routes/app.controller";
import { GlobalExceptionFilter } from "./common/filters/global-exception.filter";
import { AuthGuard } from "./middleware/auth.guard";
import { CorrelationIdMiddleware } from "./middleware/correlation-id.middleware";
import { WorkspacesController } from "./routes/workspaces.controller";
import { SessionsController } from "./routes/sessions.controller";
import { ProvisioningRunsController } from "./routes/provisioning-runs.controller";
import { ApprovalsController } from "./routes/approvals.controller";
import { ArtifactsController } from "./routes/artifacts.controller";
import { SseController } from "./routes/sse.controller";

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
      // useFactory + inject instead of useClass so the guard works under
      // esbuild (vitest) as well as tsc (nest build): esbuild emits no
      // design:paramtypes metadata for constructor injection.
      provide: APP_GUARD,
      useFactory: (reflector: Reflector) => new AuthGuard(reflector),
      inject: [Reflector],
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
