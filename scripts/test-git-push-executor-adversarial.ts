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
  type SignedGitPushCapability,
} from "@/lib/remediation/git-push-capability";

const signingSecret =
  "deployguard-test-signing-secret";

const repositoryIdentity =
  "deployguard/adversarial-test";

const artifactSha256 =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

interface TestFixture {
  rootPath: string;
  repositoryPath: string;
  remotePath: string;
  remoteName: string;
  commitSha: string;
}

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

async function createFixture():
Promise<TestFixture> {
  const rootPath =
    mkdtempSync(
      join(
        tmpdir(),
        "deployguard-push-adversarial-"
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

  const remoteName =
    "deployguard-test";

  await requireGit(
    rootPath,
    [
      "init",
      repositoryPath,
    ],
    "Unable to initialize repository"
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

  writeFileSync(
    join(
      repositoryPath,
      "example.js"
    ),
    'const message = "verified";\n',
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
      "verified remediation",
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
      "Unable to determine HEAD"
    );

  const commitSha =
    headResult.stdout.trim();

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
      remoteName,
      remotePath,
    ],
    "Unable to configure remote"
  );

  return {
    rootPath,
    repositoryPath,
    remotePath,
    remoteName,
    commitSha,
  };
}

function createSignedCapability(
  fixture: TestFixture,
  now = Date.now()
): SignedGitPushCapability {
  return signGitPushCapability(
    issueGitPushCapability(
      repositoryIdentity,
      fixture.remoteName,
      "main",
      fixture.commitSha,
      artifactSha256,
      now
    ),
    signingSecret
  );
}

async function remoteBranchExists(
  fixture: TestFixture
): Promise<boolean> {
  const result =
    await git(
      fixture.rootPath,
      [
        "--git-dir",
        fixture.remotePath,
        "show-ref",
        "--verify",
        "--quiet",
        "refs/heads/main",
      ]
    );

  return (
    result.status === "passed"
  );
}

async function assertRemoteUntouched(
  fixture: TestFixture,
  context: string
) {
  if (
    await remoteBranchExists(
      fixture
    )
  ) {
    throw new Error(
      `${context}: unauthorized push reached the remote.`
    );
  }
}

function destroyFixture(
  fixture: TestFixture
) {
  rmSync(
    fixture.rootPath,
    {
      recursive: true,
      force: true,
    }
  );
}

async function testWrongSecret() {
  const fixture =
    await createFixture();

  try {
    const capability =
      createSignedCapability(
        fixture
      );

    const result =
      await executeVerifiedGitPush(
        fixture.repositoryPath,
        repositoryIdentity,
        artifactSha256,
        capability,
        "wrong-secret"
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "Wrong signing secret unexpectedly authorized push."
      );
    }

    await assertRemoteUntouched(
      fixture,
      "Wrong signing secret"
    );

    console.log(
      "✓ Wrong signing secret rejected without remote mutation."
    );
  } finally {
    destroyFixture(
      fixture
    );
  }
}

async function testExpiredCapability() {
  const fixture =
    await createFixture();

  try {
    const capability =
      createSignedCapability(
        fixture,
        Date.now() -
          10 * 60 * 1000
      );

    const result =
      await executeVerifiedGitPush(
        fixture.repositoryPath,
        repositoryIdentity,
        artifactSha256,
        capability,
        signingSecret
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "Expired authorization unexpectedly authorized push."
      );
    }

    await assertRemoteUntouched(
      fixture,
      "Expired authorization"
    );

    console.log(
      "✓ Expired push authorization rejected without remote mutation."
    );
  } finally {
    destroyFixture(
      fixture
    );
  }
}

async function testRepositoryMismatch() {
  const fixture =
    await createFixture();

  try {
    const capability =
      createSignedCapability(
        fixture
      );

    const result =
      await executeVerifiedGitPush(
        fixture.repositoryPath,
        "attacker/other-repository",
        artifactSha256,
        capability,
        signingSecret
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "Repository identity mismatch unexpectedly authorized push."
      );
    }

    await assertRemoteUntouched(
      fixture,
      "Repository identity mismatch"
    );

    console.log(
      "✓ Cross-repository push rejected without remote mutation."
    );
  } finally {
    destroyFixture(
      fixture
    );
  }
}

async function testArtifactMismatch() {
  const fixture =
    await createFixture();

  try {
    const capability =
      createSignedCapability(
        fixture
      );

    const wrongArtifactSha256 =
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    const result =
      await executeVerifiedGitPush(
        fixture.repositoryPath,
        repositoryIdentity,
        wrongArtifactSha256,
        capability,
        signingSecret
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "Artifact identity mismatch unexpectedly authorized push."
      );
    }

    await assertRemoteUntouched(
      fixture,
      "Artifact identity mismatch"
    );

    console.log(
      "✓ Cross-artifact push rejected without remote mutation."
    );
  } finally {
    destroyFixture(
      fixture
    );
  }
}

