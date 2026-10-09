import type { FixExecutionResult, FixProposal } from "@/lib/remediation/types";

import { runDockerSandboxCommand, SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";
import { chown, chmod, mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";

import { detectPackageManager } from "@/lib/sandbox/package-manager";

const FIX_TIMEOUT_MS = 120_000;
const PREFLIGHT_PREFIX = "DEPLOYGUARD_CACHE_PREFLIGHT:";
const DEFAULT_CACHE_ROOT = "/var/cache/deployguard";

async function remediationCacheRoot(): Promise<string> {
  const configured = process.env.DEPLOYGUARD_REMEDIATION_CACHE_ROOT ||
    process.env.CACHE_DIRECTORY || DEFAULT_CACHE_ROOT;
  if (!isAbsolute(configured) || configured.includes(":")) {
    throw new Error("Remediation cache root must be a single absolute directory.");
  }
  // Resolve links so a configured path cannot point back into PrivateTmp.
  const root = await realpath(configured);
  if (["/tmp", "/var/tmp"].some((base) => root === base || root.startsWith(base + sep))) {
    throw new Error("Remediation cache root must be outside /tmp and /var/tmp.");
  }
  return root;
}

// This script runs in the npm container, before npm, with the same user and mount.
const preflightScript = `
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
const prefix = "DEPLOYGUARD_CACHE_PREFLIGHT:";
const report = { uid: process.getuid(), gid: process.getgid(), context: "unavailable" };
try {
  report.context = fs.readFileSync("/proc/self/attr/current", "utf8").trim();
} catch {}
let stage = "access";
let probe;
try {
  stage = "identity";
  if (report.uid !== Number(process.argv[1]) || report.gid !== Number(process.argv[2])) {
    const error = new Error("Unexpected container identity");
    error.code = "IDENTITY_MISMATCH";
    throw error;
  }
  stage = "access";
  fs.accessSync("/tmp/npm-cache", fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  stage = "mkdir";
  fs.mkdirSync("/tmp/npm-cache/_cacache", { recursive: true, mode: 0o700 });
  stage = "write";
  probe = path.join("/tmp/npm-cache/_cacache", ".deployguard-probe-" + process.pid);
  fs.writeFileSync(probe, "probe", { flag: "wx", mode: 0o600 });
  stage = "remove";
  fs.unlinkSync(probe);
} catch (error) {
  if (probe) { try { fs.unlinkSync(probe); } catch {} }
  console.log(prefix + JSON.stringify({ ...report, stage, code: error.code || "UNKNOWN", ok: false }));
  process.exit(74);
}
console.log(prefix + JSON.stringify({ ...report, ok: true }));
const npm = cp.spawnSync("npm", process.argv.slice(3), { stdio: "inherit" });
if (npm.error) process.exit(127);
process.exit(npm.status === null ? 1 : npm.status);
`;

function parsePreflight(stdout: string) {
  const line = stdout.split("\n").find((entry) => entry.startsWith(PREFLIGHT_PREFIX));
  if (!line) return null;
  try {
    const value = JSON.parse(line.slice(PREFLIGHT_PREFIX.length));
    if (typeof value.uid !== "number" || typeof value.gid !== "number" ||
        typeof value.ok !== "boolean") return null;
    return {
      uid: value.uid as number,
      gid: value.gid as number,
      context: typeof value.context === "string" &&
        /^[A-Za-z0-9_:., -]{1,160}$/.test(value.context) ? value.context : "unavailable",
      ok: value.ok as boolean,
      stage: ["identity", "access", "mkdir", "write", "remove"].includes(value.stage) ? value.stage as string : "unknown",
      code: typeof value.code === "string" && /^[A-Z0-9_]{1,32}$/.test(value.code)
        ? value.code : "UNKNOWN",
    };
  } catch { return null; }
}


export async function applyDependencySecurityFix(
  repositoryPath: string,
  proposal: FixProposal,
): Promise<FixExecutionResult> {
  if (proposal.strategy !== "dependency_security") {
    return {
      status: "unsupported",
      summary:
        "This remediation strategy is not supported by the dependency security fixer.",
    };
  }

  const packageManager = detectPackageManager(repositoryPath);

  if (!packageManager) {
    return {
      status: "unsupported",
      summary: "No supported package manager lockfile was detected.",
    };
  }

  /*
   * The first remediation implementation is
   * intentionally restricted to npm.
   *
   * pnpm and Yarn can be added after their
   * mutation and lockfile behavior has been
   * independently tested.
   */
  if (packageManager.name !== "npm") {
    return {
      status: "unsupported",
      summary: `Automatic dependency remediation is not yet supported for ${packageManager.name}.`,
    };
  }

  const command =
    proposal.risk === "breaking_change_allowed"
      ? [
          "npm",
          "audit",
          "fix",
          "--force",
          "--ignore-scripts",
          "--no-audit",
          "--no-fund",
        ]
      : ["npm", "audit", "fix", "--ignore-scripts", "--no-audit", "--no-fund"];

  const hostUid = typeof process.getuid === "function" ? process.getuid() : null;
  const hostGid = typeof process.getgid === "function" ? process.getgid() : null;
  const uid = hostUid && hostUid > 0 ? hostUid : 1000;
  const gid = hostUid && hostUid > 0 ? (hostGid ?? 1000) : 1000;
  const cacheDirectory = await mkdtemp(join(await remediationCacheRoot(), "deployguard-npm-cache-"));
  let result: Awaited<ReturnType<typeof runDockerSandboxCommand>>;
  let containerStateUnknown = false;
  try {
    if (hostUid !== uid || hostGid !== gid) await chown(cacheDirectory, uid, gid);
    await chmod(cacheDirectory, 0o700);
    result = await runDockerSandboxCommand({
      repositoryPath,
      command: ["node", "-e", preflightScript, String(uid), String(gid), ...command.slice(1)],
      network: "bridge",
      environment: {
        HOME: "/tmp/deployguard-home", CI: "true", npm_config_cache: "/tmp/npm-cache",
      },
      user: `${uid}:${gid}`,
      mounts: [{ source: cacheDirectory, target: "/tmp/npm-cache", selinuxPrivate: true }],
      limits: { memoryMb: 2048, cpus: 1, timeoutMs: FIX_TIMEOUT_MS },
    });
  } catch (error) {
    containerStateUnknown = error instanceof SandboxContainerStateUnknownError;
    throw error;
  } finally {
    if (containerStateUnknown) {
      console.error("[DeployGuard Remediation] Cache retained because container state is unknown");
    } else {
      await rm(cacheDirectory, { recursive: true, force: true });
    }
  }

  const preflight = parsePreflight(result.stdout);
  if (preflight) console.error("[DeployGuard Cache Preflight]", preflight);
  if (preflight?.ok === false) {
    return {
      status: "failed",
      summary: `Dependency cache preflight failed at ${preflight.stage}: ${preflight.code}.`,
      command: "npm audit fix",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    };
  }
  if (!preflight && result.status !== "timed_out") {
    return {
      status: "failed", summary: "Dependency cache preflight did not report a result.",
      command: "npm audit fix", exitCode: result.exitCode, durationMs: result.durationMs,
    };
  }

  console.error("[DeployGuard Remediation Diagnostic]", {
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutLength: result.stdout.length,
    stderrLength: result.stderr.length,
    stdoutHasERESOLVE: result.stdout.includes("ERESOLVE"),
    stderrHasERESOLVE: result.stderr.includes("ERESOLVE"),
    stdoutHasEACCES: result.stdout.includes("EACCES"),
    stderrHasEACCES: result.stderr.includes("EACCES"),
    hasRegistryError: /ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN/.test(
      result.stdout + result.stderr,
    ),
    hasAuditError: /audit endpoint|audit error|EAUDIT/i.test(
      result.stdout + result.stderr,
    ),
  });

  if (result.status === "timed_out") {
    return {
      status: "failed",
      summary: "Dependency remediation exceeded the configured timeout.",
      command: "npm audit fix",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    };
  }

  if (result.status === "failed") {
    console.error("[DeployGuard Remediation] npm audit fix failed", {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      // Do not log raw stdout/stderr here:
      // npm output may contain credentials or private registry URLs.
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
    });

    return {
      status: "failed",
      summary: "npm could not complete the dependency security remediation.",
      command: "npm audit fix",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    };
  }

  return {
    status: "applied",
    summary: "npm completed the dependency security remediation attempt.",
    command: "npm audit fix",
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  };
}
