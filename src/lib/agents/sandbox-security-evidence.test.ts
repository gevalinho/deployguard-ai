import { describe, expect, it } from "vitest";
import { parseNpmStyleAuditReport } from "./sandbox-security-agent";
const counts = (high: number) => ({ info: 0, low: 0, moderate: 0, high, critical: 0, total: high });

describe("npm audit evidence", () => {
  it("distinguishes a complete zero-vulnerability report from missing output", () => {
    expect(parseNpmStyleAuditReport(JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: counts(0) } })))
      .toEqual([]);
    expect(parseNpmStyleAuditReport("")).toBeNull();
    expect(parseNpmStyleAuditReport("{}")) .toBeNull();
    expect(parseNpmStyleAuditReport('{"vulnerabilities":{')).toBeNull();
  });

  it("rejects counts inconsistent with findings and retains advisory identifiers", () => {
    const finding = { name: "target", severity: "high", via: [{ source: 12345 }] };
    expect(parseNpmStyleAuditReport(JSON.stringify({ vulnerabilities: { target: finding },
      metadata: { vulnerabilities: counts(0) } }))).toBeNull();
    expect(parseNpmStyleAuditReport(JSON.stringify({ vulnerabilities: { target: finding },
      metadata: { vulnerabilities: counts(1) } })))
      .toEqual([{ packageName: "target", severity: "high", advisoryIds: ["12345"] }]);
  });
});
