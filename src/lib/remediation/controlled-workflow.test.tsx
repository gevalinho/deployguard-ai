import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
import { ControlledRemediation } from "@/components/dashboard/readiness-dashboard";
import { RemediationDelivery, restoreWorkflowForSource } from "@/components/dashboard/remediation-delivery";
import { controlledRemediationCandidateKey, getControlledRemediationCandidates } from "./controlled-candidates";
import { currentAssessmentArtifact } from "./current-assessment-artifact";
import { createRemediationCheckInputs } from "@/lib/ai/remediation-input";
import { verifyRemediationAnalysis } from "@/lib/agents/remediation-verifier";
import type { PublicCheckResult } from "@/lib/reporting/types";

const security: PublicCheckResult = {
  id: "security", category: "security", name: "Dependency Security", status: "failed",
  summary: "10 high-severity vulnerabilities",
  evidence: [{ kind: "security_finding", message: "lodash has a high-severity dependency vulnerability.", code: "high", advisoryIds: ["123"] }],
};
const sha = "a".repeat(40);

function controlled(checks: PublicCheckResult[]) {
  return renderToStaticMarkup(<ControlledRemediation candidates={getControlledRemediationCandidates(checks)}
    executing={false} onExecute={async () => {}} />);
}

describe("deterministic controlled remediation eligibility", () => {
  it("shows the action for WellCare-style security evidence without AI guidance", () => {
    expect(controlled([security])).toContain("Controlled Remediation");
    expect(controlled([security])).toContain("Remediate lodash advisory 123");
    expect(getControlledRemediationCandidates([security])[0].evidenceIndexes).toEqual([0]);
  });

  it("renders separate, stable actions for two advisories on one package", () => {
    const check: PublicCheckResult = { ...security, evidence: [{
      kind: "security_finding", message: "braces has a high-severity dependency vulnerability.",
      code: "high", advisoryIds: ["1098094", "1240992"],
    }] };
    const candidates = getControlledRemediationCandidates([check]);
    expect(candidates.map((item) => item.advisoryId)).toEqual(["1098094", "1240992"]);
    expect(new Set(candidates.map(controlledRemediationCandidateKey)).size).toBe(2);
    const html = controlled([check]);
    expect(html).toContain("Remediate braces advisory 1098094");
    expect(html).toContain("Remediate braces advisory 1240992");
  });

  it("remains available after AI timeout or rejection", () => {
    const rejected = verifyRemediationAnalysis([security], { summary: "AI suggestion", actions: [{
      title: "Invalid", explanation: "", recommendation: "", priority: "high",
      checkId: "missing", evidenceIndexes: [0],
    }] });
    expect(rejected.acceptedActions).toEqual([]);
    expect(controlled([security])).toContain("Controlled Remediation");
  });

  it("does not offer unsupported failures or evidence", () => {
    expect(controlled([{ ...security, id: "test", category: "test" }])).toBe("");
    expect(controlled([{ ...security, evidence: [{ kind: "diagnostic", message: "No detailed finding" }] }])).toBe("");
    expect(controlled([{ ...security, status: "blocked" }])).toBe("");
    expect(controlled([{ ...security, evidence: [{ kind: "security_finding",
      message: "lodash has a high-severity dependency vulnerability.", code: "high" }] }])).toBe("");
  });

  it("keeps original indexes when AI evidence is reordered", () => {
    const mixed: PublicCheckResult = { ...security, evidence: [
      { kind: "diagnostic", message: "General context" },
      { kind: "security_finding", message: "lodash has a high-severity dependency vulnerability.", code: "high", advisoryIds: ["123"] },
      { kind: "security_finding", message: "react has a high-severity dependency vulnerability.", code: "high", advisoryIds: ["456"], file: "package.json", line: 3 },
    ] };
    const sent = createRemediationCheckInputs([mixed])[0].evidence;
    expect(sent[0].originalIndex).toBe(2);
    expect(sent.map((item) => item.originalIndex)).toEqual([2, 1, 0]);
    expect(getControlledRemediationCandidates([mixed])[0]).toMatchObject({ evidenceIndexes: [1], packageName: "lodash" });
    const accepted = verifyRemediationAnalysis([mixed], { summary: "", actions: [{ title: "Fix", explanation: "", recommendation: "",
      priority: "high", checkId: "security", evidenceIndexes: [2] }] });
    expect(accepted.acceptedActions).toHaveLength(1);
  });

  it("rejects AI citations to evidence omitted by compaction", () => {
    const evidence = Array.from({ length: 15 }, (_, index) => ({ kind: "security_finding" as const,
      message: `package-${index} has a high-severity dependency vulnerability.`, code: "high" }));
    const check = { ...security, evidence };
    const sent = createRemediationCheckInputs([check])[0].evidence;
    expect(sent).toHaveLength(10);
    const result = verifyRemediationAnalysis([check], { summary: "", actions: [{ title: "Fix", explanation: "", recommendation: "",
      priority: "high", checkId: "security", evidenceIndexes: [14] }] });
    expect(result.acceptedActions).toHaveLength(0);
  });
});

describe("delivery state binding", () => {
  const saved = JSON.stringify({ artifactId: "artifact123", deliveryId: "delivery123",
    repositoryIdentity: "owner/repo", sourceCommitSha: sha, deliveryEligible: true });

  it("rejects saved workflow from another repository or source commit", () => {
    expect(restoreWorkflowForSource(saved, "other/repo", sha)).toEqual({});
    expect(restoreWorkflowForSource(saved, "owner/repo", "b".repeat(40))).toEqual({});
    expect(restoreWorkflowForSource(saved, "owner/repo", sha)).toEqual({
      artifactId: "artifact123", deliveryId: "delivery123", repositoryIdentity: "owner/repo", sourceCommitSha: sha,
    });
  });

  it("keeps branch delivery disabled without a current verified artifact", () => {
    const html = renderToStaticMarkup(<RemediationDelivery developer={{ login: "dev" }} generated={false}
      repositoryIdentity="owner/repo" sourceCommitSha={sha} />);
    expect(html).toContain("no verified artifact available for this assessment");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirm branch delivery<\/button>/);
  });

  it("accepts only proven artifacts from the current assessment source", () => {
    const assessment = { repositoryIdentity: "owner/repo", sourceCommitSha: sha };
    const outcome = { repositoryIdentity: "owner/repo", sourceCommitSha: sha,
      proofStatus: "proven", artifactId: "artifact123", deliveryEligible: true };
    expect(currentAssessmentArtifact(assessment, outcome)).toEqual({ artifactId: "artifact123", deliveryEligible: true });
    expect(currentAssessmentArtifact(assessment, { ...outcome, repositoryIdentity: "other/repo" })).toBeNull();
    expect(currentAssessmentArtifact(assessment, { ...outcome, sourceCommitSha: "b".repeat(40) })).toBeNull();
    expect(currentAssessmentArtifact(assessment, { ...outcome, proofStatus: "not_proven" })).toBeNull();
  });

  it("passes current source identity with a proven artifact", () => {
    const html = renderToStaticMarkup(<RemediationDelivery developer={{ login: "dev" }} generated
      artifactId="artifact123" deliveryEligible repositoryIdentity="owner/repo" sourceCommitSha={sha} />);
    expect(html).toContain("verified and persisted for this assessment");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Confirm branch delivery<\/button>/);
  });
});
