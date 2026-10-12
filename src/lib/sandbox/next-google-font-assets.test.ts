import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fetchApprovedGoogleAsset, prepareNextGoogleFonts, publicIpv4 } from "./next-google-font-assets";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
  directories.length = 0;
});

async function repository(source: string) {
  const directory = await mkdtemp(join(tmpdir(), "deployguard-font-fixture-"));
  directories.push(directory);
  await writeFile(join(directory, "package.json"), JSON.stringify({ dependencies: { next: "16.4.0" } }));
  await writeFile(join(directory, "layout.tsx"), source);
  return directory;
}

function fontBytes(): Buffer {
  const bytes = Buffer.alloc(48);
  bytes.write("wOF2", 0, "ascii");
  bytes.writeUInt32BE(bytes.length, 8);
  bytes.writeUInt16BE(1, 12);
  bytes.writeUInt32BE(100, 16);
  return bytes;
}

const fontUrl = "https://fonts.gstatic.com/s/testfont/unique-build-fixture.woff2";
const css = `/* latin */\n@font-face {\n  font-family: 'Geist';\n  src: url(${fontUrl}) format('woff2');\n}`;

describe("controlled Next.js Google Font preparation", () => {
  it("stages validated CSS and font bytes for the Next loader in a read-only mount", async () => {
    const root = await repository(`import { Geist as Brand } from "next/font/google";
      const font = Brand({ subsets: ["latin"], display: "swap" });`);
    const fetched: string[] = [];
    const prepared = await prepareNextGoogleFonts(root, async (url) => {
      fetched.push(url);
      return url.startsWith("https://fonts.googleapis.com/css2?") ? Buffer.from(css) : fontBytes();
    }, join(root, ".deployguard", "asset-cache"));
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") return;
    try {
      expect(prepared.mount.readOnly).toBe(true);
      expect(prepared.mount.target).toBe("/deployguard-build-assets");
      expect(prepared.mount.source.startsWith(root)).toBe(false);
      expect(prepared.environment.NEXT_FONT_GOOGLE_MOCKED_RESPONSES)
        .toBe("/deployguard-build-assets/fonts.js");
      const moduleText = await readFile(join(prepared.mount.source, "fonts.js"), "utf8");
      expect(moduleText).toContain("https://fonts.googleapis.com/css2?family=Geist");
      expect(moduleText).toContain("/deployguard-build-assets/");
      expect(moduleText).not.toContain(fontUrl);
      const localName = moduleText.match(/\/deployguard-build-assets\/([a-f0-9]{64}\.woff2)/)?.[1];
      expect(localName).toBeDefined();
      expect(await readFile(join(prepared.mount.source, localName!))).toEqual(fontBytes());
      expect(fetched).toContain(fontUrl);
    } finally {
      await prepared.cleanup();
    }
  });

  it("blocks dynamic font options without evaluating repository code", async () => {
    const root = await repository(`import { Geist } from "next/font/google";
      const options = { subsets: ["latin"] }; const font = Geist(options);`);
    const prepared = await prepareNextGoogleFonts(root, async () => {
      throw new Error("fetch must not run");
    }, join(root, ".deployguard", "asset-cache"));
    expect(prepared).toEqual({ status: "blocked",
      reason: "Google Font usage could not be safely resolved from static build source." });
  });

  it("reuses only validated cached CSS and font bytes", async () => {
    const root = await repository(`import { Geist } from "next/font/google";
      const font = Geist({ subsets: ["latin"] });`);
    const cache = join(root, ".deployguard", "asset-cache");
    const first = await prepareNextGoogleFonts(root, async (url) =>
      url.startsWith("https://fonts.googleapis.com/") ? Buffer.from(css) : fontBytes(), cache);
    expect(first.status).toBe("ready");
    if (first.status === "ready") await first.cleanup();
    const second = await prepareNextGoogleFonts(root, async () => {
      throw new Error("validated cache should avoid network");
    }, cache);
    expect(second.status).toBe("ready");
    if (second.status === "ready") await second.cleanup();
  });

  it.each([
    `@font-face { src: url(https://evil.example/font.woff2) }`,
    `@import url(https://fonts.gstatic.com/s/testfont/unique-build-fixture.woff2);\n${css}`,
  ])("blocks unapproved or active CSS URLs", async (responseCss) => {
    const root = await repository(`import { Geist } from "next/font/google";
      const font = Geist({ subsets: ["latin"] });`);
    const prepared = await prepareNextGoogleFonts(root,
      async () => Buffer.from(responseCss), join(root, ".deployguard", "asset-cache"));
    expect(prepared.status).toBe("blocked");
  });

  it("blocks an invalid font binary and does not stage it", async () => {
    const root = await repository(`import { Geist } from "next/font/google";
      const font = Geist({ subsets: ["latin"] });`);
    const prepared = await prepareNextGoogleFonts(root, async (url) =>
      url.startsWith("https://fonts.googleapis.com/") ? Buffer.from(css) : Buffer.from("not a font"),
      join(root, ".deployguard", "asset-cache"));
    expect(prepared.status).toBe("blocked");
  });

  it.each([
    "http://fonts.googleapis.com/css2?family=Geist",
    "https://fonts.googleapis.com.evil.example/css2?family=Geist",
    "https://127.0.0.1/css2?family=Geist",
    "https://fonts.googleapis.com@evil.example/css2?family=Geist",
    "https://fonts.gstatic.com/secret",
  ])("rejects an unapproved outbound URL before network access: %s", async (url) => {
    await expect(fetchApprovedGoogleAsset(url, 1000)).rejects.toThrow(/unapproved_asset/);
  });

  it("rejects loopback, metadata, private, and reserved DNS answers", () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "10.0.0.1", "172.16.1.1",
      "192.168.1.1", "100.64.0.1", "192.0.2.1", "198.51.100.2", "203.0.113.1"])
      expect(publicIpv4(address)).toBe(false);
    expect(publicIpv4("8.8.8.8")).toBe(true);
  });
});
