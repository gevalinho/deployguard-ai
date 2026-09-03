import type {
  SandboxLimits,
} from "@/lib/sandbox/types";

export const DEFAULT_SANDBOX_LIMITS:
  SandboxLimits = {
    memoryMb: 2048,
    cpus: 1,
    timeoutMs: 5 * 60 * 1000,
  };