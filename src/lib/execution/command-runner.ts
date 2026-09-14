import {
  spawn,
  type ChildProcess,
} from "node:child_process";

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

function terminateProcess(
  child: ChildProcess,
  signal: NodeJS.Signals
): void {
  if (!child.pid) {
    return;
  }

  try {
    if (
      process.platform !== "win32"
    ) {
      /*
       * The child is started as its own
       * process group on Unix/Linux.
       *
       * A negative PID sends the signal
       * to the entire process group,
       * including descendants spawned by
       * npm, pnpm, yarn, scripts, etc.
       */
      process.kill(
        -child.pid,
        signal
      );

      return;
    }

    /*
     * Windows does not support Unix
     * process-group signalling.
     *
     * Fall back to terminating the
     * direct child process.
     */
    child.kill(signal);
  } catch {
    /*
     * The process may already have
     * exited between the state check
     * and signal delivery.
     */
  }
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  return new Promise(
    (resolve, reject) => {
      const startedAt =
        Date.now();

      /*
       * On Unix/Linux, detached=true
       * creates a separate process group.
       *
       * This allows DeployGuard to stop
       * the entire process tree when a
       * command exceeds its timeout.
       */
      const useProcessGroup =
        process.platform !==
        "win32";

      const child = spawn(
        command,
        args,
        {
          cwd,
          shell: false,
          detached:
            useProcessGroup,
          env: {
            ...process.env,
            ...options.env,
          },
        }
      );

      let stdout = "";
      let stderr = "";

      let settled = false;
      let timedOut = false;

      let forceKillTimer:
        NodeJS.Timeout | null =
        null;

      const commandTimeout =
        options.timeoutMs &&
        options.timeoutMs > 0
          ? setTimeout(() => {
              if (settled) {
                return;
              }

              timedOut = true;

              stderr +=
                `\nCommand timed out after ${options.timeoutMs}ms.`;

              terminateProcess(
                child,
                "SIGTERM"
              );

              forceKillTimer =
                setTimeout(() => {
                  if (settled) {
                    return;
                  }

                  terminateProcess(
                    child,
                    "SIGKILL"
                  );
                }, 2_000);
            }, options.timeoutMs)
          : null;

      const clearTimers = () => {
        if (commandTimeout) {
          clearTimeout(
            commandTimeout
          );
        }

        if (forceKillTimer) {
          clearTimeout(
            forceKillTimer
          );
        }
      };

      child.stdout?.on(
        "data",
        (chunk) => {
          stdout +=
            chunk.toString();
        }
      );

      child.stderr?.on(
        "data",
        (chunk) => {
          stderr +=
            chunk.toString();
        }
      );

      child.on(
        "error",
        (error) => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimers();

          reject(error);
        }
      );

      child.on(
        "close",
        (exitCode) => {
          if (settled) {
            return;
          }

          settled = true;

          clearTimers();

          resolve({
            command,
            args,
            exitCode,
            stdout,
            stderr,
            durationMs:
              Date.now() -
              startedAt,
            status:
              exitCode === 0 &&
              !timedOut
                ? "passed"
                : "failed",
            timedOut,
          });
        }
      );
    }
  );
}