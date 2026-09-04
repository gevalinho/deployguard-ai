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
    (mount) => [
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
  "/tmp:rw,noexec,nosuid,size=256m",

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

  const outcome = await Promise.race([
    executionPromise,
    timeoutPromise,
  ]);

  if (outcome === "timeout") {
  try {
    await runCommand(
      "docker",
      [
        "kill",
        containerName,
      ],
      input.repositoryPath
    );
  } catch {
    /*
     * The container may already have
     * exited before Docker received
     * the kill request.
     */
  }

  let terminatedResult:
    Awaited<
      typeof executionPromise
    > |
    undefined;

  try {
    terminatedResult =
      await executionPromise;
  } catch {
    /*
     * Docker itself may fail after
     * forced container termination.
     */
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

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
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