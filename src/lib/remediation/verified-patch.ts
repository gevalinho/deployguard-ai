import {
  readFileSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";

import {
  relative,
  resolve,
} from "node:path";

import {
  createHash,
} from "node:crypto";

export interface WorkspaceFileSnapshot {
  path: string;
  hash: string;
  content: string;
}

export interface WorkspaceSnapshot {
  files:
    Map<string, WorkspaceFileSnapshot>;
  dependencyHashes: Map<string, string>;
}

export interface VerifiedPatchFile {
  path: string;

  changeType:
    | "added"
    | "modified"
    | "deleted";

  before?: string;
  after?: string;
}

export interface VerifiedPatch {
  files: VerifiedPatchFile[];
  fileCount: number;
}

const EXCLUDED_DIRECTORIES =
  new Set([
    ".git",
    "node_modules",
    ".next",
    ".deployguard",
    "dist",
    "build",
    "coverage",
  ]);

const MAX_FILE_BYTES =
  512 * 1024;

export function isDependencyFile(path: string): boolean {
  const name = path.split("/").at(-1);
  return name === "package.json" || name === "package-lock.json" ||
    name === "npm-shrinkwrap.json" || name === "pnpm-lock.yaml" ||
    name === "pnpm-workspace.yaml" || name === "yarn.lock";
}

function hashFile(path: string): string {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(64 * 1024);
  const fd = openSync(path, "r");
  try {
    let bytes: number;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
    return hash.digest("hex");
  } finally { closeSync(fd); }
}

export class IncompleteDependencyArtifactError extends Error {
  constructor() {
    super("A changed dependency file could not be captured within the verified artifact limits.");
    this.name = "IncompleteDependencyArtifactError";
  }
}

function hashContent(
  content: string
): string {
  return createHash("sha256")
    .update(content)
    .digest("hex");
}

function collectFiles(
  repositoryPath: string,
  currentPath: string,
  files: Map<
    string,
    WorkspaceFileSnapshot
  >,
  dependencyHashes: Map<string, string>,
): void {
  const entries =
    readdirSync(
      currentPath,
      {
        withFileTypes: true,
      }
    );

  for (const entry of entries) {
    const absolutePath =
      resolve(
        currentPath,
        entry.name
      );

    if (entry.isSymbolicLink() && !EXCLUDED_DIRECTORIES.has(entry.name)) {
      try {
        if (statSync(absolutePath).isDirectory()) throw new IncompleteDependencyArtifactError();
      } catch (error) {
        if (error instanceof IncompleteDependencyArtifactError) throw error;
      }
    }

    if (entry.isDirectory()) {
      if (
        EXCLUDED_DIRECTORIES.has(
          entry.name
        )
      ) {
        continue;
      }

      collectFiles(
        repositoryPath,
        absolutePath,
        files,
        dependencyHashes,
      );

      continue;
    }

    if (!entry.isFile()) {
      const path = relative(repositoryPath, absolutePath).replaceAll("\\", "/");
      if (isDependencyFile(path)) throw new IncompleteDependencyArtifactError();
      continue;
    }

    const stats =
      statSync(
        absolutePath
      );

    const path = relative(repositoryPath, absolutePath).replaceAll("\\", "/");
    if (isDependencyFile(path)) {
      try { dependencyHashes.set(path, hashFile(absolutePath)); }
      catch { throw new IncompleteDependencyArtifactError(); }
    }

    /*
     * v1 deliberately ignores large files.
     *
     * Verified patches should remain bounded
     * before crossing the public API boundary.
     */
    if (
      stats.size >
      MAX_FILE_BYTES
    ) {
      continue;
    }

    let content: string;

    try {
      content = isDependencyFile(path)
        ? new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(absolutePath))
        : readFileSync(absolutePath, "utf8");
    } catch {
      if (isDependencyFile(path)) throw new IncompleteDependencyArtifactError();
      /*
       * Binary or unreadable files are excluded
       * from the text patch representation.
       */
      continue;
    }

    files.set(
      path,
      {
        path,
        content,
        hash:
          hashContent(
            content
          ),
      }
    );
  }
}

export function captureWorkspaceSnapshot(
  repositoryPath: string
): WorkspaceSnapshot {
  const files =
    new Map<
      string,
      WorkspaceFileSnapshot
    >();
  const dependencyHashes = new Map<string, string>();

  collectFiles(repositoryPath, repositoryPath, files, dependencyHashes);

  return {
    files,
    dependencyHashes,
  };
}

export function createVerifiedPatch(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot
): VerifiedPatch {
  const paths =
    new Set([
      ...before.files.keys(),
      ...after.files.keys(),
    ]);

  const files:
    VerifiedPatchFile[] = [];

  const changedDependencies = new Set([...before.dependencyHashes.keys(), ...after.dependencyHashes.keys()]
    .filter((path) => before.dependencyHashes.get(path) !== after.dependencyHashes.get(path)));

  for (
    const path of
    [...paths].sort()
  ) {
    const beforeFile =
      before.files.get(path);

    const afterFile =
      after.files.get(path);

    if (
      beforeFile &&
      !afterFile
    ) {
      files.push({
        path,
        changeType: "deleted",
        before:
          beforeFile.content,
      });

      continue;
    }

    if (
      !beforeFile &&
      afterFile
    ) {
      files.push({
        path,
        changeType: "added",
        after:
          afterFile.content,
      });

      continue;
    }

    if (
      !beforeFile ||
      !afterFile
    ) {
      continue;
    }

    if (
      beforeFile.hash ===
      afterFile.hash
    ) {
      continue;
    }

    files.push({
      path,
      changeType: "modified",
      before:
        beforeFile.content,
      after:
        afterFile.content,
    });
  }

  if ([...changedDependencies].some((path) => {
    const beforeHash = before.dependencyHashes.get(path);
    const afterHash = after.dependencyHashes.get(path);
    return (beforeHash !== undefined && before.files.get(path)?.hash !== beforeHash) ||
      (afterHash !== undefined && after.files.get(path)?.hash !== afterHash) ||
      !files.some((file) => file.path === path);
  })) {
    throw new IncompleteDependencyArtifactError();
  }

  return {
    files,
    fileCount:
      files.length,
  };
}
