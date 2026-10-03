import type {
  RepositoryFact,
} from "@/lib/evidence/types";

import {
  classifyEnvironmentUsage,
} from "@/lib/scanner/environment-usage-classifier";

import type {
  EnvironmentUsagePhase,
} from "@/lib/scanner/environment-usage-classifier";

import {
  classifyEnvironmentSensitivity,
} from "@/lib/scanner/environment-sensitivity-classifier";

import type {
  EnvironmentSensitivity,
} from "@/lib/scanner/environment-sensitivity-classifier";

export type PreparationRequirementKind =
  | "dependency_install"
  | "artifact_generation"
  | "environment"
  | "external_service";

export interface PreparationRequirement {
  kind: PreparationRequirementKind;

  technology: string;

  required: boolean;

  reason: string;

  evidence: RepositoryFact[];

  phase?: EnvironmentUsagePhase;

  sensitivity?: EnvironmentSensitivity;

  confidence?: number;
}

export interface PreparationPlan {
  requirements: PreparationRequirement[];
}

function findFacts(
  facts: RepositoryFact[],
  key: string,
  value?: string
): RepositoryFact[] {
  return facts.filter(
    (fact) =>
      fact.key === key &&
      (
        value === undefined ||
        fact.value === value
      )
  );
}

export function createPreparationPlan(
  facts: RepositoryFact[]
): PreparationPlan {
  const requirements: PreparationRequirement[] = [];

  /*
   * Every supported Node repository needs its declared
   * dependencies prepared before verification.
   */
  requirements.push({
    kind: "dependency_install",
    technology: "Node.js",
    required: true,
    reason:
      "Repository dependencies must be installed before sandbox verification.",
    evidence: [],
  });

  /*
   * Prisma requires generated client artifacts before
   * TypeScript and production-build verification can
   * reliably execute.
   */
  const prismaFacts =
    findFacts(
      facts,
      "orm",
      "Prisma"
    );

  if (prismaFacts.length > 0) {
    requirements.push({
      kind: "artifact_generation",
      technology: "Prisma",
      required: true,
      reason:
        "Prisma client artifacts must be generated before sandbox verification.",
      evidence: prismaFacts,
    });
  }

  /*
   * Environment-variable references are configuration
   * requirements discovered from source code.
   *
   * DeployGuard records the requirement but never
   * invents, reads, or injects secret values merely
   * because a variable is referenced.
   *
   * Whether a variable is required specifically during
   * build, test, or runtime can be classified separately.
   */
  const environmentClassifications =
    classifyEnvironmentUsage(
      facts
    );

  const environmentFacts =
    findFacts(
      facts,
      "environmentVariable"
    );

  const environmentSensitivityClassifications =
    classifyEnvironmentSensitivity(
      facts
    );

  for (
    const classification of
    environmentClassifications
  ) {
    const fact =
      environmentFacts.find(
        (candidate) =>
          candidate.value ===
          classification.variable
      );

    if (!fact) {
      continue;
    }

    /*
     * A variable is preparation-blocking only when
     * repository evidence establishes that it is needed
     * during the build phase.
     *
     * Runtime, test, and unknown requirements are
     * reported without inventing or injecting values.
     */
    const required =
      classification.phase ===
      "build";

    const sensitivity =
      environmentSensitivityClassifications.find(
        (candidate) =>
          candidate.variable ===
          classification.variable
      );

    requirements.push({
      kind: "environment",
      technology:
        classification.variable,
      required,
      phase:
        classification.phase,
      sensitivity:
        sensitivity?.sensitivity ??
        "unknown",
      confidence:
        Math.min(
          classification.confidence,
          sensitivity?.confidence ?? 0.5
        ),
      reason:
        required
          ? `${classification.variable} is classified as a build-phase environment requirement. DeployGuard requires an explicit value before build verification can rely on it.`
          : `${classification.variable} is classified as ${classification.phase}-phase configuration and will not block sandbox preparation.`,
      evidence: [fact],
    });
  }

  /*
   * Databases, caches, and hosted backend integrations
   * are discovered here but are not automatically
   * provisioned.
   *
   * Their presence does not prove that compilation or
   * static verification requires a live service.
   */
  const infrastructureKeys = new Set([
    "database",
    "databaseDriver",
    "backendService",
    "cache",
  ]);

  const infrastructureFacts =
    facts.filter((fact) =>
      infrastructureKeys.has(
        fact.key
      )
    );

  const infrastructureByTechnology =
    new Map<
      string,
      RepositoryFact[]
    >();

  for (const fact of infrastructureFacts) {
    const existing =
      infrastructureByTechnology.get(
        fact.value
      ) ?? [];

    existing.push(fact);

    infrastructureByTechnology.set(
      fact.value,
      existing
    );
  }

  for (
    const [
      technology,
      evidence,
    ] of infrastructureByTechnology
  ) {
    requirements.push({
      kind: "external_service",
      technology,
      required: false,
      reason:
        `${technology} infrastructure was detected, but DeployGuard will not automatically provision or connect to external services during preparation.`,
      evidence,
    });
  }

  return {
    requirements,
  };
}
