import {
  randomUUID,
} from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type {
  SandboxLimits,
} from "@/lib/sandbox/types";

import {
  DEFAULT_SANDBOX_LIMITS,
} from "@/lib/sandbox/config";

import {
  runCommand,
} from "@/lib/execution/command-runner";
import { assertAssessmentTime, currentAssessmentExecution, remainingAssessmentMs } from "@/lib/orchestration/assessment-execution";

const DOCKER_CLIENT_REAP_RESERVE_MS = 90_000;

export interface DockerSandboxMount {
  source: string;
  target: string;
  readOnly?: boolean;
  selinuxPrivate?: boolean;
}

export class SandboxContainerStateUnknownError extends Error {
  constructor(message: string, readonly containerName?: string,
    readonly containerId?: string, readonly containerIdFile?: string,
    readonly mountedPaths: readonly string[] = []) {
    super(message);
    this.name = "SandboxContainerStateUnknownError";
  }
}

const FULL_CONTAINER_ID = /^[0-9a-f]{64}$/;
const IDENTITY_DIRECTORY = /^deployguard-container-id-[A-Za-z0-9]+$/;
const CONTAINER_NAME = /^deployguard-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export interface RetainedSandboxResourceRecord {
  version: 1;
  containerName: string;
  containerIdFile: string;
  mountedPaths: string[];
}

/** Read recovery metadata without treating it as permission to delete any path. */
export function readRetainedSandboxResourceRecord(directory: string): RetainedSandboxResourceRecord {
  const resolved = resolve(directory);
  if (dirname(resolved) !== resolve(tmpdir()) || !IDENTITY_DIRECTORY.test(basename(resolved)))
    throw new Error("Invalid Docker identity directory.");
  const directoryStat = lstatSync(resolved);
  if (!directoryStat.isDirectory() || directoryStat.uid !== process.getuid?.() ||
      (directoryStat.mode & 0o077) !== 0)
    throw new Error("Docker identity directory ownership is invalid.");
  const fd = openSync(join(resolved, "resources.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > 16_384 ||
        stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
      throw new Error("Docker resource record ownership is invalid.");
    const record: unknown = JSON.parse(readFileSync(fd, "utf8"));
    if (!record || typeof record !== "object") throw new Error("Invalid Docker resource record.");
    const value = record as Partial<RetainedSandboxResourceRecord>;
    if (value.version !== 1 || !value.containerName || !CONTAINER_NAME.test(value.containerName) ||
        value.containerIdFile !== join(resolved, "cid") || !Array.isArray(value.mountedPaths) ||
        value.mountedPaths.length === 0 || value.mountedPaths.length > 32 ||
        value.mountedPaths.some((path) => typeof path !== "string" || !isAbsolute(path) || resolve(path) !== path))
      throw new Error("Invalid Docker resource record.");
    return value as RetainedSandboxResourceRecord;
  } finally { closeSync(fd); }
}

function readContainerId(path: string): string | undefined {
  try {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size < 64 || stat.size > 65) return undefined;
      const id = readFileSync(fd, "utf8").trim();
      return FULL_CONTAINER_ID.test(id) ? id : undefined;
    } finally { closeSync(fd); }
  } catch { return undefined; }
}

/** Reconcile the original full ID; a renamed container or reused name is irrelevant. */
export async function reconcileSandboxContainer(
  identity: SandboxContainerStateUnknownError, cwd: string,
): Promise<void> {
  if (identity.containerIdFile) {
    let record: RetainedSandboxResourceRecord;
    try { record = readRetainedSandboxResourceRecord(dirname(identity.containerIdFile)); }
    catch {
      throw new SandboxContainerStateUnknownError("Docker resource record is missing or invalid.",
        identity.containerName, identity.containerId, identity.containerIdFile, identity.mountedPaths);
    }
    if (record.containerIdFile !== identity.containerIdFile ||
        record.containerName !== identity.containerName ||
        JSON.stringify(record.mountedPaths) !== JSON.stringify(identity.mountedPaths))
      throw new SandboxContainerStateUnknownError("Docker resource record conflicts with the captured identity.",
        identity.containerName, identity.containerId, identity.containerIdFile, identity.mountedPaths);
  }
  const fileId = identity.containerIdFile ? readContainerId(identity.containerIdFile) : undefined;
  // A captured ID cannot override a missing, malformed, or conflicting CID file.
  if (identity.containerIdFile && (!fileId || (identity.containerId && identity.containerId !== fileId)))
    throw new SandboxContainerStateUnknownError("Original Docker container identity is inconsistent.",
      identity.containerName, identity.containerId, identity.containerIdFile, identity.mountedPaths);
  const containerId = fileId ?? identity.containerId;
  if (!containerId || !FULL_CONTAINER_ID.test(containerId))
    throw new SandboxContainerStateUnknownError("Original Docker container ID is unavailable.",
      identity.containerName, undefined, identity.containerIdFile, identity.mountedPaths);
  let result: Awaited<ReturnType<typeof runCommand>>;
  try {
    result = await runCommand("docker", ["inspect", "--format", "{{.State.Running}}", containerId],
      cwd, { timeoutMs: 10_000 });
  } catch {
    throw new SandboxContainerStateUnknownError(
      `Docker container ${containerId} could not be inspected.`, identity.containerName,
      containerId, identity.containerIdFile, identity.mountedPaths);
  }
  const absent = result.exitCode !== 0 && /no such (object|container)/i.test(result.stderr);
  if (result.timedOut || (!absent && (result.exitCode !== 0 || result.stdout.trim() !== "false")))
    throw new SandboxContainerStateUnknownError(
      `Docker container ${containerId} is not confirmed stopped.`, identity.containerName,
      containerId, identity.containerIdFile, identity.mountedPaths);
}

