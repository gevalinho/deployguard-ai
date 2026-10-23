import type {
  RepositoryFact,
} from "@/lib/evidence/types";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import ts from "typescript";

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

const NEXT_AUTH_BUILD_PATHS = [
  "app/api/auth/[...nextauth]/route.ts",
  "app/auth.ts",
  "app/db.ts",
] as const;

function readRepositorySource(root: string, path: string): ts.SourceFile | null {
  try {
    const candidate = join(root, path);
    const resolvedRoot = realpathSync(root);
    const resolvedFile = realpathSync(candidate);
    const withinRoot = relative(resolvedRoot, resolvedFile);
    if (isAbsolute(withinRoot) || withinRoot === ".." || withinRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) return null;
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.size > 256_000) return null;
    return ts.createSourceFile(path, readFileSync(candidate, "utf8"), ts.ScriptTarget.Latest, true);
  } catch { return null; }
}

function hasModuleReference(source: ts.SourceFile, moduleName: string): boolean {
  return source.statements.some((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text === moduleName);
}

function hasTopLevelPostgresUrlClient(source: ts.SourceFile): boolean {
  return source.statements.some((statement) => {
    if (!ts.isVariableStatement(statement)) return false;
    return statement.declarationList.declarations.some((declaration) => {
      const initializer = declaration.initializer;
      if (!initializer || !ts.isCallExpression(initializer) ||
          !ts.isIdentifier(initializer.expression) || initializer.expression.text !== "postgres") return false;
      let found = false;
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAccessExpression(node) && node.name.text === "POSTGRES_URL" &&
            ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "env" &&
            ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "process") found = true;
        ts.forEachChild(node, visit);
      };
      initializer.arguments.forEach(visit);
      return found;
    });
  });
}

function nextAuthBuildEvidence(repositoryPath?: string): RepositoryFact["evidence"] | null {
  if (!repositoryPath) return null;
  const root = resolve(repositoryPath);
  const sources = NEXT_AUTH_BUILD_PATHS.map((path) => readRepositorySource(root, path));
  if (sources.some((source) => !source)) return null;
  const [route, auth, db] = sources as [ts.SourceFile, ts.SourceFile, ts.SourceFile];
  if (!hasModuleReference(route, "app/auth") || !hasModuleReference(auth, "app/db") ||
      !hasTopLevelPostgresUrlClient(db)) return null;
  return NEXT_AUTH_BUILD_PATHS.map((path) => ({ source: "file" as const, path, description: "Static Next.js auth route import chain and module-level postgres client initialization." }));
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
  facts: RepositoryFact[],
  repositoryPath?: string
): EnvironmentUsageClassification[] {
  const authBuildEvidence = nextAuthBuildEvidence(repositoryPath);
  const environmentFacts =
    facts.filter(
      (fact) =>
        fact.key ===
        "environmentVariable"
    );

  return environmentFacts.map(
    (fact) => {
      if (fact.value === "POSTGRES_URL" && authBuildEvidence &&
          fact.evidence.some((item) => item.path === "app/db.ts")) {
        return {
          variable: fact.value, phase: "build" as const, confidence: 0.95,
          reason: "POSTGRES_URL initializes a postgres client during import of the Next.js authentication route.",
          evidence: [...fact.evidence, ...authBuildEvidence],
        };
      }
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
