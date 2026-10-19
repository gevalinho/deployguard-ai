/** Ownership wrapper for the dependency-preparation integration test's Docker probes. */
import { runWithArtifactOwnership } from "./frozen-artifact-ownership";

export function runOwnedDependencyPreparationProbe<T>(
  sourcePath: string, dependencyPath: string, work: () => Promise<T>,
  cleanupAfterReconcile: () => void,
): Promise<T> {
  return runWithArtifactOwnership([sourcePath, dependencyPath], sourcePath,
    work, cleanupAfterReconcile);
}
