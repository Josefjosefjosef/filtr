/**
 * Short-lived HMAC signed access for private R2 document streaming via Worker.
 * Private documents must NEVER use permanent public R2 URLs.
 */

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  // btoa is available in Workers
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export type SignedObjectAccess = {
  objectKey: string;
  bucket: "DOCUMENTS" | "CREATIVES";
  exp: number; // unix seconds
  sig: string;
};

export async function signObjectAccess(
  secret: string,
  payload: { objectKey: string; bucket: "DOCUMENTS" | "CREATIVES"; exp: number }
): Promise<string> {
  const key = await importKey(secret);
  const msg = payload.bucket + "|" + payload.objectKey + "|" + String(payload.exp);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return b64url(sig);
}

export async function verifyObjectAccess(
  secret: string,
  access: SignedObjectAccess,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!access.objectKey || !access.bucket || !access.sig || !access.exp) {
    return { ok: false, reason: "malformed" };
  }
  if (access.exp < nowSec) return { ok: false, reason: "expired" };
  if (access.exp > nowSec + 86400) return { ok: false, reason: "exp_too_far" };
  const expected = await signObjectAccess(secret, {
    objectKey: access.objectKey,
    bucket: access.bucket,
    exp: access.exp,
  });
  // constant-time-ish compare
  if (expected.length !== access.sig.length) return { ok: false, reason: "bad_sig" };
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ access.sig.charCodeAt(i);
  if (diff !== 0) return { ok: false, reason: "bad_sig" };
  if (access.objectKey.includes("..") || access.objectKey.startsWith("/")) {
    return { ok: false, reason: "bad_key" };
  }
  return { ok: true };
}

export function parseAccessQuery(url: URL): SignedObjectAccess | null {
  const objectKey = url.searchParams.get("key") || "";
  const bucket = url.searchParams.get("bucket") || "";
  const exp = Number(url.searchParams.get("exp") || "0");
  const sig = url.searchParams.get("sig") || "";
  if (bucket !== "DOCUMENTS" && bucket !== "CREATIVES") return null;
  return { objectKey, bucket, exp, sig };
}

export { b64urlToBytes };
