import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  runCommand,
} from "@/lib/execution/command-runner";

import {
  executeVerifiedGitPush,
} from "@/lib/remediation/git-push-executor";

import {
  issueGitPushCapability,
  signGitPushCapability,
} from "@/lib/remediation/git-push-capability";

const signingSecret =
  "deployguard-test-signing-secret";

const rootPath =
  mkdtempSync(
    join(
      tmpdir(),
      "deployguard-git-push-"
    )
  );

const repositoryPath =
  join(
    rootPath,
    "workspace"
  );

const remotePath =
  join(
    rootPath,
    "remote.git"
  );

async function git(
  cwd: string,
  args: string[]
) {
  return runCommand(
    "git",
    args,
    cwd,
    {
      timeoutMs: 10_000,

      env: {
        ...process.env,

        GIT_TERMINAL_PROMPT:
          "0",
      },
    }
  );
}

async function requireGit(
  cwd: string,
  args: string[],
  description: string
) {
  const result =
    await git(
      cwd,
      args
    );

  if (
    result.status !== "passed"
  ) {
    throw new Error(
      `${description}: ${result.stderr}`
    );
  }

  return result;
}

async function main() {
  try {
    /*
     * Create a disposable working repository.
     *
     * We intentionally avoid:
     *
     *   git init -b main
     *
     * because older Git versions may not support
     * the -b option.
     */
    await requireGit(
      rootPath,
      [
        "init",
        repositoryPath,
      ],
      "Unable to initialize working repository"
    );

    await requireGit(
      repositoryPath,
      [
        "checkout",
        "-b",
        "main",
      ],
      "Unable to create main branch"
    );

    await requireGit(
      repositoryPath,
      [
        "config",
        "user.name",
        "DeployGuard Test",
      ],
      "Unable to configure Git user"
    );

    await requireGit(
      repositoryPath,
      [
        "config",
        "user.email",
        "deployguard@example.test",
      ],
      "Unable to configure Git email"
    );

    const sourcePath =
      join(
        repositoryPath,
        "example.js"
      );

    writeFileSync(
      sourcePath,
      'const message = "verified remediation";\n',
      "utf8"
    );

    await requireGit(
      repositoryPath,
      [
        "add",
        "example.js",
      ],
      "Unable to stage fixture"
    );

    await requireGit(
      repositoryPath,
      [
        "commit",
        "-m",
        "verified remediation fixture",
      ],
      "Unable to commit fixture"
    );

    const headResult =
      await requireGit(
        repositoryPath,
        [
          "rev-parse",
          "HEAD",
        ],
        "Unable to determine fixture HEAD"
      );

    const commitSha =
      headResult.stdout.trim();

    /*
     * Create a completely local bare repository.
     *
     * This acts as the remote server for the
     * integration test. No GitHub network push
     * occurs.
     */
    await requireGit(
      rootPath,
      [
        "init",
        "--bare",
        remotePath,
      ],
      "Unable to initialize bare remote"
    );

    await requireGit(
      repositoryPath,
      [
        "remote",
        "add",
        "deployguard-test",
        remotePath,
      ],
      "Unable to configure disposable remote"
    );

    const repositoryIdentity =
      "deployguard/test-repository";

    const artifactSha256 =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    /*
     * Authorize exactly:
     *
     * repository identity
     * remote
     * branch
     * commit
     * artifact
     */
    const capability =
      issueGitPushCapability(
        repositoryIdentity,
        "deployguard-test",
        "main",
        commitSha,
        artifactSha256
      );

    const signedCapability =
      signGitPushCapability(
        capability,
        signingSecret
      );

    const result =
      await executeVerifiedGitPush(
        repositoryPath,
        repositoryIdentity,
        artifactSha256,
        signedCapability,
        signingSecret
      );

    if (
      result.status !==
      "pushed"
    ) {
      throw new Error(
        `Verified Git push failed: ${result.summary}`
      );
    }

    console.log(
      "✓ Signed Git push authorization accepted."
    );

    console.log(
      "✓ Exact authorized commit pushed."
    );

    /*
     * Independently inspect the bare repository.
     *
     * Do not trust only the executor result.
     */
    const remoteHeadResult =
      await requireGit(
        rootPath,
        [
          "--git-dir",
          remotePath,
          "rev-parse",
          "refs/heads/main",
        ],
        "Unable to inspect remote branch"
      );

    const remoteHead =
      remoteHeadResult.stdout.trim();

    if (
      remoteHead !== commitSha
    ) {
      throw new Error(
        "Remote branch does not contain the authorized commit."
      );
    }

    console.log(
      "✓ Remote branch independently verified."
    );

    /*
     * Verify the commit object itself exists in
     * the remote repository.
     */
    const remoteCommitResult =
      await requireGit(
        rootPath,
        [
          "--git-dir",
          remotePath,
          "cat-file",
          "-t",
          commitSha,
        ],
        "Unable to inspect remote commit"
      );

    if (
      remoteCommitResult.stdout.trim() !==
      "commit"
    ) {
      throw new Error(
        "Authorized commit object was not delivered to the remote."
      );
    }

    console.log(
      "✓ Authorized commit object exists remotely."
    );

    /*
     * The local repository must remain on the
     * exact authorized commit after push.
     */
    const localHeadAfter =
      await requireGit(
        repositoryPath,
        [
          "rev-parse",
          "HEAD",
        ],
        "Unable to verify local HEAD"
      );

    if (
      localHeadAfter.stdout.trim() !==
      commitSha
    ) {
      throw new Error(
        "Git push unexpectedly changed local HEAD."
      );
    }

    console.log(
      "✓ Local HEAD remained unchanged."
    );

    /*
     * Push must not leave local repository
     * mutations behind.
     */
    const statusAfter =
      await requireGit(
        repositoryPath,
        [
          "status",
          "--porcelain",
        ],
        "Unable to verify working tree"
      );

    if (
      statusAfter.stdout.trim()
    ) {
      throw new Error(
        "Git push left the local working tree dirty."
      );
    }

    console.log(
      "✓ Working tree remained clean."
    );

    console.log(
      "\n✓ Verified Git Push execution succeeded."
    );
  } finally {
    rmSync(
      rootPath,
      {
        recursive: true,
        force: true,
      }
    );
  }
}

void main();