/**
 * A complete, private copy of the post-remediation source used for verification.
 * This is a capture primitive, not immutable storage: another host process with
 * the same UID (or greater privilege) can alter the source during capture or the
 * returned directory afterwards. Metadata checks cannot guarantee an atomic
 * capture of a concurrently modified host source. Later consumers must use
 * only the private captured tree, verify its recorded identity, and protect it
 * against host writes during verification. chmod or a Docker read-only mount
 * alone does not make the host directory immutable.
 *
 * Only exact cache/output names below are omitted. Generated source in src/,
 * dist/, or build/ is included. Symlinks, hard-linked files, special files,
 * non-NFC names, and colliding case-folded paths fail closed. Binary files are
 * copied byte-for-byte. Limits can only be reduced by a caller.
 */
import { createHash, type Hash } from "node:crypto";
import { constants, chmodSync, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readSync, readdirSync, realpathSync, rmSync, writeSync } from "node:fs";
import type { BigIntStats } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertArtifactCanBeDeleted } from "./frozen-artifact-ownership";

export interface FrozenSourceLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxEntries: number;
  maxDepth: number;
  maxPathBytes: number;
}

export const DEFAULT_FROZEN_SOURCE_LIMITS: Readonly<FrozenSourceLimits> = Object.freeze({
  maxFileBytes: 128 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
  maxEntries: 25_000,
  maxDepth: 40,
  maxPathBytes: 4_096,
});

const EXCLUDED_DIRECTORIES = new Set([
  ".git", "node_modules", ".next", ".deployguard", "coverage",
  ".turbo", ".cache", ".parcel-cache", ".pnpm-store", ".npm",
]);
const EXCLUDED_FILES = new Set([".git", ".eslintcache", ".stylelintcache"]);
const FORMAT = "deployguard-frozen-source-v1\0";
const CHUNK_BYTES = 64 * 1024;

export interface FrozenSourceSnapshot {
  /** Repository copy inside a private temporary directory. */
  readonly path: string;
  /** SHA-256 of a versioned, framed tree of normalized paths, types, modes, and full bytes. */
  readonly identity: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  cleanup(): void;
}

export interface FrozenSourceOptions {
  /** Overrides may only tighten the fixed security limits. */
  limits?: Partial<FrozenSourceLimits>;
  /** Mainly for isolated tests; the created child itself is private (0700). */
  temporaryParent?: string;
  /** Verify a captured tree without silently omitting newly injected cache names. */
  excludeCaches?: boolean;
}

export class FrozenSourceSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrozenSourceSnapshotError";
  }
}

function limitsFor(overrides: Partial<FrozenSourceLimits> | undefined): FrozenSourceLimits {
  const result = { ...DEFAULT_FROZEN_SOURCE_LIMITS };
  for (const key of Object.keys(result) as Array<keyof FrozenSourceLimits>) {
    const value = overrides?.[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1 || value > result[key])
      throw new FrozenSourceSnapshotError(`Invalid frozen source limit: ${key}`);
    result[key] = value;
  }
  return result;
}

function sameMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.size === right.size &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function assertInside(root: string, candidate: string): void {
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    throw new FrozenSourceSnapshotError("A source path escapes its root.");
}

function safeSegment(name: string): void {
  if (!name || name === "." || name === ".." || name !== name.normalize("NFC") ||
      /[\\/\0-\x1f\x7f]/.test(name))
    throw new FrozenSourceSnapshotError("Unsafe or non-normalized source path.");
}

function frame(hash: Hash, kind: "D" | "F", path: string, mode: number, size: bigint): void {
  const pathBytes = Buffer.from(path, "utf8");
  const header = Buffer.alloc(1 + 4 + pathBytes.length + 4 + 8);
  header.writeUInt8(kind.charCodeAt(0), 0);
  header.writeUInt32BE(pathBytes.length, 1);
  pathBytes.copy(header, 5);
  header.writeUInt32BE(mode, 5 + pathBytes.length);
  header.writeBigUInt64BE(size, 9 + pathBytes.length);
  hash.update(header);
}

function unlockAndRemove(root: string, directories: readonly string[]): void {
  for (const directory of directories) {
    try {
      if (lstatSync(directory).isDirectory()) chmodSync(directory, 0o700);
    } catch { /* The directory may already have been removed. */ }
  }
  rmSync(root, { recursive: true, force: true });
}

