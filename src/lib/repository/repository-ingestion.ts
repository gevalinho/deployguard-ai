import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  join,
  resolve,
} from "node:path";

import { runCommand } from "@/lib/execution/command-runner";
import type { GitHubRepository } from "@/lib/repository/github-repository";

export interface IngestedRepository {
  repository: GitHubRepository;
  repositoryPath: string;
  cleanup: () => void;
}

interface RepositoryCacheMetadata {
  cachedAt: string;
  repository: string;
}

const CLONE_ATTEMPTS = 3;

const CLONE_RETRY_DELAY_MS =
  2000;

const CACHE_TTL_MS =
  15 * 60 * 1000;

const CACHE_ROOT =
  resolve(
    process.cwd(),
    ".deployguard",
    "cache",
    "repositories"
  );

function delay(
  ms: number
): Promise<void> {
  return new Promise(
    (resolveDelay) => {
      setTimeout(
        resolveDelay,
        ms
      );
    }
  );
}

function formatDuration(
  startedAt: number
): string {
  return (
    (Date.now() - startedAt) /
    1000
  ).toFixed(2);
}

function getCacheDirectory(
  repository: GitHubRepository
): string {
  const owner =
    repository.owner
      .toLowerCase()
      .replace(
        /[^a-z0-9._-]/g,
        "_"
      );

  const name =
    repository.name
      .toLowerCase()
      .replace(
        /[^a-z0-9._-]/g,
        "_"
      );

  return join(
    CACHE_ROOT,
    `${owner}--${name}`
  );
}

function getCachedRepositoryPath(
  repository: GitHubRepository
): string {
  return join(
    getCacheDirectory(
      repository
    ),
    "repository"
  );
}

function getCacheMetadataPath(
  repository: GitHubRepository
): string {
  return join(
    getCacheDirectory(
      repository
    ),
    "metadata.json"
  );
}

function readCacheMetadata(
  repository: GitHubRepository
): RepositoryCacheMetadata | null {
  const metadataPath =
    getCacheMetadataPath(
      repository
    );

  if (
    !existsSync(metadataPath)
  ) {
    return null;
  }

  try {
    return JSON.parse(
      readFileSync(
        metadataPath,
        "utf8"
      )
    ) as RepositoryCacheMetadata;
  } catch {
    return null;
  }
}

function isCacheFresh(
  repository: GitHubRepository
): boolean {
  const cachePath =
    getCachedRepositoryPath(
      repository
    );

  if (
    !existsSync(cachePath)
  ) {
    return false;
  }

  const metadata =
    readCacheMetadata(
      repository
    );

  if (!metadata) {
    return false;
  }

  if (
    metadata.repository !==
    repository.fullName
  ) {
    return false;
  }

  const cachedAt =
    Date.parse(
      metadata.cachedAt
    );

  if (
    Number.isNaN(cachedAt)
  ) {
    return false;
  }

  return (
    Date.now() - cachedAt <
    CACHE_TTL_MS
  );
}

function removeRepositoryCache(
  repository: GitHubRepository
): void {
  rmSync(
    getCacheDirectory(
      repository
    ),
    {
      recursive: true,
      force: true,
    }
  );
}

function saveRepositoryToCache(
  repository: GitHubRepository,
  sourcePath: string
): void {
  const cacheDirectory =
    getCacheDirectory(
      repository
    );

  const cachePath =
    getCachedRepositoryPath(
      repository
    );

  removeRepositoryCache(
    repository
  );

  mkdirSync(
    cacheDirectory,
    {
      recursive: true,
    }
  );

  cpSync(
    sourcePath,
    cachePath,
    {
      recursive: true,
      force: true,
    }
  );

  const metadata:
    RepositoryCacheMetadata = {
      cachedAt:
        new Date().toISOString(),

      repository:
        repository.fullName,
    };

  writeFileSync(
    getCacheMetadataPath(
      repository
    ),
    JSON.stringify(
      metadata,
      null,
      2
    ),
    "utf8"
  );

  console.log(
    `[Repository Ingestion] Cached ${repository.fullName} for ${CACHE_TTL_MS / 60000} minutes.`
  );
}

