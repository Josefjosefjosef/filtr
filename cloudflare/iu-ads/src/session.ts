/**
 * Admin session cookies (Etapa 2).
 * Cookie value is an HMAC-signed opaque token: base64url(sessionId).exp.sig
 * Signature key: ADS_SESSION_SECRET (Worker secret, never a client-visible value).
 * Cookie attributes: HttpOnly, Secure, SameSite=Strict (see 07-roles-permissions.md).
 * The DB (`admin_sessions.token_hash`) remains source of truth for revocation —
 * a valid signature only proves the token was minted by this Worker, not that it
 * is still active.
 */

export const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const DEFAULT_SESSION_COOKIE_NAME = "iu_ads_admin_session";

function b64url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function toHex(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
  return s;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Opaque, high-entropy session identifier — persisted (hashed) in admin_sessions. */
export function generateSessionId(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

/** SHA-256 hash of an opaque token for DB storage (sessions, password resets). */
export async function hashOpaqueToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(digest);
}

export type SignedSessionToken = { sessionId: string; exp: number };

export async function signSessionToken(secret: string, payload: SignedSessionToken): Promise<string> {
  const encodedId = b64url(payload.sessionId);
  const msg = encodedId + "|" + String(payload.exp);
  const sig = await hmacHex(secret, msg);
  return encodedId + "." + String(payload.exp) + "." + sig;
}

export type VerifySessionTokenResult =
  | { ok: true; sessionId: string; exp: number }
  | { ok: false; reason: string };

export async function verifySessionToken(
  secret: string,
  token: string,
  nowSec: number = nowSeconds()
): Promise<VerifySessionTokenResult> {
  if (typeof token !== "string" || !token) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [encodedId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!encodedId || !sig || !Number.isFinite(exp) || exp <= 0) return { ok: false, reason: "malformed" };
  const expected = await hmacHex(secret, encodedId + "|" + String(exp));
  if (!timingSafeEqual(expected, sig)) return { ok: false, reason: "bad_sig" };
  if (exp < nowSec) return { ok: false, reason: "expired" };
  let sessionId: string;
  try {
    sessionId = b64urlDecode(encodedId);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, sessionId, exp };
}

export function buildSessionCookie(name: string, token: string, maxAgeSeconds: number): string {
  return (
    name +
    "=" +
    token +
    "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=" +
    String(Math.max(0, Math.floor(maxAgeSeconds)))
  );
}

export function buildExpiredSessionCookie(name: string): string {
  return name + "=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }
  return out;
}
