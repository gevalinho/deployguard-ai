import {
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";

import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCommand } from "@/lib/execution/command-runner";
import type { GitHubRepository } from "@/lib/repository/github-repository";

export interface IngestedRepository {
  repository: GitHubRepository;
  repositoryPath: string;
  cleanup: () => void;
}

const CLONE_ATTEMPTS = 3;
const CLONE_RETRY_DELAY_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function ingestGitHubRepository(
  repository: GitHubRepository
): Promise<IngestedRepository> {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "deployguard-repo-")
  );

  const repositoryPath = join(
    temporaryRoot,
    "repository"
  );

  try {
    let cloneSucceeded = false;
    let lastError = "Repository clone failed.";

    for (
      let attempt = 1;
      attempt <= CLONE_ATTEMPTS;
      attempt += 1
    ) {
      // A failed git clone may leave a partial
      // destination behind. Clear only that
      // destination before retrying.
      if (existsSync(repositoryPath)) {
        rmSync(repositoryPath, {
          recursive: true,
          force: true,
        });
      }

      const result = await runCommand(
        "git",
        [
          "clone",
          "--depth",
          "1",
          "--no-tags",
          repository.cloneUrl,
          repositoryPath,
        ],
        temporaryRoot
      );

      if (
        result.status === "passed" &&
        existsSync(repositoryPath)
      ) {
        cloneSucceeded = true;
        break;
      }

      lastError =
        result.stderr ||
        result.stdout ||
        `Repository clone failed on attempt ${attempt}.`;

      if (attempt < CLONE_ATTEMPTS) {
        await delay(
          CLONE_RETRY_DELAY_MS * attempt
        );
      }
    }

    if (!cloneSucceeded) {
      throw new Error(
        [
          `Repository clone failed after ${CLONE_ATTEMPTS} attempts.`,
          lastError,
        ].join("\n")
      );
    }

    if (!existsSync(repositoryPath)) {
      throw new Error(
        "Repository clone reported success but the repository directory is missing."
      );
    }

    let cleanedUp = false;

    return {
      repository,
      repositoryPath,

      cleanup() {
        if (cleanedUp) {
          return;
        }

        cleanedUp = true;

        rmSync(temporaryRoot, {
          recursive: true,
          force: true,
        });
      },
    };
  } catch (error) {
    rmSync(temporaryRoot, {
      recursive: true,
      force: true,
    });

    throw error;
  }
}