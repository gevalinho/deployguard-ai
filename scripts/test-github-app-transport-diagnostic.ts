import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { allowedGit, classifyFailure, httpFailure } from "./diagnose-github-app-transport";
const secret = "FAKE_TOKEN Authorization: Basic FAKE_HEADER -----BEGIN PRIVATE KEY----- https://user:pass@github.com/repo";
for (const [message, expected] of [
  ["Authentication failed", "AUTHENTICATION_FAILED"],
  ["write access to repository not granted", "AUTHORIZATION_FAILED"],
  ["Repository not found", "REPOSITORY_NOT_FOUND"],
  ["Could not resolve host", "NETWORK_FAILURE"],
  ["bad object", "OBJECT_UNAVAILABLE"],
  ["invalid config", "GIT_CONFIG_INVALID"],
  ["unexpected failure", "UNKNOWN_SAFE_FAILURE"],
]) {
  const result = classifyFailure({ stderr: `${message} ${secret}` });
  assert.equal(result, expected);
  assert(!result.includes(secret));
}
assert.equal(classifyFailure({ cause: { code: "ENOTFOUND" } }), "NETWORK_FAILURE");
assert.equal(httpFailure(401), "AUTHENTICATION_FAILED");
assert.equal(httpFailure(403), "AUTHORIZATION_FAILED");
assert.equal(httpFailure(404), "REPOSITORY_NOT_FOUND");
assert.equal(httpFailure(503), "NETWORK_FAILURE");
for (const args of [["push"], ["push", "--dry-run"], ["config", "http.extraheader", secret], ["fetch"], ["checkout", "main"], ["ls-remote", "https://evil.example"], ["init", "--bare", "--template=", "/some/repository"]]) assert(!allowedGit(args));
assert(allowedGit(["ls-remote", "--refs", "--", "https://github.com/gevalinho/deployguard-lint-fixture.git", "refs/heads/main"]));
assert(allowedGit(["cat-file", "-e", "57b64cc5fd7452ab9daf3b34253a45c9cee4a0e6^{commit}"]));
// Credential-free local reproduction of Git runtime configuration support.
const url = "https://github.com/gevalinho/deployguard-lint-fixture.git";
const env: NodeJS.ProcessEnv = {
  NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `http.${url}.extraheader`,
  GIT_CONFIG_VALUE_0: "X-DeployGuard-Diagnostic: sentinel",
};
const args = ["config", "--get-urlmatch", "http.extraheader", url];
let countSupported = false;
try {
  countSupported = execFileSync("git", args, { cwd: tmpdir(), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() === env.GIT_CONFIG_VALUE_0;
} catch { /* Older Git ignores GIT_CONFIG_COUNT and finds no matching setting. */ }
env.GIT_CONFIG_PARAMETERS = `'http.${url}.extraheader=X-DeployGuard-Diagnostic: sentinel'`;
assert.equal(execFileSync("git", args, { cwd: tmpdir(), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(), env.GIT_CONFIG_VALUE_0);
console.log(`COUNT_CONFIGURATION_SUPPORTED=${countSupported}`);
console.log("✓ Diagnostic allowlist, safe classifications, and local configuration compatibility passed. No network or repository mutation.");
