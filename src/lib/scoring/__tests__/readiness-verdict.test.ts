import { describe, expect, it } from "vitest";
import type { CheckCategory, CheckResult } from "@/lib/checks/types";
import { createProductionReadinessReport } from "@/lib/reporting/readiness-report";
import { calculateReadinessScore } from "../readiness-score";
import { calculateReadinessVerdict, resolveReadinessVerdict } from "../readiness-verdict";

const categories: CheckCategory[] = [
  "build", "types", "lint", "test", "security", "database", "deployment", "environment",
];
const check = (category: CheckCategory, status: CheckResult["status"],
  skipReason?: CheckResult["skipReason"]): CheckResult => ({
  id: category, category, name: category, status, skipReason, summary: status,
});
const verdict = (checks: CheckResult[]) =>
  calculateReadinessVerdict(checks, calculateReadinessScore(checks));
const allPassing = () => categories.map((category) => check(category, "passed"));

describe("readiness verdict v1", () => {
  it("keeps 100/100 evaluated performance at 5% coverage undetermined", () => {
    const checks = [check("database", "passed")];
    const score = calculateReadinessScore(checks);
    expect(score).toMatchObject({ score: 100, coverage: 5 });
    expect(verdict(checks)).toMatchObject({
      version: 1, status: "undetermined",
      reasonCodes: expect.arrayContaining(["required_evidence_missing", "applicability_unknown"]),
    });
  });

  it("is ready only when all applicable categories have passing evidence", () => {
    expect(verdict(allPassing())).toEqual({
      version: 1, status: "ready", reasonCodes: ["all_applicable_checks_passed"],
      affectedCategories: [],
    });
  });

  it("makes a confirmed failure not ready even when other evidence is missing", () => {
    const result = verdict([check("build", "failed")]);
    expect(result.status).toBe("not_ready");
    expect(result.reasonCodes).toContain("confirmed_check_failure");
    expect(result.affectedCategories).toContain("build");
  });

  it("treats an unconfigured required check as a confirmed readiness gap", () => {
    const checks = allPassing().map((item) => item.category === "build"
      ? { ...check("build", "skipped", "not_configured"), requiredForReadiness: true } : item);
    expect(verdict(checks)).toMatchObject({
      status: "not_ready", reasonCodes: ["required_check_not_configured"],
    });
  });

  it("keeps unproven missing lint, test, deployment, and audit configuration undetermined", () => {
    for (const category of ["lint", "test", "deployment", "security"] as const) {
      const checks = allPassing().map((item) => item.category === category
        ? check(category, "skipped", "not_configured") : item);
      expect(verdict(checks)).toMatchObject({ status: "undetermined",
        affectedCategories: [category] });
    }
  });

  it("does not conceal a confirmed failure behind blocked evidence", () => {
    const checks = allPassing().map((item) => item.category === "build"
      ? check("build", "blocked") : item.category === "test"
        ? check("test", "failed") : item);
    expect(verdict(checks)).toMatchObject({ status: "not_ready",
      reasonCodes: ["confirmed_check_failure"], affectedCategories: ["test"] });
  });

  it("does not turn blocked build or security evidence into a failure or ready result", () => {
    for (const category of ["build", "security"] as const) {
      const checks = allPassing().map((item) => item.category === category
        ? check(category, "blocked") : item);
      const result = verdict(checks);
      expect(result.status).toBe("undetermined");
      expect(result.reasonCodes).toContain("required_evidence_blocked");
      expect(result.affectedCategories).toContain(category);
    }
  });

  it("keeps a category undetermined when a passing check coexists with an error", () => {
    const checks = [...allPassing(), { ...check("build", "error"), id: "build-secondary" }];
    expect(verdict(checks)).toMatchObject({
      status: "undetermined", reasonCodes: ["required_evidence_error"],
    });
  });

  it("keeps zero evaluated weight undetermined", () => {
    const result = verdict([check("build", "blocked")]);
    expect(result.status).toBe("undetermined");
    expect(result.reasonCodes).toContain("zero_evaluated_weight");
  });

  it("excludes only explicitly non-applicable categories", () => {
    const checks = allPassing().map((item) =>
      item.category === "database" || item.category === "types"
        ? check(item.category, "skipped", "not_applicable") : item);
    expect(calculateReadinessScore(checks)).toMatchObject({ score: 100, coverage: 100 });
    expect(verdict(checks).status).toBe("ready");
  });

  it("does not infer non-applicability from missing or unsupported checks", () => {
    const missing = allPassing().filter((item) => item.category !== "database");
    expect(verdict(missing)).toMatchObject({ status: "undetermined",
      affectedCategories: ["database"] });
    const unsupported = [...missing, check("database", "skipped", "unsupported")];
    expect(verdict(unsupported)).toMatchObject({ status: "undetermined",
      reasonCodes: ["required_evidence_unsupported"] });
    expect(verdict([...missing, check("database", "skipped")]).reasonCodes)
      .toContain("applicability_unknown");
  });

  it("does not turn uncertain preparation errors into confirmed repository defects", () => {
    expect(verdict([check("build", "error")]).status).toBe("undetermined");
  });

  it("includes a versioned verdict in completed reports independent of AI analysis", () => {
    const checks = [check("database", "passed")];
    const scan = { repositoryPath: "/repo", scannedAt: "", facts: [] };
    const report = createProductionReadinessReport(scan, checks, calculateReadinessScore(checks));
    expect(report.readiness).toMatchObject({ score: 100, coverage: 5 });
    expect(report.readinessVerdict).toMatchObject({ version: 1, status: "undetermined" });
  });

  it("resolves a legacy or unrecognized verdict to undetermined", () => {
    expect(resolveReadinessVerdict({})).toEqual({
      version: 1, status: "undetermined",
      reasonCodes: ["legacy_report_missing_verdict"], affectedCategories: [],
    });
    expect(resolveReadinessVerdict({ readinessVerdict: { version: 2, status: "ready",
      reasonCodes: [], affectedCategories: [] } as never }).status).toBe("undetermined");
    expect(resolveReadinessVerdict({ readinessVerdict: { version: 1, status: "ready",
      reasonCodes: ["unknown_reason"], affectedCategories: [] } as never }).status).toBe("undetermined");
  });
});
