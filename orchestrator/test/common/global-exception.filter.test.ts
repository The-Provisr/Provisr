import "reflect-metadata";
import { Controller, Get, INestApplication, MiddlewareConsumer, Module, NestModule, NotFoundException } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFoundError } from "../../src/common/errors/typed-errors";
import { GlobalExceptionFilter } from "../../src/common/filters/global-exception.filter";
import { CorrelationIdMiddleware, REQUEST_ID_HEADER } from "../../src/middleware/correlation-id.middleware";

@Controller("filter-test")
class FilterTestController {
  @Get("prov-error")
  provError(): never {
    throw new NotFoundError("The thing does not exist");
  }

  @Get("nest-error")
  nestError(): never {
    throw new NotFoundException("resource missing");
  }

  @Get("panic")
  panic(): never {
    throw new Error("secret internal detail");
  }
}

@Module({
  controllers: [FilterTestController],
  providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class FilterTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}

describe("GlobalExceptionFilter", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [FilterTestModule] }).compile()
    ).createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("renders ProvError with the typed error contract", async () => {
    const res = await request(app.getHttpServer())
      .get("/filter-test/prov-error")
      .expect(404);

    expect(res.body).toMatchObject({
      error: "ProvError",
      message: "The thing does not exist",
      status: 404,
      code: "NOT_FOUND",
    });
    expect(res.body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.request_id).toBe(res.headers[REQUEST_ID_HEADER]);
  });

  it("renders HttpException with a generic error name", async () => {
    const res = await request(app.getHttpServer())
      .get("/filter-test/nest-error")
      .expect(404);

    expect(res.body).toMatchObject({
      error: "NOT_FOUND",
      message: "resource missing",
      status: 404,
    });
    expect(res.body.code).toBeUndefined();
  });

  it("never leaks internal error details", async () => {
    const res = await request(app.getHttpServer())
      .get("/filter-test/panic")
      .expect(500);

    expect(res.body).toMatchObject({
      error: "InternalServerError",
      message: "Internal server error",
      status: 500,
      code: "INTERNAL_ERROR",
    });
    expect(JSON.stringify(res.body)).not.toContain("secret internal detail");
  });
});
