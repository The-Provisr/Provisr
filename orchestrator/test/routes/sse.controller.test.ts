import { firstValueFrom } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { SseController } from "../../src/routes/sse.controller";
import type { DbService } from "../../src/db/db.service";
import type { RequestUser } from "../../src/middleware/auth.types";

const user = { userId: "user" } as RequestUser;
const workspaceId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
describe("SSE persisted delivery", () => {
  it("emits persisted payloads with replayable ids", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{}] }).mockResolvedValue({ rows: [{ event_id: workspaceId, event_type: "ClarificationQuestionEvent", payload: { question: "Region?" }, stream_sequence: "1" }] });
    const stream = await new SseController({ query } as unknown as DbService).events(workspaceId, undefined, user);
    expect(await firstValueFrom(stream)).toEqual({ id: workspaceId, type: "ClarificationQuestionEvent", data: { question: "Region?" } });
  });
  it("keeps heartbeats from replacing the replay cursor", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{}] }).mockResolvedValue({ rows: [] });
    const stream = await new SseController({ query } as unknown as DbService).events(workspaceId, undefined, user);
    expect(await firstValueFrom(stream)).toEqual({ type: "keepalive", data: { workspaceId } });
  });
  it("denies streams for nonmembers", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(new SseController({ query } as unknown as DbService).events(workspaceId, undefined, user)).rejects.toThrow("membership");
  });
});
