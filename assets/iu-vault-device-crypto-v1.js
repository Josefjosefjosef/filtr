/**
 * L2 device wrap/unwrap — seed-v1 via PRF-derived AES-GCM (no extractable MDK export).
 */
import {
  CIPHER_ALG,
  importMdkRaw,
  encryptString,
  decryptString,
  bytesToB64,
  b64ToBytes,
  unwrapMdkRaw,
} from "./iu-vault-core-v1.js";

export const DEVICE_MDK_SEED_STORAGE_KEY = "iu:vault:device:mdk-seed:v1";

export async function deriveDeviceAesKeyFromPrf(prfBytes) {
  const raw = prfBytes instanceof Uint8Array ? prfBytes : new Uint8Array(prfBytes);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: CIPHER_ALG, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** @deprecated legacy AES-KW path for wrappedMdk records only */
export async function deriveLegacyDeviceWrapKeyFromPrf(prfBytes) {
  const raw = prfBytes instanceof Uint8Array ? prfBytes : new Uint8Array(prfBytes);
  return crypto.subtle.importKey("raw", raw, "AES-KW", false, ["wrapKey", "unwrapKey"]);
}

export async function wrapMdkSeedForDevice(deviceAesKey, seedBytes) {
  const seedB64 = bytesToB64(seedBytes);
  return encryptString(deviceAesKey, DEVICE_MDK_SEED_STORAGE_KEY, seedB64);
}

export async function unwrapMdkSeedFromDevice(deviceAesKey, envelope) {
  const seedB64 = await decryptString(deviceAesKey, DEVICE_MDK_SEED_STORAGE_KEY, envelope);
  return b64ToBytes(seedB64);
}

export async function buildDeviceWrap(credentialId, prfSalt, wrappedSeed) {
  return {
    type: "device",
    format: "seed-v1",
    credentialId: Array.from(credentialId),
    prfSalt: Array.from(prfSalt),
    wrappedSeed,
    createdAt: new Date().toISOString(),
  };
}

export async function mdkFromDeviceWrap(deviceWrap, prfBytes) {
  if (deviceWrap && deviceWrap.wrappedSeed) {
    const deviceAesKey = await deriveDeviceAesKeyFromPrf(prfBytes);
    const seedBytes = await unwrapMdkSeedFromDevice(deviceAesKey, deviceWrap.wrappedSeed);
    return importMdkRaw(seedBytes);
  }
  if (deviceWrap && deviceWrap.wrappedMdk) {
    const wrapKey = await deriveLegacyDeviceWrapKeyFromPrf(prfBytes);
    return unwrapMdkRaw(wrapKey, deviceWrap.wrappedMdk);
  }
  throw new Error("VAULT_DEVICE_FORMAT_UNSUPPORTED");
}

export async function unwrapSeedFromDeviceWrap(deviceWrap, prfBytes) {
  if (!deviceWrap || !deviceWrap.wrappedSeed) throw new Error("VAULT_DEVICE_FORMAT_UNSUPPORTED");
  const deviceAesKey = await deriveDeviceAesKeyFromPrf(prfBytes);
  return unwrapMdkSeedFromDevice(deviceAesKey, deviceWrap.wrappedSeed);
}
