import {
  randomUUID,
} from "node:crypto";
import { constants, closeSync, fstatSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
  SandboxLimits,
} from "@/lib/sandbox/types";

import {
  DEFAULT_SANDBOX_LIMITS,
} from "@/lib/sandbox/config";

import {
  runCommand,
} from "@/lib/execution/command-runner";

export interface DockerSandboxMount {
  source: string;
  target: string;
  readOnly?: boolean;
  selinuxPrivate?: boolean;
}

export class SandboxContainerStateUnknownError extends Error {
  constructor(message: string, readonly containerName?: string,
    readonly containerId?: string, readonly containerIdFile?: string) {
    super(message);
    this.name = "SandboxContainerStateUnknownError";
  }
}

const FULL_CONTAINER_ID = /^[0-9a-f]{64}$/;
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
  const containerId = identity.containerId ??
    (identity.containerIdFile ? readContainerId(identity.containerIdFile) : undefined);
  if (!containerId || !FULL_CONTAINER_ID.test(containerId))
    throw new SandboxContainerStateUnknownError("Original Docker container ID is unavailable.",
      identity.containerName, undefined, identity.containerIdFile);
  let result: Awaited<ReturnType<typeof runCommand>>;
  try {
    result = await runCommand("docker", ["inspect", "--format", "{{.State.Running}}", containerId],
      cwd, { timeoutMs: 10_000 });
  } catch {
    throw new SandboxContainerStateUnknownError(
      `Docker container ${containerId} could not be inspected.`, identity.containerName,
      containerId, identity.containerIdFile);
  }
  const absent = result.exitCode !== 0 && /no such (object|container)/i.test(result.stderr);
  if (result.timedOut || (!absent && (result.exitCode !== 0 || result.stdout.trim() !== "false")))
    throw new SandboxContainerStateUnknownError(
      `Docker container ${containerId} is not confirmed stopped.`, identity.containerName,
      containerId, identity.containerIdFile);
}

export function discardSandboxContainerIdentity(identity: SandboxContainerStateUnknownError): void {
  if (identity.containerIdFile) rmSync(dirname(identity.containerIdFile),
    { recursive: true, force: true });
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
  const limits =
    input.limits ??
    DEFAULT_SANDBOX_LIMITS;

  const containerName =
    `deployguard-${randomUUID()}`;
  const identityDirectory = mkdtempSync(join(tmpdir(), "deployguard-container-id-"));
  const containerIdFile = join(identityDirectory, "cid");
  const identity = (message: string) => new SandboxContainerStateUnknownError(
    message, containerName, readContainerId(containerIdFile), containerIdFile);
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

  const executionPromise =
    runCommand(
      "docker",
      dockerArgs,
      input.repositoryPath
    );

  let timeoutHandle:
    ReturnType<typeof setTimeout> |
    undefined;

  const timeoutPromise =
    new Promise<"timeout">(
      (resolve) => {
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

  try {
    terminatedResult = await executionPromise;
  } catch {
    // Verify container state below even if the Docker client failed.
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
