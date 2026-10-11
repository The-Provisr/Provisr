import type { PolicyPack, PolicyPackDraft } from "@/lib/policy/types";

/** @migration Replace with a real orchestrator call when policy endpoints land (BE-C01). */
export function savePolicyDraft(draft: PolicyPackDraft): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 600);
  });
}

/** @migration Replace with a real orchestrator call when policy endpoints land (BE-C01). */
export function resetPolicyPack(id: string): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 600);
  });
}

export type { PolicyPack, PolicyPackDraft };