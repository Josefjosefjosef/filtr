/**
 * PIN wrap/unwrap crypto helpers (no lock-layer imports).
 */
import {
  derivePinAesKey,
  derivePinKey,
  importMdkRaw,
  wrapMdkSeedForPin,
  unwrapMdkSeedFromPin,
  unwrapMdkRaw,
} from "./iu-vault-core-v1.js";

export async function buildPinWrap(seedBytes, pin, salt, iterations) {
  const pinAesKey = await derivePinAesKey(pin, salt, iterations);
  const wrappedSeed = await wrapMdkSeedForPin(pinAesKey, seedBytes);
  return {
    type: "pin",
    format: "seed-v1",
    salt,
    iterations,
    wrappedSeed,
    createdAt: new Date().toISOString(),
  };
}

export async function mdkFromPinWrap(pinWrap, pin) {
  if (pinWrap && pinWrap.wrappedSeed) {
    const pinAesKey = await derivePinAesKey(pin, pinWrap.salt, pinWrap.iterations);
    const seedBytes = await unwrapMdkSeedFromPin(pinAesKey, pinWrap.wrappedSeed);
    return importMdkRaw(seedBytes);
  }
  if (pinWrap && pinWrap.wrappedMdk) {
    const wrapKey = await derivePinKey(pin, pinWrap.salt, pinWrap.iterations);
    return unwrapMdkRaw(wrapKey, pinWrap.wrappedMdk);
  }
  throw new Error("VAULT_PIN_FORMAT_UNSUPPORTED");
}

export async function unwrapSeedFromPinWrap(pinWrap, pin) {
  if (!pinWrap || !pinWrap.wrappedSeed) throw new Error("VAULT_PIN_FORMAT_UNSUPPORTED");
  const pinAesKey = await derivePinAesKey(pin, pinWrap.salt, pinWrap.iterations);
  return unwrapMdkSeedFromPin(pinAesKey, pinWrap.wrappedSeed);
}
