import { describe, expect, it } from "vitest";
import { inspectNpmStyleAuditReport, parseNpmStyleAuditReport } from "./sandbox-security-agent";

const direct = (name: string, source: number, effects: string[] = []) => ({
  name, severity: "high", isDirect: true,
  via: [{ name, severity: "high", source }], effects,
  range: "<2", nodes: [`node_modules/${name}`], fixAvailable: true,
});
const dependent = (name: string, via: string[]) => ({
  name, severity: "high", isDirect: false, via, effects: [],
  range: "<2", nodes: [`node_modules/${name}`], fixAvailable: true,
});
function report(vulnerabilities: Record<string, unknown>) {
  const values = Object.values(vulnerabilities) as Array<{ severity?: string }>;
  return JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: {
    info: 0, low: 0, moderate: 0,
    high: values.filter((item) => item.severity === "high").length,
    critical: 0, total: values.length,
  } } });
}

describe("npm audit v2 evidence", () => {
  it("classifies safe diagnostic failure reasons without changing parse results", () => {
    const reason = (stdout: string | undefined) => inspectNpmStyleAuditReport(stdout).diagnostic.reason;
    expect(reason(undefined)).toBe("missing_stdout");
    expect(reason("  ")).toBe("empty_stdout");
    expect(reason("{invalid")).toBe("invalid_json");
    expect(reason(JSON.stringify({ auditReportVersion: 1 }))).toBe("unsupported_report_version");
    expect(reason("{}")).toBe("missing_required_top_level_fields");
    expect(reason(JSON.stringify({ auditReportVersion: 2 }))).toBe("missing_required_top_level_fields");
    expect(reason(report({ braces: { ...direct("braces", 1), nodes: [] } })))
      .toBe("invalid_vulnerability_records");
    const badCounts = JSON.parse(report({ braces: direct("braces", 1) }));
    badCounts.metadata.vulnerabilities.total = 0;
    expect(reason(JSON.stringify(badCounts))).toBe("invalid_metadata_counts");
    expect(reason(report({ braces: direct("braces", 1), other: direct("other", 1) })))
      .toBe("inconsistent_advisory_identifiers");
    expect(reason(report({ braces: direct("braces", 1), parent: dependent("parent", ["braces"]) })))
      .toBe("inconsistent_vulnerability_relationships");
  });
  it("reports only validated counts and structural field types", () => {
    const result = inspectNpmStyleAuditReport(report({ braces: direct("braces", 1) }));
    expect(result.diagnostic).toEqual({ reason: null, stdoutBytes: Buffer.byteLength(report({ braces: direct("braces", 1) })),
      jsonParsed: true, auditReportVersion: 2,
      fields: { vulnerabilities: "object", metadata: "object", metadataVulnerabilities: "object" },
      counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } });
    const invalid = inspectNpmStyleAuditReport(JSON.stringify({ auditReportVersion: 2,
      vulnerabilities: {}, metadata: { vulnerabilities: { high: "secret" } } }));
    expect(invalid.diagnostic.counts).toBeUndefined();
  });
  it("distinguishes a complete zero-vulnerability report from missing output", () => {
    expect(parseNpmStyleAuditReport(report({}))).toEqual([]);
    expect(parseNpmStyleAuditReport("")).toBeNull();
    expect(parseNpmStyleAuditReport("{}")).toBeNull();
    expect(parseNpmStyleAuditReport('{"vulnerabilities":{')).toBeNull();
  });
  it("retains numeric advisory identities and rejects inconsistent metadata counts", () => {
    const valid = report({ braces: direct("braces", 12345) });
    expect(parseNpmStyleAuditReport(valid))
      .toEqual([{ packageName: "braces", severity: "high", advisoryIds: ["12345"] }]);
    const invalid = JSON.parse(valid);
    invalid.metadata.vulnerabilities.total = 0;
    expect(parseNpmStyleAuditReport(JSON.stringify(invalid))).toBeNull();
    expect(parseNpmStyleAuditReport(report({ braces: { ...direct("braces", 12345),
      via: [...direct("braces", 12345).via, { name: "braces", severity: "high", source: 67890 }] } })))
      .toEqual([{ packageName: "braces", severity: "high", advisoryIds: ["12345", "67890"] }]);
  });
  it("accepts a valid transitive relationship and mixed direct/string via entries", () => {
    const braces = direct("braces", 123, ["parent"]);
    expect(parseNpmStyleAuditReport(report({ braces, parent: dependent("parent", ["braces"]) }))).toEqual([
      { packageName: "braces", severity: "high", advisoryIds: ["123"] },
      { packageName: "parent", severity: "high" },
    ]);
    const parent = { ...dependent("parent", ["braces"]), via: ["braces", { name: "parent",
      severity: "high", source: 456 }] };
    expect(parseNpmStyleAuditReport(report({ braces, parent }))).toEqual([
      { packageName: "braces", severity: "high", advisoryIds: ["123"] },
      { packageName: "parent", severity: "high", advisoryIds: ["456"] },
    ]);
  });
  it("rejects missing and inconsistent string via relationships", () => {
    expect(parseNpmStyleAuditReport(report({ parent: dependent("parent", ["missing"]) }))).toBeNull();
    expect(parseNpmStyleAuditReport(report({ braces: direct("braces", 123),
      parent: dependent("parent", ["braces"]) }))).toBeNull();
    expect(parseNpmStyleAuditReport(report({ braces: direct("braces", 123, ["parent"]),
      parent: dependent("parent", ["other"]) }))).toBeNull();
    expect(parseNpmStyleAuditReport(report({ braces: direct("braces", 123, ["parent"]),
      parent: { ...dependent("parent", ["braces"]), severity: "low" } }))).toBeNull();
  });
  it("rejects malformed or incomplete vulnerability records", () => {
    expect(parseNpmStyleAuditReport(report({ braces: { name: "braces", severity: "high",
      via: [{ source: 123 }] } }))).toBeNull();
    expect(parseNpmStyleAuditReport(report({ braces: { ...direct("braces", 123), nodes: [] } }))).toBeNull();
    expect(parseNpmStyleAuditReport(report({ braces: { ...direct("braces", 123), name: "other" } }))).toBeNull();
    expect(parseNpmStyleAuditReport(report({ braces: { ...direct("braces", 123), via: [{}] } }))).toBeNull();
  });
  it("rejects ambiguous advisory IDs and cycles", () => {
    expect(parseNpmStyleAuditReport(report({ braces: direct("braces", 123),
      other: direct("other", 123) }))).toBeNull();
    expect(parseNpmStyleAuditReport(report({
      braces: { ...direct("braces", 123, ["parent"]), via: ["parent", ...direct("braces", 123).via] },
      parent: dependent("parent", ["braces"]),
    }))).toBeNull();
  });
});
