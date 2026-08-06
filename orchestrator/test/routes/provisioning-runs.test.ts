import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, http, useDevAuth } from "../helpers/create-test-app";

const UUID = "a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a";

describe("Provisioning runs routes", () => {
  let app: INestApplication;

  useDevAuth();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts a valid create body and returns 501", async () => {
    const res = await http(app)
      .post("/v1/runs")
      .send({ sessionId: UUID, prompt: "provision a postgres database" })
      .expect(501);

    expect(res.body).toMatchObject({
      error: "NotImplementedError",
      status: 501,
      code: "NOT_IMPLEMENTED",
    });
    expect(res.body.message).toBe("Run creation is not implemented yet");
  });

  it("returns 400 with field details for an empty prompt", async () => {
    const res = await http(app)
      .post("/v1/runs")
      .send({ sessionId: UUID, prompt: "" })
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "prompt", message: "String must contain at least 1 character(s)" },
    ]);
  });

  it("returns 400 for an invalid sessionId in the body", async () => {
    const res = await http(app)
      .post("/v1/runs")
      .send({ sessionId: "nope", prompt: "hi" })
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "sessionId", message: "Invalid uuid" },
    ]);
  });

  it("lists runs without filters", async () => {
    const res = await http(app).get("/v1/runs").expect(501);
    expect(res.body.message).toBe("Run listing is not implemented yet");
  });

  it("rejects an invalid sessionId filter", async () => {
    const res = await http(app).get("/v1/runs?sessionId=abc").expect(400);

    expect(res.body).toMatchObject({
      error: "ValidationError",
      status: 400,
      code: "VALIDATION_FAILED",
    });
    expect(res.body.details).toEqual([
      { field: "sessionId", message: "Invalid uuid" },
    ]);
  });

  it("rejects an invalid status filter", async () => {
    const res = await http(app).get("/v1/runs?status=INVALID").expect(400);

    expect(res.body.details).toEqual([
      {
        field: "status",
        message:
          "Invalid enum value. Expected 'received' | 'pending_agent' | 'pending_clarification' | 'policy_check' | 'pending_confirmation' | 'pending_approval' | 'provisioning' | 'live' | 'failed' | 'cancelled', received 'INVALID'",
      },
    ]);
  });

  it("accepts a valid status filter", async () => {
    const res = await http(app).get("/v1/runs?status=pending_approval").expect(501);
    expect(res.body.message).toBe("Run listing is not implemented yet");
  });

  it("returns 501 for get on an existing id", async () => {
    const res = await http(app).get(`/v1/runs/${UUID}`).expect(501);
    expect(res.body.message).toBe("Run retrieval is not implemented yet");
  });

  it("returns 501 for cancel with an existing id", async () => {
    const res = await http(app).post(`/v1/runs/${UUID}/cancel`).expect(501);
    expect(res.body.message).toBe("Run cancellation is not implemented yet");
  });

  it("accepts a confirm body and returns 501", async () => {
    const res = await http(app)
      .post(`/v1/runs/${UUID}/confirm`)
      .send({ manifestVersion: "manifest/v1.0", planVersion: "plan/v3" })
      .expect(501);

    expect(res.body.message).toBe("Run confirmation is not implemented yet");
  });

  it("requires manifestVersion and planVersion on confirm", async () => {
    const res = await http(app)
      .post(`/v1/runs/${UUID}/confirm`)
      .send({})
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "manifestVersion", message: "Required" },
      { field: "planVersion", message: "Required" },
    ]);
  });

  it("accepts a clarify body and returns 501", async () => {
    const res = await http(app)
      .post(`/v1/runs/${UUID}/clarify`)
      .send({ answers: { region: "us-east-1", engine: "postgres" } })
      .expect(501);

    expect(res.body.message).toBe("Clarification submission is not implemented yet");
  });

  it("requires answers on clarify", async () => {
    const res = await http(app)
      .post(`/v1/runs/${UUID}/clarify`)
      .send({})
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "answers", message: "Required" },
    ]);
  });

  it("rejects invalid run ids in the path", async () => {
    const res = await http(app).get("/v1/runs/not-a-uuid").expect(400);
    expect(res.body.error).toBe("BAD_REQUEST");
    expect(res.body.message).toBe("Validation failed (uuid is expected)");
  });
});
