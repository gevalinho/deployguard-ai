import type { CheckResult } from "@/lib/checks/types";
import type { RepositoryScanResult } from "@/lib/scanner/types";

/** Positive scanner facts establish a database integration, not its readiness. */
export function createDatabaseEvidenceCheck(scan: RepositoryScanResult): CheckResult {
  const databaseFacts = scan.facts.filter((fact) =>
    ["database", "orm", "databaseDriver", "backendService"].includes(fact.key));

  if (databaseFacts.length > 0) {
    return {
      id: "database-readiness",
      category: "database",
      name: "Database Readiness",
      status: "skipped",
      skipReason: "unsupported",
      summary: "A database or backend integration was detected, but database validation was not performed in this assessment.",
    };
  }

  return {
    id: "database-readiness",
    category: "database",
    name: "Database Readiness",
    status: "skipped",
    summary: "Database applicability could not be established from the available repository facts.",
  };
}
