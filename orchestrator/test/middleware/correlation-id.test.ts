import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, http } from "../helpers/create-test-app";
import {
  CORRELATION_ID_HEADER,
  REQUEST_ID_HEADER,
} from "../../src/middleware/correlation-id.middleware";

describe("CorrelationIdMiddleware", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("generates and returns both headers when none are provided", async () => {
    const res = await http(app).get("/health/live").expect(200);

    expect(res.headers[CORRELATION_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reuses a caller-provided correlation id and echoes it back", async () => {
    const res = await http(app)
      .get("/health/live")
      .set(CORRELATION_ID_HEADER, "trace-abc-123")
      .expect(200);

    expect(res.headers[CORRELATION_ID_HEADER]).toBe("trace-abc-123");
    expect(res.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("uses the same request id in error responses", async () => {
    const res = await http(app).get("/v1/workspaces").expect(401);

    expect(res.body.request_id).toBe(res.headers[REQUEST_ID_HEADER]);
    expect(res.body.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
