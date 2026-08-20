import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestApp, http, useDevAuth } from "../helpers/create-test-app";

describe("Controller Payload Validation & Strict Typing Integration Tests", () => {
  let app: INestApplication;
  const workspaceId = randomUUID();
  const sessionId = randomUUID();
  const runId = randomUUID();

  useDevAuth();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("ProvisioningRunsController Validation", () => {
    it("rejects POST /v1/runs when workspaceId query param is missing", async () => {
      const res = await http(app)
        .post("/v1/runs")
        .send({ sessionId, prompt: "provision resources" })
        .expect(400);

      expect(res.body).toMatchObject({
        error: "ValidationError",
        status: 400,
        code: "VALIDATION_FAILED",
      });
      expect(res.body.details).toEqual(
        expect.arrayContaining([{ field: "workspaceId", message: "Required" }]),
      );
    });

    it("rejects POST /v1/runs with invalid UUID in workspaceId query param", async () => {
      const res = await http(app)
        .post("/v1/runs?workspaceId=not-a-valid-uuid")
        .send({ sessionId, prompt: "provision resources" })
        .expect(400);

      expect(res.body.details).toEqual(
        expect.arrayContaining([{ field: "workspaceId", message: "Invalid uuid" }]),
      );
    });

    it("rejects POST /v1/runs with empty prompt", async () => {
      const res = await http(app)
        .post(`/v1/runs?workspaceId=${workspaceId}`)
        .send({ sessionId, prompt: "" })
        .expect(400);

      expect(res.body.details).toEqual(
        expect.arrayContaining([
          { field: "prompt", message: "String must contain at least 1 character(s)" },
        ]),
      );
    });

    it("rejects POST /v1/runs with invalid non-UUID sessionId", async () => {
      const res = await http(app)
        .post(`/v1/runs?workspaceId=${workspaceId}`)
        .send({ sessionId: "invalid-session-uuid", prompt: "deploy a cluster" })
        .expect(400);

      expect(res.body.details).toEqual(
        expect.arrayContaining([{ field: "sessionId", message: "Invalid uuid" }]),
      );
    });

    it("rejects POST /v1/runs with unrecognized / extra payload fields (strict mode enforcement)", async () => {
      const res = await http(app)
        .post(`/v1/runs?workspaceId=${workspaceId}`)
        .send({
          sessionId,
          prompt: "deploy a cluster",
          unexpectedField: "malicious_payload",
          anotherBogusField: 12345,
        })
        .expect(400);

      expect(res.body.error).toBe("ValidationError");
      expect(res.body.details[0].message).toContain("Unrecognized key(s) in object");
    });

    it("rejects POST /v1/runs/:id/confirm with extra / unexpected fields in body", async () => {
      const res = await http(app)
        .post(`/v1/runs/${runId}/confirm?workspaceId=${workspaceId}`)
        .send({
          manifestVersion: "v1.0.0",
          planVersion: "plan-123",
          extraDangerousField: "bypass_policy",
        })
        .expect(400);

      expect(res.body.error).toBe("ValidationError");
      expect(res.body.details[0].message).toContain("Unrecognized key(s) in object");
    });

    it("rejects POST /v1/runs/:id/clarify with extra / unexpected fields in body", async () => {
      const res = await http(app)
        .post(`/v1/runs/${runId}/clarify?workspaceId=${workspaceId}`)
        .send({
          answers: { engine: "postgres" },
          extraInject: true,
        })
        .expect(400);

      expect(res.body.error).toBe("ValidationError");
      expect(res.body.details[0].message).toContain("Unrecognized key(s) in object");
    });

    it("rejects GET /v1/runs with invalid status query filter", async () => {
      const res = await http(app)
        .get(`/v1/runs?workspaceId=${workspaceId}&status=UNKNOWN_STATUS`)
        .expect(400);

      expect(res.body.details[0].field).toBe("status");
      expect(res.body.details[0].message).toContain("Invalid enum value");
    });

    it("rejects non-UUID path parameters across all run endpoints", async () => {
      await http(app).get(`/v1/runs/not-uuid?workspaceId=${workspaceId}`).expect(400);
      await http(app).post(`/v1/runs/not-uuid/confirm?workspaceId=${workspaceId}`).expect(400);
      await http(app).post(`/v1/runs/not-uuid/clarify?workspaceId=${workspaceId}`).expect(400);
      await http(app).post(`/v1/runs/not-uuid/cancel?workspaceId=${workspaceId}`).expect(400);
    });
  });

  describe("ApprovalsController Validation", () => {
    it("rejects POST /v1/approvals/:id/decide with invalid decision value", async () => {
      const res = await http(app)
        .post(`/v1/approvals/${runId}/decide`)
        .send({ decision: "pending" })
        .expect(400);

      expect(res.body.details[0].field).toBe("decision");
      expect(res.body.details[0].message).toContain("Invalid enum value");
    });

    it("rejects POST /v1/approvals/:id/decide when decision is rejected but reason is missing", async () => {
      const res = await http(app)
        .post(`/v1/approvals/${runId}/decide`)
        .send({ decision: "rejected" })
        .expect(400);

      expect(res.body.details).toEqual([
        { field: "reason", message: "Reason is required when rejecting an approval" },
      ]);
    });

    it("rejects POST /v1/approvals/:id/decide with whitespace-only rejection reason", async () => {
      const res = await http(app)
        .post(`/v1/approvals/${runId}/decide`)
        .send({ decision: "rejected", reason: "    " })
        .expect(400);

      expect(res.body.details).toEqual(
        expect.arrayContaining([
          { field: "reason", message: "Reason is required when rejecting an approval" },
        ]),
      );
    });

    it("rejects POST /v1/approvals/:id/decide with unrecognized / extra payload fields", async () => {
      const res = await http(app)
        .post(`/v1/approvals/${runId}/decide`)
        .send({
          decision: "approved",
          untrustedProperty: "inject_token",
        })
        .expect(400);

      expect(res.body.error).toBe("ValidationError");
      expect(res.body.details[0].message).toContain("Unrecognized key(s) in object");
    });

    it("rejects GET /v1/approvals/:id with non-UUID path parameter", async () => {
      await http(app).get("/v1/approvals/non-uuid-ticket").expect(400);
    });
  });

  describe("SessionsController Validation", () => {
    it("rejects POST /v1/sessions when workspaceId is missing or non-UUID", async () => {
      const res1 = await http(app).post("/v1/sessions").send({ title: "My Session" }).expect(400);
      expect(res1.body.details).toEqual(
        expect.arrayContaining([{ field: "workspaceId", message: "Required" }]),
      );

      const res2 = await http(app)
        .post("/v1/sessions")
        .send({ workspaceId: "not-a-uuid", title: "My Session" })
        .expect(400);
      expect(res2.body.details).toEqual(
        expect.arrayContaining([{ field: "workspaceId", message: "Invalid uuid" }]),
      );
    });

    it("rejects POST /v1/sessions with title exceeding 200 characters", async () => {
      const res = await http(app)
        .post("/v1/sessions")
        .send({ workspaceId, title: "a".repeat(201) })
        .expect(400);

      expect(res.body.details).toEqual([
        { field: "title", message: "String must contain at most 200 character(s)" },
      ]);
    });

    it("rejects POST /v1/sessions with unrecognized extra properties", async () => {
      const res = await http(app)
        .post("/v1/sessions")
        .send({
          workspaceId,
          title: "Valid Session",
          maliciousRoleOverride: "admin",
        })
        .expect(400);

      expect(res.body.error).toBe("ValidationError");
      expect(res.body.details[0].message).toContain("Unrecognized key(s) in object");
    });

    it("rejects GET /v1/sessions when workspaceId query is missing", async () => {
      const res = await http(app).get("/v1/sessions").expect(400);
      expect(res.body.details).toEqual(
        expect.arrayContaining([{ field: "workspaceId", message: "Required" }]),
      );
    });

    it("rejects non-UUID path on session detail, messages, and deletion", async () => {
      await http(app).get(`/v1/sessions/not-uuid?workspaceId=${workspaceId}`).expect(400);
      await http(app).get(`/v1/sessions/not-uuid/messages?workspaceId=${workspaceId}`).expect(400);
      await http(app).delete(`/v1/sessions/not-uuid?workspaceId=${workspaceId}`).expect(400);
    });
  });

  describe("WorkspacesController Validation", () => {
    it("rejects POST /v1/workspaces with name shorter than 3 characters", async () => {
      const res = await http(app).post("/v1/workspaces").send({ name: "ab" }).expect(400);

      expect(res.body.details).toEqual([
        { field: "name", message: "String must contain at least 3 character(s)" },
      ]);
    });

    it("rejects POST /v1/workspaces with name longer than 64 characters", async () => {
      const res = await http(app)
        .post("/v1/workspaces")
        .send({ name: "x".repeat(65) })
        .expect(400);

      expect(res.body.details).toEqual([
        { field: "name", message: "String must contain at most 64 character(s)" },
      ]);
    });

    it("rejects POST /v1/workspaces with invalid environment enum", async () => {
      const res = await http(app)
        .post("/v1/workspaces")
        .send({ name: "valid-name", environment: "testing" })
        .expect(400);

      expect(res.body.details[0].field).toBe("environment");
      expect(res.body.details[0].message).toContain("Invalid enum value");
    });

    it("rejects POST /v1/workspaces with description exceeding 500 characters", async () => {
      const res = await http(app)
        .post("/v1/workspaces")
        .send({ name: "valid-name", description: "d".repeat(501) })
        .expect(400);

      expect(res.body.details).toEqual([
        { field: "description", message: "String must contain at most 500 character(s)" },
      ]);
    });

    it("rejects POST /v1/workspaces with unexpected extra fields in body", async () => {
      const res = await http(app)
        .post("/v1/workspaces")
        .send({
          name: "valid-workspace",
          extraUnknownProperty: "injection",
        })
        .expect(400);

      expect(res.body.error).toBe("ValidationError");
      expect(res.body.details[0].message).toContain("Unrecognized key(s) in object");
    });

    it("rejects PATCH /v1/workspaces/:id with unexpected extra fields in body", async () => {
      const res = await http(app)
        .patch(`/v1/workspaces/${workspaceId}`)
        .send({
          name: "updated-name",
          unknownProperty: 999,
        })
        .expect(400);

      expect(res.body.error).toBe("ValidationError");
      expect(res.body.details[0].message).toContain("Unrecognized key(s) in object");
    });

    it("rejects non-UUID path parameters on workspace routes", async () => {
      await http(app).get("/v1/workspaces/not-a-uuid").expect(400);
      await http(app).patch("/v1/workspaces/not-a-uuid").send({ name: "valid" }).expect(400);
      await http(app).delete("/v1/workspaces/not-a-uuid").expect(400);
    });
  });
});
