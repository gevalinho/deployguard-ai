import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitHubAppPushTransport, githubRemoteMatches } from "@/lib/remediation/github-app-git-transport";
import { executeVerifiedGitPush, type GitPushTransportFactory } from "@/lib/remediation/git-push-executor";
import { issueGitPushCapability, signGitPushCapability } from "@/lib/remediation/git-push-capability";
import { createRemediationBranchName } from "@/lib/remediation/git-delivery";

async function main() {
  const root = mkdtempSync(join(tmpdir(), "dg-app-push-test-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  const originalPath = process.env.PATH;
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
  const git = (...args: string[]) => execFileSync(realGit, args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const identity = "gevalinho/deployguard-ai";
  const hash = "a".repeat(64);
  const branch = createRemediationBranchName(hash);
  const secret = "test-signing-secret";
  const token = "SECRET_INSTALLATION_TOKEN";
  let issued = 0;
  try {
    git("init");
    git("checkout", "-b", branch);
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.test");
    writeFileSync(join(repo, "fixture"), "verified\n");
    git("add", ".");
    git("commit", "-m", "fixture");
    git("remote", "add", "origin", `git@github.com:${identity}.git`);
    const sha = git("rev-parse", "HEAD");
    writeFileSync(join(repo, ".git/shallow"), `${sha}\n`);
    const signed = signGitPushCapability(issueGitPushCapability(identity, "origin", branch, sha, hash), secret);
    const provider = createGitHubAppPushTransport(async (owner, repository) => {
      issued++;
      assert.equal(`${owner}/${repository}`, identity);
      return { token, repositoryIdentity: identity, installationId: 123, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    });
    const execute = (factory: GitPushTransportFactory = provider, cap = signed, repoIdentity = identity) =>
      executeVerifiedGitPush(repo, repoIdentity, hash, cap, secret, factory);
    assert.equal((await execute(provider, signed, "other/repo")).status, "denied");
    assert.equal((await execute(provider, { ...signed, signature: "00" })).status, "denied");
    git("checkout", "-b", "wrong-branch");
    assert.equal((await execute()).status, "denied");
    const arbitraryBranch = signGitPushCapability({ ...signed.capability, branchName: "wrong-branch" }, secret);
    assert.equal((await execute(provider, arbitraryBranch)).status, "denied");
    git("checkout", branch);
    const wrongCommit = signGitPushCapability({ ...signed.capability, commitSha: "b".repeat(40) }, secret);
    assert.equal((await execute(provider, wrongCommit)).status, "denied");
    git("remote", "set-url", "origin", "git@github.com:other/repo.git");
    assert.equal((await execute()).status, "push_failed");
    assert.equal(issued, 0, "No token before all authorization and identity checks");
    git("remote", "set-url", "origin", `git@github.com:${identity}.git`);
    const authFailure = createGitHubAppPushTransport(async () => { throw new Error(token); });
    const failure = await execute(authFailure);
    assert.equal(failure.status, "push_failed");
    assert(!JSON.stringify(failure).includes(token));
    const badScope = createGitHubAppPushTransport(async () => ({ token, repositoryIdentity: "other/repo", installationId: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    assert.equal((await execute(badScope)).status, "push_failed");
    for (const remote of [`https://github.com.evil/${identity}`, `https://user:pass@github.com/${identity}`, `https://github.com/${identity}?x=1`]) {
      assert(!githubRemoteMatches(identity, remote));
    }
    // Real local Git; a fake remote executable asserts the process boundary.
    const bin = join(root, "bin"); mkdirSync(bin);
    const modePath = join(root, "mode");
    writeFileSync(modePath, "success");
    const header = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
    const fakeGit = `#!${process.execPath}
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const args=process.argv.slice(2);
if (!['push','ls-remote'].includes(args[0])) {
 process.stdout.write(execFileSync(${JSON.stringify(realGit)},args,{env:process.env}));
} else {
 const env=process.env;
 assert.equal(env.GIT_TRACE,undefined);
 assert.equal(env.GIT_ASKPASS,undefined);
 assert.equal(env.GIT_CONFIG_GLOBAL,'/dev/null');
 assert.notEqual(process.cwd(),${JSON.stringify(repo)});
 assert.equal(fs.readFileSync('shallow','utf8').trim(),${JSON.stringify(sha)});
 assert(!fs.readFileSync('config','utf8').includes(${JSON.stringify(token)}));
 assert(!args.join(' ').includes(${JSON.stringify(token)}));
 assert.equal(env.GIT_CONFIG_VALUE_3,${JSON.stringify(header)});
 assert(args.includes(${JSON.stringify(`https://github.com/${identity}.git`)}));
 if(args[0]==='push') assert.equal(args.at(-1),${JSON.stringify(`${sha}:refs/heads/${branch}`)});
 const mode=fs.readFileSync(${JSON.stringify(modePath)},'utf8');
 if(mode==='error') { process.stderr.write(${JSON.stringify(token)}); process.exit(1); }
 if(args[0]==='ls-remote') process.stdout.write(mode==='wrong'?'${"b".repeat(40)}\\trefs/heads/${branch}\\n': '${sha}\\trefs/heads/${branch}\\n');
 else process.stdout.write(${JSON.stringify(token)});
}
`;
    writeFileSync(join(bin, "git"), fakeGit, { mode: 0o700 });
    process.env.PATH = `${bin}:${originalPath}`;
    const before = readFileSync(join(repo, ".git/config"), "utf8");
    assert.equal((await execute()).status, "pushed");
    writeFileSync(modePath, "wrong");
    assert.equal((await execute()).status, "verification_failed");
    writeFileSync(modePath, "error");
    const failedPush = await execute();
    assert.equal(failedPush.status, "push_failed");
    assert(!JSON.stringify(failedPush).includes(token));
    assert(!JSON.stringify(failedPush).includes(header));
    assert.equal(readFileSync(join(repo, ".git/config"), "utf8"), before);
    console.log("✓ GitHub App push authorization, scope, credential isolation, error redaction, and remote verification passed.");
  } finally {
    process.env.PATH = originalPath;
    rmSync(root, { recursive: true, force: true });
  }
}
main().catch(() => { console.error("GitHub App push security test failed."); process.exitCode = 1; });
