export type DependencyAuditSeverity =
  | "info"
  | "low"
  | "moderate"
  | "high"
  | "critical";

export interface DependencyAuditFinding {
  packageName: string;
  severity: DependencyAuditSeverity;
  advisoryIds?: string[];
}

export type DependencyScope =
  | "production"
  | "development"
  | "both"
  | "unknown";

export type ScopedDependencyFinding =
  DependencyAuditFinding & {
    dependencyScope: DependencyScope;
  };

/**
 * Classify findings using a full dependency audit and an independently
 * verified production-only audit.
 *
 * A null production report means classification cannot be established.
 *
 * "production" means production-exposed, not necessarily production-only.
 * "development" means absent from a successfully verified production audit.
 */
export function classifyDependencyFindings(
  fullFindings: DependencyAuditFinding[],
  productionFindings: DependencyAuditFinding[] | null,
): ScopedDependencyFinding[] {
  return fullFindings.map((finding) => {
    if (productionFindings === null) {
      return {
        ...finding,
        dependencyScope: "unknown",
      };
    }

    const productionExposed = productionFindings.some((candidate) => {
      if (candidate.packageName !== finding.packageName) {
        return false;
      }

      const fullIds = finding.advisoryIds ?? [];
      const productionIds = candidate.advisoryIds ?? [];

      if (fullIds.length > 0 && productionIds.length > 0) {
        return fullIds.some((id) => productionIds.includes(id));
      }

      return candidate.severity === finding.severity;
    });

    const hasConflictingProductionEvidence =
      !productionExposed &&
      productionFindings.some(
        (candidate) => candidate.packageName === finding.packageName,
      );

    return {
      ...finding,
      dependencyScope: productionExposed
        ? "production"
        : hasConflictingProductionEvidence
          ? "unknown"
          : "development",
    };
  });
}
