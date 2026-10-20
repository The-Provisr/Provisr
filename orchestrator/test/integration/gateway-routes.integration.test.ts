import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestApp, http, useDevAuth } from "../helpers/create-test-app";

const WS = randomUUID();
const ACCT = randomUUID();
const U1 = randomUUID();

describe("Gateway routes — authentication", () => {
  let app: INestApplication;

  beforeAll(async () => {
    delete process.env.DEV_USER_ID;
    delete process.env.AUTH_DEV_BYPASS;
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 without credentials on cloud accounts, members, invitations, and permissions", async () => {
    await http(app).get(`/v1/workspaces/${WS}/cloud-accounts`).expect(401);
    await http(app).get(`/v1/workspaces/${WS}/members`).expect(401);
    await http(app).get(`/v1/workspaces/${WS}/cloud-capabilities`).expect(401);
    await http(app).get("/v1/invitations?code=abc").expect(401);
    await http(app).post("/v1/permissions/check").send({}).expect(401);
  });
});

describe("Gateway routes — payload validation", () => {
  let app: INestApplication;
  useDevAuth();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects non-UUID workspace path parameters", async () => {
    await http(app).get("/v1/workspaces/not-a-uuid/cloud-accounts").expect(400);
    await http(app).get("/v1/workspaces/not-a-uuid/members").expect(400);
    await http(app).get("/v1/workspaces/not-a-uuid/cloud-capabilities").expect(400);
  });

  it("rejects an unknown cloud provider and strict-mode extra fields", async () => {
    const res = await http(app)
      .post(`/v1/workspaces/${WS}/cloud-accounts`)
      .send({ provider: "digitalocean", label: "x", metadata: {} })
      .expect(400);
    expect(res.body.details[0].field).toBe("provider");

    const extra = await http(app)
      .post(`/v1/workspaces/${WS}/cloud-accounts`)
      .send({ provider: "aws", label: "x", metadata: {}, workspace_id: WS })
      .expect(400);
    expect(extra.body.error).toBe("ValidationError");
    expect(extra.body.details[0].message).toContain("Unrecognized key(s) in object");
  });

  it("rejects a missing label on cloud account creation", async () => {
    const res = await http(app)
      .post(`/v1/workspaces/${WS}/cloud-accounts`)
      .send({ provider: "aws", metadata: {} })
      .expect(400);
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "label" })]),
    );
  });

  it("rejects an invalid member role and a non-UUID user id", async () => {
    const role = await http(app)
      .post(`/v1/workspaces/${WS}/members`)
      .send({ user_id: U1, role: "owner" })
      .expect(400);
    expect(role.body.details[0].field).toBe("role");

    await http(app)
      .patch(`/v1/workspaces/${WS}/members/not-a-uuid`)
      .send({ role: "viewer" })
      .expect(400);
  });

  it("rejects an invalid invitation email and unknown role", async () => {
    const res = await http(app)
      .post(`/v1/workspaces/${WS}/invitations`)
      .send({ email: "not-an-email", role: "viewer" })
      .expect(400);
    expect(res.body.details[0].field).toBe("email");
  });

  it("requires a code when looking up or accepting an invitation", async () => {
    await http(app).get("/v1/invitations").expect(400);
    await http(app).post("/v1/invitations/accept").send({ name: "Ada" }).expect(400);
  });

  it("rejects a permission check without a UUID workspace id", async () => {
    const res = await http(app)
      .post("/v1/permissions/check")
      .send({ workspace_id: "nope", resource_type: "member", action: "add" })
      .expect(400);
    expect(res.body.details[0].field).toBe("workspace_id");
  });

  it("rejects a permission check that tries to supply user_id (strict injection)", async () => {
    const res = await http(app)
      .post("/v1/permissions/check")
      .send({ workspace_id: WS, resource_type: "member", action: "add", user_id: ACCT })
      .expect(400);
    expect(res.body.details[0].message).toContain("Unrecognized key(s) in object");
  });
});
