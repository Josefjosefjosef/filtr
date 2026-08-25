/**
 * PIN setup, change, disable — level 3.
 */
import {
  importMdkRaw,
  calibratePbkdf2Iterations,
  explainPinRejection,
} from "./iu-vault-core-v1.js";
import {
  readMeta,
  writeMeta,
  readKeyRecord,
  deleteKeyRecord,
} from "./iu-vault-db-v1.js";
import {
  getMdk,
  unlockWithMdk,
  storePinWrap,
  activateLevel1AutoKey,
} from "./iu-vault-lock-v1.js";
import { rotateVaultMdk } from "./iu-vault-storage-v1.js";
import { buildPinWrap, mdkFromPinWrap, unwrapSeedFromPinWrap } from "./iu-vault-pin-crypto-v1.js";

function randomSalt() {
  return globalThis.crypto.getRandomValues(new Uint8Array(16));
}

export { mdkFromPinWrap } from "./iu-vault-pin-crypto-v1.js";

function assertPinStrength(pin) {
  const reason = explainPinRejection(pin);
  if (reason) throw new Error(`VAULT_PIN_WEAK|${reason}`);
}

export async function setupPin(pin, confirmPin) {
  if (String(pin) !== String(confirmPin)) throw new Error("VAULT_PIN_MISMATCH");
  assertPinStrength(pin);
  const oldMdk = getMdk();
  const meta = await readMeta();
  const seedBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const newMdk = await importMdkRaw(seedBytes);
  await rotateVaultMdk(oldMdk, newMdk);
  const salt = randomSalt();
  const iterations = await calibratePbkdf2Iterations(250);
  const pinWrap = await buildPinWrap(seedBytes, pin, salt, iterations);
  const testMdk = await mdkFromPinWrap(pinWrap, pin);
  await unlockWithMdk(testMdk);
  await storePinWrap(meta, pinWrap);
  return { iterations };
}

export async function changePin(oldPin, newPin, confirmPin) {
  if (String(newPin) !== String(confirmPin)) throw new Error("VAULT_PIN_MISMATCH");
  assertPinStrength(newPin);
  const { unlockWithPin } = await import("./iu-vault-lock-v1.js");
  await unlockWithPin(oldPin);
  const pinWrap = await readKeyRecord("mdk:pin");
  let seedBytes;
  if (pinWrap.wrappedSeed) {
    seedBytes = await unwrapSeedFromPinWrap(pinWrap, oldPin);
  } else if (pinWrap.wrappedMdk) {
    const oldMdk = getMdk();
    seedBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const newMdk = await importMdkRaw(seedBytes);
    await rotateVaultMdk(oldMdk, newMdk);
  } else {
    throw new Error("VAULT_PIN_FORMAT_UNSUPPORTED");
  }
  const salt = randomSalt();
  const iterations = await calibratePbkdf2Iterations(250);
  const newWrap = await buildPinWrap(seedBytes, newPin, salt, iterations);
  const testMdk = await mdkFromPinWrap(newWrap, newPin);
  const meta = await readMeta();
  await unlockWithMdk(testMdk);
  await storePinWrap(meta, newWrap);
  return { iterations };
}

export async function disablePin(pin) {
  const { unlockWithPin } = await import("./iu-vault-lock-v1.js");
  await unlockWithPin(pin);
  await activateLevel1AutoKey();
}

export async function hasPinConfigured() {
  const rec = await readKeyRecord("mdk:pin");
  return !!rec;
}
