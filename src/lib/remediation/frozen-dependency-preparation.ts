/** Isolated npm dependency preparation for a previously captured source tree.
 * Host-side identity checks detect ordinary tampering but cannot make a capture
 * atomic against a concurrent host writer. Consumers must verify both identities
 * immediately before use and protect the private trees from host writes.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdtempSync,
  mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, readSync, realpathSync, rmSync,
  statSync, type BigIntStats } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runDockerSandboxCommand } from "@/lib/sandbox/docker-sandbox";
import { SandboxContainerStateUnknownError } from "@/lib/sandbox/docker-sandbox";
import { assertArtifactCanBeDeleted, FrozenArtifactContainerStateError, holdArtifacts } from "./frozen-artifact-ownership";
import { SANDBOX_RUNTIME_IMAGE } from "@/lib/sandbox/dependency-cache";
import { isAuthorizedNpmTarball } from "./npm-tarball-policy";
import { createFrozenSourceSnapshot, type FrozenSourceSnapshot } from "./frozen-source-snapshot";

export class FrozenDependencyPreparationError extends Error {
  constructor(message: string) { super(message); this.name = "FrozenDependencyPreparationError"; }
}
export interface PreparedFrozenDependencies {
  readonly path: string;
  readonly sourceIdentity: string;
  readonly dependencyIdentity: string;
  readonly lockIdentity: string;
  verify(): void;
  cleanup(): void;
}
const HEX = /^[0-9a-f]{64}$/;
const MAX_ENTRIES = 100_000;
const MAX_BYTES = 1024 * 1024 * 1024;
const MAX_DEPTH = 60;
function fail(message: string): never { throw new FrozenDependencyPreparationError(message); }
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function requiredFile(path: string): Buffer {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== BigInt(1)) fail("Required npm file is unsafe.");
  if (stat.size > BigInt(16 * 1024 * 1024)) fail("Required npm file is too large.");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!sameEntry(stat, fstatSync(fd, { bigint: true }))) fail("Required npm file changed.");
    const content = readFileSync(fd);
    if (BigInt(content.length) !== stat.size || !sameEntry(stat, fstatSync(fd, { bigint: true })) ||
        !sameEntry(stat, lstatSync(path, { bigint: true }))) fail("Required npm file changed.");
    return content;
  } finally { closeSync(fd); }
}
function validateNpmInput(root: string): { manifest: Buffer; lock: Buffer; packages: Record<string, unknown> } {
  for (const name of ["pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json", "pnpm-workspace.yaml", ".npmrc", ".yarnrc.yml"])
    if (readdirSync(root).includes(name)) fail(`Unsupported package-manager layout: ${name}`);
  let manifest: Buffer; let lock: Buffer;
  try { manifest = requiredFile(join(root, "package.json")); lock = requiredFile(join(root, "package-lock.json")); }
  catch (error) { if (error instanceof FrozenDependencyPreparationError) throw error; return fail("package.json and package-lock.json are required."); }
  let pkg: Record<string, unknown> | null; let locked: Record<string, unknown> | null;
  try { pkg = object(JSON.parse(manifest.toString("utf8"))); locked = object(JSON.parse(lock.toString("utf8"))); }
  catch { return fail("Invalid npm manifest or lockfile JSON."); }
  const packages = object(locked?.packages);
  const lockRoot = object(packages?.[""]);
  if (!pkg || !locked || locked.lockfileVersion !== 3 || !packages || !lockRoot)
    fail("Unsupported npm lockfile layout.");
  if (pkg.workspaces !== undefined) fail("Unsupported package-manager layout.");
  if (pkg.packageManager !== undefined && (typeof pkg.packageManager !== "string" || !/^npm@10\.\d+\.\d+$/.test(pkg.packageManager)))
    fail("Unsupported package-manager declaration.");
  for (const field of ["name", "version", "dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])
    if (!isDeepStrictEqual(pkg[field] ?? {}, lockRoot[field] ?? {}))
      fail(`Manifest and lockfile disagree on ${field}.`);
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const section = pkg[field];
    if (section !== undefined && !object(section)) fail(`Invalid ${field} section.`);
    for (const spec of Object.values(object(section) ?? {}))
      if (typeof spec !== "string" || /^(?:file:|link:|workspace:|git\+|https?:)/.test(spec))
        fail("Unsupported dependency specification.");
  }
  for (const [path, value] of Object.entries(packages)) {
    if (path === "") continue;
    if (!/^node_modules\/(?:@[^/]+\/)?[^/]+(?:\/node_modules\/(?:@[^/]+\/)?[^/]+)*$/.test(path) ||
        path.split("/").some((segment) => segment === "." || segment === "..") ||
        !object(value) || object(value)?.link === true)
      fail("Unsupported lockfile package entry.");
    const metadata = object(value)!;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    if (typeof metadata.version !== "string" || typeof metadata.resolved !== "string" ||
        typeof metadata.integrity !== "string" ||
        !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(metadata.integrity) ||
        !isAuthorizedNpmTarball(name, metadata.version, metadata.resolved))
      fail("Unsupported or unverifiable lockfile package.");
  }
  return { manifest, lock, packages };
}
function verifySource(snapshot: FrozenSourceSnapshot, identity: string): void {
  if (!HEX.test(identity) || snapshot.identity !== identity) fail("Frozen source identity mismatch.");
  const copy = createFrozenSourceSnapshot(snapshot.path, { excludeCaches: false });
  try { if (copy.identity !== identity) fail("Frozen source tree changed."); }
  finally { copy.cleanup(); }
}
function sameEntry(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.size === right.size && left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
function stableNames(directory: string): string[] {
  return readdirSync(directory).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
}
function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
function treeIdentity(root: string): string {
  const hash = createHash("sha256").update("deployguard-frozen-dependencies-v1\0");
  const seen = new Set<string>(); let entries = 0; let bytes = 0;
  function visit(directory: string, prefix: string, depth: number): void {
    if (depth > MAX_DEPTH) fail("Dependency tree depth exceeded.");
    const before = lstatSync(directory, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink()) fail("Dependency directory changed or is unsafe.");
    const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (!sameEntry(before, fstatSync(directoryFd, { bigint: true }))) fail("Dependency directory changed.");
      const names = stableNames(directory);
      for (const name of names) {
      if (!name || name !== name.normalize("NFC") || /[\\/\0-\x1f\x7f]/.test(name)) fail("Unsafe dependency path.");
      const path = prefix ? `${prefix}/${name}` : name;
      if (Buffer.byteLength(path) > 4096 || ++entries > MAX_ENTRIES) fail("Dependency traversal limit exceeded.");
      const key = path.toLowerCase(); if (seen.has(key)) fail("Dependency path collision."); seen.add(key);
      const absolute = join(directory, name); const stat = lstatSync(absolute, { bigint: true });
      if (stat.mode & BigInt(0o7000)) fail("Unsafe dependency mode.");
      const pathBytes = Buffer.from(path);
      const frame = (kind: number, size: number) => {
        const header = Buffer.alloc(17);
        header.writeUInt8(kind, 0);
        header.writeUInt32BE(pathBytes.length, 1);
        header.writeUInt32BE(Number(stat.mode & BigInt(0o777)), 5);
        header.writeBigUInt64BE(BigInt(size), 9);
        hash.update(header).update(pathBytes);
      };
      if (stat.isDirectory()) {
        frame(68, 0);
        visit(absolute, path, depth + 1);
      } else if (stat.isFile()) {
        if (stat.nlink !== BigInt(1) || stat.size > BigInt(128 * 1024 * 1024) ||
            BigInt(bytes) + stat.size > BigInt(MAX_BYTES)) fail("Unsafe dependency file.");
        const fileFd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          if (!sameEntry(stat, fstatSync(fileFd, { bigint: true }))) fail("Dependency file replaced before reading.");
          frame(70, Number(stat.size));
          const buffer = Buffer.allocUnsafe(64 * 1024);
          let copied = BigInt(0);
          let count: number;
          while ((count = readSync(fileFd, buffer, 0, buffer.length, null)) > 0) {
            copied += BigInt(count);
            if (copied > stat.size) fail("Dependency file changed while reading.");
            hash.update(buffer.subarray(0, count));
          }
          if (copied !== stat.size || !sameEntry(stat, fstatSync(fileFd, { bigint: true })) ||
              !sameEntry(stat, lstatSync(absolute, { bigint: true })))
            fail("Dependency file changed while reading.");
          bytes += Number(copied);
        } finally { closeSync(fileFd); }
      } else if (stat.isSymbolicLink()) {
        const target = readlinkSync(absolute);
        if (isAbsolute(target)) fail("Absolute dependency symlink.");
        const resolved = resolve(dirname(absolute), target);
        if (!inside(root, resolved)) fail("Escaping dependency symlink.");
        const actual = realpathSync(absolute);
        if (!inside(root, actual) || !statSync(actual).isFile())
          fail("Unsafe dependency symlink target.");
        if (readlinkSync(absolute) !== target || !sameEntry(stat, lstatSync(absolute, { bigint: true })))
          fail("Dependency symlink changed during hashing.");
        const targetBytes = Buffer.from(target);
        frame(76, targetBytes.length); hash.update(targetBytes);
      } else fail("Unsupported dependency special file.");
      if (!sameEntry(stat, lstatSync(absolute, { bigint: true })))
        fail("Dependency entry changed during hashing.");
      }
      const afterNames = stableNames(directory);
      if (names.length !== afterNames.length || names.some((name, index) => name !== afterNames[index]) ||
          !sameEntry(before, fstatSync(directoryFd, { bigint: true })) ||
          !sameEntry(before, lstatSync(directory, { bigint: true })))
        fail("Dependency directory changed during hashing.");
    } finally { closeSync(directoryFd); }
  }
  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) fail("Dependency root is unsafe.");
  visit(root, "", 0);
  if (entries === 0) fail("Dependency installation is empty.");
  return hash.digest("hex");
}
function verifyInstalledPackages(root: string, packages: Record<string, unknown>): void {
  const moduleRoot = join(root, "node_modules");
  if (!existsSync(moduleRoot) || !lstatSync(moduleRoot).isDirectory()) fail("Dependency installation is incomplete.");
  const found = new Set<string>();
  const binDirectories: string[] = [];
  function inventory(directory: string, prefix: string): void {
    for (const name of readdirSync(directory)) {
      if (name === ".package-lock.json") continue;
      if (name === ".bin") {
        const binDirectory = join(directory, name);
        if (!lstatSync(binDirectory).isDirectory()) fail("Unsafe .bin directory.");
        binDirectories.push(binDirectory);
        continue;
      }
      if (name.startsWith("@")) {
        const scope = join(directory, name);
        if (!lstatSync(scope).isDirectory()) fail("Unsafe installed package scope.");
        for (const child of readdirSync(scope)) packageAt(join(scope, child), `${prefix}/@${name.slice(1)}/${child}`);
      } else packageAt(join(directory, name), `${prefix}/${name}`);
    }
  }
  function packageAt(directory: string, path: string): void {
    if (!lstatSync(directory).isDirectory() || !Object.hasOwn(packages, path))
      fail(`Unlisted or unsafe installed package: ${path}`);
    found.add(path);
    const nested = join(directory, "node_modules");
    if (readdirSync(directory).includes("node_modules")) inventory(nested, `${path}/node_modules`);
  }
  inventory(moduleRoot, "node_modules");
  const allowedBins = new Map<string, { declared: string; packageRoot: string }>();
  for (const [path, entry] of Object.entries(packages)) {
    if (!path) continue;
    if (!found.has(path)) fail(`Installed package is missing: ${path}`);
    const expected = object(entry)?.version;
    if (typeof expected !== "string") fail("Lockfile package lacks a version.");
    const dir = join(root, path);
    let pkg: Record<string, unknown> | null;
    try { if (!lstatSync(dir).isDirectory()) fail("Installed package is missing.");
      pkg = object(JSON.parse(requiredFile(join(dir, "package.json")).toString("utf8"))); }
    catch { return fail(`Installed package is missing or unsafe: ${path}`); }
    if (pkg?.version !== expected) fail(`Installed package version mismatch: ${path}`);
    const packageName = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const binRoot = join(root, path.slice(0, path.lastIndexOf("node_modules/") + "node_modules".length), ".bin");
    const bins = typeof pkg.bin === "string" ? { [packageName.split("/").at(-1)!]: pkg.bin } :
      pkg.bin === undefined ? {} : object(pkg.bin);
    if (!bins) fail(`Invalid installed bin metadata: ${path}`);
    for (const [command, target] of Object.entries(bins)) {
      if (!/^[A-Za-z0-9_.-]+$/.test(command) || typeof target !== "string" ||
          isAbsolute(target) || target.includes("\\")) fail(`Unsafe installed bin metadata: ${path}`);
      const declared = resolve(dir, target);
      if (!inside(dir, declared) || declared === dir) fail(`Escaping installed bin target: ${path}`);
      allowedBins.set(join(binRoot, command), { declared, packageRoot: dir });
    }
  }
  for (const binDirectory of binDirectories) {
    for (const name of readdirSync(binDirectory)) {
      const link = join(binDirectory, name);
      const before = lstatSync(link, { bigint: true });
      if (!before.isSymbolicLink()) fail(`Unsafe .bin entry: ${name}`);
      const target = readlinkSync(link);
      if (isAbsolute(target)) fail(`Unsafe .bin link: ${name}`);
      const resolved = resolve(binDirectory, target);
      const allowed = allowedBins.get(link);
      if (!allowed || resolved !== allowed.declared || !inside(allowed.packageRoot, resolved))
        fail(`Unsafe .bin link: ${name}`);
      const actual = realpathSync(link);
      if (!inside(allowed.packageRoot, actual) || !statSync(actual).isFile() ||
          readlinkSync(link) !== target || !sameEntry(before, lstatSync(link, { bigint: true })))
        fail(`Unsafe .bin link: ${name}`);
    }
  }
}
export async function prepareFrozenNpmDependencies(
  snapshot: FrozenSourceSnapshot, sourceIdentity: string,
  options: { temporaryParent?: string } = {},
): Promise<PreparedFrozenDependencies> {
  verifySource(snapshot, sourceIdentity);
  const input = validateNpmInput(snapshot.path);
  const lockIdentity = createHash("sha256").update(input.manifest).update("\0").update(input.lock).digest("hex");
  const parent = resolve(options.temporaryParent ?? tmpdir());
  const fromSource = relative(realpathSync(snapshot.path), realpathSync(parent));
  if (!lstatSync(parent).isDirectory() || fromSource === "" ||
      (fromSource !== ".." && !fromSource.startsWith(`..${sep}`) && !isAbsolute(fromSource)))
    fail("Unsafe dependency staging parent.");
  const temporaryRoot = mkdtempSync(join(parent, "deployguard-frozen-deps-"));
  const workspace = join(temporaryRoot, "workspace");
  let cleaned = false;
  const cleanup = () => { if (!cleaned) { assertArtifactCanBeDeleted(workspace);
    assertArtifactCanBeDeleted(join(workspace, "node_modules"));
    rmSync(temporaryRoot, { recursive: true, force: true }); cleaned = true; } };
  try {
    mkdirSync(workspace, { mode: 0o700 });
    copyFileSync(join(snapshot.path, "package.json"), join(workspace, "package.json"));
    copyFileSync(join(snapshot.path, "package-lock.json"), join(workspace, "package-lock.json"));
    if (!readFileSync(join(workspace, "package.json")).equals(input.manifest) ||
        !readFileSync(join(workspace, "package-lock.json")).equals(input.lock)) fail("Staging inputs changed.");
    verifySource(snapshot, sourceIdentity);
    const uid = typeof process.getuid === "function" ? process.getuid() : 1000;
    const gid = typeof process.getgid === "function" ? process.getgid() : 1000;
    const release = holdArtifacts([snapshot.path, workspace]);
    let result: Awaited<ReturnType<typeof runDockerSandboxCommand>> | undefined;
    let unknown = false;
    try { result = await runDockerSandboxCommand({ repositoryPath: workspace,
      command: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
      network: "bridge", user: `${uid}:${gid}`,
      environment: { HOME: "/tmp", CI: "true", npm_config_cache: "/tmp/npm-cache",
        npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false",
        npm_config_fetch_retries: "0", npm_config_fetch_timeout: "30000" },
      limits: { memoryMb: 2048, cpus: 1, timeoutMs: 5 * 60 * 1000 },
    }); }
    catch (error) {
      if (error instanceof SandboxContainerStateUnknownError) {
        unknown = true;
        throw new FrozenArtifactContainerStateError(error, [snapshot.path, workspace], workspace,
          () => { release(); cleanup(); });
      }
      throw error;
    }
    finally { /* Unknown state retains the lease through the error's reconciliation closure. */
      if (!unknown) release(); }
    if (!result) fail("Isolated npm ci returned no result.");
    if (result.status !== "passed" || result.exitCode !== 0) fail("Isolated npm ci did not complete successfully.");
    verifySource(snapshot, sourceIdentity);
    if (!readFileSync(join(workspace, "package.json")).equals(input.manifest) ||
        !readFileSync(join(workspace, "package-lock.json")).equals(input.lock)) fail("Staging inputs changed during install.");
    const dependencies = join(workspace, "node_modules");
    verifyInstalledPackages(workspace, input.packages);
    const dependencyIdentity = createHash("sha256").update("deployguard-prepared-npm-v1\0")
      .update(SANDBOX_RUNTIME_IMAGE).update("\0").update(sourceIdentity).update("\0")
      .update(lockIdentity).update("\0").update(treeIdentity(dependencies)).digest("hex");
    const verify = () => {
      verifySource(snapshot, sourceIdentity);
      if (!readFileSync(join(workspace, "package.json")).equals(input.manifest) ||
          !readFileSync(join(workspace, "package-lock.json")).equals(input.lock)) fail("Prepared inputs changed.");
      verifyInstalledPackages(workspace, input.packages);
      const current = createHash("sha256").update("deployguard-prepared-npm-v1\0")
        .update(SANDBOX_RUNTIME_IMAGE).update("\0").update(sourceIdentity).update("\0")
        .update(lockIdentity).update("\0").update(treeIdentity(dependencies)).digest("hex");
      if (current !== dependencyIdentity) fail("Prepared dependency tree changed.");
    };
    return { path: dependencies, sourceIdentity, lockIdentity, dependencyIdentity, verify, cleanup };
  } catch (error) {
    if (!(error instanceof FrozenArtifactContainerStateError)) cleanup();
    throw error;
  }
}
