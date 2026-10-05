import { cookieOptions, cookieValue, type DeveloperSession, newNonce, seal, unseal } from "@/lib/auth/developer-session";
import { parseGitHubRepositoryUrl } from "@/lib/repository/github-repository";

export const INSTALL_INTENT_COOKIE = "deployguard_install_intent";
export const INSTALL_RESULT_COOKIE = "deployguard_install_result";
export const INSTALL_MAX_AGE = 10 * 60;

export type InstallOutcome = "success" | "incomplete" | "unavailable";

interface InstallIntent {
  action: "assessment";
  nonce: string;
  repositoryUrl: string;
  developerId: string;
  expiresAt: number;
}

export interface InstallResult {
  action: "assessment";
  outcome: InstallOutcome;
  repositoryUrl: string;
  developerId: string;
  expiresAt: number;
}

export function createInstallIntent(repositoryUrl: string, developer: DeveloperSession): InstallIntent {
  return {
    action: "assessment",
    nonce: newNonce(),
    repositoryUrl: parseGitHubRepositoryUrl(repositoryUrl).url,
    developerId: developer.githubId,
    expiresAt: Date.now() + INSTALL_MAX_AGE * 1000,
  };
}

function validRepositoryUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return parseGitHubRepositoryUrl(value).url === value; } catch { return false; }
}

export function readInstallIntent(request: Request, developer: DeveloperSession, state: string | null): InstallIntent | null {
  const intent = unseal<InstallIntent>(cookieValue(request, INSTALL_INTENT_COOKIE));
  return intent && intent.action === "assessment" &&
    typeof intent.nonce === "string" && /^[A-Za-z0-9_-]{43}$/.test(intent.nonce) &&
    state === intent.nonce && intent.developerId === developer.githubId &&
    Number.isFinite(intent.expiresAt) && intent.expiresAt > Date.now() &&
    validRepositoryUrl(intent.repositoryUrl) ? intent : null;
}

export function readInstallResult(request: Request, developer: DeveloperSession): InstallResult | null {
  const result = unseal<InstallResult>(cookieValue(request, INSTALL_RESULT_COOKIE));
  return result && result.action === "assessment" &&
    ["success", "incomplete", "unavailable"].includes(result.outcome) &&
    result.developerId === developer.githubId &&
    Number.isFinite(result.expiresAt) && result.expiresAt > Date.now() &&
    validRepositoryUrl(result.repositoryUrl) ? result : null;
}

export function installCookie(value: object, name: string): string {
  return `${name}=${seal(value)}; ${cookieOptions(INSTALL_MAX_AGE)}`;
}

export function clearInstallCookie(name: string): string {
  return `${name}=; ${cookieOptions(0)}`;
}
