/**
 * Level 2 — device unlock via WebAuthn PRF + seed-v1 MDK wrap.
 */
import { importMdkRaw } from "./iu-vault-core-v1.js";
import {
  readMeta,
  readKeyRecord,
  writeKeyRecord,
  deleteKeyRecord,
} from "./iu-vault-db-v1.js";
import {
  getMdk,
  unlockWithMdk,
  storeDeviceWrap,
} from "./iu-vault-lock-v1.js";
import { rotateVaultMdk, flushPendingVaultWrites } from "./iu-vault-storage-v1.js";
import {
  buildDeviceWrap,
  mdkFromDeviceWrap,
  wrapMdkSeedForDevice,
  deriveDeviceAesKeyFromPrf,
} from "./iu-vault-device-crypto-v1.js";

const RP_NAME = "InfoUzel.cz";
const PENDING_DEVICE_KEY = "mdk:device:pending";
const WEBAUTHN_TIMEOUT_MS = 120000;

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

async function stableDeviceUserId() {
  const enc = new TextEncoder().encode("iu-vault-device-user@" + rpId());
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return new Uint8Array(hash).slice(0, 16);
}

export async function detectDeviceUnlockSupport() {
  if (!window.PublicKeyCredential || !window.isSecureContext) return false;
  try {
    if (await hasDeviceConfigured()) return true;
  } catch (_) {}
  let platformAvailable = false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
      platformAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } else {
      platformAvailable = true;
    }
  } catch (_) {
    platformAvailable = false;
  }
  if (!platformAvailable) return false;
  try {
    if (typeof PublicKeyCredential.getClientCapabilities === "function") {
      const caps = await PublicKeyCredential.getClientCapabilities();
      if (caps && caps["extension:prf"] === true) return true;
      if (caps && caps["extension:prf"] === false) return false;
    }
  } catch (_) {}
  const standalone =
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  if (standalone) return true;
  if (isLikelyMobileBrowserTab()) return false;
  return true;
}

function isLikelyMobileBrowserTab() {
  try {
    const ua = String(navigator.userAgent || "");
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    const standalone =
      window.navigator.standalone === true ||
      (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
    return isMobile && !standalone;
  } catch (_) {
    return false;
  }
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

function devicePhaseError(code, detail) {
  if (detail) return new Error(`${code}|${detail}`);
  return new Error(code);
}

function persistStepFromError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (msg.includes("VAULT_ROTATE_FAIL")) return "rotate";
  if (msg.includes("VAULT_IDB") || (err && err.name === "QuotaExceededError")) return "idb";
  if (msg.includes("VAULT_LOCKED")) return "unlock";
  if (msg.includes("writeMeta") || msg.includes("writeKeyRecord")) return "meta";
  return "persist";
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
  if (/^DEVICE_[A-Z0-9_]+/.test(msg)) {
    if (msg.includes("|")) return new Error(msg);
    return new Error(msg.split("|")[0]);
  }
  if (msg.includes("VAULT_DEVICE_PRF")) {
    return new Error("DEVICE_PRF_RESULT_MISSING");
  }
  if (msg.includes("VAULT_DEVICE_UNSUPPORTED")) {
    return new Error("VAULT_DEVICE_UNSUPPORTED");
  }
  if (msg.includes("VAULT_DEVICE_NOT_CONFIGURED")) {
    return new Error("DEVICE_VERIFY_GET_FAILED");
  }
  if (msg.includes("VAULT_DEVICE_CREATE_FAILED")) {
    return new Error(msg.includes("|") ? msg.replace("VAULT_DEVICE_CREATE_FAILED", "DEVICE_CREATE_FAILED") : `DEVICE_CREATE_FAILED|${sanitizeDeviceErrorDetail(name, msg)}`);
  }
  return new Error(`DEVICE_CREATE_FAILED|${sanitizeDeviceErrorDetail(name, msg)}`);
}

async function withWebAuthnWatchdog(fn) {
  const controller = new AbortController();
  let watchdog = null;
  const timeoutPromise = new Promise((_, reject) => {
    watchdog = setTimeout(() => {
      try {
        controller.abort();
      } catch (_) {}
      reject(new Error("VAULT_DEVICE_TIMEOUT"));
    }, webAuthnWatchdogMs());
  });
  try {
    return await Promise.race([fn(controller.signal), timeoutPromise]);
  } finally {
    if (watchdog) clearTimeout(watchdog);
  }
}

function buildCreateOptions(userId, signal) {
  return {
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: RP_NAME, id: rpId() },
      user: {
        id: userId,
        name: "iu-vault-device@" + rpId(),
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
      extensions: { prf: {} },
    },
    signal,
  };
}

function toCredRawIdBuffer(rawId) {
  if (rawId instanceof ArrayBuffer) return rawId;
  if (ArrayBuffer.isView(rawId)) {
    return rawId.buffer.slice(rawId.byteOffset, rawId.byteOffset + rawId.byteLength);
  }
  return new Uint8Array(rawId).buffer;
}

