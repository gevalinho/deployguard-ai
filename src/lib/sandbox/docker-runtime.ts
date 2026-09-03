import {
  runCommand,
} from "@/lib/execution/command-runner";

export interface DockerRuntimeStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export async function getDockerRuntimeStatus():
  Promise<DockerRuntimeStatus> {
  try {
    const result = await runCommand(
      "docker",
      ["version", "--format", "{{.Server.Version}}"],
      process.cwd()
    );

    if (result.status !== "passed") {
      return {
        available: false,
        error:
          result.stderr ||
          result.stdout ||
          "Docker runtime unavailable.",
      };
    }

    return {
      available: true,
      version: result.stdout.trim(),
    };
  } catch (error) {
    return {
      available: false,
      error:
        error instanceof Error
          ? error.message
          : "Docker runtime unavailable.",
    };
  }
}