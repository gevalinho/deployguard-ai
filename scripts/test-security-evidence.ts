import assert from "node:assert/strict";

import {
  createSecurityEvidence,
  extractNpmStyleFindings,
} from "@/lib/agents/sandbox-security-agent";

function main(): void {
  console.log(
    "Testing structured security evidence..."
  );

  const npmAuditJson =
    JSON.stringify({
      auditReportVersion: 2,

      vulnerabilities: {
        "alpha-package": {
          name: "alpha-package",
          severity: "critical",
        },

        "beta-package": {
          name: "beta-package",
          severity: "high",
        },

        "gamma-package": {
          name: "gamma-package",
          severity: "moderate",
        },
      },
    });

  const findings =
    extractNpmStyleFindings(
      npmAuditJson
    );

  assert.equal(
    findings.length,
    3,
    "All supported audit severities should be parsed"
  );

  assert.deepEqual(
    findings[0],
    {
      packageName:
        "alpha-package",
      severity:
        "critical",
    }
  );

  const evidence =
    createSecurityEvidence(
      findings
    );

  assert.equal(
    evidence.length,
    2,
    "Only high and critical findings should become high-risk evidence"
  );

  assert.deepEqual(
    evidence[0],
    {
      kind:
        "security_finding",
      message:
        "alpha-package has a critical-severity dependency vulnerability.",
      code:
        "critical",
    }
  );

  assert.deepEqual(
    evidence[1],
    {
      kind:
        "security_finding",
      message:
        "beta-package has a high-severity dependency vulnerability.",
      code:
        "high",
    }
  );

  assert.equal(
    evidence.some(
      (item) =>
        item.message.includes(
          "gamma-package"
        )
    ),
    false,
    "Moderate findings must not enter the high-risk evidence set"
  );

  const duplicateEvidence =
    createSecurityEvidence([
      ...findings,

      {
        packageName:
          "alpha-package",
        severity:
          "critical",
      },
    ]);

  assert.equal(
    duplicateEvidence.length,
    2,
    "Duplicate package/severity findings should be removed"
  );

  console.log(
    "✓ npm audit JSON parsed"
  );

  console.log(
    "✓ Critical finding normalized"
  );

  console.log(
    "✓ High finding normalized"
  );

  console.log(
    "✓ Lower severity excluded"
  );

  console.log(
    "✓ Duplicate finding removed"
  );

  console.log(
    "✓ Audit JSON → structured security evidence passed"
  );
}

main();