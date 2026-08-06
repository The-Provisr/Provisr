import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, http } from "../helpers/create-test-app";

const UUID = "a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a";

describe("Workspaces routes", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    delete process.env.DEV_USER_ID;
    delete process.env.AUTH_DEV_BYPASS;
    await app.close();
  });

  beforeEach(() => {
    process.env.DEV_USER_ID = "test-user";
    process.env.AUTH_DEV_BYPASS = "true";
  });

  describe("without credentials", () => {
    beforeEach(() => {
      delete process.env.DEV_USER_ID;
    });

    it("rejects with 401 and the error contract", async () => {
      const res = await http(app).get("/v1/workspaces").expect(401);

      expect(res.body).toMatchObject({
        error: "UnauthorizedError",
        // Deliberately generic: invalid/expired tokens never reveal why.
        message: "Authentication required",
        status: 401,
        code: "UNAUTHORIZED",
      });
      expect(res.body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it("returns 501 for listing until OR-004", async () => {
    const res = await http(app).get("/v1/workspaces").expect(501);

    expect(res.body).toMatchObject({
      error: "NotImplementedError",
      status: 501,
      code: "NOT_IMPLEMENTED",
    });
    expect(res.body.message).toBe("Workspace listing is not implemented yet");
  });

  it("accepts a valid create body and returns 501", async () => {
    const res = await http(app)
      .post("/v1/workspaces")
      .send({ name: "production", environment: "production" })
      .expect(501);

    expect(res.body.message).toBe("Workspace creation is not implemented yet");
  });

  it("returns 400 with field details for a too-short name", async () => {
    const res = await http(app)
      .post("/v1/workspaces")
      .send({ name: "ab" })
      .expect(400);

    expect(res.body).toMatchObject({
      error: "ValidationError",
      status: 400,
      code: "VALIDATION_FAILED",
    });
    expect(res.body.details).toEqual([
      { field: "name", message: "String must contain at least 3 character(s)" },
    ]);
  });

  it("rejects unknown environment values", async () => {
    const res = await http(app)
      .post("/v1/workspaces")
      .send({ name: "valid", environment: "prod" })
      .expect(400);

    expect(res.body.details[0].field).toBe("environment");
    expect(res.body.details[0].message).toContain("Invalid enum value");
  });

  it("rejects invalid workspace ids in the path", async () => {
    const res = await http(app).get("/v1/workspaces/not-a-uuid").expect(400);

    expect(res.body.error).toBe("BAD_REQUEST");
    expect(res.body.message).toBe("Validation failed (uuid is expected)");
  });

  it("returns 501 for get/patch/delete on an existing id", async () => {
    const getRes = await http(app).get(`/v1/workspaces/${UUID}`).expect(501);
    expect(getRes.body.code).toBe("NOT_IMPLEMENTED");

    const patchRes = await http(app)
      .patch(`/v1/workspaces/${UUID}`)
      .send({ description: "updated description" })
      .expect(501);
    expect(patchRes.body.code).toBe("NOT_IMPLEMENTED");

    const delRes = await http(app).delete(`/v1/workspaces/${UUID}`).expect(501);
    expect(delRes.body.code).toBe("NOT_IMPLEMENTED");
  });
});
