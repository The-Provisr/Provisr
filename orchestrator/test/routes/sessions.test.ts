import { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestApp, http, useDevAuth } from "../helpers/create-test-app";
import { SessionsController } from "../../src/routes/sessions.controller";
import { ChatPersistenceService } from "../../src/services/chat-persistence.service";

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

  it("rejects invalid session ids in the path", async () => {
    const res = await http(app).delete("/v1/sessions/not-a-uuid").expect(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.message).toBe("Request validation failed");
  });
});

describe("SessionsController", () => {
  const user = { userId: "user-1", clerkId: "clerk-1", email: undefined, workspaceIds: [], roles: {} };

  it("delegates persisted session operations to the chat service", async () => {
    const chat = {
      listSessions: vi.fn().mockResolvedValue([]),
      createSession: vi.fn().mockResolvedValue({ id: UUID }),
      getSession: vi.fn().mockResolvedValue({ id: UUID }),
      deleteSession: vi.fn().mockResolvedValue(undefined),
      getMessagePreview: vi.fn().mockResolvedValue([]),
    };
    const controller = new SessionsController(chat as unknown as ChatPersistenceService);

    await controller.list(UUID, { limit: 50, offset: 0 }, user);
    await controller.create({ workspaceId: UUID, title: "Request" }, user);
    await controller.get(UUID, UUID, user);
    await controller.remove(UUID, UUID, user);

    expect(chat.listSessions).toHaveBeenCalledWith(UUID, user.userId, 50, 0);
    expect(chat.createSession).toHaveBeenCalledWith({ workspaceId: UUID, userId: user.userId, title: "Request" });
    expect(chat.getSession).toHaveBeenCalledWith(UUID, UUID, user.userId);
    expect(chat.getMessagePreview).toHaveBeenCalledWith(UUID, UUID, user.userId);
    expect(chat.deleteSession).toHaveBeenCalledWith(UUID, UUID, user.userId);
  });
});
