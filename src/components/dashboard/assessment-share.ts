import type { PublicCheckResult, PublicProductionReadinessReport } from "@/lib/reporting/types";

export type ShareableAssessment = {
  repository: { owner: string; name: string; fullName: string; url: string };
  sourceCommitSha?: string;
  report: Pick<PublicProductionReadinessReport, "readiness" | "checks">;
};

const labels: Record<PublicCheckResult["category"], string> = {
  build: "Production build", types: "TypeScript", lint: "Lint", test: "Tests",
  security: "Security", database: "Database", deployment: "Deployment",
  environment: "Environment",
};

const stateDescriptions: Record<PublicCheckResult["status"], string> = {
  passed: "Verified check passed.",
  failed: "Verified check failed; diagnostic details omitted.",
  blocked: "Verification could not complete; no pass or failure established.",
  skipped: "Check did not run; no pass or failure established.",
  error: "Verification encountered an error; no pass or failure established.",
};

const skipDescriptions: Record<NonNullable<PublicCheckResult["skipReason"]>, string> = {
  not_applicable: "Outside the applicable assessment scope.",
  not_configured: "Recognized configuration was not found.",
  unsupported: "The detected setup is unsupported.",
};

function safeIdentity(assessment: ShareableAssessment): string | null {
  const { owner, name, fullName, url } = assessment.repository;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner) || !/^[A-Za-z0-9._-]{1,100}$/.test(name) ||
      name === "." || name === ".." || fullName !== `${owner}/${name}` ||
      url !== `https://github.com/${fullName}`) return null;
  return fullName;
}

function safeNumber(value: number): string | null {
  return Number.isFinite(value) && value >= 0 && value <= 100 ? String(Math.round(value)) : null;
}

function checkLines(check: PublicCheckResult, index: number): string[] | null {
  if (!Object.prototype.hasOwnProperty.call(labels, check.category) ||
      !Object.prototype.hasOwnProperty.call(stateDescriptions, check.status)) return null;
  const lines = [`${index + 1}. ${labels[check.category]}: ${check.status}. ${stateDescriptions[check.status]}`];
  if (check.status === "skipped" && check.skipReason &&
      Object.prototype.hasOwnProperty.call(skipDescriptions, check.skipReason)) {
    lines.push(`   ${skipDescriptions[check.skipReason]}`);
  }
  if (check.status === "failed" && check.category === "security") {
    const advisoryIds = (check.evidence ?? []).slice(0, 8)
      .filter((item) => item.kind === "security_finding")
      .flatMap((item) => item.advisoryIds ?? [])
      .filter((id) => /^CVE-[0-9]{4}-[0-9]{4,7}$/.test(id))
      .slice(0, 3);
    if (advisoryIds.length > 0) lines.push(`   Advisory IDs: ${[...new Set(advisoryIds)].join(", ")}`);
  }
  return lines;
}

function header(assessment: ShareableAssessment): string[] | null {
  const identity = safeIdentity(assessment);
  const score = safeNumber(assessment.report.readiness.score);
  const coverage = safeNumber(assessment.report.readiness.coverage);
  if (!identity || score === null || coverage === null) return null;
  const lines = ["DeployGuard AI assessment context", `Repository: ${identity}`];
  if (assessment.sourceCommitSha && /^[a-fA-F0-9]{40}$/.test(assessment.sourceCommitSha)) {
    lines.push(`Source commit: ${assessment.sourceCommitSha.toLowerCase()}`);
  }
  lines.push(`Readiness score: ${score}/100`, `Assessment coverage: ${coverage}%`,
    "Statuses below reflect deterministic checks. Diagnostic text and AI recommendations are omitted.");
  return lines;
}

export function serializeAiContext(assessment: ShareableAssessment): string | null {
  const lines = header(assessment);
  if (!lines) return null;
  lines.push("Verification checks:");
  assessment.report.checks.slice(0, 20).forEach((check, index) => {
    lines.push(...(checkLines(check, index) ?? []));
  });
  if (assessment.report.checks.length > 20) lines.push("Additional checks omitted.");
  return lines.join("\n").slice(0, 4000);
}

export function serializeFinding(assessment: ShareableAssessment, index: number): string | null {
  const lines = header(assessment);
  if (!lines || !Number.isInteger(index) || index < 0 || index >= assessment.report.checks.length) return null;
  const finding = checkLines(assessment.report.checks[index], index);
  if (!finding) return null;
  return [...lines, "Selected verification check:", ...finding].join("\n").slice(0, 1200);
}

export async function writeShareText(
  value: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined = typeof navigator === "undefined" ? undefined : navigator.clipboard,
): Promise<boolean> {
  if (!clipboard?.writeText) return false;
  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