async function testBranchDrift() {
  const fixture =
    await createFixture();

  try {
    const capability =
      createSignedCapability(
        fixture
      );

    await requireGit(
      fixture.repositoryPath,
      [
        "checkout",
        "-b",
        "unexpected-branch",
      ],
      "Unable to create branch drift"
    );

    const result =
      await executeVerifiedGitPush(
        fixture.repositoryPath,
        repositoryIdentity,
        artifactSha256,
        capability,
        signingSecret
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "Branch drift unexpectedly authorized push."
      );
    }

    await assertRemoteUntouched(
      fixture,
      "Branch drift"
    );

    console.log(
      "✓ Branch drift rejected without remote mutation."
    );
  } finally {
    destroyFixture(
      fixture
    );
  }
}

async function testHeadDrift() {
  const fixture =
    await createFixture();

  try {
    const capability =
      createSignedCapability(
        fixture
      );

    writeFileSync(
      join(
        fixture.repositoryPath,
        "drift.txt"
      ),
      "unauthorized commit drift\n",
      "utf8"
    );

    await requireGit(
      fixture.repositoryPath,
      [
        "add",
        "drift.txt",
      ],
      "Unable to stage HEAD drift"
    );

    await requireGit(
      fixture.repositoryPath,
      [
        "commit",
        "-m",
        "unauthorized HEAD drift",
      ],
      "Unable to create HEAD drift"
    );

    const result =
      await executeVerifiedGitPush(
        fixture.repositoryPath,
        repositoryIdentity,
        artifactSha256,
        capability,
        signingSecret
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "HEAD drift unexpectedly authorized push."
      );
    }

    await assertRemoteUntouched(
      fixture,
      "HEAD drift"
    );

    console.log(
      "✓ HEAD drift rejected without remote mutation."
    );
  } finally {
    destroyFixture(
      fixture
    );
  }
}

async function testDirtyWorkspace() {
  const fixture =
    await createFixture();

  try {
    const capability =
      createSignedCapability(
        fixture
      );

    writeFileSync(
      join(
        fixture.repositoryPath,
        "uncommitted.txt"
      ),
      "uncommitted mutation\n",
      "utf8"
    );

    const result =
      await executeVerifiedGitPush(
        fixture.repositoryPath,
        repositoryIdentity,
        artifactSha256,
        capability,
        signingSecret
      );

    if (
      result.status !==
      "verification_failed"
    ) {
      throw new Error(
        "Dirty workspace unexpectedly crossed push boundary."
      );
    }

    await assertRemoteUntouched(
      fixture,
      "Dirty workspace"
    );

    console.log(
      "✓ Dirty workspace rejected without remote mutation."
    );
  } finally {
    destroyFixture(
      fixture
    );
  }
}

async function testTamperedCapability() {
  const fixture =
    await createFixture();

  try {
    const capability =
      createSignedCapability(
        fixture
      );

    const tamperedCapability:
      SignedGitPushCapability = {
        ...capability,

        capability: {
          ...capability.capability,

          branchName:
            "attacker-branch",
        },
      };

    const result =
      await executeVerifiedGitPush(
        fixture.repositoryPath,
        repositoryIdentity,
        artifactSha256,
        tamperedCapability,
        signingSecret
      );

    if (
      result.status !== "denied"
    ) {
      throw new Error(
        "Tampered signed capability unexpectedly authorized push."
      );
    }

    await assertRemoteUntouched(
      fixture,
      "Tampered capability"
    );

    console.log(
      "✓ Tampered signed capability rejected without remote mutation."
    );
  } finally {
    destroyFixture(
      fixture
    );
  }
}

async function testUntouchedAuthorizedPush() {
  const fixture =
    await createFixture();

  try {
    const capability =
      createSignedCapability(
        fixture
      );

    const result =
      await executeVerifiedGitPush(
        fixture.repositoryPath,
        repositoryIdentity,
        artifactSha256,
        capability,
        signingSecret
      );

    if (
      result.status !== "pushed"
    ) {
      throw new Error(
        `Untouched authorized push failed: ${result.summary}`
      );
    }

    const remoteHeadResult =
      await requireGit(
        fixture.rootPath,
        [
          "--git-dir",
          fixture.remotePath,
          "rev-parse",
          "refs/heads/main",
        ],
        "Unable to inspect authorized remote branch"
      );

    if (
      remoteHeadResult.stdout.trim() !==
      fixture.commitSha
    ) {
      throw new Error(
        "Remote branch does not contain the exact authorized commit."
      );
    }

    console.log(
      "✓ Untouched authorized commit pushed successfully."
    );

    console.log(
      "✓ Remote contains exact authorized commit SHA."
    );
  } finally {
    destroyFixture(
      fixture
    );
  }
}

async function main() {
  console.log(
    "\n=== DeployGuard Git Push Adversarial Tests ===\n"
  );

  await testWrongSecret();
  await testExpiredCapability();
  await testRepositoryMismatch();

  await testArtifactMismatch();
  await testBranchDrift();
  await testHeadDrift();
  await testDirtyWorkspace();
  await testTamperedCapability();

  await testUntouchedAuthorizedPush();

  console.log(
    "\n✓ Git push executor adversarial boundary passed."
  );
}

void main();