function copyCachedRepository(
  repository: GitHubRepository,
  repositoryPath: string
): boolean {
  if (
    !isCacheFresh(
      repository
    )
  ) {
    return false;
  }

  const cachedPath =
    getCachedRepositoryPath(
      repository
    );

  console.log(
    `[Repository Ingestion] Cache hit for ${repository.fullName}.`
  );

  const copyStartedAt =
    Date.now();

  cpSync(
    cachedPath,
    repositoryPath,
    {
      recursive: true,
      force: true,
    }
  );

  console.log(
    `[Repository Ingestion] Cached repository copied in ${formatDuration(
      copyStartedAt
    )}s.`
  );

  return true;
}

async function tryArchiveDownload(
  repository: GitHubRepository,
  temporaryRoot: string,
  repositoryPath: string
): Promise<boolean> {
  const archivePath =
    join(
      temporaryRoot,
      "repository.tar.gz"
    );

  const archiveUrl =
    `https://api.github.com/repos/` +
    `${encodeURIComponent(
      repository.owner
    )}/` +
    `${encodeURIComponent(
      repository.name
    )}/tarball`;

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
        "8",
        "--max-time",
        "25",
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
    download.status !==
      "passed" ||
    !existsSync(archivePath)
  ) {
    rmSync(
      archivePath,
      {
        force: true,
      }
    );

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

  rmSync(
    archivePath,
    {
      force: true,
    }
  );

  console.log(
    `[Repository Ingestion] Archive extraction finished in ${formatDuration(
      extractionStartedAt
    )}s with status: ${extraction.status}`
  );

  if (
    extraction.status !==
      "passed" ||
    !existsSync(
      repositoryPath
    )
  ) {
    rmSync(
      repositoryPath,
      {
        recursive: true,
        force: true,
      }
    );

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

  let cloneSucceeded =
    false;

  let lastError =
    "Repository clone failed.";

  for (
    let attempt = 1;
    attempt <= CLONE_ATTEMPTS;
    attempt += 1
  ) {
    if (
      existsSync(
        repositoryPath
      )
    ) {
      rmSync(
        repositoryPath,
        {
          recursive: true,
          force: true,
        }
      );
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
      result.status ===
        "passed" &&
      existsSync(
        repositoryPath
      )
    ) {
      cloneSucceeded =
        true;

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

  if (!cloneSucceeded) {
    const authenticationFailure =
      /could not read Username|Authentication failed|Repository not found|terminal prompts disabled/i.test(
        lastError
      );

    if (
      authenticationFailure
    ) {
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
  mkdirSync(
    CACHE_ROOT,
    {
      recursive: true,
    }
  );

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
    const cacheHit =
      copyCachedRepository(
        repository,
        repositoryPath
      );

    if (!cacheHit) {
      console.log(
        `[Repository Ingestion] Cache miss for ${repository.fullName}.`
      );

      const archiveSucceeded =
        await tryArchiveDownload(
          repository,
          temporaryRoot,
          repositoryPath
        );

      if (
        !archiveSucceeded
      ) {
        await cloneRepository(
          repository,
          temporaryRoot,
          repositoryPath
        );
      }

      if (
        !existsSync(
          repositoryPath
        )
      ) {
        throw new Error(
          "Repository ingestion reported success but the repository directory is missing."
        );
      }

      try {
        saveRepositoryToCache(
          repository,
          repositoryPath
        );
      } catch (cacheError) {
        console.warn(
          "[Repository Ingestion] Repository was ingested successfully, but caching failed.",
          cacheError
        );
      }
    }

    if (
      !existsSync(
        repositoryPath
      )
    ) {
      throw new Error(
        "Repository ingestion reported success but the repository directory is missing."
      );
    }

    const stats =
      statSync(
        repositoryPath
      );

    if (
      !stats.isDirectory()
    ) {
      throw new Error(
        "Repository ingestion path is not a directory."
      );
    }

    console.log(
      `[Repository Ingestion] Total ingestion time: ${formatDuration(
        ingestionStartedAt
      )}s.`
    );

    let cleanedUp =
      false;

    return {
      repository,
      repositoryPath,

      cleanup() {
        if (cleanedUp) {
          return;
        }

        cleanedUp =
          true;

        // Only remove the disposable
        // assessment copy.
        // Persistent cache remains.
        rmSync(
          temporaryRoot,
          {
            recursive: true,
            force: true,
          }
        );
      },
    };
  } catch (error) {
    rmSync(
      temporaryRoot,
      {
        recursive: true,
        force: true,
      }
    );

    throw error;
  }
}