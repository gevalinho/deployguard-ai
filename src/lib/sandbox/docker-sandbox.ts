import {
  randomUUID,
} from "node:crypto";

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
  constructor(message: string) {
    super(message);
    this.name = "SandboxContainerStateUnknownError";
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
    | "timed_out";

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
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  if (outcome === "timeout") {
  let killExitCode: number | null = null;
  try {
    const killResult = await runCommand(
      "docker",
      [
        "kill",
        containerName,
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
        "docker", ["rm", "--force", containerName], input.repositoryPath,
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

  let inspectResult: Awaited<ReturnType<typeof runCommand>>;
  try {
    inspectResult = await runCommand(
      "docker",
      ["inspect", "--format", "{{.State.Running}}", containerName],
      input.repositoryPath,
      { timeoutMs: 10_000 },
    );
  } catch {
    throw new SandboxContainerStateUnknownError(
      `Docker container ${containerName} could not be inspected after timeout.`,
    );
  }
  // --rm removes a stopped container; otherwise inspect must say false.
  const gone = inspectResult.exitCode !== 0 &&
    /no such (object|container)/i.test(inspectResult.stderr);
  if (inspectResult.timedOut || (!gone &&
      (inspectResult.exitCode !== 0 || inspectResult.stdout.trim() !== "false"))) {
    throw new SandboxContainerStateUnknownError(
      `Docker container ${containerName} could not be confirmed stopped after timeout. ` +
      `Kill exit code: ${killExitCode}; inspect exit code: ${inspectResult.exitCode}.`,
    );
  }

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

  return {
    status:
      outcome.status === "passed"
        ? "passed"
        : "failed",

    exitCode: outcome.exitCode,
    stdout: outcome.stdout,
    stderr: outcome.stderr,

    durationMs:
      Date.now() - startedAt,
  };
}
