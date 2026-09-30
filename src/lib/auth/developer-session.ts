import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface DeveloperSession { githubId: string; login: string; expiresAt: number }
export const SESSION_COOKIE = "deployguard_developer";
export const OAUTH_COOKIE = "deployguard_oauth";

function secret(): string {
  const value = process.env.DEPLOYGUARD_SESSION_SECRET;
  if (!value || Buffer.byteLength(value) < 32) throw new Error("Developer session secret is not configured.");
  return value;
}
function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}
export function seal(value: object): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function unseal<T>(cookie: string | undefined): T | null {
  if (!cookie) return null;
  const [payload, signature, extra] = cookie.split(".");
  if (!payload || !signature || extra) return null;
  const expected = sign(payload);
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, Buffer.from(expected))) return null;
  try { return JSON.parse(Buffer.from(payload, "base64url").toString()) as T; } catch { return null; }
}
export function cookieValue(request: Request, name: string): string | undefined {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
export function readDeveloperSession(request: Request): DeveloperSession | null {
  const value = unseal<DeveloperSession>(cookieValue(request, SESSION_COOKIE));
  if (!value || !/^[1-9][0-9]*$/.test(value.githubId) ||
      !/^[A-Za-z0-9-]+$/.test(value.login) ||
      !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()) return null;
  return value;
}
export function newNonce(): string { return randomBytes(32).toString("base64url"); }
export function cookieOptions(maxAge: number): string {
  return `Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const target = new URL(request.url);
    return new URL(origin).origin === target.origin &&
      (target.protocol === "https:" || (target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname)));
  } catch { return false; }
}
