# Assessment sandbox resource reconciliation

When an assessment logs `Docker cleanup unconfirmed`, it emits a `recoveryId`
and retains the disposable repository workspace. The Docker identity directory
also retains a private `resources.json` containing the container identity-file
path and every bind source. Shared npm and Corepack caches are listed because
they may remain mounted; they are not disposable assessment workspaces.

## Same server process

An operator with server access can call `reconcileRetainedArtifact(recoveryId)`
from `src/lib/remediation/frozen-artifact-ownership.ts`. It inspects the original
full container ID, never the reusable name. If Docker confirms the container is
stopped or absent, it releases the mount guards, removes owned font staging,
and invokes ingestion workspace cleanup. If inspection fails or reports a
running container, the resources remain retained and the same recovery ID can
be retried after the Docker fault is repaired.

## After a server restart

The in-memory recovery ID is lost, but the private Docker identity directory
and `resources.json` remain. `readRetainedSandboxResourceRecord(directory)`
validates its owner, permissions, shape, and expected identity-file location
without removing anything. An operator must then inspect the original full ID
in the recorded `cid` file with Docker. The container name is only context;
it must never be used for a kill or cleanup decision.

Quarantine a missing, malformed, unreadable, or conflicting record or CID file.
Do not infer that the container stopped from a missing file, a stale timestamp,
an absent process-local recovery ID, or a Docker daemon error. A record with an
unexpected mount path or an ID that disagrees with another record requires
manual attribution using Docker's full-ID inspection and mount information.
Age alone never authorizes deletion. Only after the original container is
confirmed stopped, or Docker explicitly reports that object absent, may an
operator remove the unique repository workspace and font staging directories
listed in the validated record, followed by the identity directory. Shared
npm and Corepack cache directories should remain in place. There is
intentionally no automatic cleanup after a restart while state is uncertain.

## Preparation or workspace cleanup unconfirmed

An `assessment_cleanup_unconfirmed` interruption may mean concurrent
preparation did not settle within the separate cleanup reserve, or workspace
removal failed. A private `deployguard-preparation-owner-*` directory under the
system temporary directory records the absolute workspace path before
preparation begins. `readPreparationOwnershipRecord(directory)` validates that
record after a process restart. The record is a recovery pointer, never proof
that a process has exited or permission to delete anything. The server log
also records the private repository workspace path and record directory;
the public event never includes it. Do not delete that path or its associated
mounts while preparation may still be active. Check the private Docker
`resources.json` records for the workspace and follow the full-ID inspection
procedure above for every matching container. If there is no Docker identity,
an operator must establish that no preparation child process or open bind mount
still uses the workspace before removing it. A missing record by itself is not
proof that preparation terminated. If removal itself failed, diagnose that
failure and retry cleanup only after resource ownership is confirmed clear.
If the command runner reports termination unconfirmed, its PID is logged only
as diagnostic context. PIDs can be reused; do not signal a later process or
delete the workspace based on that PID or record age alone.
