/**
 * PIN setup, change, disable — level 3.
 */
import {
  derivePinKey,
  encryptString,
  wrapMdkRaw,
  unwrapMdkRaw,
  calibratePbkdf2Iterations,
  isTrivialPin,
  PIN_VERIFY_PLAINTEXT,
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
  lockVault,
  storePinWrap,
  activateLevel1AutoKey,
} from "./iu-vault-lock-v1.js";

function randomSalt() {
  const g = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return g;
}

export async function setupPin(pin, confirmPin) {
  if (String(pin) !== String(confirmPin)) throw new Error("VAULT_PIN_MISMATCH");
  if (isTrivialPin(pin)) throw new Error("VAULT_PIN_WEAK");
  const mdk = getMdk();
  const meta = await readMeta();
  const salt = randomSalt();
  const iterations = await calibratePbkdf2Iterations(250);
  const wrapKey = await derivePinKey(pin, salt, iterations);
  const wrappedMdk = await wrapMdkRaw(mdk, wrapKey);
  const pinWrap = {
    type: "pin",
    salt,
    iterations,
    wrappedMdk,
    createdAt: new Date().toISOString(),
  };
  const testMdk = await unwrapMdkRaw(wrapKey, wrappedMdk);
  await unlockWithMdk(testMdk);
  await storePinWrap(meta, pinWrap);
  return { iterations };
}

export async function changePin(oldPin, newPin, confirmPin) {
  const { unlockWithPin } = await import("./iu-vault-lock-v1.js");
  await unlockWithPin(oldPin);
  return setupPin(newPin, confirmPin);
}

export async function disablePin(pin) {
  const { unlockWithPin } = await import("./iu-vault-lock-v1.js");
  await unlockWithPin(pin);
  const meta = await readMeta();
  await deleteKeyRecord("mdk:pin");
  meta.pinEnabled = false;
  if (!meta.deviceEnabled) {
    await activateLevel1AutoKey();
  } else {
    meta.securityLevel = 2;
    await writeMeta(meta);
    await lockVault("pin_disabled");
  }
}

export async function hasPinConfigured() {
  const rec = await readKeyRecord("mdk:pin");
  return !!rec;
}
