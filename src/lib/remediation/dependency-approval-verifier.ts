import type { VerifiedPatch } from "./verified-patch";
import { validateDependencyMutation } from "./dependency-mutation-validator";
import { verifyNpmRegistryMetadata } from "./npm-registry-verifier";

export interface DependencyApprovalResult {
  valid: boolean;
  reason: string;
}

export async function verifyDependencyApproval(
  patch: VerifiedPatch,
  packageName: string,
  expectedVersion: string,
): Promise<DependencyApprovalResult> {
  const reject = (reason: string): DependencyApprovalResult => ({
    valid: false,
    reason,
  });

  const mutation = validateDependencyMutation(
    patch,
    packageName,
    expectedVersion,
  );

  if (!mutation.valid) {
    return reject(mutation.reason);
  }

  const lockChange = patch.files.find(
    (file) => file.path === "package-lock.json",
  );

  if (typeof lockChange?.after !== "string") {
    return reject("Updated npm lockfile is missing.");
  }

  let lockfile: unknown;

  try {
    lockfile = JSON.parse(lockChange.after);
  } catch {
    return reject("Updated npm lockfile is invalid.");
  }

  if (
    !lockfile ||
    typeof lockfile !== "object" ||
    Array.isArray(lockfile)
  ) {
    return reject("Updated npm lockfile is invalid.");
  }

  const packages = (lockfile as Record<string, unknown>).packages;

  if (
    !packages ||
    typeof packages !== "object" ||
    Array.isArray(packages)
  ) {
    return reject("Updated npm package inventory is invalid.");
  }

  const target = (packages as Record<string, unknown>)[
    `node_modules/${packageName}`
  ];

  if (
    !target ||
    typeof target !== "object" ||
    Array.isArray(target)
  ) {
    return reject("Authorized npm package metadata is missing.");
  }

  const metadata = target as Record<string, unknown>;

  if (
    metadata.version !== expectedVersion ||
    typeof metadata.resolved !== "string" ||
    typeof metadata.integrity !== "string"
  ) {
    return reject("Authorized npm package metadata is incomplete.");
  }

  const registry = await verifyNpmRegistryMetadata(
    packageName,
    expectedVersion,
    metadata.resolved,
    metadata.integrity,
  );

  if (!registry.valid) {
    return reject(registry.reason);
  }

  return {
    valid: true,
    reason: "Dependency mutation and npm registry metadata verified.",
  };
}
