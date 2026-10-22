import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiAvailabilityNotice, AssessmentPipeline, FindingEvidence, ReadinessDashboard, ReadinessScoreCard, ReadinessVerdictCard, VerificationChecks, isCurrentRequest, repositoryIdentity, shouldInvalidateRepository } from "./readiness-dashboard";
import type { PublicCheckResult, PublicProductionReadinessReport } from "@/lib/reporting/types";
import { calculateReadinessScore } from "@/lib/scoring/readiness-score";
import { calculateReadinessVerdict } from "@/lib/scoring/readiness-verdict";

function reportFor(checks: PublicCheckResult[], includeVerdict = true): PublicProductionReadinessReport {
  const readiness = calculateReadinessScore(checks);
  return {
    generatedAt: "", repository: { path: "/repo", scannedAt: "", facts: [] },
    checks, readiness, remediation: [],
    ...(includeVerdict ? { readinessVerdict: calculateReadinessVerdict(checks, readiness) } : {}),
  };
}

describe("readiness score presentation", () => {
  it("qualifies 100/100 when only five percent of applicable weight was evaluated", () => {
    const readiness = calculateReadinessScore([
      { id: "database", category: "database", name: "Database", status: "passed", summary: "Passed" },
      { id: "build", category: "build", name: "Build", status: "blocked", summary: "Blocked" },
    ]);
    const html = renderToStaticMarkup(<ReadinessScoreCard readiness={readiness} />);

    expect(readiness.score).toBe(100);
    expect(readiness.coverage).toBe(5);
    expect(html).toContain("100<span");
    expect(html).toContain("Verified Performance");
    expect(html).not.toContain("Ready");
  });

  it("shows a fully evaluated assessment without an evidence warning", () => {
    const readiness = calculateReadinessScore([
      ...(["build", "types", "lint", "test", "security", "database", "deployment", "environment"] as const)
        .map((category) => ({ id: category, category, name: category, status: "passed" as const, summary: "Passed" })),
    ]);
    const html = renderToStaticMarkup(<ReadinessScoreCard readiness={readiness} />);

    expect(readiness.coverage).toBe(100);
    expect(html).toContain("100<span");
    expect(html).not.toContain("Insufficient evidence");
    expect(html).not.toContain("Production readiness not established");
  });
});

describe("server readiness verdict presentation", () => {
  const categories = ["build", "types", "lint", "test", "security", "database", "deployment", "environment"] as const;
  const passing = () => categories.map((category) => ({
    id: category, category, name: category, status: "passed" as const, summary: "Verified pass",
  }));

  it("shows Ready only for a completed server verdict and states its scope", () => {
    const html = renderToStaticMarkup(<ReadinessVerdictCard report={reportFor(passing())} />);
    expect(html).toContain(">Ready</h2>");
    expect(html).toContain("Pre-deployment readiness based on verified checks");
    expect(html).toContain("does not guarantee production behavior");
    expect(html).toContain("dependency audits cover declared dependencies");
  });

  it("shows confirmed failures as Not Ready even with blocked evidence", () => {
    const checks = passing().map((check) => check.category === "build"
      ? { ...check, status: "blocked" as const, summary: "Build blocked" }
      : check.category === "test"
        ? { ...check, status: "failed" as const, summary: "Tests failed" } : check);
    const html = renderToStaticMarkup(<ReadinessVerdictCard report={reportFor(checks)} />);
    expect(html).toContain(">Not Ready</h2>");
    expect(html).toContain("Tests failed");
    expect(html).not.toContain("Build blocked");
  });

  it("shows 100/100 at 5% coverage as Undetermined with safe reasons", () => {
    const report = reportFor([{ id: "database", category: "database", name: "Database",
      status: "passed", summary: "Verified pass" }]);
    expect(report.readiness).toMatchObject({ score: 100, coverage: 5 });
    const html = renderToStaticMarkup(<ReadinessVerdictCard report={report} />);
    expect(html).toContain(">Undetermined</h2>");
    expect(html).toContain("Required check evidence is missing.");
    expect(html).toContain("Affected categories:");
    expect(html).not.toContain(">Ready</h2>");
  });

  it("keeps legacy reports undetermined without inventing check results", () => {
    const report = reportFor(passing(), false);
    const html = renderToStaticMarkup(<ReadinessVerdictCard report={report} />);
    expect(report.readiness).toMatchObject({ score: 100, coverage: 100 });
    expect(html).toContain(">Undetermined</h2>");
    expect(html).toContain("older report has no server-calculated verdict");
    expect(html).not.toContain("Relevant check evidence");
  });

  it("does not render unknown server reason text", () => {
    const report = reportFor(passing());
    report.readinessVerdict = { version: 1, status: "undetermined",
      reasonCodes: ["<script>unsafe</script>" as never], affectedCategories: [] };
    const html = renderToStaticMarkup(<ReadinessVerdictCard report={report} />);
    expect(html).not.toContain("unsafe");
    expect(html).toContain("older report has no server-calculated verdict");
  });
});

