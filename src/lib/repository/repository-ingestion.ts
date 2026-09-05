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

function formatDuration(startedAt: number): string {
  return (
    (Date.now() - startedAt) /
    1000
  ).toFixed(2);
}



async function tryArchiveDownload(
  repository: GitHubRepository,
  temporaryRoot: string,
  repositoryPath: string
): Promise<boolean> {
  const archivePath = join(
    temporaryRoot,
    "repository.tar.gz"
  );

  const archiveUrl =
    `https://api.github.com/repos/` +
    `${encodeURIComponent(repository.owner)}/` +
    `${encodeURIComponent(repository.name)}/tarball`;

  console.log(
    "[Repository Ingestion] Trying GitHub archive..."
  );

  const archiveStartedAt =
    Date.now();

  const download =
    await runCommand(
      "curl",
      [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--connect-timeout",
        "20",
        "--max-time",
        "180",
        "--output",
        archivePath,
        archiveUrl,
      ],
      temporaryRoot
    );

  console.log(
    `[Repository Ingestion] Archive download finished in ${formatDuration(
      archiveStartedAt
    )}s with status: ${download.status}`
  );

  if (
    download.status !== "passed" ||
    !existsSync(archivePath)
  ) {
    rmSync(archivePath, {
      force: true,
    });

    console.log(
      "[Repository Ingestion] Archive unavailable. Falling back to Git clone."
    );

    return false;
  }

  console.log(
    "[Repository Ingestion] Extracting GitHub archive..."
  );

  const extractionStartedAt =
    Date.now();

  const extraction =
    await runCommand(
      "tar",
      [
        "-xzf",
        archivePath,
        "-C",
        temporaryRoot,
        "--one-top-level=repository",
        "--strip-components=1",
      ],
      temporaryRoot
    );

  rmSync(archivePath, {
    force: true,
  });

  console.log(
    `[Repository Ingestion] Archive extraction finished in ${formatDuration(
      extractionStartedAt
    )}s with status: ${extraction.status}`
  );

  if (
    extraction.status !== "passed" ||
    !existsSync(repositoryPath)
  ) {
    rmSync(repositoryPath, {
      recursive: true,
      force: true,
    });

    console.log(
      "[Repository Ingestion] Archive extraction failed. Falling back to Git clone."
    );

    return false;
  }

  console.log(
    "[Repository Ingestion] GitHub archive fast-path succeeded."
  );

  return true;
}




async function cloneRepository(
  repository: GitHubRepository,
  temporaryRoot: string,
  repositoryPath: string
): Promise<void> {
  console.log(
    "[Repository Ingestion] Starting Git clone fallback..."
  );

  const cloneStartedAt =
    Date.now();

  let cloneSucceeded = false;
  let lastError =
    "Repository clone failed.";

  for (
    let attempt = 1;
    attempt <= CLONE_ATTEMPTS;
    attempt += 1
  ) {
    if (
      existsSync(repositoryPath)
    ) {
      rmSync(repositoryPath, {
        recursive: true,
        force: true,
      });
    }

    console.log(
      `[Repository Ingestion] Git clone attempt ${attempt}/${CLONE_ATTEMPTS}...`
    );

    const result =
      await runCommand(
        "git",
        [
          "clone",
          "--depth",
          "1",
          "--no-tags",
          "--single-branch",
          "--filter=blob:none",
          repository.cloneUrl,
          repositoryPath,
        ],
        temporaryRoot,
        {
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT:
              "0",
          },
        }
      );

    if (
      result.status === "passed" &&
      existsSync(repositoryPath)
    ) {
      cloneSucceeded = true;

      console.log(
        `[Repository Ingestion] Git clone succeeded in ${formatDuration(
          cloneStartedAt
        )}s.`
      );

      break;
    }

    lastError =
      result.stderr ||
      result.stdout ||
      `Repository clone failed on attempt ${attempt}.`;

    console.log(
      `[Repository Ingestion] Git clone attempt ${attempt} failed.`
    );

    if (
      attempt <
      CLONE_ATTEMPTS
    ) {
      await delay(
        CLONE_RETRY_DELAY_MS *
          attempt
      );
    }
  }

  // if (!cloneSucceeded) {
  //   throw new Error(
  //     [
  //       `Repository clone failed after ${CLONE_ATTEMPTS} attempts.`,
  //       lastError,
  //     ].join("\n")
  //   );
  // }


  if (!cloneSucceeded) {
  const authenticationFailure =
    /could not read Username|Authentication failed|Repository not found|terminal prompts disabled/i.test(
      lastError
    );

  if (authenticationFailure) {
    throw new Error(
      "This repository could not be accessed. DeployGuard currently supports public GitHub repositories. Private repository access requires GitHub authentication."
    );
  }

  throw new Error(
    [
      `Repository ingestion failed after ${CLONE_ATTEMPTS} attempts.`,
      lastError,
    ].join("\n")
  );
}


}

export async function ingestGitHubRepository(
  repository: GitHubRepository
): Promise<IngestedRepository> {
  const temporaryRoot =
    mkdtempSync(
      join(
        tmpdir(),
        "deployguard-repo-"
      )
    );

  const repositoryPath =
    join(
      temporaryRoot,
      "repository"
    );

  const ingestionStartedAt =
    Date.now();

  try {
    const archiveSucceeded =
      await tryArchiveDownload(
        repository,
        temporaryRoot,
        repositoryPath
      );

    if (!archiveSucceeded) {
      await cloneRepository(
        repository,
        temporaryRoot,
        repositoryPath
      );
    }

    if (
      !existsSync(repositoryPath)
    ) {
      throw new Error(
        "Repository ingestion reported success but the repository directory is missing."
      );
    }

    console.log(
      `[Repository Ingestion] Total ingestion time: ${formatDuration(
        ingestionStartedAt
      )}s.`
    );

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