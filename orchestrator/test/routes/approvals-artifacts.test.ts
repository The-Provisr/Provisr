import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, http, useDevAuth } from "../helpers/create-test-app";

const UUID = "a3b8f0f2-2c4a-4d6e-8f0a-1b2c3d4e5f6a";

describe("Approvals and artifacts routes", () => {
  let app: INestApplication;

  useDevAuth();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("approvals", () => {
    it("returns 501 for ticket retrieval", async () => {
      const res = await http(app).get(`/v1/approvals/${UUID}`).expect(501);
      expect(res.body.message).toBe("Approval ticket retrieval is not implemented yet");
    });

    it("accepts an approved decision and returns 501", async () => {
      const res = await http(app)
        .post(`/v1/approvals/${UUID}/decide`)
        .send({ decision: "approved" })
        .expect(501);

      expect(res.body.message).toBe("Approval decision is not implemented yet");
    });

    it("rejects a decision without a reason", async () => {
      const res = await http(app)
        .post(`/v1/approvals/${UUID}/decide`)
        .send({ decision: "rejected" })
        .expect(400);

      expect(res.body).toMatchObject({
        error: "ValidationError",
        status: 400,
        code: "VALIDATION_FAILED",
      });
      expect(res.body.details).toEqual([
        {
          field: "reason",
          message: "Reason is required when rejecting an approval",
        },
      ]);
    });

    it("rejects a whitespace-only rejection reason", async () => {
      const res = await http(app)
        .post(`/v1/approvals/${UUID}/decide`)
        .send({ decision: "rejected", reason: "   " })
        .expect(400);

      expect(res.body).toMatchObject({
        error: "ValidationError",
        status: 400,
        code: "VALIDATION_FAILED",
      });
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          {
            field: "reason",
            message: "Reason is required when rejecting an approval",
          },
        ]),
      );
    });

    it("accepts a rejected decision with a reason", async () => {
      const res = await http(app)
        .post(`/v1/approvals/${UUID}/decide`)
        .send({ decision: "rejected", reason: "budget not approved" })
        .expect(501);

      expect(res.body.message).toBe("Approval decision is not implemented yet");
    });

    it("rejects an unknown decision value", async () => {
      const res = await http(app)
        .post(`/v1/approvals/${UUID}/decide`)
        .send({ decision: "maybe" })
        .expect(400);

      expect(res.body.details[0].field).toBe("decision");
      expect(res.body.details[0].message).toContain("Invalid enum value");
    });
  });

  describe("artifacts", () => {
    it("returns 501 for artifact listing", async () => {
      const res = await http(app).get(`/v1/runs/${UUID}/artifacts`).expect(501);
      expect(res.body.message).toBe("Artifact listing is not implemented yet");
    });

    it("returns 501 for artifact download", async () => {
      const res = await http(app)
        .get(`/v1/runs/${UUID}/artifacts/${UUID}`)
        .expect(501);

      expect(res.body.message).toBe("Artifact download is not implemented yet");
    });

    it("rejects an invalid artifact id in the path", async () => {
      const res = await http(app)
        .get(`/v1/runs/${UUID}/artifacts/not-a-uuid`)
        .expect(400);

      expect(res.body.error).toBe("BAD_REQUEST");
      expect(res.body.message).toBe("Validation failed (uuid is expected)");
    });
  });
});
