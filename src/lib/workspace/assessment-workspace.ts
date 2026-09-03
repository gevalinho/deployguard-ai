import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IGNORED_ENTRIES = new Set([
  "node_modules",
  ".next",
  ".git",
]);

export interface AssessmentWorkspace {
  sourcePath: string;
  workspacePath: string;
  cleanup: () => void;
}

export function createAssessmentWorkspace(
  sourcePath: string
): AssessmentWorkspace {
  if (!existsSync(sourcePath)) {
    throw new Error(
      `Repository path does not exist: ${sourcePath}`
    );
  }

  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "deployguard-")
  );

  const workspacePath = join(
    temporaryRoot,
    "repository"
  );

  cpSync(sourcePath, workspacePath, {
    recursive: true,

    filter(source) {
      const parts = source.split("/");

      return !parts.some((part) =>
        IGNORED_ENTRIES.has(part)
      );
    },
  });

  return {
    sourcePath,
    workspacePath,

    cleanup() {
      rmSync(temporaryRoot, {
        recursive: true,
        force: true,
      });
    },
  };
}