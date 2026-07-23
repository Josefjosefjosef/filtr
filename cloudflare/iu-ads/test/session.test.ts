import { describe, expect, it } from "vitest";
import {
  buildExpiredSessionCookie,
  buildSessionCookie,
  generateSessionId,
  hashOpaqueToken,
  nowSeconds,
  parseCookies,
  signSessionToken,
  verifySessionToken,
} from "../src/session";

const SECRET = "test-session-secret-not-for-prod";

describe("signed admin session tokens", () => {
  it("signs and verifies a valid token", async () => {
    const sessionId = generateSessionId();
    const exp = nowSeconds() + 3600;
    const token = await signSessionToken(SECRET, { sessionId, exp });
    const verified = await verifySessionToken(SECRET, token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.sessionId).toBe(sessionId);
      expect(verified.exp).toBe(exp);
    }
  });

  it("rejects an expired token", async () => {
    const sessionId = generateSessionId();
    const exp = nowSeconds() - 10;
    const token = await signSessionToken(SECRET, { sessionId, exp });
    const verified = await verifySessionToken(SECRET, token);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toBe("expired");
  });

  it("rejects a token signed with a different secret", async () => {
    const sessionId = generateSessionId();
    const exp = nowSeconds() + 3600;
    const token = await signSessionToken("other-secret", { sessionId, exp });
    const verified = await verifySessionToken(SECRET, token);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toBe("bad_sig");
  });

  it("rejects tampered/malformed tokens", async () => {
    const malformed = await verifySessionToken(SECRET, "not.a.valid.token");
    expect(malformed.ok).toBe(false);
    const empty = await verifySessionToken(SECRET, "");
    expect(empty.ok).toBe(false);
  });

  it("generates unique high-entropy session ids", () => {
    const a = generateSessionId();
    const b = generateSessionId();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(48);
  });

  it("hashes opaque tokens deterministically for DB lookup", async () => {
    const token = generateSessionId();
    const hash1 = await hashOpaqueToken(token);
    const hash2 = await hashOpaqueToken(token);
    expect(hash1).toEqual(hash2);
    expect(hash1).not.toEqual(token);
  });
});

describe("admin session cookie attributes", () => {
  it("sets HttpOnly, Secure, SameSite=Strict on login cookie", () => {
    const cookie = buildSessionCookie("iu_ads_admin_session", "abc.123.def", 28800);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Max-Age=28800");
    expect(cookie.startsWith("iu_ads_admin_session=abc.123.def;")).toBe(true);
  });

  it("expires the cookie on logout with Max-Age=0", () => {
    const cookie = buildExpiredSessionCookie("iu_ads_admin_session");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
  });

  it("parses cookie headers into a map", () => {
    const parsed = parseCookies("iu_ads_admin_session=abc; other=xyz");
    expect(parsed.iu_ads_admin_session).toBe("abc");
    expect(parsed.other).toBe("xyz");
    expect(parseCookies(null)).toEqual({});
  });
});
