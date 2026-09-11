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
import { join, resolve } from "node:path";

import { runCommand } from "@/lib/execution/command-runner";
import type { GitHubRepository } from "@/lib/repository/github-repository";

export interface IngestedRepository {
  repository: GitHubRepository;
  repositoryPath: string;
  cleanup: () => void;
}

export type RepositoryIngestionProgress = (
  message: string
) => void | Promise<void>;

interface RepositoryCacheMetadata {
  cachedAt: string;
  repository: string;
  commitSha?: string;
}

const CLONE_ATTEMPTS = 1;
const CLONE_TIMEOUT_MS =
  6 * 60 * 1000;
const CLONE_RETRY_DELAY_MS =
  2000;

const CACHE_TTL_MS =
  15 * 60 * 1000;

const STALE_CACHE_FALLBACK_MS =
  24 * 60 * 60 * 1000;

const REMOTE_HEAD_TIMEOUT_MS =
  3 * 1000;

const ARCHIVE_CONNECT_TIMEOUT_SECONDS = 10;
const ARCHIVE_MAX_TIME_SECONDS = 5 * 60;

const CACHE_ROOT = resolve(
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

function sanitizeCacheSegment(
  value: string
): string {
  return value
    .toLowerCase()
    .replace(
      /[^a-z0-9._-]/g,
      "_"
    );
}

function getCacheDirectory(
  repository: GitHubRepository
): string {
  const owner =
    sanitizeCacheSegment(
      repository.owner
    );

  const name =
    sanitizeCacheSegment(
      repository.name
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

function isCacheWithinTtl(
  metadata: RepositoryCacheMetadata
): boolean {
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

function isCacheWithinStaleFallback(
  metadata: RepositoryCacheMetadata
): boolean {
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
    STALE_CACHE_FALLBACK_MS
  );
}

async function getRemoteHeadSha(
  repository: GitHubRepository
): Promise<string | null> {
  console.log(
    `[Repository Ingestion] Checking remote HEAD for ${repository.fullName}...`
  );

  try {
    const result =
      await runCommand(
        "git",
        [
          "ls-remote",
          "--exit-code",
          repository.cloneUrl,
          "HEAD",
        ],
        process.cwd(),
        {
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT:
              "0",
          },

          timeoutMs:
            REMOTE_HEAD_TIMEOUT_MS,
        }
      );

    if (
      result.status !==
      "passed"
    ) {
      if (
        result.timedOut
      ) {
        console.warn(
          `[Repository Ingestion] Remote HEAD check timed out after ${REMOTE_HEAD_TIMEOUT_MS}ms.`
        );
      } else {
        console.warn(
          "[Repository Ingestion] Remote HEAD check failed."
        );
      }

      return null;
    }

    const firstLine =
      result.stdout
        .trim()
        .split(
          /\r?\n/
        )[0];

    if (!firstLine) {
      return null;
    }

    const [commitSha] =
      firstLine.split(
        /\s+/
      );

    if (
      !/^[0-9a-f]{40,64}$/i.test(
        commitSha
      )
    ) {
      console.warn(
        "[Repository Ingestion] Remote HEAD returned an unexpected commit identifier."
      );

      return null;
    }

    return commitSha;
  } catch (error) {
    console.warn(
      "[Repository Ingestion] Remote HEAD check could not be completed.",
      error
    );

    return null;
  }
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

async function saveRepositoryToCache(
  repository: GitHubRepository,
  sourcePath: string
): Promise<void> {
  const cacheDirectory =
    getCacheDirectory(
      repository
    );

  const cachePath =
    getCachedRepositoryPath(
      repository
    );

  const commitSha =
    await getRemoteHeadSha(
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

      ...(commitSha
        ? { commitSha }
        : {}),
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
    commitSha
      ? `[Repository Ingestion] Cached ${repository.fullName} at commit ${commitSha.slice(0, 12)}.`
      : `[Repository Ingestion] Cached ${repository.fullName} with ${CACHE_TTL_MS / 60000}-minute TTL fallback.`
  );
}

async function copyCachedRepository(
  repository: GitHubRepository,
  repositoryPath: string
): Promise<boolean> {
  const cachedPath =
    getCachedRepositoryPath(
      repository
    );

  if (
    !existsSync(
      cachedPath
    )
  ) {
    return false;
  }

  const metadata =
    readCacheMetadata(
      repository
    );

  if (
    !metadata ||
    metadata.repository !==
      repository.fullName
  ) {
    return false;
  }

  const remoteCommitSha =
    await getRemoteHeadSha(
      repository
    );

  if (
    remoteCommitSha &&
    metadata.commitSha
  ) {
    if (
      remoteCommitSha !==
      metadata.commitSha
    ) {
      console.log(
        `[Repository Ingestion] Cache stale for ${repository.fullName}: remote HEAD changed.`
      );

      removeRepositoryCache(
        repository
      );

      return false;
    }

    console.log(
      `[Repository Ingestion] Cache commit verified for ${repository.fullName} (${remoteCommitSha.slice(0, 12)}).`
    );
  } else if (
  !isCacheWithinTtl(
    metadata
  )
) {
  if (
    !isCacheWithinStaleFallback(
      metadata
    )
  ) {
    console.log(
      `[Repository Ingestion] Cache could not be remotely verified and stale fallback has expired for ${repository.fullName}.`
    );

    return false;
  }

  console.warn(
    `[Repository Ingestion] Remote verification unavailable; using stale fallback cache for ${repository.fullName}.`
  );
} else {
    console.log(
      `[Repository Ingestion] Remote verification unavailable; using fresh TTL cache for ${repository.fullName}.`
    );
  }

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

function createArchiveUrl(
  repository: GitHubRepository
): string {
  return (
    "https://api.github.com/repos/" +
    `${encodeURIComponent(
      repository.owner
    )}/` +
    `${encodeURIComponent(
      repository.name
    )}/tarball`
  );
}

async function tryArchiveDownload(
  repository: GitHubRepository,
  temporaryRoot: string,
  repositoryPath: string,
  onProgress?:
    RepositoryIngestionProgress
): Promise<boolean> {
  const archivePath =
    join(
      temporaryRoot,
      "repository.tar.gz"
    );

  const archiveUrl =
    createArchiveUrl(
      repository
    );

  console.log(
    "[Repository Ingestion] Trying GitHub archive..."
  );

  await onProgress?.(
    "Downloading repository archive. Large repositories may take a few minutes..."
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
        String(
          ARCHIVE_CONNECT_TIMEOUT_SECONDS
        ),

        "--max-time",
        String(
          ARCHIVE_MAX_TIME_SECONDS
        ),

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
    "passed"
  ) {
    console.warn(
      "[Repository Ingestion] Archive download diagnostic:",
      download.stderr ||
        download.stdout ||
        "No diagnostic output."
    );
  }

  if (
    download.status !==
      "passed" ||
    !existsSync(
      archivePath
    )
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

    await onProgress?.(
      "GitHub archive unavailable. Falling back to Git clone..."
    );

    return false;
  }

  console.log(
    "[Repository Ingestion] Extracting GitHub archive..."
  );

  await onProgress?.(
    "Extracting GitHub archive..."
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
    "passed"
  ) {
    console.warn(
      "[Repository Ingestion] Archive extraction diagnostic:",
      extraction.stderr ||
        extraction.stdout ||
        "No diagnostic output."
    );
  }

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

    await onProgress?.(
      "Archive extraction failed. Falling back to Git clone..."
    );

    return false;
  }

  console.log(
    "[Repository Ingestion] GitHub archive fast-path succeeded."
  );

  await onProgress?.(
    "GitHub archive downloaded and extracted successfully."
  );

  return true;
}

async function cloneRepository(
  repository: GitHubRepository,
  temporaryRoot: string,
  repositoryPath: string,
  onProgress?:
    RepositoryIngestionProgress
): Promise<void> {
  console.log(
    "[Repository Ingestion] Starting Git clone fallback..."
  );

  await onProgress?.(
    "Starting Git clone fallback..."
  );

  const cloneStartedAt =
    Date.now();

  let cloneSucceeded =
    false;

  let lastError =
    "Repository clone failed.";

  for (
    let attempt = 1;
    attempt <=
    CLONE_ATTEMPTS;
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

    await onProgress?.(
      `Git clone attempt ${attempt}/${CLONE_ATTEMPTS} started...`
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

          timeoutMs:
            CLONE_TIMEOUT_MS,
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

      await onProgress?.(
        `Git clone completed successfully on attempt ${attempt}.`
      );

      break;
    }

    lastError =
      result.stderr ||
      result.stdout ||
      `Repository clone failed on attempt ${attempt}.`;

    if (
      result.timedOut
    ) {
      console.log(
        `[Repository Ingestion] Git clone attempt ${attempt} timed out after ${CLONE_TIMEOUT_MS / 1000}s.`
      );

      await onProgress?.(
        `Git clone attempt ${attempt}/${CLONE_ATTEMPTS} timed out after ${CLONE_TIMEOUT_MS / 1000}s.`
      );
    } else {
      console.log(
        `[Repository Ingestion] Git clone attempt ${attempt} failed.`
      );

      await onProgress?.(
        `Git clone attempt ${attempt}/${CLONE_ATTEMPTS} failed.`
      );
    }

    if (
      attempt <
      CLONE_ATTEMPTS
    ) {
      const retryDelayMs =
        CLONE_RETRY_DELAY_MS *
        attempt;

      await onProgress?.(
        `Retrying repository clone in ${retryDelayMs / 1000}s...`
      );

      await delay(
        retryDelayMs
      );
    }
  }

  if (
    cloneSucceeded
  ) {
    return;
  }

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

export async function ingestGitHubRepository(
  repository: GitHubRepository,
  onProgress?:
    RepositoryIngestionProgress
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
      await copyCachedRepository(
        repository,
        repositoryPath
      );

    if (
      cacheHit
    ) {
      await onProgress?.(
        "Repository loaded from verified cache."
      );
    }

    if (
      !cacheHit
    ) {
      console.log(
        `[Repository Ingestion] Cache miss for ${repository.fullName}.`
      );

      await onProgress?.(
        "Repository cache miss. Fetching from GitHub..."
      );

      const archiveSucceeded =
        await tryArchiveDownload(
          repository,
          temporaryRoot,
          repositoryPath,
          onProgress
        );

      if (
        !archiveSucceeded
      ) {
        await cloneRepository(
          repository,
          temporaryRoot,
          repositoryPath,
          onProgress
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
        await saveRepositoryToCache(
          repository,
          repositoryPath
        );
      } catch (
        cacheError
      ) {
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
        if (
          cleanedUp
        ) {
          return;
        }

        cleanedUp =
          true;

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