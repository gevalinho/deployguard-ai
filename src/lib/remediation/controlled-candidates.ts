import type { PublicCheckResult } from "@/lib/reporting/types";

export type ControlledRemediationCandidate = {
  checkId: "security" | "lint";
  checkName: string;
  category: "security" | "lint";
  evidenceIndexes: number[];
  strategy: "dependency_security" | "lint_autofix";
  packageName?: string;
  advisoryId?: string;
};

/** Only strategies already supported by the controlled remediation server. */
export function getControlledRemediationCandidates(checks: PublicCheckResult[]): ControlledRemediationCandidate[] {
  const candidates: ControlledRemediationCandidate[] = [];
  for (const check of checks) {
    if (check.status !== "failed") continue;
    if (check.id === "security" && check.category === "security") {
      for (const [index, evidence] of (check.evidence ?? []).entries()) {
        if (evidence.kind !== "security_finding") continue;
        const packageName = evidence.message.match(
          /^(.+?) has a (?:high|critical)-severity dependency vulnerability\.$/i,
        )?.[1];
        if (!packageName) continue;
        for (const advisoryId of evidence.advisoryIds ?? []) {
          if (!/^[0-9]{1,20}$/.test(advisoryId)) continue;
          candidates.push({ checkId: "security", checkName: check.name,
            category: "security", evidenceIndexes: [index], strategy: "dependency_security", packageName, advisoryId });
        }
      }
    } else if (check.id === "lint" && check.category === "lint") {
      const index = (check.evidence ?? []).findIndex((item) => item.kind === "error" || item.kind === "warning");
      if (index >= 0) candidates.push({ checkId: "lint", checkName: check.name,
        category: "lint", evidenceIndexes: [index], strategy: "lint_autofix" });
    }
  }
  return candidates;
}
