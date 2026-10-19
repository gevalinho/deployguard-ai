import type { CheckResult } from "@/lib/checks/types";
import { isDependencyOnlyNpmPackage } from "@/lib/capabilities/build-applicability";
import type { FixProof } from "./types";
import type { TrustedLodashProofContract } from "./frozen-regression-runner";
import { createFrozenSourceSnapshot } from "./frozen-source-snapshot";
import { prepareFrozenNpmDependencies, type PreparedFrozenDependencies } from "./frozen-dependency-preparation";
import { runFrozenNodeRegression } from "./frozen-regression-runner";
import { verifyDependencySecurityFix } from "./dependency-security-verifier";
import { FrozenArtifactContainerStateError, FrozenArtifactOwnedError,
  retainUnknownArtifact, runWithArtifactOwnership } from "./frozen-artifact-ownership";

export interface TrustedLodashVerificationResult {
  readonly proof: FixProof;
  readonly sourceIdentity?: string;
}

function inconclusive(summary: string, checks: CheckResult[] = []): FixProof {
  return { status: "inconclusive", summary, comparisons: [], regressionChecks: checks };
}

function inapplicable(id: "types" | "lint" | "build"): CheckResult {
  return { id, category: id, name: id, status: "skipped", skipReason: "not_applicable",
    summary: "Not applicable to the pinned dependency-only fixture." };
}

/** Called only after repository identity and source commit match the server allowlist. */
export async function verifyTrustedLodashRemediation(repositoryPath: string, before: CheckResult,
  targetPackageName: string, targetAdvisoryId: string,
  contract: TrustedLodashProofContract | null): Promise<TrustedLodashVerificationResult> {
  if (!contract) return { proof: inconclusive("Trusted lodash regression contract is unavailable.") };
  let snapshot: ReturnType<typeof createFrozenSourceSnapshot> | undefined;
  let prepared: PreparedFrozenDependencies | undefined;
  let proof = inconclusive("Frozen lodash verification could not be completed.");
  let sourceIdentity: string | undefined;
  try {
    snapshot = createFrozenSourceSnapshot(repositoryPath);
    sourceIdentity = snapshot.identity;
    if (!isDependencyOnlyNpmPackage(snapshot.path)) {
      proof = inconclusive("The pinned source is not the supported dependency-only fixture.");
    } else {
      prepared = await prepareFrozenNpmDependencies(snapshot, snapshot.identity);
      prepared.verify();
      const regression = await runFrozenNodeRegression(snapshot, prepared, contract);
      const checks: CheckResult[] = [inapplicable("types"), inapplicable("lint"), {
      id: "test", category: "test", name: "Trusted lodash Node tests",
      status: regression.status === "passed" ? "passed" : "error",
      exitCode: regression.exitCode,
      ...(regression.status === "passed" ? { testExecutionVerified: true } : {}),
      command: "node --test --test-reporter=tap /source/test/lodash.test.js",
      summary: regression.status === "passed" ? "Four trusted lodash tests passed." :
        "Trusted lodash regression evidence was incomplete.",
      stdout: regression.stdout, stderr: regression.stderr,
      }, inapplicable("build")];
      if (regression.status !== "passed") {
        proof = inconclusive("Trusted lodash regression evidence was incomplete.", checks);
      } else {
        prepared.verify();
        proof = await runWithArtifactOwnership([snapshot.path], snapshot.path,
          () => verifyDependencySecurityFix(snapshot!.path, before, checks,
            targetPackageName, ["types", "lint", "test", "build"], targetAdvisoryId),
          () => snapshot!.cleanup());
        prepared.verify();
      }
    }
  } catch (error) {
    if (error instanceof FrozenArtifactContainerStateError) {
      const recoveryId = retainUnknownArtifact(error,
        () => { prepared?.cleanup(); snapshot?.cleanup(); });
      console.error("[DeployGuard Frozen Verification] Docker state unknown; artifacts retained.",
        { recoveryId, containerId: error.containerId ?? "unavailable" });
      proof = inconclusive("Docker container state is unknown; verification artifacts were retained.");
    } else {
      proof = inconclusive("Frozen lodash verification could not be completed safely.");
    }
  } finally {
    for (const cleanup of [() => prepared?.cleanup(), () => snapshot?.cleanup()]) {
      try { cleanup(); }
      catch (error) {
        if (!(error instanceof FrozenArtifactOwnedError))
          proof = inconclusive("Frozen verification cleanup could not be completed safely.");
      }
    }
  }
  return { proof, ...(sourceIdentity ? { sourceIdentity } : {}) };
}
