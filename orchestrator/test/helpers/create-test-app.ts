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
  beforeAll(() => {
    process.env.DEV_USER_ID = userId;
  });
  afterAll(() => {
    delete process.env.DEV_USER_ID;
  });
}
