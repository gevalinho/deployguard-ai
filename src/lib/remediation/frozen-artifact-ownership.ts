/** Process-local ownership guard for private trees used as Docker bind mounts.
 * Unknown containers retain ownership until explicit Docker reconciliation.
 * Host processes with filesystem or Docker control remain outside this guard.
 */
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { discardSandboxContainerIdentity, reconcileSandboxContainer,
  SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";

const held = new Map<string, number>();
const unresolved = new Map<string, { error: FrozenArtifactContainerStateError;
  afterRecovery: () => void; inFlight?: Promise<void> }>();

export function assertArtifactCanBeDeleted(path: string): void {
  if (held.has(resolve(path))) throw new FrozenArtifactOwnedError("Artifact may still be Docker-mounted.");
}

export class FrozenArtifactOwnedError extends Error {
  constructor(message: string) { super(message); this.name = "FrozenArtifactOwnedError"; }
}

export class FrozenArtifactContainerStateError extends FrozenArtifactOwnedError {
  readonly containerName: string;
  readonly containerId?: string;
  readonly artifacts: readonly string[];
  private recovered = false;
  constructor(private readonly originalError: SandboxContainerStateUnknownError, paths: readonly string[],
    private readonly cwd: string, private readonly afterReconcile: () => void) {
    super(`${originalError.message} Private artifacts remain owned; call reconcile() before cleanup.`);
    this.name = "FrozenArtifactContainerStateError";
    this.containerName = originalError.containerName ?? "";
    this.containerId = originalError.containerId;
    this.artifacts = Object.freeze([...paths]);
  }
  async reconcile(): Promise<void> {
    if (this.recovered) return;
    await reconcileSandboxContainer(this.originalError, this.cwd);
    if (this.recovered) return;
    this.afterReconcile();
    discardSandboxContainerIdentity(this.originalError);
    this.recovered = true;
  }
}

/** Keep recovery reachable after an orchestration request returns inconclusive. */
export function retainUnknownArtifact(error: FrozenArtifactContainerStateError,
  afterRecovery: () => void = () => {}): string {
  const recoveryId = randomUUID();
  unresolved.set(recoveryId, { error, afterRecovery });
  return recoveryId;
}

export async function reconcileRetainedArtifact(recoveryId: string): Promise<void> {
  const retained = unresolved.get(recoveryId);
  if (!retained) throw new FrozenArtifactOwnedError("Unknown artifact recovery identity.");
  if (retained.inFlight) return retained.inFlight;
  const reconciliation = (async () => {
    await retained.error.reconcile();
    retained.afterRecovery();
    unresolved.delete(recoveryId);
  })();
  retained.inFlight = reconciliation;
  try { await reconciliation; }
  finally { retained.inFlight = undefined; }
}

export function holdArtifacts(paths: readonly string[]): () => void {
  const keys = [...new Set(paths.map((path) => resolve(path)))];
  for (const path of keys) held.set(path, (held.get(path) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    for (const path of keys) {
      const count = held.get(path);
      if (count === 1) held.delete(path);
      else if (count !== undefined) held.set(path, count - 1);
    }
    released = true;
  };
}

/** Keep every bind source owned across a Docker call, including unknown errors. */
export async function runWithArtifactOwnership<T>(paths: readonly string[], cwd: string,
  work: () => Promise<T>, cleanupAfterReconcile: () => void): Promise<T> {
  const release = holdArtifacts(paths);
  let unknown = false;
  try { return await work(); }
  catch (error) {
    if (error instanceof SandboxContainerStateUnknownError) {
      unknown = true;
      throw new FrozenArtifactContainerStateError(error, paths, cwd,
        () => { release(); cleanupAfterReconcile(); });
    }
    throw error;
  } finally {
    if (!unknown) release();
  }
}
