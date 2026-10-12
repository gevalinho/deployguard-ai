import { isAuthorizedNpmTarball } from "./npm-tarball-policy";

export interface NpmRegistryVerification {
  valid: boolean;
  reason: string;
}

export async function verifyNpmRegistryMetadata(
  packageName: string,
  version: string,
  resolved: string,
  integrity: string,
): Promise<NpmRegistryVerification> {
  const reject = (reason: string): NpmRegistryVerification => ({
    valid: false,
    reason,
  });

  if (
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName) ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)
  ) {
    return reject("Invalid npm package identity or version.");
  }

  if (
    !integrity.startsWith("sha512-") ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)
  ) {
    return reject("Missing or malformed SHA-512 integrity.");
  }

  if (!isAuthorizedNpmTarball(packageName, version, resolved)) {
    return reject("Unauthorized npm tarball URL.");
  }

  const metadataUrl =
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`;

  try {
    const response = await fetch(metadataUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
      redirect: "error",
    });

    if (!response.ok) {
      return reject(`npm registry returned HTTP ${response.status}.`);
    }

    const metadata: unknown = await response.json();

    if (
      metadata === null ||
      typeof metadata !== "object" ||
      Array.isArray(metadata)
    ) {
      return reject("Invalid npm registry metadata.");
    }

    const entry = metadata as Record<string, unknown>;
    const dist = entry.dist;

    if (
      dist === null ||
      typeof dist !== "object" ||
      Array.isArray(dist)
    ) {
      return reject("Missing npm distribution metadata.");
    }

    const distribution = dist as Record<string, unknown>;

    if (
      entry.name !== packageName ||
      entry.version !== version ||
      distribution.tarball !== resolved ||
      distribution.integrity !== integrity
    ) {
      return reject("Lockfile metadata does not match the npm registry.");
    }

    return {
      valid: true,
      reason: "Lockfile metadata matches the npm registry.",
    };
  } catch {
    return reject("Unable to verify npm registry metadata.");
  }
}
