import type {
  CheckStatus,
} from "@/lib/checks/types";

import type {
  SandboxPreparationResult,
} from "@/lib/sandbox/workspace-preparation";

/*
 * Decide how an incomplete sandbox preparation should
 * affect downstream repository checks.
 *
 * Infrastructure failures do not prove that the
 * repository itself is unhealthy.
 *
 * Network/registry failures and sandbox timeouts therefore
 * block verification, while repository-caused preparation
 * failures remain errors attributable to the repository.
 */
export function classifyPreparationFailureStatus(
  failureKind:
    SandboxPreparationResult["failureKind"]
): Extract<
  CheckStatus,
  "blocked" | "error"
> {
  return failureKind === "network" ||
    failureKind === "timeout"
    ? "blocked"
    : "error";
}
