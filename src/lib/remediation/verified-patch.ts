import {
  readFileSync,
  readdirSync,
  statSync,
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
  >
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
        files
      );

      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const stats =
      statSync(
        absolutePath
      );

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
      content =
        readFileSync(
          absolutePath,
          "utf8"
        );
    } catch {
      /*
       * Binary or unreadable files are excluded
       * from the text patch representation.
       */
      continue;
    }

    const path =
      relative(
        repositoryPath,
        absolutePath
      ).replaceAll("\\", "/");

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

  collectFiles(
    repositoryPath,
    repositoryPath,
    files
  );

  return {
    files,
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

  return {
    files,
    fileCount:
      files.length,
  };
}