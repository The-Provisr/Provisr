import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
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
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
