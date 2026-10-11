/**
 * Restrictive policy for standard tarballs hosted by the public npm registry.
 *
 * Private registries, aliases, and custom tarball URLs are not yet supported.
 */
export function isAuthorizedNpmTarball(
  packageName: string,
  version: string,
  resolved: string,
): boolean {
  if (
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(packageName) ||
    !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version)
  ) {
    return false;
  }

  const basename = packageName.split("/").at(-1);

  if (!basename) {
    return false;
  }

  const expectedUrl =
    `https://registry.npmjs.org/${packageName}/-/${basename}-${version}.tgz`;

  return resolved === expectedUrl;
}
