import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, http, useDevAuth } from "../helpers/create-test-app";

const UUID = "a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a";

describe("Sessions routes", () => {
  let app: INestApplication;

  useDevAuth();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("requires workspaceId when listing sessions", async () => {
    const res = await http(app).get("/v1/sessions").expect(400);

    expect(res.body).toMatchObject({
      error: "ValidationError",
      status: 400,
      code: "VALIDATION_FAILED",
    });
    expect(res.body.message).toBe("Request validation failed");
    expect(res.body.details).toEqual([
      { field: "workspaceId", message: "Required" },
    ]);
  });

  it("rejects a non-UUID workspaceId filter", async () => {
    const res = await http(app).get("/v1/sessions?workspaceId=abc").expect(400);
    expect(res.body.details).toEqual([
      { field: "workspaceId", message: "Invalid uuid" },
    ]);
  });

  it("returns 501 for listing with a valid workspaceId", async () => {
    const res = await http(app)
      .get(`/v1/sessions?workspaceId=${UUID}`)
      .expect(501);
    expect(res.body.message).toBe("Session listing is not implemented yet");
  });

  it("accepts a valid create body and returns 501", async () => {
    const res = await http(app)
      .post("/v1/sessions")
      .send({ workspaceId: UUID })
      .expect(501);
    expect(res.body.message).toBe("Session creation is not implemented yet");
  });

  it("returns 400 with field details for an invalid workspaceId in the body", async () => {
    const res = await http(app)
      .post("/v1/sessions")
      .send({ workspaceId: "nope" })
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "workspaceId", message: "Invalid uuid" },
    ]);
  });

  it("rejects an empty title", async () => {
    const res = await http(app)
      .post("/v1/sessions")
      .send({ workspaceId: UUID, title: "" })
      .expect(400);

    expect(res.body.details[0].field).toBe("title");
    expect(res.body.details[0].message).toContain("at least 1 character");
  });

  it("returns 501 for get and delete on an existing id", async () => {
    const getRes = await http(app).get(`/v1/sessions/${UUID}`).expect(501);
    expect(getRes.body.message).toBe("Session retrieval is not implemented yet");

    const delRes = await http(app).delete(`/v1/sessions/${UUID}`).expect(501);
    expect(delRes.body.message).toBe("Session deletion is not implemented yet");
  });

  it("rejects invalid session ids in the path", async () => {
    const res = await http(app).delete("/v1/sessions/not-a-uuid").expect(400);
    expect(res.body.error).toBe("BAD_REQUEST");
    expect(res.body.message).toBe("Validation failed (uuid is expected)");
  });
});
