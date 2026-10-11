import { vi, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cookieOptions,
  readDeveloperSession,
  sameOrigin,
  seal,
  SESSION_COOKIE,
  unseal,
} from "./developer-session";

const SECRET = "test-session-secret-with-at-least-32-bytes";

function sessionRequest(cookie: string): Request {
  return new Request("https://deployguard.example/api/assessment", {
    headers: { Cookie: `${SESSION_COOKIE}=${cookie}` },
  });
}

function validSession() {
  return {
    githubId: "123",
    login: "developer",
    expiresAt: Date.now() + 60_000,
  };
}

describe("developer session security", () => {
  const originalSecret = process.env.DEPLOYGUARD_SESSION_SECRET;

  beforeEach(() => {
    process.env.DEPLOYGUARD_SESSION_SECRET = SECRET;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.DEPLOYGUARD_SESSION_SECRET;
    } else {
      process.env.DEPLOYGUARD_SESSION_SECRET = originalSecret;
    }
  });

  it("accepts a valid signed, unexpired session", () => {
    const session = validSession();
    expect(readDeveloperSession(sessionRequest(seal(session)))).toEqual(session);
  });

  it("rejects a modified session payload", () => {
    const cookie = seal(validSession());
    const [payload, signature] = cookie.split(".");
    const modified = Buffer.from(
      JSON.stringify({ ...validSession(), githubId: "999" }),
    ).toString("base64url");

    expect(
      readDeveloperSession(sessionRequest(`${modified}.${signature}`)),
    ).toBeNull();

    expect(payload).not.toBe(modified);
  });

  it("rejects expired sessions", () => {
    const expired = { ...validSession(), expiresAt: Date.now() - 1_000 };
    expect(readDeveloperSession(sessionRequest(seal(expired)))).toBeNull();
  });

  it("rejects malformed session cookies", () => {
    for (const cookie of ["invalid", "a.b.c", ""]) {
      expect(readDeveloperSession(sessionRequest(cookie))).toBeNull();
    }
  });

  it("rejects invalid developer identities", () => {
    for (const session of [
      { ...validSession(), githubId: "invalid" },
      { ...validSession(), login: "invalid login" },
      { ...validSession(), expiresAt: "tomorrow" },
    ]) {
      expect(readDeveloperSession(sessionRequest(seal(session)))).toBeNull();
    }
  });

  it("fails closed when the signing secret is missing or weak", () => {
    delete process.env.DEPLOYGUARD_SESSION_SECRET;
    expect(() => seal(validSession())).toThrow();

    process.env.DEPLOYGUARD_SESSION_SECRET = "short";
    expect(() => seal(validSession())).toThrow();
  });

  it("rejects an invalid signature", () => {
    const cookie = seal(validSession());
    const [payload] = cookie.split(".");
    expect(unseal(`${payload}.invalid-signature`)).toBeNull();
  });

  it("sets secure cookie attributes", () => {
    const options = cookieOptions(600);
    expect(options).toContain("HttpOnly");
    expect(options).toContain("Secure");
    expect(options).toContain("SameSite=Lax");
    expect(options).toContain("Max-Age=600");
  });


  it("rejects localhost fallback in production without a configured origin", () => {
    vi.stubEnv("DEPLOYGUARD_PUBLIC_ORIGIN", undefined);
    vi.stubEnv("NODE_ENV", "production");

    try {
      const request = new Request("http://127.0.0.1:3000/api/remediation", {
        method: "POST",
        headers: { Origin: "http://127.0.0.1:3000" },
      });

      expect(sameOrigin(request)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects spoofed forwarded headers", () => {
    const request = new Request("http://127.0.0.1:3000/api/remediation", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
      },
    });

    expect(sameOrigin(request)).toBe(false);
  });

  it("accepts the configured public HTTPS origin behind a proxy", () => {
    const previous = process.env.DEPLOYGUARD_PUBLIC_ORIGIN;
    process.env.DEPLOYGUARD_PUBLIC_ORIGIN = "https://deployguard.example";

    try {
      const request = new Request("http://127.0.0.1:3000/api/remediation", {
        method: "POST",
        headers: {
          Origin: "https://deployguard.example",
        },
      });

      expect(sameOrigin(request)).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.DEPLOYGUARD_PUBLIC_ORIGIN;
      } else {
        process.env.DEPLOYGUARD_PUBLIC_ORIGIN = previous;
      }
    }
  });

  it("accepts a matching configured HTTPS origin", () => {
    const previous = process.env.DEPLOYGUARD_PUBLIC_ORIGIN;
    process.env.DEPLOYGUARD_PUBLIC_ORIGIN = "https://deployguard.example";

    try {
      const request = new Request("https://deployguard.example/api/remediation", {
        method: "POST",
        headers: { Origin: "https://deployguard.example" },
      });

      expect(sameOrigin(request)).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.DEPLOYGUARD_PUBLIC_ORIGIN;
      } else {
        process.env.DEPLOYGUARD_PUBLIC_ORIGIN = previous;
      }
    }
  });

  it("rejects missing and unrelated origins", () => {
    const url = "https://deployguard.example/api/remediation";

    expect(sameOrigin(new Request(url, { method: "POST" }))).toBe(false);

    expect(
      sameOrigin(
        new Request(url, {
          method: "POST",
          headers: { Origin: "https://attacker.example" },
        }),
      ),
    ).toBe(false);
  });
});
