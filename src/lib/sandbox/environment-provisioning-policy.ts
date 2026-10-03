import type {
  PreparationRequirement,
} from "@/lib/sandbox/preparation-planner";

export type EnvironmentProvisioningAction =
  | "provide"
  | "require_explicit_value"
  | "defer_to_runtime"
  | "defer_to_test"
  | "unresolved";

export interface EnvironmentProvisioningDecision {
  variable: string;

  action: EnvironmentProvisioningAction;

  canAutoProvision: boolean;

  reason: string;
}

/*
 * Decide how DeployGuard may handle a discovered
 * environment requirement.
 *
 * This policy deliberately separates classification
 * from provisioning.
 *
 * Knowing that a variable is public does NOT prove
 * what its correct value should be.
 *
 * Likewise, DeployGuard must never infer secret values
 * from its own host environment or manufacture values
 * merely to make verification pass.
 */
export function decideEnvironmentProvisioning(
  requirement: PreparationRequirement
): EnvironmentProvisioningDecision {
  if (requirement.kind !== "environment") {
    throw new Error(
      "Environment provisioning policy requires an environment preparation requirement."
    );
  }

  const variable = requirement.technology;

  if (requirement.phase === "runtime") {
    return {
      variable,
      action: "defer_to_runtime",
      canAutoProvision: false,
      reason:
        `${variable} is classified as runtime configuration and is not a build-verification prerequisite.`,
    };
  }

  if (requirement.phase === "test") {
    return {
      variable,
      action: "defer_to_test",
      canAutoProvision: false,
      reason:
        `${variable} is classified as test configuration and is not a build-verification prerequisite.`,
    };
  }

  if (requirement.phase !== "build") {
    return {
      variable,
      action: "unresolved",
      canAutoProvision: false,
      reason:
        `${variable} does not have a sufficiently established execution phase for automatic provisioning.`,
    };
  }

  if (requirement.sensitivity === "secret") {
    return {
      variable,
      action: "require_explicit_value",
      canAutoProvision: false,
      reason:
        `${variable} is required during build and classified as sensitive. An explicit repository-scoped value is required.`,
    };
  }

  if (requirement.sensitivity === "unknown") {
    return {
      variable,
      action: "require_explicit_value",
      canAutoProvision: false,
      reason:
        `${variable} is required during build but its sensitivity is uncertain. DeployGuard will not infer or manufacture a value.`,
    };
  }

  /*
   * Public and ordinary configuration values are not
   * necessarily secrets, but that still does not give
   * DeployGuard enough evidence to invent their values.
   *
   * For example, NEXT_PUBLIC_API_URL may be public while
   * still requiring the repository owner's real endpoint.
   */
  return {
    variable,
    action: "require_explicit_value",
    canAutoProvision: false,
    reason:
      `${variable} is required during build. Its value must be supplied explicitly because DeployGuard cannot infer repository configuration safely.`,
  };
}
