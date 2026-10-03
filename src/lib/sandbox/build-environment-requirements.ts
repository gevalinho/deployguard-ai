import type {
  BuildEnvironmentRequirement,
} from "@/lib/agents/sandbox-build-agent";

import {
  decideEnvironmentProvisioning,
} from "@/lib/sandbox/environment-provisioning-policy";

import type {
  PreparationRequirement,
} from "@/lib/sandbox/preparation-planner";

/*
 * Convert evidence-derived preparation requirements into
 * the environment preconditions understood by the build
 * verification agent.
 *
 * Provisioning policy is the authority for deciding how
 * DeployGuard may handle each discovered variable.
 */
export function createBuildEnvironmentRequirements(
  requirements: PreparationRequirement[]
): BuildEnvironmentRequirement[] {
  return requirements
    .filter(
      (requirement) =>
        requirement.kind === "environment" &&
        requirement.phase === "build"
    )
    .map((requirement) => {
      const decision =
        decideEnvironmentProvisioning(
          requirement
        );

      /*
       * A requirement is available only when DeployGuard
       * has actually provisioned an explicit value.
       *
       * The current policy deliberately does not provision
       * repository configuration automatically, so these
       * requirements remain unavailable.
       *
       * Keeping this decision here prevents the orchestrator
       * from inventing availability independently of policy.
       */
      const available =
        decision.action === "provide" &&
        decision.canAutoProvision;

      return {
        variable: decision.variable,
        required: requirement.required,
        available,
        provisioningAction:
          decision.action,
        provisioningReason:
          decision.reason,
      };
    });
}
