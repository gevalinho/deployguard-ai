import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVerifiedPatchArtifact } from "@/lib/remediation/verified-patch-artifact";
import type { VerifiedPatch, VerifiedPatchFile } from "@/lib/remediation/verified-patch";

interface Case {
  name: string;
  before?: string;
  after?: string;
  hunk?: string;
  eofMarkers?: number;
}
const cases: Case[] = [
  { name: "lint fixture with final LF", before: "const message = 'DeployGuard lint remediation works'\nconsole.log(message)\n", after: 'const message = "DeployGuard lint remediation works";\nconsole.log(message);\n', hunk: "@@ -1,2 +1,2 @@", eofMarkers: 0 },
  { name: "no final newline", before: "old\nlast", after: "new\nend", hunk: "@@ -1,2 +1,2 @@", eofMarkers: 2 },
  { name: "add final newline", before: "same", after: "same\n", eofMarkers: 1 },
  { name: "remove final newline", before: "same\n", after: "same", eofMarkers: 1 },
  { name: "internal and trailing blank lines", before: "\nold\n\nlast\n\n", after: "\nnew\n\nend\n\n", hunk: "@@ -1,5 +1,5 @@" },
  { name: "empty to nonempty", before: "", after: "new\n", hunk: "@@ -0,0 +1,1 @@" },
  { name: "nonempty to empty", before: "old\n", after: "", hunk: "@@ -1,1 +0,0 @@" },
  { name: "newline-only file", before: "\n", after: "\n\n", hunk: "@@ -1,1 +1,2 @@" },
  { name: "empty to newline", before: "", after: "\n", hunk: "@@ -0,0 +1,1 @@" },
  { name: "newline to empty", before: "\n", after: "", hunk: "@@ -1,1 +0,0 @@" },
  { name: "CRLF preserved", before: "old\r\n\r\nlast\r\n", after: "new\r\n\r\nend\r\n", hunk: "@@ -1,3 +1,3 @@" },
  { name: "CRLF to LF", before: "same\r\n", after: "same\n" },
  { name: "LF to CRLF", before: "same\n", after: "same\r\n" },
  { name: "CRLF without final newline", before: "old\r\nlast", after: "new\r\nend", eofMarkers: 2 },
  { name: "literal CR at EOF", before: "old\r", after: "new\r", eofMarkers: 2 },
  { name: "added file", after: "new\n", hunk: "@@ -0,0 +1,1 @@" },
  { name: "added no final newline", after: "new", eofMarkers: 1 },
  { name: "added empty file", after: "" },
  { name: "added newline-only file", after: "\n" },
  { name: "added CRLF", after: "new\r\n" },
  { name: "deleted file", before: "old\n", hunk: "@@ -1,1 +0,0 @@" },
  { name: "deleted no final newline", before: "old", eofMarkers: 1 },
  { name: "deleted empty file", before: "" },
  { name: "deleted newline-only file", before: "\n" },
  { name: "deleted CRLF", before: "old\r\n" },
  { name: "UTF-8 byte integrity", before: "café\n", after: "日本語 🎉\n" },
];
const root = mkdtempSync(join(tmpdir(), "dg-artifact-apply-"));
function check(files: VerifiedPatchFile[], name: string, fixture?: Case) {
  const repo = mkdtempSync(join(root, "repo-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "--quiet");
  git("config", "core.autocrlf", "false");
  git("config", "core.safecrlf", "false");
  git("config", "user.name", "Artifact Test");
  git("config", "user.email", "artifact@example.test");
  git("config", "commit.gpgsign", "false");
  const hooks = join(root, "empty-hooks");
  mkdirSync(hooks, { recursive: true });
  git("config", "core.hooksPath", hooks);
  for (const file of files) if (file.before !== undefined) writeFileSync(join(repo, file.path), file.before);
  git("add", "--all");
  git("commit", "--quiet", "--allow-empty", "-m", "Exact original content");
  const patch: VerifiedPatch = { files, fileCount: files.length };
  const artifact = createVerifiedPatchArtifact(patch);
  assert.deepEqual(createVerifiedPatchArtifact(patch), artifact, name);
  assert.equal(artifact.format, "unified_diff");
  assert.equal(artifact.byteSize, Buffer.byteLength(artifact.content, "utf8"));
  assert.equal(artifact.sha256, createHash("sha256").update(artifact.content).digest("hex"));
  assert(artifact.content.endsWith("\n"));
  if (fixture?.hunk) assert(artifact.content.includes(fixture.hunk), name);
  if (fixture?.eofMarkers !== undefined) {
    assert.equal(artifact.content.split("\\ No newline at end of file").length - 1, fixture.eofMarkers, name);
  }
  // Store outside the worktree: the initial state must be clean and exact.
  const artifactPath = join(root, "artifact.patch");
  writeFileSync(artifactPath, artifact.content);
  assert.equal(git("status", "--porcelain"), "");
  git("apply", "--check", artifactPath);
  git("apply", artifactPath);
  for (const file of files) {
    if (file.after === undefined) assert(!existsSync(join(repo, file.path)), name);
    else assert.deepEqual(readFileSync(join(repo, file.path)), Buffer.from(file.after, "utf8"), name);
  }
  console.log(`✓ Git applicability and exact bytes: ${name}`);
}
try {
  for (const fixture of cases) {
    check([{ path: "example.txt", changeType: fixture.before === undefined ? "added" : fixture.after === undefined ? "deleted" : "modified", before: fixture.before, after: fixture.after }], fixture.name, fixture);
  }
  check([
    { path: "modified.txt", changeType: "modified", before: "old", after: "new\r\n" },
    { path: "added.txt", changeType: "added", after: "" },
    { path: "deleted.txt", changeType: "deleted", before: "\n" },
  ], "multi-file patch boundaries");
  assert.equal(createVerifiedPatchArtifact({ fileCount: 0, files: [] }).content, "");
  console.log("✓ Artifact determinism, exact byteSize/SHA-256, EOF markers, and hunk counts passed.");
} finally { rmSync(root, { recursive: true, force: true }); }