export function createFrozenSourceSnapshot(
  repositoryPath: string,
  options: FrozenSourceOptions = {},
): FrozenSourceSnapshot {
  const limits = limitsFor(options.limits);
  const sourceRoot = resolve(repositoryPath);
  const rootStat = lstatSync(sourceRoot, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new FrozenSourceSnapshotError("Repository root must be a real directory.");
  const sourceReal = realpathSync(sourceRoot);
  const parent = resolve(options.temporaryParent ?? tmpdir());
  if (!lstatSync(parent).isDirectory())
    throw new FrozenSourceSnapshotError("Snapshot parent must be a real directory.");
  const parentFromSource = relative(sourceReal, realpathSync(parent));
  if (parentFromSource === "" ||
      (parentFromSource !== ".." && !parentFromSource.startsWith(`..${sep}`) &&
        !isAbsolute(parentFromSource)))
    throw new FrozenSourceSnapshotError("Snapshot parent cannot be inside source.");

  const temporaryRoot = mkdtempSync(join(parent, "deployguard-frozen-source-"));
  const snapshotRoot = join(temporaryRoot, "repository");
  const directories: string[] = [temporaryRoot, snapshotRoot];
  const directoryModes = new Map<string, number>();
  const seen = new Set<string>();
  const hash = createHash("sha256").update(FORMAT);
  let entries = 0;
  let files = 0;
  let bytes = BigInt(0);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    assertArtifactCanBeDeleted(snapshotRoot);
    unlockAndRemove(temporaryRoot, directories);
    cleaned = true;
  };

  try {
    chmodSync(temporaryRoot, 0o700);
    mkdirSync(snapshotRoot, { mode: 0o700 });
    const visit = (sourceDirectory: string, targetDirectory: string,
      relativeDirectory: string, depth: number): void => {
      if (depth > limits.maxDepth)
        throw new FrozenSourceSnapshotError("Source traversal depth exceeded.");
      const before = lstatSync(sourceDirectory, { bigint: true });
      if (!before.isDirectory() || before.isSymbolicLink())
        throw new FrozenSourceSnapshotError("Source directory changed or is a symlink.");
      if (depth === 0 && !sameMetadata(rootStat, before))
        throw new FrozenSourceSnapshotError("Repository root changed during capture.");
      if ((Number(before.mode) & 0o7000) !== 0)
        throw new FrozenSourceSnapshotError("Special directory permission bits are unsupported.");
      const actual = realpathSync(sourceDirectory);
      assertInside(sourceReal, actual);
      const directoryMode = (Number(before.mode) & 0o555) | 0o500;
      frame(hash, "D", relativeDirectory, directoryMode, BigInt(0));
      directoryModes.set(targetDirectory, directoryMode);

      const children = readdirSync(sourceDirectory, { withFileTypes: true })
        .sort((a, b) => Buffer.compare(Buffer.from(a.name), Buffer.from(b.name)));
      for (const child of children) {
        safeSegment(child.name);
        const relativePath = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name;
        if (Buffer.byteLength(relativePath, "utf8") > limits.maxPathBytes)
          throw new FrozenSourceSnapshotError("Source path length exceeded.");
        const collisionKey = relativePath.toLowerCase();
        if (seen.has(collisionKey)) throw new FrozenSourceSnapshotError("Source path collision.");
        seen.add(collisionKey);
        const source = join(sourceDirectory, child.name);
        const target = join(targetDirectory, child.name);
        assertInside(sourceRoot, source);
        assertInside(snapshotRoot, target);

        if (++entries > limits.maxEntries)
          throw new FrozenSourceSnapshotError("Source entry limit exceeded.");
        const initial = lstatSync(source, { bigint: true });
        if (initial.isSymbolicLink())
          throw new FrozenSourceSnapshotError("Source symlinks are unsupported.");
        if (!initial.isDirectory() && !initial.isFile())
          throw new FrozenSourceSnapshotError("Special source files are unsupported.");
        if ((Number(initial.mode) & 0o7000) !== 0)
          throw new FrozenSourceSnapshotError("Special source permission bits are unsupported.");
        if (initial.isFile() && initial.nlink !== BigInt(1))
          throw new FrozenSourceSnapshotError("Hard-linked source files are unsupported.");

        // Only validated ordinary entries may be excluded by exact cache names.
        if (options.excludeCaches !== false && initial.isDirectory() && (EXCLUDED_DIRECTORIES.has(child.name) ||
            relativePath === ".yarn/cache")) continue;
        if (options.excludeCaches !== false && initial.isFile() && (EXCLUDED_FILES.has(child.name) ||
            child.name.endsWith(".tsbuildinfo"))) continue;
        if (initial.isDirectory()) {
          mkdirSync(target, { mode: 0o700 });
          directories.push(target);
          visit(source, target, relativePath, depth + 1);
        } else if (initial.isFile()) {
          if (initial.size > BigInt(limits.maxFileBytes) ||
              bytes + initial.size > BigInt(limits.maxTotalBytes))
            throw new FrozenSourceSnapshotError("Source byte limit exceeded.");
          const mode = 0o444 | (Number(initial.mode) & 0o111);
          frame(hash, "F", relativePath, mode, initial.size);
          const sourceFd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW);
          let targetFd: number | undefined;
          try {
            const opened = fstatSync(sourceFd, { bigint: true });
            if (!opened.isFile() || !sameMetadata(initial, opened))
              throw new FrozenSourceSnapshotError("Source file changed during capture.");
            targetFd = openSync(target, constants.O_WRONLY | constants.O_CREAT |
              constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
            let copied = BigInt(0);
            let count: number;
            while ((count = readSync(sourceFd, buffer, 0, buffer.length, null)) > 0) {
              copied += BigInt(count);
              if (copied > BigInt(limits.maxFileBytes) || bytes + copied > BigInt(limits.maxTotalBytes))
                throw new FrozenSourceSnapshotError("Source byte limit exceeded.");
              hash.update(buffer.subarray(0, count));
              let offset = 0;
              while (offset < count) {
                const written = writeSync(targetFd, buffer, offset, count - offset);
                if (written === 0) throw new FrozenSourceSnapshotError("Snapshot write made no progress.");
                offset += written;
              }
            }
            if (copied !== initial.size ||
                !sameMetadata(initial, fstatSync(sourceFd, { bigint: true })) ||
                !sameMetadata(initial, lstatSync(source, { bigint: true })))
              throw new FrozenSourceSnapshotError("Source file changed during capture.");
            bytes += copied;
            files++;
          } finally {
            if (targetFd !== undefined) closeSync(targetFd);
            closeSync(sourceFd);
          }
          chmodSync(target, mode);
        }
      }
      if (!sameMetadata(before, lstatSync(sourceDirectory, { bigint: true })))
        throw new FrozenSourceSnapshotError("Source directory changed during capture.");
    };
    visit(sourceRoot, snapshotRoot, "", 0);
    for (const [directory, mode] of [...directoryModes].reverse()) chmodSync(directory, mode);
    return { path: snapshotRoot, identity: hash.digest("hex"), fileCount: files,
      totalBytes: Number(bytes), cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
