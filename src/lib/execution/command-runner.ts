import { spawn } from "node:child_process";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  status: "passed" | "failed";
}

export function runCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const child = spawn(command, args, {
      cwd,
      shell: false,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode) => {
      resolve({
        command,
        args,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        status: exitCode === 0 ? "passed" : "failed",
      });
    });
  });
}