describe("repository switching identity", () => {
  it("keeps assessment state for equivalent URL edits", () => {
    const identity = repositoryIdentity("https://github.com/Owner/Repo");
    expect(identity).toBe("owner/repo");
    expect(shouldInvalidateRepository(identity, " https://GITHUB.com/owner/repo.git ")).toBe(false);
    expect(shouldInvalidateRepository(identity, "https://github.com/owner/repo/")).toBe(false);
  });

  it("invalidates report, progress and repository configuration when the URL points elsewhere", () => {
    const identity = repositoryIdentity("https://github.com/owner/first");
    expect(shouldInvalidateRepository(identity, "https://github.com/owner/second")).toBe(true);
    expect(shouldInvalidateRepository(identity, "https://github.com/owner/other/branch")).toBe(true);
    expect(shouldInvalidateRepository(identity, "")).toBe(true);
  });

  it("rejects out-of-order assessment streams and stale scan responses", () => {
    expect(isCurrentRequest(1, 2, "owner/first", "owner/second", false)).toBe(false);
    expect(isCurrentRequest(1, 2, "owner/first", "owner/first", false)).toBe(false);
    expect(isCurrentRequest(2, 2, "owner/second", "owner/second", false)).toBe(true);
    expect(isCurrentRequest(2, 2, "owner/second", "owner/second", true)).toBe(false);
  });

  it("allows a repeat assessment while invalidating its earlier completion", () => {
    const identity = repositoryIdentity("https://github.com/owner/repo");
    expect(isCurrentRequest(3, 4, identity, identity, false)).toBe(false);
    expect(isCurrentRequest(4, 4, identity, identity, false)).toBe(true);
  });

  it("rejects an authorization return after the user switches repositories", () => {
    expect(isCurrentRequest(5, 6, "owner/first", "owner/second", false)).toBe(false);
  });
});

