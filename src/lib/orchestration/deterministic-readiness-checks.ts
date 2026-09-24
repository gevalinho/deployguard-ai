import {
  runSandboxBuildAgent,
} from "@/lib/agents/sandbox-build-agent";

import {
  runSandboxLintAgent,
} from "@/lib/agents/sandbox-lint-agent";

import {
  runSandboxSecurityAgent,
} from "@/lib/agents/sandbox-security-agent";

import {
  runSandboxTestAgent,
} from "@/lib/agents/sandbox-test-agent";

import {
  runSandboxTypecheckAgent,
} from "@/lib/agents/sandbox-typecheck-agent";

import type {
  CheckResult,
} from "@/lib/checks/types";

/*
 * Run repository-controlled deterministic checks
 * against an already prepared sandbox workspace.
 *
 * This pipeline is intentionally AI-independent.
 *
 * It can therefore be reused by both the normal
 * readiness assessment and post-remediation
 * verification.
 */
export async function runDeterministicSandboxChecks(
  repositoryPath: string
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  const typecheck =
    await runSandboxTypecheckAgent(
      repositoryPath
    );

  checks.push(typecheck);

  const lint =
    await runSandboxLintAgent(
      repositoryPath
    );

  checks.push(lint);

  const tests =
    await runSandboxTestAgent(
      repositoryPath
    );

  checks.push(tests);

  const build =
    await runSandboxBuildAgent(
      repositoryPath
    );

  checks.push(build);

  const security =
    await runSandboxSecurityAgent(
      repositoryPath
    );

  checks.push(security);

  return checks;
}