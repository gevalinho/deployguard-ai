import {
  spawn,
  type ChildProcess,
} from "node:child_process";
import { currentAssessmentExecution, remainingAssessmentMs } from "@/lib/orchestration/assessment-execution";

const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const TERMINATION_GRACE_MS = 2_000;
const TERMINATION_REAP_MS = 5_000;

export class CommandTerminationUnconfirmedError extends Error {
  constructor(readonly pid: number | undefined) {
    super("Command termination could not be confirmed after escalation.");
    this.name = "CommandTerminationUnconfirmedError";
  }
}

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
  /*
   * Explicit environment supplied to the child process.
   *
   * Callers may intentionally provide an isolated subset
   * instead of inheriting the server process environment.
   */
  env?: Readonly<
    Partial<NodeJS.ProcessEnv>
  >;

  /*
   * Commands inherit the DeployGuard process environment
   * by default for backwards compatibility.
   *
   * Security-sensitive operations such as authenticated
   * repository reads may explicitly disable inheritance.
   */
  inheritProcessEnv?: boolean;

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
  const effectiveTimeoutMs = command === "docker" ? options.timeoutMs ?? Number.POSITIVE_INFINITY :
    remainingAssessmentMs(options.timeoutMs ?? Number.POSITIVE_INFINITY);
  const assessmentSignal = command === "docker" ? undefined : currentAssessmentExecution()?.signal;
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

      const childEnvironment:
        NodeJS.ProcessEnv = {
          ...(options.inheritProcessEnv === false
            ? {}
            : process.env),
          ...options.env,
        } as NodeJS.ProcessEnv;

      const child = spawn(
        command,
        args,
        {
          cwd,
          shell: false,
          detached:
            useProcessGroup,
          env:
            childEnvironment,
        }
      );

      let stdout = "";
      let stderr = "";

      let settled = false;
      let timedOut = false;
      let reapTimer: NodeJS.Timeout | null = null;
      let forceKillTimer: NodeJS.Timeout | null = null;
      const escalate = () => {
        terminateProcess(child, "SIGTERM");
        forceKillTimer = setTimeout(() => {
          if (settled) return;
          terminateProcess(child, "SIGKILL");
          reapTimer = setTimeout(() => {
            if (settled) return;
            settled = true;
            clearTimers();
            reject(new CommandTerminationUnconfirmedError(child.pid));
          }, TERMINATION_REAP_MS);
        }, TERMINATION_GRACE_MS);
      };
      const abortCommand = () => {
        if (settled || timedOut) return;
        timedOut = true;
        escalate();
      };

      const commandTimeout =
        Number.isFinite(effectiveTimeoutMs) &&
        effectiveTimeoutMs > 0
          ? setTimeout(() => {
              if (settled) {
                return;
              }

              timedOut = true;

              stderr +=
                `\nCommand timed out after ${effectiveTimeoutMs}ms.`;

              escalate();
            }, effectiveTimeoutMs)
          : null;

      const clearTimers = () => {
        assessmentSignal?.removeEventListener("abort", abortCommand);
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
        if (reapTimer) clearTimeout(reapTimer);
      };

      child.stdout?.on(
        "data",
        (chunk) => {
          if (stdout.length < MAX_CAPTURE_BYTES)
            stdout += chunk.toString().slice(0, MAX_CAPTURE_BYTES - stdout.length);
        }
      );

      child.stderr?.on(
        "data",
        (chunk) => {
          if (stderr.length < MAX_CAPTURE_BYTES)
            stderr += chunk.toString().slice(0, MAX_CAPTURE_BYTES - stderr.length);
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

      if (assessmentSignal?.aborted) abortCommand();
      else assessmentSignal?.addEventListener("abort", abortCommand, { once: true });

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