function toCredRawIdUint8(rawId) {
  if (rawId instanceof ArrayBuffer) return new Uint8Array(rawId);
  if (ArrayBuffer.isView(rawId)) return new Uint8Array(rawId.buffer, rawId.byteOffset, rawId.byteLength);
  return new Uint8Array(rawId);
}

function buildPrfGetOptions(credRawId, salt, signal) {
  const idBuffer = toCredRawIdBuffer(credRawId);
  return {
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: rpId(),
      allowCredentials: [{ id: idBuffer, type: "public-key", transports: ["internal"] }],
      userVerification: "required",
      timeout: webAuthnTimeoutMs(),
      extensions: { prf: { eval: { first: salt } } },
    },
    signal,
  };
}

function prfBytesFromExtension(credOrAssertion, phaseCode) {
  const prfOut = readPrfExtensionResults(credOrAssertion);
  if (prfOut && prfOut.results && prfOut.results.first) {
    return new Uint8Array(prfOut.results.first);
  }
  if (prfOut && prfOut.enabled === false) {
    throw devicePhaseError("DEVICE_PRF_NOT_ENABLED");
  }
  throw devicePhaseError(phaseCode);
}

async function evaluatePrfViaGet(credRawId, salt, signal) {
  let assertion = null;
  try {
    assertion = await navigator.credentials.get(buildPrfGetOptions(credRawId, salt, signal));
  } catch (err) {
    const name = err && err.name ? String(err.name) : "";
    if (name === "NotAllowedError") throw new Error("VAULT_DEVICE_CANCELLED");
    if (name === "AbortError") throw new Error("VAULT_DEVICE_TIMEOUT");
    throw devicePhaseError("DEVICE_PRF_GET_FAILED", sanitizeDeviceErrorDetail(name, err && err.message ? err.message : err));
  }
  if (!assertion) throw devicePhaseError("DEVICE_PRF_GET_FAILED", "empty_assertion");
  try {
    return prfBytesFromExtension(assertion, "DEVICE_PRF_RESULT_MISSING");
  } catch (err) {
    if (String(err.message || err).includes("DEVICE_PRF_RESULT_MISSING")) {
      throw devicePhaseError("DEVICE_PRF_RESULT_INVALID");
    }
    throw err;
  }
}

async function obtainPrfBytesAfterCreate(cred, salt, signal) {
  const createPrf = readPrfExtensionResults(cred);
  if (createPrf && createPrf.results && createPrf.results.first) {
    return new Uint8Array(createPrf.results.first);
  }
  if (createPrf && createPrf.enabled === false) {
    throw devicePhaseError("DEVICE_PRF_NOT_ENABLED");
  }
  return evaluatePrfViaGet(cred.rawId, salt, signal);
}

async function writePendingDeviceSetup(credentialId, salt) {
  await writeKeyRecord(PENDING_DEVICE_KEY, {
    credentialId: Array.from(new Uint8Array(credentialId)),
    prfSalt: Array.from(salt),
    savedAt: Date.now(),
  });
}

async function clearPendingDeviceSetup() {
  try {
    await deleteKeyRecord(PENDING_DEVICE_KEY);
  } catch (_) {}
}

async function readPendingDeviceSetup() {
  const pending = await readKeyRecord(PENDING_DEVICE_KEY);
  if (!pending || !pending.credentialId || !pending.prfSalt) return null;
  return {
    credentialId: new Uint8Array(pending.credentialId),
    prfSalt: new Uint8Array(pending.prfSalt),
  };
}

async function createPlatformCredential(signal) {
  const userId = await stableDeviceUserId();
  let cred = null;
  try {
    cred = await navigator.credentials.create(buildCreateOptions(userId, signal));
  } catch (err) {
    const name = err && err.name ? String(err.name) : "";
    if (name === "NotAllowedError") throw new Error("VAULT_DEVICE_CANCELLED");
    if (name === "AbortError") throw new Error("VAULT_DEVICE_TIMEOUT");
    throw devicePhaseError("DEVICE_CREATE_FAILED", sanitizeDeviceErrorDetail(name, err && err.message ? err.message : err));
  }
  if (!cred || !cred.rawId) throw devicePhaseError("DEVICE_CREATE_FAILED", "missing_credential");
  return cred;
}

async function createCredentialWithPrf(salt) {
  return withWebAuthnWatchdog(async (signal) => {
    const pending = await readPendingDeviceSetup();
    const existingDevice = await readKeyRecord("mdk:device");
    if (pending && !existingDevice) {
      const prfBytes = await evaluatePrfViaGet(pending.credentialId, pending.prfSalt, signal);
      return {
        cred: { rawId: pending.credentialId },
        prfBytes,
        salt: pending.prfSalt,
        resumed: true,
      };
    }

    const cred = await createPlatformCredential(signal);
    await writePendingDeviceSetup(toCredRawIdUint8(cred.rawId), salt);
    const prfBytes = await obtainPrfBytesAfterCreate(cred, salt, signal);
    return { cred, prfBytes, salt, resumed: false };
  });
}

