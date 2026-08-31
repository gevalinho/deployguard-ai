import fs from "node:fs";
import path from "node:path";

import type { CheckResult } from "@/lib/checks/types";
import { runCommand } from "@/lib/execution/command-runner";
import type { RepositoryScanResult } from "@/lib/scanner/types";

function getFact(
  scan: RepositoryScanResult,
  key: string
): string | null {
  return (
    scan.facts.find((fact) => fact.key === key)?.value ?? null
  );
}

export async function runDatabaseAgent(
  scan: RepositoryScanResult
): Promise<CheckResult> {
  const orm = getFact(scan, "orm");

  if (!orm) {
    return {
      id: "database-readiness",
      category: "database",
      name: "Database Readiness",
      status: "skipped",
      skipReason: "not_applicable",
      summary:
        "No verified database or ORM configuration was detected.",
    };
  }

  if (orm !== "Prisma") {
    return {
      id: "database-readiness",
      category: "database",
      name: "Database Readiness",
      status: "skipped",
      skipReason: "unsupported",
      summary:
        `Database validation is not yet implemented for ORM: ${orm}.`,
    };
  }

  const schemaPath = path.join(
    scan.repositoryPath,
    "prisma",
    "schema.prisma"
  );

  if (!fs.existsSync(schemaPath)) {
    return {
      id: "database-readiness",
      category: "database",
      name: "Database Readiness",
      status: "failed",
      summary:
        "Prisma was detected, but prisma/schema.prisma is missing.",
    };
  }

  const result = await runCommand(
    "npx",
    ["prisma", "validate"],
    scan.repositoryPath
  );

  return {
    id: "database-readiness",
    category: "database",
    name: "Database Readiness",
    status: result.status,

    command: "npx prisma validate",
    exitCode: result.exitCode,
    durationMs: result.durationMs,

    summary:
      result.status === "passed"
        ? "Prisma schema validation completed successfully."
        : "Prisma schema validation failed.",

    stdout: result.stdout,
    stderr: result.stderr,
  };
}