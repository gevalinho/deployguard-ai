import type {
  RepositoryFact,
} from "@/lib/evidence/types";

export type EnvironmentUsagePhase =
  | "build"
  | "test"
  | "runtime"
  | "unknown";

export interface EnvironmentUsageClassification {
  variable: string;

  phase: EnvironmentUsagePhase;

  confidence: number;

  reason: string;

  evidence: RepositoryFact["evidence"];
}

function classifyEvidencePath(
  evidencePath: string
): EnvironmentUsagePhase {
  /*
   * Explicit test locations are strong evidence that
   * configuration participates in test execution.
   */
  if (
    /(^|\/)(__tests__|tests?|test)(\/|$)/i.test(
      evidencePath
    ) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(
      evidencePath
    )
  ) {
    return "test";
  }

  /*
   * Framework and bundler configuration files execute
   * as part of application preparation or production
   * build configuration.
   *
   * Treat these as strong build-phase evidence rather
   * than inferring build requirements from arbitrary
   * source locations.
   */
  if (
    /(^|\/)(next|vite|webpack|rollup)\.config\.[cm]?[jt]s$/i.test(
      evidencePath
    )
  ) {
    return "build";
  }

  /*
   * Next.js route handlers are invoked in response to
   * application requests. They are therefore runtime
   * evidence rather than build-time evidence.
   */
  if (
    /(^|\/)src\/app\/api\/.+\/route\.[cm]?[jt]s$/i.test(
      evidencePath
    )
  ) {
    return "runtime";
  }

  /*
   * These application layers are executed by runtime
   * workflows in DeployGuard. Their presence alone does
   * not establish that the environment variable is
   * required during compilation or static generation.
   */
  if (
    /(^|\/)src\/lib\/(agents|ai|auth|remediation|research)\//i.test(
      evidencePath
    )
  ) {
    return "runtime";
  }

  /*
   * Do not guess when repository evidence cannot
   * establish an execution phase.
   */
  return "unknown";
}

export function classifyEnvironmentUsage(
  facts: RepositoryFact[]
): EnvironmentUsageClassification[] {
  const environmentFacts =
    facts.filter(
      (fact) =>
        fact.key ===
        "environmentVariable"
    );

  return environmentFacts.map(
    (fact) => {
      const phases =
        new Set(
          fact.evidence.map(
            (evidence) =>
              classifyEvidencePath(
                evidence.path
              )
          )
        );

      phases.delete("unknown");

      /*
       * Conflicting positive evidence means the variable
       * participates in more than one execution phase.
       * Until DeployGuard models multi-phase requirements,
       * preserve uncertainty rather than selecting one.
       */
      const phase =
        phases.size === 1
          ? [...phases][0]
          : "unknown";

      const confidence =
        phase === "unknown"
          ? 0.5
          : 0.9;

      const reason =
        phase === "unknown"
          ? "Repository evidence does not establish one unambiguous execution phase."
          : `Repository evidence indicates ${phase}-phase usage.`;

      return {
        variable: fact.value,
        phase,
        confidence,
        reason,
        evidence: fact.evidence,
      };
    }
  );
}