export function discardSandboxContainerIdentity(identity: SandboxContainerStateUnknownError): void {
  if (identity.containerIdFile) {
    const record = readRetainedSandboxResourceRecord(dirname(identity.containerIdFile));
    const fileId = readContainerId(identity.containerIdFile);
    if (record.containerIdFile !== identity.containerIdFile ||
        record.containerName !== identity.containerName ||
        JSON.stringify(record.mountedPaths) !== JSON.stringify(identity.mountedPaths) ||
        !fileId || (identity.containerId && identity.containerId !== fileId))
      throw new SandboxContainerStateUnknownError("Docker identity cannot be discarded without a matching full ID and resource record.",
        identity.containerName, identity.containerId, identity.containerIdFile, identity.mountedPaths);
    rmSync(dirname(identity.containerIdFile), { recursive: true, force: true });
  }
}

// export interface DockerSandboxCommand {
//   repositoryPath: string;
//   command: string[];
//   limits?: SandboxLimits;

//   network?: "none" | "bridge";

//   user?: string;

//   environment?: Record<
//     string,
//     string
//   >;
// }

export interface DockerSandboxCommand {
  repositoryPath: string;
  command: string[];
  limits?: SandboxLimits;
  network?: "none" | "bridge";
  user?: string;
  environment?: Record<string, string>;
  mounts?: DockerSandboxMount[];
}

