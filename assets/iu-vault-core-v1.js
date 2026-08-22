/**
 * InfoUzel.cz — vault cryptography core (AES-256-GCM, key wrap, KDF helpers).
 * Local-first; no network; keys never logged.
 */
export const VAULT_DB_NAME = "iu.vault.v1";
export const VAULT_SCHEMA_VERSION = 1;
export const CIPHER_ALG = "AES-GCM";
export const KEY_BITS = 256;
export const IV_BYTES = 12;
export const PBKDF2_DEFAULT_ITERATIONS = 310000;
export const PIN_VERIFY_PLAINTEXT = "IU_VAULT_PIN_VERIFY_V1";
export const DEVICE_VERIFY_PLAINTEXT = "IU_VAULT_DEVICE_VERIFY_V1";

const subtle = globalThis.crypto && globalThis.crypto.subtle;
const getRandomValues = globalThis.crypto && globalThis.crypto.getRandomValues
  ? (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))
  : null;

function requireSubtle() {
  if (!subtle || !getRandomValues) throw new Error("VAULT_CRYPTO_UNAVAILABLE");
}

export function bytesToB64(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(String(b64 || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function generateMdk() {
  requireSubtle();
  return subtle.generateKey({ name: CIPHER_ALG, length: KEY_BITS }, false, ["encrypt", "decrypt"]);
}

export async function exportMdkRaw(mdk) {
  requireSubtle();
  const raw = await subtle.exportKey("raw", mdk);
  return new Uint8Array(raw);
}

export async function importMdkRaw(rawBytes) {
  requireSubtle();
  return subtle.importKey("raw", rawBytes, { name: CIPHER_ALG, length: KEY_BITS }, false, ["encrypt", "decrypt"]);
}

export function buildAad(storageKey) {
  const enc = new TextEncoder();
  return enc.encode(`iu-vault-v1|${storageKey}`);
}

export async function encryptJson(mdk, storageKey, value) {
  requireSubtle();
  const iv = getRandomValues(IV_BYTES);
  const aad = buildAad(storageKey);
  const pt = new TextEncoder().encode(JSON.stringify(value));
  const ct = await subtle.encrypt({ name: CIPHER_ALG, iv, additionalData: aad, tagLength: 128 }, mdk, pt);
  return {
    v: VAULT_SCHEMA_VERSION,
    alg: CIPHER_ALG,
    iv: bytesToB64(iv),
    aad: bytesToB64(aad),
    ct: bytesToB64(new Uint8Array(ct)),
  };
}

export async function decryptJson(mdk, storageKey, envelope) {
  requireSubtle();
  if (!envelope || envelope.v !== VAULT_SCHEMA_VERSION) throw new Error("VAULT_FORMAT_UNSUPPORTED");
  const iv = b64ToBytes(envelope.iv);
  const aad = envelope.aad ? b64ToBytes(envelope.aad) : buildAad(storageKey);
  const ct = b64ToBytes(envelope.ct);
  const pt = await subtle.decrypt({ name: CIPHER_ALG, iv, additionalData: aad, tagLength: 128 }, mdk, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

export async function encryptString(mdk, storageKey, text) {
  requireSubtle();
  const iv = getRandomValues(IV_BYTES);
  const aad = buildAad(storageKey);
  const pt = new TextEncoder().encode(String(text));
  const ct = await subtle.encrypt({ name: CIPHER_ALG, iv, additionalData: aad, tagLength: 128 }, mdk, pt);
  return {
    v: VAULT_SCHEMA_VERSION,
    alg: CIPHER_ALG,
    iv: bytesToB64(iv),
    aad: bytesToB64(aad),
    ct: bytesToB64(new Uint8Array(ct)),
  };
}

export async function decryptString(mdk, storageKey, envelope) {
  requireSubtle();
  if (!envelope || envelope.v !== VAULT_SCHEMA_VERSION) throw new Error("VAULT_FORMAT_UNSUPPORTED");
  const iv = b64ToBytes(envelope.iv);
  const aad = envelope.aad ? b64ToBytes(envelope.aad) : buildAad(storageKey);
  const ct = b64ToBytes(envelope.ct);
  const pt = await subtle.decrypt({ name: CIPHER_ALG, iv, additionalData: aad, tagLength: 128 }, mdk, ct);
  return new TextDecoder().decode(pt);
}

export async function wrapMdk(mdk, wrappingKey) {
  requireSubtle();
  const wrapped = await subtle.wrapKey("raw", mdk, wrappingKey, "AES-KW");
  return {
    v: VAULT_SCHEMA_VERSION,
    ct: bytesToB64(new Uint8Array(wrapped)),
  };
}

export async function unwrapMdk(wrappingKey, wrapped) {
  requireSubtle();
  const ct = wrapped && wrapped.ct ? b64ToBytes(wrapped.ct) : wrapped;
  return subtle.unwrapKey(
    "raw",
    ct,
    wrappingKey,
    "AES-KW",
    { name: CIPHER_ALG, length: KEY_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

/** @deprecated internal test helper only */
export async function wrapMdkRaw(mdk, wrappingKey) {
  return wrapMdk(mdk, wrappingKey);
}

/** @deprecated internal test helper only */
export async function unwrapMdkRaw(wrappingKey, wrapped) {
  return unwrapMdk(wrappingKey, wrapped);
}

export async function derivePinKey(pin, saltBytes, iterations) {
  requireSubtle();
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey("raw", enc.encode(String(pin)), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    256
  );
  return subtle.importKey("raw", bits, "AES-KW", false, ["wrapKey", "unwrapKey"]);
}

/** AES-GCM key derived from PIN — encrypts MDK seed bytes (non-extractable MDK safe). */
export async function derivePinAesKey(pin, saltBytes, iterations) {
  requireSubtle();
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey("raw", enc.encode(String(pin)), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations, hash: "SHA-256" },
    baseKey,
    256
  );
  return subtle.importKey("raw", bits, { name: CIPHER_ALG, length: KEY_BITS }, false, ["encrypt", "decrypt"]);
}

export const PIN_MDK_SEED_STORAGE_KEY = "iu:vault:pin:mdk-seed:v1";

export async function wrapMdkSeedForPin(pinAesKey, seedBytes) {
  const seedB64 = bytesToB64(seedBytes);
  return encryptString(pinAesKey, PIN_MDK_SEED_STORAGE_KEY, seedB64);
}

export async function unwrapMdkSeedFromPin(pinAesKey, envelope) {
  const seedB64 = await decryptString(pinAesKey, PIN_MDK_SEED_STORAGE_KEY, envelope);
  return b64ToBytes(seedB64);
}

export async function calibratePbkdf2Iterations(targetMs = 250) {
  requireSubtle();
  const salt = getRandomValues(16);
  const pin = "123456";
  let iterations = 100000;
  const enc = new TextEncoder();
  const baseKey = await subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    await subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, baseKey, 256);
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    if (elapsed >= targetMs * 0.7 && elapsed <= targetMs * 1.8) return iterations;
    if (elapsed < targetMs * 0.7) iterations = Math.min(Math.round(iterations * (targetMs / Math.max(elapsed, 1))), 600000);
    else iterations = Math.max(Math.round(iterations * (targetMs / elapsed)), 50000);
  }
  return iterations;
}

export function isTrivialPin(pin) {
  const s = String(pin || "");
  if (!/^\d{6,}$/.test(s)) return true;
  if (/^(\d)\1+$/.test(s)) return true;
  const seq = "012345678901234567890";
  if (seq.includes(s) || seq.split("").reverse().join("").includes(s)) return true;
  return false;
}

export async function sha256Hex(text) {
  requireSubtle();
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
