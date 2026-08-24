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
} from "./iu-vault-lock-v1.js";
import { rotateVaultMdk } from "./iu-vault-storage-v1.js";
import {
  buildDeviceWrap,
  mdkFromDeviceWrap,
  wrapMdkSeedForDevice,
  deriveDeviceAesKeyFromPrf,
} from "./iu-vault-device-crypto-v1.js";

const RP_NAME = "InfoUzel.cz";
const WEBAUTHN_TIMEOUT_MS = 120000;
const WEBAUTHN_WATCHDOG_MS = WEBAUTHN_TIMEOUT_MS + 10000;

function webAuthnTimeoutMs() {
  try {
    const testMs = globalThis.__iuVaultWebAuthnTestTimeoutMs;
    if (typeof testMs === "number" && testMs >= 1000 && testMs <= WEBAUTHN_TIMEOUT_MS) {
      return testMs;
    }
  } catch (_) {}
  return WEBAUTHN_TIMEOUT_MS;
}

function webAuthnWatchdogMs() {
  return webAuthnTimeoutMs() + 10000;
}

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
    const configured = await hasDeviceConfigured();
    if (configured) return true;
  } catch (_) {}
  try {
    if (typeof PublicKeyCredential.getClientCapabilities === "function") {
      const caps = await PublicKeyCredential.getClientCapabilities();
      if (caps && caps["extension:prf"]) return true;
    }
  } catch (_) {}
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      const uvpa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      return !!uvpa;
    }
  } catch (_) {
    return false;
  }
  return false;
}

function prfSalt() {
  return crypto.getRandomValues(new Uint8Array(32));
}

function readPrfExtensionResults(credOrAssertion) {
  try {
    return credOrAssertion && credOrAssertion.getClientExtensionResults
      ? credOrAssertion.getClientExtensionResults().prf
      : null;
  } catch (_) {
    return null;
  }
}

function readPrfBytes(credOrAssertion) {
  const prfOut = readPrfExtensionResults(credOrAssertion);
  if (!prfOut || !prfOut.results || !prfOut.results.first) {
    throw new Error("VAULT_DEVICE_PRF_UNAVAILABLE");
  }
  return new Uint8Array(prfOut.results.first);
}

function sanitizeDeviceErrorDetail(name, msg) {
  const safeName = name && /^[A-Za-z]+Error$/.test(name) ? name : "";
  const safeMsg = String(msg || "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 96);
  if (safeName && safeMsg) return `${safeName}|${safeMsg}`;
  if (safeName) return safeName;
  if (safeMsg) return safeMsg;
  return "unknown";
}

export function mapDeviceSetupError(err) {
  const name = err && err.name ? String(err.name) : "";
  const msg = String(err && err.message ? err.message : err);
  if (msg.includes("VAULT_DEVICE_CANCELLED") || name === "NotAllowedError" || msg.includes("NotAllowedError")) {
    return new Error("VAULT_DEVICE_CANCELLED");
  }
  if (msg.includes("VAULT_DEVICE_TIMEOUT") || name === "AbortError" || msg.includes("AbortError")) {
    return new Error("VAULT_DEVICE_TIMEOUT");
  }
  if (msg.includes("VAULT_DEVICE_PRF")) {
    return new Error("VAULT_DEVICE_PRF_UNAVAILABLE");
  }
  if (msg.includes("VAULT_DEVICE_UNSUPPORTED")) {
    return new Error("VAULT_DEVICE_UNSUPPORTED");
  }
  if (msg.includes("VAULT_DEVICE_CREATE_FAILED")) {
    return new Error(msg.includes("|") ? msg : `VAULT_DEVICE_CREATE_FAILED|${sanitizeDeviceErrorDetail(name, msg)}`);
  }
  return new Error(`VAULT_DEVICE_CREATE_FAILED|${sanitizeDeviceErrorDetail(name, msg)}`);
}

async function withWebAuthnWatchdog(operation, fn) {
  const controller = new AbortController();
  let watchdog = null;
  const watchdogMs = webAuthnWatchdogMs();
  const timeoutPromise = new Promise((_, reject) => {
    watchdog = setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {}
      reject(new Error("VAULT_DEVICE_TIMEOUT"));
    }, watchdogMs);
  });
  try {
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } catch (err) {
    throw mapDeviceSetupError(err);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
}