describe("repository assessment sign-in state", () => {
  it("offers the existing GitHub sign-in flow without an initial auth error", () => {
    const html = renderToStaticMarkup(<ReadinessDashboard developer={null} />);

    expect(html).toContain('href="/api/auth/github/start"');
    expect(html).toContain("Sign in with GitHub to assess private repositories");
    expect(html).not.toContain("Developer sign-in required.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Assess Repository<\/button>/);
  });

  it("keeps the assessment action available to a signed-in developer", () => {
    const html = renderToStaticMarkup(
      <ReadinessDashboard developer={{ login: "octocat" }} />,
    );

    expect(html).not.toContain('href="/api/auth/github/start"');
    expect(html).toContain(">Assess Repository</button>");
  });
});

describe("assessment pipeline applicability", () => {
  const cases: Array<{
    category: PublicCheckResult["category"];
    status: PublicCheckResult["status"];
    skipReason?: PublicCheckResult["skipReason"];
    label: string;
    visible: boolean;
  }> = [
    { category: "types", status: "skipped", skipReason: "not_applicable", label: "TypeScript", visible: false },
    { category: "lint", status: "skipped", skipReason: "not_configured", label: "Lint", visible: true },
    { category: "test", status: "skipped", skipReason: "not_configured", label: "Tests", visible: true },
    { category: "types", status: "passed", label: "TypeScript", visible: true },
    { category: "types", status: "failed", label: "TypeScript", visible: true },
  ];

  it.each(cases)("shows $label when $status / $skipReason: $visible", ({
    category, status, skipReason, label, visible,
  }) => {
    const check: PublicCheckResult = {
      id: category, category, name: label, status, skipReason, summary: `${label} result`,
    };
    const html = renderToStaticMarkup(
      <AssessmentPipeline
        loading={false}
        progressByStage={new Map([[category, {
          stage: category, label, status, message: `${label} result`,
        }]])}
        checks={[check]}
      />,
    );

    expect(html.includes(`>${label}</p>`)).toBe(visible);
  });
});

describe("AI availability presentation", () => {
  it("shows a completed deterministic report when AI enrichment is unavailable", () => {
    const html = renderToStaticMarkup(<AiAvailabilityNotice availability={{
      architecture: "unavailable", remediation: "unavailable",
    }} />);
    expect(html).toContain("AI guidance was unavailable for architecture analysis and remediation");
    expect(html).toContain("readiness score, and deterministic remediation plan are complete");
    expect(html).toContain('role="status"');
  });
});


describe("security dependency exposure presentation", () => {
  const scopes = [
    ["production", "Production dependency"],
    ["development", "Development dependency"],
    ["both", "Production and development"],
    ["unknown", "Exposure unknown"],
  ] as const;

  it.each(scopes)("renders %s exposure in both evidence views", (scope, label) => {
    const evidence = [{
      kind: "security_finding" as const,
      message: "example-package has a high-severity dependency vulnerability.",
      code: "high",
      dependencyScope: scope,
    }];

    const compact = renderToStaticMarkup(
      <FindingEvidence evidence={evidence} />,
    );

    const detailed = renderToStaticMarkup(
      <VerificationChecks checks={[{
        id: "security",
        category: "security",
        name: "Security",
        status: "failed",
        summary: "High-severity vulnerabilities detected.",
        evidence,
      }]} />,
    );

    expect(compact).toContain(`Exposure: ${label}`);
    expect(detailed).toContain(label);
  });

  it("does not label unrelated evidence as dependency exposure", () => {
    const html = renderToStaticMarkup(
      <FindingEvidence evidence={[{
        kind: "warning",
        message: "Example warning.",
        dependencyScope: "production",
      }]} />,
    );

    expect(html).not.toContain("Production dependency");
    expect(html).not.toContain("Exposure:");
  });
});

describe("report accessibility", () => {
  it("keeps failed status and summary visible while evidence is a native disclosure", () => {
    const html = renderToStaticMarkup(<VerificationChecks checks={[{
      id: "build", category: "build", name: "Build", status: "failed",
      summary: "Build failed", evidence: [{ kind: "error", message: "Long diagnostic" }],
    }]} />);
    expect(html).toContain('id="verification-checks"');
    expect(html).toContain("Build failed");
    expect(html).toContain("Verified check failed.");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>[\s\S]*Captured evidence/);
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain("focus-visible:outline-2");
  });

  it("makes compact finding evidence collapsible with a keyboard target", () => {
    const html = renderToStaticMarkup(<FindingEvidence evidence={[{
      kind: "security_finding", message: "Affected package", file: "very/long/path",
    }]} />);
    expect(html).toContain("View evidence (1)");
    expect(html).toContain("min-h-11");
    expect(html).toContain("Affected package");
  });
});
