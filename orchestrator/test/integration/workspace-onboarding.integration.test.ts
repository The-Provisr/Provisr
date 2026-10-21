import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp, http } from "../helpers/create-test-app";
import { ClerkAuthService } from "../../src/auth/clerk-auth.service";
import { IdentityService } from "../../src/auth/identity.service";
import { DbService } from "../../src/db/db.service";

// Live boundary proof: only Clerk signature verification is stubbed. Identity,
// membership, workspace-service creation/replay, selection and audit use PostgreSQL.
describe.skipIf(!process.env.ONBOARDING_DATABASE_URL)("workspace onboarding with real services", () => {
  let app: INestApplication;
  const token = `onboarding_${randomUUID()}`;
  const otherToken = `other_${randomUUID()}`;
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", process.env.ONBOARDING_DATABASE_URL!);
    vi.stubEnv("AUTH_DEV_BYPASS", "false");
    app = await createTestApp();
    vi.spyOn(app.get(ClerkAuthService), "verifyToken").mockImplementation(async value => ({
      sub: value, sid: undefined, email: "onboarding@example.invalid", exp: Date.now() / 1000 + 3600,
      orgId: undefined, orgRole: undefined,
    }));
  });
  afterAll(async () => { await app?.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("creates a durable identity, workspace and admin membership, then recovers a lost response", async () => {
    const before = await http(app).post("/v1/users/ensure").auth(token, { type: "bearer" })
      .set("Idempotency-Key", token).send({ name: "Team owner", email: "owner@example.invalid" }).expect(200);
    expect(before.body.workspaceId).toBeNull();
    const key = randomUUID();
    const body = { name: "Live onboarding", environment: "production", avatar: "🚀", providers: ["aws"] };
    const first = await http(app).post("/v1/workspaces").auth(token, { type: "bearer" })
      .set("Idempotency-Key", key).send(body).expect(201);
    const retry = await http(app).post("/v1/workspaces").auth(token, { type: "bearer" })
      .set("Idempotency-Key", key).send(body).expect(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(first.body.environment).toBe("production");
    await http(app).post("/v1/users/ensure").auth(token, { type: "bearer" }).set("Idempotency-Key", token)
      .send({ workspaceId: first.body.id }).expect(200);
    const nextSignIn = await http(app).post("/v1/users/ensure").auth(token, { type: "bearer" })
      .set("Idempotency-Key", token).send({}).expect(200);
    expect(nextSignIn.body.workspaceId).toBe(first.body.id);
    const memberships = await http(app).get("/v1/workspaces").auth(token, { type: "bearer" }).expect(200);
    expect(memberships.body).toMatchObject([{ id: first.body.id, role: "admin" }]);
    const db = app.get(DbService);
    const restarted = await new IdentityService(db).getOrCreateUser({ sub: token, email: undefined, sid: undefined,
      exp: Date.now() / 1000 + 3600, orgId: undefined, orgRole: undefined });
    expect(restarted.userId).toBe(before.body.id);
    const audit = await db.query("SELECT count(*)::int AS count FROM provisr_audit.audit_events WHERE workspace_id=$1 AND event_type='workspace_created'", [first.body.id]);
    expect(audit.rows[0].count).toBe(1);
    const settings = await db.query("SELECT settings FROM provisr_identity.workspaces WHERE id=$1", [first.body.id]);
    expect(settings.rows[0].settings).toEqual({ avatar: "🚀", providers: ["aws"] });
  });

  it("rejects foreign workspace selection and caller-supplied identity overrides", async () => {
    const foreign = await http(app).post("/v1/workspaces").auth(otherToken, { type: "bearer" })
      .set("Idempotency-Key", randomUUID()).send({ name: "Other workspace" }).expect(201);
    await http(app).post("/v1/users/ensure").auth(token, { type: "bearer" }).set("Idempotency-Key", token)
      .send({ workspaceId: foreign.body.id }).expect(403);
    await http(app).post("/v1/workspaces").auth(token, { type: "bearer" }).set("Idempotency-Key", randomUUID())
      .send({ name: "Forged creator", creator_id: randomUUID() }).expect(400);
    const listed = await http(app).get("/v1/workspaces").auth(token, { type: "bearer" }).expect(200);
    expect(listed.body.some((workspace: { id: string }) => workspace.id === foreign.body.id)).toBe(false);
    await http(app).post("/v1/workspaces").set("Idempotency-Key", randomUUID()).send({ name: "Anonymous" }).expect(401);
  });
});
