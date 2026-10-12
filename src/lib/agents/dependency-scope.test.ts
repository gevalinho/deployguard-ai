import { describe, expect, it } from "vitest";

import {
  classifyDependencyFindings,
  type DependencyAuditFinding,
} from "./dependency-scope";

const finding = (
  packageName: string,
  advisoryIds: string[] = ["123"],
): DependencyAuditFinding => ({
  packageName,
  severity: "high",
  advisoryIds,
});

describe("dependency security scope classification", () => {
  it("classifies findings absent from a verified production audit as development-only", () => {
    const result = classifyDependencyFindings(
      [finding("braces"), finding("micromatch")],
      [],
    );

    expect(result.map((item) => item.dependencyScope)).toEqual([
      "development",
      "development",
    ]);
  });

  it("classifies a finding present in both audits as production-exposed", () => {
    const result = classifyDependencyFindings(
      [finding("lodash")],
      [finding("lodash")],
    );

    expect(result[0].dependencyScope).toBe("production");
  });

  it("preserves advisory identities and severity", () => {
    const result = classifyDependencyFindings(
      [finding("braces", ["1240992"])],
      [],
    );

    expect(result[0]).toMatchObject({
      packageName: "braces",
      severity: "high",
      advisoryIds: ["1240992"],
      dependencyScope: "development",
    });
  });

  it("uses unknown when production audit evidence is unavailable", () => {
    const result = classifyDependencyFindings(
      [finding("braces")],
      null,
    );

    expect(result[0].dependencyScope).toBe("unknown");
  });

  it("does not label conflicting advisory identities as development-only", () => {
    const result = classifyDependencyFindings(
      [finding("shared-package", ["111"])],
      [finding("shared-package", ["222"])],
    );

    expect(result[0].dependencyScope).toBe("unknown");
  });

  it("does not invent findings absent from the full audit", () => {
    const result = classifyDependencyFindings(
      [finding("braces")],
      [finding("braces"), finding("other")],
    );

    expect(result).toHaveLength(1);
  });
});
