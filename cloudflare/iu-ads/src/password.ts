/**
 * Admin password hashing (Etapa 2). PBKDF2-SHA256 with per-user random salt
 * plus a shared server-side pepper (ADS_PASSWORD_PEPPER, never stored in DB).
 * Stored format: pbkdf2$<iterations>$<saltHex>$<hashHex>
 */

export const DEFAULT_PASSWORD_HASH_ITERATIONS = 100_000;
export const DEFAULT_PASSWORD_MIN_LENGTH = 12;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : "0" + hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function randomSaltHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

async function derive(password: string, pepper: string, saltHex: string, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password + "|" + pepper),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex), iterations },
    keyMaterial,
    256
  );
  return toHex(bits);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPassword(
  password: string,
  pepper: string,
  iterations: number = DEFAULT_PASSWORD_HASH_ITERATIONS
): Promise<string> {
  const salt = randomSaltHex();
  const hash = await derive(password, pepper, salt, iterations);
  return "pbkdf2$" + String(iterations) + "$" + salt + "$" + hash;
}

export async function verifyPassword(password: string, pepper: string, stored: string): Promise<boolean> {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = parts[3];
  if (!Number.isFinite(iterations) || iterations <= 0 || !salt || !expected) return false;
  const actual = await derive(password, pepper, salt, iterations);
  return timingSafeEqualHex(actual, expected);
}

export type PasswordStrengthResult = { ok: true } | { ok: false; reason: string };

/** Server-side minimum policy — UI hints do not replace this check. */
export function validatePasswordStrength(
  password: string,
  minLength: number = DEFAULT_PASSWORD_MIN_LENGTH
): PasswordStrengthResult {
  if (typeof password !== "string" || password.length < minLength) {
    return { ok: false, reason: "too_short" };
  }
  if (password.length > 256) return { ok: false, reason: "too_long" };
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  if (!hasLower || !hasUpper || !hasDigit) return { ok: false, reason: "too_weak" };
  return { ok: true };
}
