import type { CheckResult } from "@/lib/checks/types";
import type { RepositoryScanResult } from "@/lib/scanner/types";

export async function runDeploymentAgent(
  scan: RepositoryScanResult
): Promise<CheckResult> {
  const deploymentFacts = scan.facts.filter(
    (fact) => fact.key === "deployment"
  );

  const ciFacts = scan.facts.filter(
    (fact) => fact.key === "ci"
  );

  if (
    deploymentFacts.length === 0 &&
    ciFacts.length === 0
  ) {
    return {
      id: "deployment-readiness",
      category: "deployment",
      name: "Deployment Readiness",
      status: "skipped",
      skipReason: "not_configured",
      summary:
        "No verified deployment or CI configuration was detected in the repository.",
    };
  }

  const detectedEvidence = [
    ...deploymentFacts.map((fact) => fact.value),
    ...ciFacts.map((fact) => fact.value),
  ];

  return {
    id: "deployment-readiness",
    category: "deployment",
    name: "Deployment Readiness",
    status: "passed",
    summary: `Verified deployment configuration detected: ${detectedEvidence.join(
      ", "
    )}.`,
  };
}