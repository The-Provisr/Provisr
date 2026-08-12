import { firstValueFrom, take } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SseController } from "../../src/routes/sse.controller";
import { ChatEventsService } from "../../src/services/chat-events.service";

describe("SseController", () => {
  let controller: SseController;

  beforeEach(async () => {
    const eventService = {
      listWorkspaceEvents: vi.fn().mockResolvedValue([
        { id: "event-1", eventType: "turn.accepted", sequence: 4, payload: { runId: "run-1" }, createdAt: "2026-08-13T00:00:00Z" },
      ]),
    };
    controller = new SseController(eventService as unknown as ChatEventsService);
  });

  it("replays durable workspace events after the supplied cursor", async () => {
    const event = await firstValueFrom(controller.events(
      "f47ac10b-58cc-4372-a567-0e02b2c3d479", 3,
      { userId: "user-1", clerkId: "clerk-1", email: undefined, workspaceIds: [], roles: {} },
    ).pipe(take(1)));
    expect(event).toEqual({ id: "4", type: "turn.accepted", data: { runId: "run-1" } });
  });
});
