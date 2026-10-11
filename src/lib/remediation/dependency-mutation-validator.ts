import { isAuthorizedNpmTarball } from "./npm-tarball-policy";
import { isDeepStrictEqual } from "node:util";
import type { VerifiedPatch } from "./verified-patch";

type JsonObject = Record<string, unknown>;

export interface DependencyMutationValidation {
  valid: boolean;
  reason: string;
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function parseObject(content: string | undefined): JsonObject | null {
  if (content === undefined) return null;
  try {
    return object(JSON.parse(content));
  } catch {
    return null;
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}

export function validateDependencyMutation(
  patch: VerifiedPatch,
  packageName: string,
  expectedVersion: string,
): DependencyMutationValidation {
  const reject = (reason: string): DependencyMutationValidation => ({
    valid: false,
    reason,
  });

  if (!packageName || !expectedVersion) {
    return reject("Missing authorized package or version.");
  }

  if (
    patch.files.length !== 2 ||
    patch.fileCount !== 2 ||
    patch.files.filter((file) => file.path === "package.json").length !== 1 ||
    patch.files.filter((file) => file.path === "package-lock.json").length !== 1
  ) {
    return reject(
      "Dependency repair must contain exactly one manifest and one lockfile change.",
    );
  }

  if (
    patch.files.some(
      (file) =>
        file.path !== "package.json" && file.path !== "package-lock.json",
    )
  ) {
    return reject("Unexpected file changed during dependency repair.");
  }

  const manifestChange = patch.files.find(
    (file) => file.path === "package.json",
  );

  const lockChange = patch.files.find(
    (file) => file.path === "package-lock.json",
  );

  if (
    !manifestChange ||
    !lockChange ||
    manifestChange.changeType !== "modified" ||
    lockChange.changeType !== "modified"
  ) {
    return reject("Both existing npm dependency files must be modified.");
  }

  const before = parseObject(manifestChange.before);
  const after = parseObject(manifestChange.after);
  const lockBefore = parseObject(lockChange.before);
  const lockAfter = parseObject(lockChange.after);

  if (!before || !after || !lockBefore || !lockAfter) {
    return reject("Invalid dependency manifest or lockfile JSON.");
  }

  const beforeProd = object(before.dependencies) ?? {};
  const beforeDev = object(before.devDependencies) ?? {};
  const afterProd = object(after.dependencies) ?? {};
  const afterDev = object(after.devDependencies) ?? {};

  const inProd = Object.hasOwn(beforeProd, packageName);
  const inDev = Object.hasOwn(beforeDev, packageName);

  if (inProd === inDev) {
    return reject("Target must be declared in exactly one dependency section.");
  }

  const section = inProd ? "dependencies" : "devDependencies";

  if ((inProd ? afterProd : afterDev)[packageName] !== expectedVersion) {
    return reject("Target dependency does not match the authorized version.");
  }

  const expectedManifest = structuredClone(before);
  const expectedSection = object(expectedManifest[section]);

  if (!expectedSection) {
    return reject("Original dependency section is invalid.");
  }

  expectedSection[packageName] = expectedVersion;

  if (!sameJson(expectedManifest, after)) {
    return reject(
      "Manifest contains changes beyond the authorized dependency.",
    );
  }

  const lockPackages = object(lockAfter.packages);
  const lockRoot = object(lockPackages?.[""]);
  const installed = object(lockPackages?.[`node_modules/${packageName}`]);
  const lockSection = object(lockRoot?.[section]);

  if (
    lockAfter.lockfileVersion !== 3 ||
    lockSection?.[packageName] !== expectedVersion ||
    installed?.version !== expectedVersion
  ) {
    return reject("Lockfile does not match the authorized dependency version.");
  }

  const beforePackages = object(lockBefore.packages);
  const afterPackages = object(lockAfter.packages);

  if (!beforePackages || !afterPackages) {
    return reject("Invalid npm lockfile package inventory.");
  }

  const expectedLock = structuredClone(lockBefore);
  const expectedPackages = object(expectedLock.packages);
  const expectedRoot = object(expectedPackages?.[""]);
  const expectedRootSection = object(expectedRoot?.[section]);
  const expectedInstalled = object(
    expectedPackages?.[`node_modules/${packageName}`],
  );

  if (!expectedRootSection || !expectedInstalled) {
    return reject(
      "Original lockfile does not contain the authorized dependency.",
    );
  }

  expectedRootSection[packageName] = expectedVersion;

  const originalInstalled = object(
    beforePackages[`node_modules/${packageName}`],
  );
  const updatedInstalled = object(afterPackages[`node_modules/${packageName}`]);

  if (!originalInstalled || !updatedInstalled) {
    return reject("Missing original or updated target package metadata.");
  }

  const originalResolved = originalInstalled.resolved;
  const updatedResolved = updatedInstalled.resolved;

  if (
    typeof originalResolved !== "string" ||
    typeof updatedResolved !== "string"
  ) {
    return reject("Target package download origin cannot be verified.");
  } else {
    try {
      const originalUrl = new URL(originalResolved);
      const updatedUrl = new URL(updatedResolved);

      if (
        originalUrl.protocol !== "https:" ||
        updatedUrl.protocol !== "https:" ||
        originalUrl.origin !== updatedUrl.origin ||
        !isAuthorizedNpmTarball(
          packageName,
          expectedVersion,
          updatedResolved,
        ) ||
        originalUrl.username ||
        originalUrl.password ||
        updatedUrl.username ||
        updatedUrl.password
      ) {
        return reject("Target package download origin is unauthorized.");
      }
    } catch {
      return reject("Invalid target package download URL.");
    }
  }

  // The authorized package may acquire new npm metadata.
  // Its installed version is checked separately above.
  const targetPath = `node_modules/${packageName}`;
  expectedPackages![targetPath] = structuredClone(afterPackages[targetPath]);

  if (!sameJson(expectedLock, lockAfter)) {
    return reject(
      "Lockfile contains changes beyond the authorized dependency.",
    );
  }

  return {
    valid: true,
    reason: "Direct dependency mutation matches the authorized version.",
  };
}
