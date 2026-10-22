import { constants, closeSync, fstatSync, lstatSync, mkdtempSync, openSync,
  readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const PREFIX = "deployguard-preparation-owner-";
const DIRECTORY = /^deployguard-preparation-owner-[A-Za-z0-9]+$/;

export interface PreparationOwnershipRecord {
  version: 1;
  workspacePath: string;
  createdAt: string;
}

/** A private recovery pointer, never permission to delete the workspace. */
export function createPreparationOwnershipRecord(workspacePath: string): {
  directory: string;
  discard: () => void;
} {
  const directory = mkdtempSync(join(tmpdir(), PREFIX));
  try {
    writeFileSync(join(directory, "resources.json"), JSON.stringify({
      version: 1, workspacePath: resolve(workspacePath), createdAt: new Date().toISOString(),
    } satisfies PreparationOwnershipRecord), { mode: 0o600, flag: "wx" });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return { directory, discard: () => rmSync(directory, { recursive: true, force: true }) };
}

export function readPreparationOwnershipRecord(directory: string): PreparationOwnershipRecord {
  const path = resolve(directory);
  if (dirname(path) !== resolve(tmpdir()) || !DIRECTORY.test(basename(path)))
    throw new Error("Invalid preparation ownership directory.");
  const directoryStat = lstatSync(path);
  if (!directoryStat.isDirectory() || directoryStat.uid !== process.getuid?.() ||
      (directoryStat.mode & 0o077) !== 0)
    throw new Error("Invalid preparation ownership directory.");
  const fd = openSync(join(path, "resources.json"),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > 4096 ||
        stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)
      throw new Error("Invalid preparation ownership record.");
    const value: unknown = JSON.parse(readFileSync(fd, "utf8"));
    if (!value || typeof value !== "object") throw new Error("Invalid preparation ownership record.");
    const record = value as Partial<PreparationOwnershipRecord>;
    if (record.version !== 1 || typeof record.workspacePath !== "string" ||
        !isAbsolute(record.workspacePath) || resolve(record.workspacePath) !== record.workspacePath ||
        typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt)))
      throw new Error("Invalid preparation ownership record.");
    return record as PreparationOwnershipRecord;
  } finally { closeSync(fd); }
}
