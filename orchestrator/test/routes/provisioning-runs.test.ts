import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp, http, useDevAuth } from "../helpers/create-test-app";
import { ProvisioningRunsController } from "../../src/routes/provisioning-runs.controller";
import type { RunsService, ProvisioningRun } from "../../src/state-machine/runs.service";
import type { RequestUser } from "../../src/middleware/auth.types";

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

  it("requires workspaceId when creating a run", async () => {
    const res = await http(app)
      .post("/v1/runs")
      .send({ sessionId: UUID, prompt: "provision a postgres database" })
      .expect(400);

    expect(res.body).toMatchObject({
      error: "ValidationError",
      status: 400,
      code: "VALIDATION_FAILED",
    });
    expect(res.body.details).toEqual([
      { field: "workspaceId", message: "Required" },
    ]);
  });

  it("returns 400 with field details for an empty prompt", async () => {
    const res = await http(app)
      .post(`/v1/runs?workspaceId=${UUID}`)
      .send({ sessionId: UUID, prompt: "" })
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "prompt", message: "String must contain at least 1 character(s)" },
    ]);
  });

  it("returns 400 for an invalid sessionId in the body", async () => {
    const res = await http(app)
      .post(`/v1/runs?workspaceId=${UUID}`)
      .send({ sessionId: "nope", prompt: "hi" })
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "sessionId", message: "Invalid uuid" },
    ]);
  });

  it("requires workspaceId when listing runs", async () => {
    const res = await http(app).get("/v1/runs").expect(400);
    expect(res.body).toMatchObject({
      error: "ValidationError",
      status: 400,
      code: "VALIDATION_FAILED",
    });
    expect(res.body.details).toEqual([
      { field: "workspaceId", message: "Required" },
    ]);
  });

  it("rejects an invalid sessionId filter", async () => {
    const res = await http(app).get(`/v1/runs?workspaceId=${UUID}&sessionId=abc`).expect(400);

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
    const res = await http(app).get(`/v1/runs?workspaceId=${UUID}&status=INVALID`).expect(400);

    expect(res.body.details).toEqual([
      {
        field: "status",
        message:
          "Invalid enum value. Expected 'received' | 'pending_agent' | 'pending_clarification' | 'policy_check' | 'pending_confirmation' | 'pending_approval' | 'provisioning' | 'live' | 'failed' | 'cancelled', received 'INVALID'",
      },
    ]);
  });

  it("requires workspaceId on get", async () => {
    const res = await http(app).get(`/v1/runs/${UUID}`).expect(400);
    expect(res.body.details).toEqual([
      { field: "workspaceId", message: "Required" },
    ]);
  });

  it("requires workspaceId on cancel", async () => {
    const res = await http(app).post(`/v1/runs/${UUID}/cancel`).expect(400);
    expect(res.body.details).toEqual([
      { field: "workspaceId", message: "Required" },
    ]);
  });

  it("requires workspaceId on confirm", async () => {
    const res = await http(app)
      .post(`/v1/runs/${UUID}/confirm`)
      .send({ manifestVersion: "manifest/v1.0", planVersion: "plan/v3" })
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "workspaceId", message: "Required" },
    ]);
  });

  it("requires manifestVersion and planVersion on confirm", async () => {
    const res = await http(app)
      .post(`/v1/runs/${UUID}/confirm?workspaceId=${UUID}`)
      .send({})
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "manifestVersion", message: "Required" },
      { field: "planVersion", message: "Required" },
    ]);
  });

  it("requires workspaceId on clarify", async () => {
    const res = await http(app)
      .post(`/v1/runs/${UUID}/clarify`)
      .send({ answers: { region: "us-east-1", engine: "postgres" } })
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "workspaceId", message: "Required" },
    ]);
  });

  it("requires answers on clarify", async () => {
    const res = await http(app)
      .post(`/v1/runs/${UUID}/clarify?workspaceId=${UUID}`)
      .send({})
      .expect(400);

    expect(res.body.details).toEqual([
      { field: "answers", message: "Required" },
    ]);
  });

  it("rejects invalid run ids in the path", async () => {
    const res = await http(app).get(`/v1/runs/not-a-uuid?workspaceId=${UUID}`).expect(400);
    expect(res.body.error).toBe("BAD_REQUEST");
    expect(res.body.message).toBe("Validation failed (uuid is expected)");
  });
});

describe("ProvisioningRunsController", () => {
  const user: RequestUser = {
    userId: "user-1",
    clerkId: "clerk-1",
    email: undefined,
    workspaceIds: [UUID],
    roles: {},
  };

  const mockRun = {
    id: UUID,
    sessionId: UUID,
    workspaceId: UUID,
    requesterId: user.userId,
    state: "received",
    stateVersion: 0,
    prompt: "Create VPC",
    manifestVersion: null,
    policyDecision: null,
    approvalStatus: "not_required",
    executionStatus: "pending",
    idempotencyKey: "run-key",
    correlationId: "corr-1",
    errorCode: null,
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
  } as unknown as ProvisioningRun;

  it("delegates operations to RunsService", async () => {
    const runsService = {
      createRun: vi.fn().mockResolvedValue(mockRun),
      listRuns: vi.fn().mockResolvedValue([mockRun]),
      getRun: vi.fn().mockResolvedValue(mockRun),
      cancelRun: vi.fn().mockResolvedValue({ ...mockRun, state: "cancelled" }),
      confirmRun: vi.fn().mockResolvedValue({ ...mockRun, state: "pending_approval" }),
      clarifyRun: vi.fn().mockResolvedValue({ ...mockRun, state: "pending_agent" }),
      transitionState: vi.fn(),
    } as unknown as RunsService;

    const controller = new ProvisioningRunsController(runsService);

    await controller.create(UUID, { sessionId: UUID, prompt: "Create VPC" }, user);
    expect(runsService.createRun).toHaveBeenCalledWith(UUID, UUID, user.userId, "Create VPC");

    await controller.list(UUID, UUID, "received", user);
    expect(runsService.listRuns).toHaveBeenCalledWith(UUID, UUID, "received");

    await controller.get(UUID, UUID);
    expect(runsService.getRun).toHaveBeenCalledWith(UUID, UUID);

    await controller.cancel(UUID, UUID, user);
    expect(runsService.cancelRun).toHaveBeenCalledWith(UUID, UUID, user.userId);

    await controller.confirm(
      UUID,
      UUID,
      { manifestVersion: "v1", planVersion: "v1" },
      user,
    );
    expect(runsService.confirmRun).toHaveBeenCalledWith(
      UUID,
      UUID,
      user.userId,
      { manifestVersion: "v1", planVersion: "v1" },
    );

    await controller.clarify(
      UUID,
      UUID,
      { answers: { region: "us-west-2" } },
      user,
    );
    expect(runsService.clarifyRun).toHaveBeenCalledWith(
      UUID,
      UUID,
      user.userId,
      { answers: { region: "us-west-2" } },
    );
  });
});