function buildCreateOptions(salt, signal, withPrfEval) {
  const extensions = withPrfEval ? { prf: { eval: { first: salt } } } : { prf: {} };
  return {
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: RP_NAME, id: rpId() },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "iu-vault-device@" + rpId() + ":" + Date.now(),
        displayName: "InfoUzel",
      },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "discouraged",
        requireResidentKey: false,
      },
      timeout: webAuthnTimeoutMs(),
      extensions,
    },
    signal,
  };
}

function buildPrfGetOptions(credRawId, salt, signal) {
  return {
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: credRawId, type: "public-key", transports: ["internal"] }],
      userVerification: "required",
      timeout: webAuthnTimeoutMs(),
      extensions: { prf: { eval: { first: salt } } },
    },
    signal,
  };
}

async function createCredentialWithPrf(salt) {
  return withWebAuthnWatchdog("create", async (signal) => {
    let cred = null;
    try {
      cred = await navigator.credentials.create(buildCreateOptions(salt, signal, true));
    } catch (err) {
      const name = err && err.name ? String(err.name) : "";
      const msg = String(err && err.message ? err.message : err);
      if (/prf|extension|NotSupportedError|TypeError/i.test(`${name}|${msg}`)) {
        cred = await navigator.credentials.create(buildCreateOptions(salt, signal, false));
      } else {
        throw err;
      }
    }
    if (!cred || !cred.rawId) throw new Error("VAULT_DEVICE_CREATE_FAILED|missing_credential");

    const createPrf = readPrfExtensionResults(cred);
    if (createPrf && createPrf.results && createPrf.results.first) {
      return { cred, prfBytes: new Uint8Array(createPrf.results.first) };
    }

    const assertion = await navigator.credentials.get(buildPrfGetOptions(cred.rawId, salt, signal));
    if (!assertion) throw new Error("VAULT_DEVICE_CREATE_FAILED|get_null");
    return { cred, prfBytes: readPrfBytes(assertion) };
  });
}

async function rollbackMdkRotation(oldMdk, newMdk) {
  if (!oldMdk || !newMdk) return;
  try {
    await rotateVaultMdk(newMdk, oldMdk);
    await unlockWithMdk(oldMdk);
  } catch (_) {}
}

export async function setupDeviceUnlock() {
  const supported = await detectDeviceUnlockSupport();
  if (!supported) throw new Error("VAULT_DEVICE_UNSUPPORTED");

  const oldMdk = getMdk();
  const meta = await readMeta();
  const seedBytes = crypto.getRandomValues(new Uint8Array(32));
  const newMdk = await importMdkRaw(seedBytes);

  let rotated = false;
  let testMdk = null;
  try {
    const salt = prfSalt();
    const { cred, prfBytes } = await createCredentialWithPrf(salt);

    const deviceAesKey = await deriveDeviceAesKeyFromPrf(prfBytes);
    const wrappedSeed = await wrapMdkSeedForDevice(deviceAesKey, seedBytes);
    const deviceWrap = await buildDeviceWrap(new Uint8Array(cred.rawId), salt, wrappedSeed);

    testMdk = await mdkFromDeviceWrap(deviceWrap, prfBytes);

    await rotateVaultMdk(oldMdk, testMdk);
    rotated = true;
    await unlockWithMdk(testMdk);
    await storeDeviceWrap(meta, deviceWrap);
    return { ok: true };
  } catch (err) {
    if (rotated) {
      await rollbackMdkRotation(oldMdk, testMdk || newMdk);
    }
    throw mapDeviceSetupError(err);
  }
}

export async function unlockWithDevice() {
  const deviceWrap = await readKeyRecord("mdk:device");
  if (!deviceWrap) throw new Error("VAULT_DEVICE_NOT_CONFIGURED");

  const credId = new Uint8Array(deviceWrap.credentialId);
  const salt = new Uint8Array(deviceWrap.prfSalt);

  const assertion = await withWebAuthnWatchdog("unlock", async (signal) => {
    const result = await navigator.credentials.get(buildPrfGetOptions(credId, salt, signal));
    if (!result) throw new Error("VAULT_DEVICE_UNLOCK_FAILED");
    return result;
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
  const { activateLevel1AutoKey } = await import("./iu-vault-lock-v1.js");
  await activateLevel1AutoKey();
}

export { mdkFromDeviceWrap } from "./iu-vault-device-crypto-v1.js";
