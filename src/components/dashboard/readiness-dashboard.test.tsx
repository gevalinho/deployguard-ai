import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssessmentPipeline, ReadinessDashboard } from "./readiness-dashboard";
import type { PublicCheckResult } from "@/lib/reporting/types";

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
