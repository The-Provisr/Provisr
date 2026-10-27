import { describe, expect, it } from "vitest";
import {
  appendRunTransition,
  buildTimeline,
  formatStageTime,
  stageIndexForState,
  type RunTransition,
} from "./timeline";

const T = (state: RunTransition["state"], at: string): RunTransition => ({ state, at });

describe("stageIndexForState", () => {
  it("maps canonical states to stages", () => {
    expect(stageIndexForState("RECEIVED")).toBe(0);
    expect(stageIndexForState("EXECUTING")).toBe(11);
    expect(stageIndexForState("COMPLETED")).toBe(12);
  });

  it("returns null for terminal failure states and unknown values", () => {
    expect(stageIndexForState("FAILED")).toBeNull();
    expect(stageIndexForState("CANCELLED")).toBeNull();
    expect(stageIndexForState("SOMETHING_ELSE")).toBeNull();
  });
});

describe("appendRunTransition", () => {
  it("appends known states immutably", () => {
    const before: RunTransition[] = [T("RECEIVED", "2026-01-01T00:00:00Z")];
    const after = appendRunTransition(before, "POLICY_LOADED", "2026-01-01T00:00:05Z");
    expect(after).toHaveLength(2);
    expect(before).toHaveLength(1);
  });

  it("ignores unknown states", () => {
    const before: RunTransition[] = [];
    expect(appendRunTransition(before, "NOT_A_STATE", "2026-01-01T00:00:00Z")).toHaveLength(0);
  });
});

