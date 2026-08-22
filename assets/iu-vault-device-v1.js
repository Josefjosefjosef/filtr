/**
 * Level 2 — device unlock via WebAuthn PRF (only when cryptographically supported).
 */
import {
  wrapMdkRaw,
  unwrapMdkRaw,
} from "./iu-vault-core-v1.js";
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

const RP_NAME = "InfoUzel.cz";

function rpId() {
  try {
    return location.hostname || "infouzel.cz";
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

export async function deriveWrapKeyFromPrf(prfBytes) {
  return crypto.subtle.importKey(
    "raw",
    prfBytes,
    "AES-KW",
    false,
    ["wrapKey", "unwrapKey"]
  );
}

export async function setupDeviceUnlock() {
  const supported = await detectDeviceUnlockSupport();
  if (!supported) throw new Error("VAULT_DEVICE_UNSUPPORTED");

  const mdk = getMdk();
  const meta = await readMeta();
  const salt = prfSalt();

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
  const prfOut = assertion.getClientExtensionResults().prf;
  if (!prfOut || !prfOut.results || !prfOut.results.first) throw new Error("VAULT_DEVICE_PRF_UNAVAILABLE");

  const wrapKey = await deriveWrapKeyFromPrf(new Uint8Array(prfOut.results.first));
  const wrappedMdk = await wrapMdkRaw(mdk, wrapKey);
  const deviceWrap = {
    type: "device",
    credentialId: Array.from(new Uint8Array(cred.rawId)),
    prfSalt: Array.from(salt),
    wrappedMdk,
    createdAt: new Date().toISOString(),
  };

  const testMdk = await unwrapMdkRaw(wrapKey, wrappedMdk);
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

  const prfOut = assertion.getClientExtensionResults().prf;
  if (!prfOut || !prfOut.results || !prfOut.results.first) throw new Error("VAULT_DEVICE_PRF_UNAVAILABLE");

  const wrapKey = await deriveWrapKeyFromPrf(new Uint8Array(prfOut.results.first));
  const mdk = await unwrapMdkRaw(wrapKey, deviceWrap.wrappedMdk);
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
