import type {
  CheckResult,
} from "@/lib/checks/types";

export interface SandboxLimits {
  memoryMb: number;
  cpus: number;
  timeoutMs: number;
}

export interface SandboxExecutionResult {
  status:
    | "completed"
    | "failed"
    | "timed_out";

  containerId?: string;
  exitCode?: number | null;
  durationMs: number;

  checks: CheckResult[];

  error?: string;
}