export interface DockerSandboxCommandResult {
  status:
    | "passed"
    | "failed"
    | "timed_out"
    | "infrastructure_error";

  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export async function runDockerSandboxCommand(
  input: DockerSandboxCommand
): Promise<DockerSandboxCommandResult> {
  const configuredLimits = input.limits ?? DEFAULT_SANDBOX_LIMITS;
  const limits = { ...configuredLimits,
    timeoutMs: remainingAssessmentMs(configuredLimits.timeoutMs) };

  const containerName =
    `deployguard-${randomUUID()}`;
  const identityDirectory = mkdtempSync(join(tmpdir(), "deployguard-container-id-"));
  const containerIdFile = join(identityDirectory, "cid");
  const mountedPaths = [...new Set([input.repositoryPath, ...(input.mounts ?? []).map((mount) => mount.source)])];
  // This private record remains available to an operator when Docker state is unknown.
  // It is never used as authority to delete a mount or target a container by name.
  try {
    writeFileSync(join(identityDirectory, "resources.json"), JSON.stringify({
      version: 1, containerName, containerIdFile, mountedPaths,
    }), { mode: 0o600, flag: "wx" });
  } catch (error) {
    rmSync(identityDirectory, { recursive: true, force: true });
    throw error;
  }
  const identity = (message: string) => new SandboxContainerStateUnknownError(
    message, containerName, readContainerId(containerIdFile), containerIdFile, mountedPaths);
  const discardIdentity = () => rmSync(identityDirectory, { recursive: true, force: true });

const environmentArgs =
  Object.entries(
    input.environment ?? {}
  ).flatMap(
    ([key, value]) => [
      "--env",
      `${key}=${value}`,
    ]
  );

const userArgs =
  input.user
    ? [
        "--user",
        input.user,
      ]
    : [];

    const additionalMountArgs =
  (input.mounts ?? []).flatMap(
    (mount) => mount.selinuxPrivate
      ? ["--volume", `${mount.source}:${mount.target}:${mount.readOnly ? "ro," : ""}Z`]
      : [
        "--mount",
        [
        "type=bind",
        `source=${mount.source}`,
        `target=${mount.target}`,
        mount.readOnly
          ? "readonly"
          : undefined,
      ]
        .filter(Boolean)
        .join(","),
    ]
  );

  const dockerArgs = [
  "run",
  "--rm",

  "--name",
  containerName,

  "--cidfile",
  containerIdFile,

  "--network",
  input.network ?? "none",

  "--memory",
  `${limits.memoryMb}m`,

  "--cpus",
  String(limits.cpus),

  "--pids-limit",
  "256",

  "--security-opt",
  "no-new-privileges",

  "--cap-drop",
  "ALL",

  "--read-only",

  "--tmpfs",
  "/tmp:rw,noexec,nosuid,size=256m,mode=1777",

  // ...userArgs,
  // ...environmentArgs,

  // "--mount",
  // `type=bind,source=${input.repositoryPath},target=/workspace`,

  ...userArgs,
...environmentArgs,

"--mount",
`type=bind,source=${input.repositoryPath},target=/workspace`,

...additionalMountArgs,

  "--workdir",
  "/workspace",

  "node:22-bookworm-slim",

  ...input.command,
];

  const startedAt = Date.now();

  // Cancellation before launch creates no Docker owner; release the unused
  // identity record. Once launched, reconciliation controls every bind source.
  try { assertAssessmentTime(); } catch (error) { discardIdentity(); throw error; }

  const executionPromise =
    runCommand(
      "docker",
      dockerArgs,
      input.repositoryPath
    );

  let timeoutHandle:
    ReturnType<typeof setTimeout> |
    undefined;
  const assessmentSignal = currentAssessmentExecution()?.signal;
  let cancelTimeout: (() => void) | undefined;

  const timeoutPromise =
    new Promise<"timeout">(
      (resolve) => {
        cancelTimeout = () => resolve("timeout");
        if (assessmentSignal?.aborted) cancelTimeout();
        else assessmentSignal?.addEventListener("abort", cancelTimeout, { once: true });
        timeoutHandle = setTimeout(
          () => {
            resolve("timeout");
          },
          limits.timeoutMs
        );
      }
    );

  let outcome: Awaited<typeof executionPromise> | "timeout";
  try {
    outcome = await Promise.race([
      executionPromise,
      timeoutPromise,
    ]);
  } catch (error) {
    const code =
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;

    if (
      code !== "ENOENT" &&
      code !== "EACCES" &&
      code !== "EPERM"
    ) {
      throw identity(`Docker client failed; container ${containerName} state is unknown.`);
    }

    discardIdentity();
    return {
      status: "infrastructure_error",
      exitCode: null,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - startedAt,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    if (cancelTimeout) assessmentSignal?.removeEventListener("abort", cancelTimeout);
  }

  if (outcome === "timeout") {
  const timeoutContainerId = readContainerId(containerIdFile);
  if (!timeoutContainerId) {
    // Docker may still create the container and CID file later. Keep both the
    // identity record and bind sources owned; never target a reusable name.
    void executionPromise.catch(() => undefined);
    throw identity(`Docker container ${containerName} timed out before its ID was established.`);
  }
  let killExitCode: number | null = null;
  try {
    const killResult = await runCommand(
      "docker",
      [
        "kill",
        timeoutContainerId,
      ],
      input.repositoryPath,
      { timeoutMs: 10_000 },
    );
    killExitCode = killResult.exitCode;
  } catch {
    // The run process and inspect check still determine cleanup safety.
  }
  if (killExitCode !== 0) {
    try {
      await runCommand(
        "docker", ["rm", "--force", timeoutContainerId], input.repositoryPath,
        { timeoutMs: 10_000 },
      );
    } catch {
      // Keep waiting for docker run; never release the cache on uncertainty.
    }
  }

  let terminatedResult:
    Awaited<
      typeof executionPromise
    > |
    undefined;

  let reapTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    terminatedResult = await Promise.race([
      executionPromise,
      new Promise<never>((_resolve, reject) => {
        reapTimer = setTimeout(() => reject(new Error("docker_client_reap_timeout")),
          DOCKER_CLIENT_REAP_RESERVE_MS);
      }),
    ]);
  } catch {
    // A client that has not exited can still hold the bind sources. Retain
    // ownership even if Docker might later report its container stopped.
    void executionPromise.catch(() => undefined);
    throw identity(`Docker client did not exit within the cleanup reserve for ${containerName}.`);
  } finally {
    if (reapTimer) clearTimeout(reapTimer);
  }

  const timeoutIdentity = identity(`Docker container ${containerName} could not be confirmed stopped after timeout. ` +
    `Kill exit code: ${killExitCode}.`);
  await reconcileSandboxContainer(timeoutIdentity, input.repositoryPath);
  discardIdentity();

  return {
    status: "timed_out",
    exitCode:
      terminatedResult?.exitCode ??
      null,

    stdout:
      terminatedResult?.stdout ??
      "",

    stderr: [
      terminatedResult?.stderr,
      "Sandbox execution exceeded the configured timeout and the container was terminated.",
    ]
      .filter(Boolean)
      .join("\n"),

    durationMs:
      Date.now() - startedAt,
  };
}

  // Docker run forwards a completed container's exit code, including test
  // failures. The captured ID must still be checked before releasing mounts.
  const completedIdentity = identity(`Docker container ${containerName} did not establish a safe exit.`);
  await reconcileSandboxContainer(completedIdentity, input.repositoryPath);
  discardIdentity();

  return {
    status:
      outcome.exitCode === 125
        ? "infrastructure_error"
        : outcome.status === "passed"
          ? "passed"
          : "failed",

    exitCode: outcome.exitCode,
    stdout: outcome.stdout,
    stderr: outcome.stderr,

    durationMs:
      Date.now() - startedAt,
  };
}
