import { spawn } from "node:child_process";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  status: "passed" | "failed";
  timedOut: boolean;
}

export interface RunCommandOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: {
        ...process.env,
        ...options.env,
      },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timeout =
      options.timeoutMs &&
      options.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;

            stderr +=
              `\nCommand timed out after ${options.timeoutMs}ms.`;

            child.kill("SIGTERM");

            setTimeout(() => {
              if (!settled) {
                child.kill("SIGKILL");
              }
            }, 2000);
          }, options.timeoutMs)
        : null;

    const clearCommandTimeout = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearCommandTimeout();
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearCommandTimeout();

      resolve({
        command,
        args,
        exitCode,
        stdout,
        stderr,
        durationMs:
          Date.now() - startedAt,
        status:
          exitCode === 0 &&
          !timedOut
            ? "passed"
            : "failed",
        timedOut,
      });
    });
  });
}