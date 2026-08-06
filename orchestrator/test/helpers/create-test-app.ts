import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll } from "vitest";
import { buildApp } from "../../src/app.builder";

export async function createTestApp(): Promise<INestApplication> {
  const app = await buildApp();
  await app.init();
  return app;
}

export function http(app: INestApplication): ReturnType<typeof request> {
  return request(app.getHttpServer());
}

export function useDevAuth(userId = "test-user"): void {
  let previousUserId: string | undefined;
  let previousBypass: string | undefined;
  beforeAll(() => {
    previousUserId = process.env.DEV_USER_ID;
    previousBypass = process.env.AUTH_DEV_BYPASS;
    process.env.DEV_USER_ID = userId;
    process.env.AUTH_DEV_BYPASS = "true";
  });
  afterAll(() => {
    if (previousUserId === undefined) {
      delete process.env.DEV_USER_ID;
    } else {
      process.env.DEV_USER_ID = previousUserId;
    }
    if (previousBypass === undefined) {
      delete process.env.AUTH_DEV_BYPASS;
    } else {
      process.env.AUTH_DEV_BYPASS = previousBypass;
    }
  });
}
