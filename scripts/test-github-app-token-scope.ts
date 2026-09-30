import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInstallationAccessToken } from "@/lib/remediation/github-app-auth";

async function main() {
  const directory = mkdtempSync(join(tmpdir(), "dg-token-scope-"));
  const fetchOriginal = globalThis.fetch;
  const appId = process.env.GITHUB_APP_ID;
  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  try {
    const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const path = join(directory, "test.pem");
    writeFileSync(path, key.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_APP_PRIVATE_KEY_PATH = path;
    const calls: string[] = [];
    globalThis.fetch = async (url, init) => {
      calls.push(String(url));
      if (calls.length === 1) {
        assert.equal(String(url), "https://api.github.com/repos/gevalinho/deployguard-ai/installation");
        return Response.json({ id: 456 });
      }
      assert.equal(String(url), "https://api.github.com/app/installations/456/access_tokens");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.repositories, ["deployguard-ai"]);
      assert.equal(body.permissions.contents, "write");
      return Response.json({ token: "TEST_TOKEN", expires_at: new Date(Date.now() + 60_000).toISOString(),
        permissions: { contents: "write", pull_requests: "write" },
        repositories: [{ full_name: "gevalinho/deployguard-ai" }] });
    };
    const access = await createInstallationAccessToken("gevalinho", "deployguard-ai");
    assert.equal(access.repositoryIdentity, "gevalinho/deployguard-ai");
    assert.equal(access.installationId, 456);
    assert.equal(calls.length, 2);
    console.log("✓ Installation lookup and token request are scoped to the exact owner/repository.");
  } finally {
    globalThis.fetch = fetchOriginal;
    if (appId === undefined) delete process.env.GITHUB_APP_ID;
    else process.env.GITHUB_APP_ID = appId;
    if (keyPath === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    else process.env.GITHUB_APP_PRIVATE_KEY_PATH = keyPath;
    rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(() => { console.error("Token scope test failed."); process.exitCode = 1; });