describe("buildTimeline", () => {
  it("marks reached stages succeeded, current running, future pending, and passed-over optional stages skipped", () => {
    const timeline = buildTimeline({ run: { state: "MANIFEST_CREATING", createdAt: "2026-01-01T00:00:00Z" } });
    const byId = new Map(timeline.steps.map((step) => [step.id, step]));
    expect(byId.get("received")?.status).toBe("succeeded");
    expect(byId.get("policy_requirements")?.status).toBe("succeeded");
    expect(byId.get("cloud_context")?.status).toBe("succeeded");
    // Optional stage never entered: skipped, not succeeded.
    expect(byId.get("clarification")?.status).toBe("skipped");
    expect(byId.get("manifest")?.status).toBe("running");
    expect(byId.get("approval")?.status).toBe("pending");
    expect(byId.get("completed")?.status).toBe("pending");
    expect(timeline.currentStep).toBe("Manifest drafted");
  });

  it("uses observed transition timestamps, closes the previous stage, and computes durations", () => {
    const timeline = buildTimeline({
      run: { state: "POLICY_LOADED", createdAt: "2026-01-01T00:00:00Z" },
      transitions: [
        T("RECEIVED", "2026-01-01T00:00:00Z"),
        T("POLICY_LOADED", "2026-01-01T00:00:05Z"),
      ],
    });
    const received = timeline.steps.find((step) => step.id === "received")!;
    const policy = timeline.steps.find((step) => step.id === "policy_requirements")!;
    expect(received.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(received.completedAt).toBe("2026-01-01T00:00:05Z");
    expect(received.durationMs).toBe(5000);
    expect(policy.startedAt).toBe("2026-01-01T00:00:05Z");
    expect(policy.status).toBe("running");
    expect(policy.completedAt).toBeUndefined();
    expect(policy.durationMs).toBeUndefined();
    expect(timeline.currentStep).toBe("Policy requirements");
  });

  it("sorts transitions that arrive out of order", () => {
    const timeline = buildTimeline({
      run: { state: "POLICY_LOADED" },
      transitions: [
        T("POLICY_LOADED", "2026-01-01T00:00:05Z"),
        T("RECEIVED", "2026-01-01T00:00:00Z"),
      ],
    });
    const received = timeline.steps.find((step) => step.id === "received")!;
    expect(received.startedAt).toBe("2026-01-01T00:00:00Z");
    expect(received.completedAt).toBe("2026-01-01T00:00:05Z");
  });

  it("marks the farthest reached stage failed when the run fails", () => {
    const timeline = buildTimeline({
      run: { state: "FAILED" },
      transitions: [
        T("RECEIVED", "2026-01-01T00:00:00Z"),
        T("POLICY_LOADED", "2026-01-01T00:00:05Z"),
        T("CLOUD_CONTEXT_LOADED", "2026-01-01T00:00:10Z"),
        T("FAILED", "2026-01-01T00:00:12Z"),
      ],
    });
    const byId = new Map(timeline.steps.map((step) => [step.id, step]));
    expect(byId.get("cloud_context")?.status).toBe("failed");
    expect(byId.get("clarification")?.status).toBe("pending");
    expect(byId.get("manifest")?.status).toBe("pending");
    expect(timeline.currentStep).toBe("Cloud context");
  });

  it("marks the stopping stage cancelled when the run is cancelled", () => {
    const timeline = buildTimeline({
      run: { state: "CANCELLED" },
      transitions: [
        T("RECEIVED", "2026-01-01T00:00:00Z"),
        T("POLICY_LOADED", "2026-01-01T00:00:05Z"),
        T("CANCELLED", "2026-01-01T00:00:07Z"),
      ],
    });
    const byId = new Map(timeline.steps.map((step) => [step.id, step]));
    expect(byId.get("policy_requirements")?.status).toBe("cancelled");
    expect(byId.get("cloud_context")?.status).toBe("pending");
    expect(timeline.currentStep).toBe("Policy requirements");
  });

  it("renders a completed run with every stage succeeded and the run end timestamp", () => {
    const timeline = buildTimeline({
      run: {
        state: "COMPLETED",
        createdAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T00:10:00Z",
      },
      transitions: [
        T("RECEIVED", "2026-01-01T00:00:00Z"),
        T("POLICY_LOADED", "2026-01-01T00:01:00Z"),
        T("CLOUD_CONTEXT_LOADED", "2026-01-01T00:02:00Z"),
        T("MANIFEST_CREATING", "2026-01-01T00:04:00Z"),
        T("MANIFEST_VALIDATING", "2026-01-01T00:05:00Z"),
        T("IAC_GENERATING", "2026-01-01T00:06:00Z"),
        T("PLAN_CREATING", "2026-01-01T00:07:00Z"),
        T("POLICY_CHECKING", "2026-01-01T00:08:00Z"),
        T("CONFIRMING", "2026-01-01T00:09:00Z"),
        T("EXECUTING", "2026-01-01T00:09:30Z"),
        T("COMPLETED", "2026-01-01T00:10:00Z"),
      ],
    });
    const byId = new Map(timeline.steps.map((step) => [step.id, step]));
    const optional = new Set(["clarification", "approval"]);
    expect(
      [...byId.values()].every(
        (step) => optional.has(step.id) || step.status === "succeeded",
      ),
    ).toBe(true);
    const completed = byId.get("completed")!;
    expect(completed.completedAt).toBe("2026-01-01T00:10:00Z");
    expect(completed.startedAt).toBe("2026-01-01T00:10:00Z");
    const execution = byId.get("execution")!;
    expect(execution.startedAt).toBe("2026-01-01T00:09:30Z");
    expect(execution.durationMs).toBe(30000);
    // Optional stages never observed are still skipped, not silently succeeded.
    expect(byId.get("clarification")?.status).toBe("skipped");
    expect(byId.get("approval")?.status).toBe("skipped");
  });

  it("falls back to updatedAt for the end timestamp when completedAt is missing", () => {
    const timeline = buildTimeline({
      run: { state: "FAILED", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:02:00Z" },
      transitions: [T("RECEIVED", "2026-01-01T00:00:00Z")],
    });
    const received = timeline.steps.find((step) => step.id === "received")!;
    expect(received.status).toBe("failed");
    expect(received.completedAt).toBe("2026-01-01T00:02:00Z");
    expect(received.durationMs).toBe(120000);
  });

  it("omits timestamps entirely on a cold reload without transitions", () => {
    const timeline = buildTimeline({ run: { state: "POLICY_CHECKING" } });
    for (const step of timeline.steps) {
      expect(step.startedAt).toBeUndefined();
      expect(step.completedAt).toBeUndefined();
      expect(step.durationMs).toBeUndefined();
    }
  });

  it("attaches a manifest artifact once a manifest version exists", () => {
    const timeline = buildTimeline({ run: { state: "MANIFEST_VALIDATING", manifestVersion: 3 } });
    const manifest = timeline.steps.find((step) => step.id === "manifest")!;
    expect(manifest.artifacts).toEqual([
      { id: "manifest-v3", title: "Manifest v3", type: "manifest" },
    ]);
  });

  it("merges caller-supplied artifacts per stage", () => {
    const timeline = buildTimeline({
      run: { state: "PLAN_CREATING" },
      artifactsByStage: {
        plan: [{ id: "plan-1", title: "Terraform plan", type: "plan", url: "/artifacts/plan-1" }],
      },
    });
    const plan = timeline.steps.find((step) => step.id === "plan")!;
    expect(plan.artifacts?.[0]?.url).toBe("/artifacts/plan-1");
  });

  it("carries the run id into the timeline", () => {
    expect(buildTimeline({ run: { id: "run-1", state: "RECEIVED" } }).runId).toBe("run-1");
  });
});

describe("formatStageTime", () => {
  it("shows the UTC time-of-day deterministically", () => {
    expect(formatStageTime("2026-01-01T09:41:02Z")).toBe("09:41:02");
  });
});
