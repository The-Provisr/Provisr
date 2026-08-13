import { ProvisioningRunSnapshot } from "../state-machine/workflow-transition.service";
import { EMPTY_TRANSITION_CONDITIONS, TransitionConditions } from "../state-machine/transitions";

export interface PolicyRequirements {
  allowedRegions: string[];
  maxBudget: number;
  requiredTags: Record<string, string>;
  prohibitedResourceTypes: string[];
  requiredEncryption: boolean;
  requiredBackup: boolean;
}

export interface PolicyRequirementsClient {
  getPolicyRequirements(workspaceId: string): Promise<PolicyRequirements>;
}

export interface PolicyPreflightStore {
  policiesEnabled(workspaceId: string): Promise<boolean>;
  persistRequirements(input: {
    runId: string;
    workspaceId: string;
    requirements: PolicyRequirements;
    actorId: string;
    actorType: "user" | "agent" | "system";
    correlationId: string;
  }): Promise<boolean>;
  recordSkipped(input: {
    runId: string;
    workspaceId: string;
    actorId: string;
    actorType: "user" | "agent" | "system";
    correlationId: string;
    reason: "workspace_policies_disabled";
  }): Promise<void>;
}

export class PolicyPreflightStateError extends Error {
  constructor(readonly state: string) {
    super(`Policy pre-flight can only run in POLICY_LOADED, not ${state}`);
  }
}

export class PolicyPreflightPersistenceError extends Error {
  constructor(readonly runId: string) {
    super(`Policy requirements could not be persisted for run ${runId}`);
  }
}

export type PolicyPreflightResult =
  | { policiesEnabled: false; requirements: null; conditions: TransitionConditions }
  | { policiesEnabled: true; requirements: PolicyRequirements; conditions: TransitionConditions };

/**
 * OR-008 entry action for POLICY_LOADED. The persisted snapshot, not an
 * agent's claim that it called a tool, is the evidence used by later gates.
 */
export class PolicyPreflightService {
  constructor(
    private readonly store: PolicyPreflightStore,
    private readonly policyClient: PolicyRequirementsClient,
  ) {}

  async load(input: {
    run: ProvisioningRunSnapshot;
    actorId: string;
    actorType: "user" | "agent" | "system";
  }): Promise<PolicyPreflightResult> {
    if (input.run.state !== "POLICY_LOADED") {
      throw new PolicyPreflightStateError(input.run.state);
    }
    const enabled = await this.store.policiesEnabled(input.run.workspaceId);
    if (!enabled) {
      await this.store.recordSkipped({
        runId: input.run.id,
        workspaceId: input.run.workspaceId,
        actorId: input.actorId,
        actorType: input.actorType,
        correlationId: input.run.correlationId,
        reason: "workspace_policies_disabled",
      });
      return {
        policiesEnabled: false,
        requirements: null,
        conditions: {
          ...EMPTY_TRANSITION_CONDITIONS,
          policiesEnabled: false,
          policyRequirementsLoaded: true,
        },
      };
    }

    const requirements = await this.policyClient.getPolicyRequirements(input.run.workspaceId);
    const persisted = await this.store.persistRequirements({
      runId: input.run.id,
      workspaceId: input.run.workspaceId,
      requirements,
      actorId: input.actorId,
      actorType: input.actorType,
      correlationId: input.run.correlationId,
    });
    if (!persisted) throw new PolicyPreflightPersistenceError(input.run.id);
    return {
      policiesEnabled: true,
      requirements,
      conditions: {
        ...EMPTY_TRANSITION_CONDITIONS,
        policiesEnabled: true,
        policyRequirementsLoaded: true,
      },
    };
  }
}
