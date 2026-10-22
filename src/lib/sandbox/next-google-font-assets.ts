import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { existsSync, readFileSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { currentAssessmentExecution, remainingAssessmentMs } from "@/lib/orchestration/assessment-execution";

import type { DockerSandboxMount } from "./docker-sandbox";

const requireTrusted = createRequire(import.meta.url);
const { validateGoogleFontFunctionCall } = requireTrusted(
  "next/dist/compiled/@next/font/dist/google/validate-google-font-function-call"
) as { validateGoogleFontFunctionCall: (name: string, options: object) => {
  fontFamily: string; weights: string[]; styles: string[]; display: string;
  selectedVariableAxes?: string[];
} };
const { getFontAxes } = requireTrusted(
  "next/dist/compiled/@next/font/dist/google/get-font-axes"
) as { getFontAxes: (family: string, weights: string[], styles: string[], axes?: string[]) => object };
const { getGoogleFontsUrl } = requireTrusted(
  "next/dist/compiled/@next/font/dist/google/get-google-fonts-url"
) as { getGoogleFontsUrl: (family: string, axes: object, display: string) => string };

const ASSET_TARGET = "/deployguard-build-assets";
const MAX_SOURCE_FILES = 1000;
const MAX_SCAN_ENTRIES = 5000;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_FONT_CALLS = 24;
const MAX_FONT_FILES = 64;
const MAX_CSS_BYTES = 512 * 1024;
const MAX_FONT_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const CACHE_ROOT = join(process.cwd(), ".deployguard", "cache", "next-google-fonts");
const STAGING_ROOT = join(CACHE_ROOT, "staging");

export type GoogleFontPreparation =
  | { status: "not_required" }
  | { status: "blocked"; reason: string; transientFailure?: "approved_build_asset" }
  | { status: "ready"; mount: DockerSandboxMount; environment: Record<string, string>;
      cleanup: () => Promise<void> };

export function publicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
    return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export async function fetchApprovedGoogleAsset(url: string, maxBytes: number,
  deadline = Date.now() + 10_000): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port ||
      parsed.hash || !["fonts.googleapis.com", "fonts.gstatic.com"].includes(parsed.hostname))
    throw new Error("unapproved_asset_url");
  if ((parsed.hostname === "fonts.googleapis.com" && parsed.pathname !== "/css2") ||
      (parsed.hostname === "fonts.gstatic.com" && !/\.woff2?$/.test(parsed.pathname)))
    throw new Error("unapproved_asset_path");
  const dnsTimeoutMs = Math.max(1, deadline - Date.now());
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    dns.lookup(parsed.hostname, { family: 4, all: true }),
    new Promise<never>((_resolve, reject) => {
      dnsTimer = setTimeout(() => reject(new Error("asset_total_timeout")), dnsTimeoutMs);
    }),
  ]).finally(() => { if (dnsTimer) clearTimeout(dnsTimer); });
  if (!addresses.length || addresses.some((entry) => !publicIpv4(entry.address)))
    throw new Error("unapproved_dns_address");
  const address = addresses[0].address;
  return new Promise<Buffer>((resolve, reject) => {
    const request = https.get({
      hostname: address,
      port: 443,
      path: `${parsed.pathname}${parsed.search}`,
      servername: parsed.hostname,
      headers: { Host: parsed.hostname,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36" },
      timeout: Math.max(1, Math.min(10_000, deadline - Date.now())),
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`asset_http_${response.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(new Error("asset_size_limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    const deadlineTimer = setTimeout(() => request.destroy(new Error("asset_total_timeout")),
      Math.max(1, deadline - Date.now()));
    const assessmentSignal = currentAssessmentExecution()?.signal;
    const cancel = () => request.destroy(new Error("asset_total_timeout"));
    if (assessmentSignal?.aborted) cancel();
    else assessmentSignal?.addEventListener("abort", cancel, { once: true });
    request.on("close", () => clearTimeout(deadlineTimer));
    request.on("close", () => assessmentSignal?.removeEventListener("abort", cancel));
    request.on("timeout", () => request.destroy(new Error("asset_timeout")));
    request.on("error", reject);
  });
}

function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map((item) => {
    if (!ts.isExpression(item)) throw new Error("unsupported_font_options");
    return literal(item);
  });
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) ||
          !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)))
        throw new Error("unsupported_font_options");
      result[property.name.text] = literal(property.initializer);
    }
    return result;
  }
  throw new Error("unsupported_font_options");
}

async function fontRequests(repositoryPath: string): Promise<string[]> {
  const urls = new Set<string>();
  let scanned = 0;
  let entries = 0;
  let sourceBytes = 0;
  async function walk(directory: string, depth = 0): Promise<void> {
    if (depth > 32) throw new Error("source_scan_limit");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++entries > MAX_SCAN_ENTRIES) throw new Error("source_scan_limit");
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", ".next", ".deployguard", "dist", "build", "coverage"].includes(entry.name))
          await walk(path, depth + 1);
        continue;
      }
      if (!entry.isFile() || ![".js", ".jsx", ".ts", ".tsx", ".mjs", ".mts"].includes(extname(entry.name)))
        continue;
      if (++scanned > MAX_SOURCE_FILES) throw new Error("source_scan_limit");
      const size = (await lstat(path)).size;
      sourceBytes += size;
      if (size > MAX_SOURCE_BYTES || sourceBytes > MAX_SOURCE_TOTAL_BYTES)
        throw new Error("source_scan_limit");
      const source = ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true);
      const imports = new Map<string, string>();
      for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text !== "next/font/google")
          continue;
        const named = statement.importClause?.namedBindings;
        if (!named || !ts.isNamedImports(named)) throw new Error("unsupported_font_import");
        for (const item of named.elements) imports.set(item.name.text, item.propertyName?.text ?? item.name.text);
      }
      if (imports.size === 0) continue;
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && imports.has(node.expression.text)) {
          if (node.arguments.length !== 1) throw new Error("unsupported_font_options");
          const options = literal(node.arguments[0]);
          if (!options || typeof options !== "object" || Array.isArray(options))
            throw new Error("unsupported_font_options");
          const config = validateGoogleFontFunctionCall(imports.get(node.expression.text)!, options);
          const axes = getFontAxes(config.fontFamily, config.weights, config.styles,
            config.selectedVariableAxes);
          urls.add(getGoogleFontsUrl(config.fontFamily, axes, config.display));
          if (urls.size > MAX_FONT_CALLS) throw new Error("font_request_limit");
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  await walk(repositoryPath);
  return [...urls];
}

function validCss(bytes: Buffer): { css: string; urls: string[] } {
  if (bytes.length === 0 || bytes.length > MAX_CSS_BYTES) throw new Error("invalid_font_css");
  const css = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!css.includes("@font-face") || /@import|javascript:|expression\s*\(|behavior\s*:/i.test(css))
    throw new Error("invalid_font_css");
  const urls = [...css.matchAll(/src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^\s)'"<>]+\.woff2?)\)/g)]
    .map((match) => match[1]);
  if (!urls.length || [...css.matchAll(/url\s*\(/g)].length !== urls.length ||
      urls.length > MAX_FONT_FILES) throw new Error("invalid_font_css");
  return { css, urls };
}

function validFont(bytes: Buffer): boolean {
  return bytes.length >= 44 && bytes.length <= MAX_FONT_BYTES &&
    ["wOF2", "wOFF"].includes(bytes.subarray(0, 4).toString("ascii")) &&
    bytes.readUInt32BE(8) === bytes.length && bytes.readUInt16BE(12) > 0 &&
    bytes.readUInt16BE(14) === 0 && bytes.readUInt32BE(16) > 0;
}

async function cachedAsset(cacheRoot: string, url: string, maxBytes: number,
  validate: (bytes: Buffer) => boolean,
  fetchAsset: (url: string, maxBytes: number) => Promise<Buffer>): Promise<Buffer> {
  const key = createHash("sha256").update(url).digest("hex");
  const path = join(cacheRoot, key);
  try {
    const cached = await readFile(path);
    if (cached.length <= maxBytes && validate(cached)) return cached;
  } catch { /* A missing or invalid cache entry must be fetched again. */ }
  const bytes = await fetchAsset(url, maxBytes);
  if (bytes.length > maxBytes || !validate(bytes)) throw new Error("invalid_asset_data");
  await mkdir(cacheRoot, { recursive: true, mode: 0o700 });
  const temporary = join(cacheRoot, `${key}.${process.pid}.${createHash("sha256").update(bytes).digest("hex")}.tmp`);
  await writeFile(temporary, bytes, { mode: 0o600 });
  await rename(temporary, path);
  return bytes;
}

export async function prepareNextGoogleFonts(repositoryPath: string,
  fetchAsset = fetchApprovedGoogleAsset, cacheRoot = CACHE_ROOT): Promise<GoogleFontPreparation> {
  let staging: string | undefined;
  const deadline = Date.now() + remainingAssessmentMs(60_000);
  const boundedFetch = async (url: string, maxBytes: number) => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (Date.now() >= deadline) throw new Error("asset_total_timeout");
      try {
        return await fetchAsset(url, maxBytes, deadline);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (!/ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNRESET|ECONNREFUSED|ETIMEDOUT|asset_timeout|asset_http_429|asset_http_5\\d\\d/i.test(code) ||
            attempt === 2 || Date.now() + 500 >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new Error("asset_total_timeout");
  };
  try {
    const packageJson = JSON.parse(readFileSync(join(repositoryPath, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>;
    };
    if (!packageJson.dependencies?.next && !packageJson.devDependencies?.next)
      return { status: "not_required" };
    const urls = await fontRequests(repositoryPath);
    if (urls.length === 0) return { status: "not_required" };
    const stagedWithinRepository = relative(resolve(repositoryPath), STAGING_ROOT);
    if (!stagedWithinRepository.startsWith("..") && !isAbsolute(stagedWithinRepository))
      throw new Error("unsafe_staging_location");
    await mkdir(STAGING_ROOT, { recursive: true, mode: 0o700 });
    staging = await mkdtemp(join(STAGING_ROOT, "assets-"));
    await chmod(staging, 0o700);
    const responses: Record<string, string> = {};
    const fontPaths = new Map<string, string>();
    let totalBytes = 0;
    for (const url of urls) {
      const cssBytes = await cachedAsset(cacheRoot, url, MAX_CSS_BYTES, (bytes) => {
        try { validCss(bytes); return true; } catch { return false; }
      }, boundedFetch);
      totalBytes += cssBytes.length;
      const { css, urls: fontUrls } = validCss(cssBytes);
      let localCss = css;
      for (const fontUrl of fontUrls) {
        let path = fontPaths.get(fontUrl);
        if (!path) {
          if (fontPaths.size >= MAX_FONT_FILES) throw new Error("font_file_limit");
          const bytes = await cachedAsset(cacheRoot, fontUrl, MAX_FONT_BYTES, validFont, boundedFetch);
          totalBytes += bytes.length;
          if (totalBytes > MAX_TOTAL_BYTES) throw new Error("asset_total_limit");
          path = `${ASSET_TARGET}/${createHash("sha256").update(bytes).digest("hex")}.${fontUrl.endsWith(".woff2") ? "woff2" : "woff"}`;
          await writeFile(join(staging, path.slice(ASSET_TARGET.length + 1)), bytes, { mode: 0o600 });
          fontPaths.set(fontUrl, path);
        }
        localCss = localCss.split(fontUrl).join(path);
      }
      responses[url] = localCss;
    }
    await writeFile(join(staging, "fonts.js"), `module.exports = ${JSON.stringify(responses)};\n`, { mode: 0o600 });
    const readyPath = staging;
    return { status: "ready", mount: { source: readyPath, target: ASSET_TARGET, readOnly: true },
      environment: { NEXT_FONT_GOOGLE_MOCKED_RESPONSES: `${ASSET_TARGET}/fonts.js` },
      cleanup: () => rm(readyPath, { recursive: true, force: true }) };
  } catch (error) {
    if (staging && existsSync(staging)) await rm(staging, { recursive: true, force: true });
    const code = error instanceof Error ? error.message : "";
    const reason = code === "unsafe_staging_location"
      ? "Approved build assets cannot be staged outside this repository's writable workspace."
      : ["unsupported_font_import", "unsupported_font_options", "source_scan_limit",
      "font_request_limit"].includes(code)
      ? "Google Font usage could not be safely resolved from static build source."
      : ["invalid_font_css", "invalid_asset_data", "font_file_limit", "asset_total_limit"].includes(code)
        ? "Approved Google Font assets failed validation or exceeded download limits."
        : "Approved Google Font assets could not be fetched for the isolated production build.";
    const transientFailure = /ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ECONNRESET|ECONNREFUSED|ETIMEDOUT|asset_timeout|asset_total_timeout|asset_http_429|asset_http_5\\d\\d/i.test(code)
      ? "approved_build_asset" as const : undefined;
    return { status: "blocked", reason, ...(transientFailure ? { transientFailure } : {}) };
  }
}
