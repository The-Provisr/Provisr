import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { AuthenticatedRequest, RequestUser } from "./auth.types";

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    return ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  },
);
