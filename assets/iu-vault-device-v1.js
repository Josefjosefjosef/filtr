/**
 * Level 2 — device unlock via WebAuthn PRF + seed-v1 MDK wrap.
 */
import { importMdkRaw } from "./iu-vault-core-v1.js";
import {
  readMeta,
  readKeyRecord,
} from "./iu-vault-db-v1.js";
import {
  getMdk,
  unlockWithMdk,
  storeDeviceWrap,
  lockVault,
} from "./iu-vault-lock-v1.js";
import { rotateVaultMdk } from "./iu-vault-storage-v1.js";
import {
  buildDeviceWrap,
  mdkFromDeviceWrap,
  wrapMdkSeedForDevice,
  deriveDeviceAesKeyFromPrf,
} from "./iu-vault-device-crypto-v1.js";

const RP_NAME = "InfoUzel.cz";

function rpId() {
  try {
    const host = location.hostname || "infouzel.cz";
    if (host === "127.0.0.1" || host === "[::1]") return "localhost";
    return host;
  } catch (_) {
    return "infouzel.cz";
  }
}

export async function detectDeviceUnlockSupport() {
  if (!window.PublicKeyCredential) return false;
  try {
    if (typeof PublicKeyCredential.getClientCapabilities === "function") {
      const caps = await PublicKeyCredential.getClientCapabilities();
      if (caps && caps["extension:prf"]) return true;
    }
  } catch (_) {}
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      const uvpa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (!uvpa) return false;
    }
  } catch (_) {
    return false;
  }
  return false;
}

function prfSalt() {
  return crypto.getRandomValues(new Uint8Array(32));
}

function readPrfBytes(assertion) {
  const prfOut = assertion.getClientExtensionResults().prf;
  if (!prfOut || !prfOut.results || !prfOut.results.first) {
    throw new Error("VAULT_DEVICE_PRF_UNAVAILABLE");
  }
  return new Uint8Array(prfOut.results.first);
}

async function createCredentialWithPrf(salt) {
  const createOpts = {
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: RP_NAME, id: rpId() },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "iu-vault-device",
        displayName: "InfoUzel",
      },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      extensions: { prf: {} },
    },
  };

  const cred = await navigator.credentials.create(createOpts);
  if (!cred || !cred.rawId) throw new Error("VAULT_DEVICE_CREATE_FAILED");

  const getOpts = {
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: cred.rawId, type: "public-key", transports: ["internal"] }],
      userVerification: "required",
      extensions: { prf: { eval: { first: salt } } },
    },
  };
  const assertion = await navigator.credentials.get(getOpts);
  return { cred, prfBytes: readPrfBytes(assertion) };
}

export async function setupDeviceUnlock() {
  const supported = await detectDeviceUnlockSupport();
  if (!supported) throw new Error("VAULT_DEVICE_UNSUPPORTED");

  const oldMdk = getMdk();
  const meta = await readMeta();
  const seedBytes = crypto.getRandomValues(new Uint8Array(32));
  const newMdk = await importMdkRaw(seedBytes);
  await rotateVaultMdk(oldMdk, newMdk);

  const salt = prfSalt();
  const { cred, prfBytes } = await createCredentialWithPrf(salt);

  const deviceAesKey = await deriveDeviceAesKeyFromPrf(prfBytes);
  const wrappedSeed = await wrapMdkSeedForDevice(deviceAesKey, seedBytes);
  const deviceWrap = await buildDeviceWrap(new Uint8Array(cred.rawId), salt, wrappedSeed);

  const testMdk = await mdkFromDeviceWrap(deviceWrap, prfBytes);
  await unlockWithMdk(testMdk);
  await storeDeviceWrap(meta, deviceWrap);
  return { ok: true };
}

export async function unlockWithDevice() {
  const deviceWrap = await readKeyRecord("mdk:device");
  if (!deviceWrap) throw new Error("VAULT_DEVICE_NOT_CONFIGURED");

  const credId = new Uint8Array(deviceWrap.credentialId);
  const salt = new Uint8Array(deviceWrap.prfSalt);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: credId, type: "public-key", transports: ["internal"] }],
      userVerification: "required",
      extensions: { prf: { eval: { first: salt } } },
    },
  });

  const prfBytes = readPrfBytes(assertion);
  const mdk = await mdkFromDeviceWrap(deviceWrap, prfBytes);
  await unlockWithMdk(mdk);
  return true;
}

export async function hasDeviceConfigured() {
  const rec = await readKeyRecord("mdk:device");
  return !!rec;
}

export async function disableDeviceUnlock() {
  await unlockWithDevice();
  const meta = await readMeta();
  const { deleteKeyRecord, writeMeta } = await import("./iu-vault-db-v1.js");
  const { activateLevel1AutoKey } = await import("./iu-vault-lock-v1.js");
  await deleteKeyRecord("mdk:device");
  meta.deviceEnabled = false;
  if (!meta.pinEnabled) {
    await activateLevel1AutoKey();
  } else {
    meta.securityLevel = 3;
    await writeMeta(meta);
    await lockVault("device_disabled");
  }
}

export { mdkFromDeviceWrap } from "./iu-vault-device-crypto-v1.js";