async function rollbackMdkRotation(oldMdk, newMdk) {
  if (!oldMdk || !newMdk) return;
  try {
    await rotateVaultMdk(newMdk, oldMdk);
    await unlockWithMdk(oldMdk);
  } catch (_) {}
}

async function verifyDeviceWrapUnlock(deviceWrap, credRawId, salt, signal) {
  let verifyPrf = null;
  try {
    verifyPrf = await evaluatePrfViaGet(credRawId, salt, signal);
  } catch (err) {
    const name = err && err.name ? String(err.name) : "";
    const msg = String(err && err.message ? err.message : err);
    if (msg.includes("VAULT_DEVICE_CANCELLED")) throw err;
    if (msg.includes("VAULT_DEVICE_TIMEOUT")) throw err;
    throw devicePhaseError("DEVICE_VERIFY_GET_FAILED", sanitizeDeviceErrorDetail(name, msg));
  }
  try {
    await mdkFromDeviceWrap(deviceWrap, verifyPrf);
  } catch (err) {
    throw devicePhaseError("DEVICE_VERIFY_DECRYPT_FAILED", sanitizeDeviceErrorDetail("", err && err.message ? err.message : err));
  }
}

async function persistDeviceActivation(meta, deviceWrap, oldMdk, testMdk, rotatedRef) {
  try {
    await flushPendingVaultWrites();
    await rotateVaultMdk(oldMdk, testMdk);
    rotatedRef.value = true;
    await unlockWithMdk(testMdk);
    await storeDeviceWrap(meta, deviceWrap);
    await clearPendingDeviceSetup();
  } catch (err) {
    const name = err && err.name ? String(err.name) : "";
    const msg = String(err && err.message ? err.message : err);
    const step = persistStepFromError(err);
    throw devicePhaseError(
      "DEVICE_PERSIST_FAILED",
      `step:${step}|${sanitizeDeviceErrorDetail(name, msg)}`
    );
  }
}

export async function setupDeviceUnlock() {
  const supported = await detectDeviceUnlockSupport();
  if (!supported) throw new Error("VAULT_DEVICE_UNSUPPORTED");

  const oldMdk = getMdk();
  const meta = await readMeta();
  const seedBytes = crypto.getRandomValues(new Uint8Array(32));

  let testMdk = null;
  const rotatedRef = { value: false };
  try {
    const salt = prfSalt();
    const { cred, prfBytes, salt: prfSaltUsed } = await createCredentialWithPrf(salt);
    const activeSalt = prfSaltUsed || salt;

    let deviceWrap = null;
    try {
      const deviceAesKey = await deriveDeviceAesKeyFromPrf(prfBytes);
      const wrappedSeed = await wrapMdkSeedForDevice(deviceAesKey, seedBytes);
      deviceWrap = await buildDeviceWrap(toCredRawIdUint8(cred.rawId), activeSalt, wrappedSeed);
      testMdk = await mdkFromDeviceWrap(deviceWrap, prfBytes);
    } catch (err) {
      throw devicePhaseError("DEVICE_WRAP_FAILED", sanitizeDeviceErrorDetail("", err && err.message ? err.message : err));
    }

    await withWebAuthnWatchdog(async (signal) => {
      await verifyDeviceWrapUnlock(deviceWrap, cred.rawId, activeSalt, signal);
    });

    await persistDeviceActivation(meta, deviceWrap, oldMdk, testMdk, rotatedRef);
    return { ok: true };
  } catch (err) {
    if (rotatedRef.value && testMdk) {
      await rollbackMdkRotation(oldMdk, testMdk);
    }
    throw mapDeviceSetupError(err);
  }
}

export async function unlockWithDevice() {
  const deviceWrap = await readKeyRecord("mdk:device");
  if (!deviceWrap) throw new Error("VAULT_DEVICE_NOT_CONFIGURED");

  const credId = new Uint8Array(deviceWrap.credentialId);
  const salt = new Uint8Array(deviceWrap.prfSalt);

  const assertion = await withWebAuthnWatchdog(async (signal) => {
    const result = await navigator.credentials.get(buildPrfGetOptions(credId, salt, signal));
    if (!result) throw new Error("VAULT_DEVICE_UNLOCK_FAILED");
    return result;
  });

  let prfBytes = null;
  try {
    prfBytes = prfBytesFromExtension(assertion, "DEVICE_PRF_RESULT_MISSING");
  } catch (err) {
    throw mapDeviceSetupError(err);
  }

  let mdk = null;
  try {
    mdk = await mdkFromDeviceWrap(deviceWrap, prfBytes);
  } catch (err) {
    throw devicePhaseError("DEVICE_UNWRAP_FAILED", sanitizeDeviceErrorDetail("", err && err.message ? err.message : err));
  }
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
  await clearPendingDeviceSetup();
}

export { mdkFromDeviceWrap } from "./iu-vault-device-crypto-v1.js";
