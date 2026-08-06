import { Test } from "@nestjs/testing";
import { firstValueFrom, take } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SseController } from "../../src/routes/sse.controller";

describe("SseController", () => {
  let controller: SseController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SseController],
    }).compile();

    controller = moduleRef.get(SseController);
  });

  it("emits a keepalive event carrying the workspace id", async () => {
    vi.useFakeTimers();
    try {
      const workspaceId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";

      const eventPromise = firstValueFrom(
        controller.events(workspaceId).pipe(take(1)),
      );
      vi.advanceTimersByTime(15_000);

      const event = await eventPromise;
      expect(event.id).toBe("0");
      expect(JSON.parse(String(event.data))).toEqual({
        type: "keepalive",
        workspaceId,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
