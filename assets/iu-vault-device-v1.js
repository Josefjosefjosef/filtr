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
import { rotateVaultMdk, flushPendingVaultWrites, withVaultSecurityTransition } from "./iu-vault-storage-v1.js";
import {
  buildDeviceWrap,
  mdkFromDeviceWrap,
  wrapMdkSeedForDevice,
  deriveDeviceAesKeyFromPrf,
} from "./iu-vault-device-crypto-v1.js";

const RP_NAME = "InfoUzel.cz";
const PENDING_DEVICE_KEY = "mdk:device:pending";
const WEBAUTHN_TIMEOUT_MS = 120000;

function ensureCeremonyLog() {
  try {
    if (!Array.isArray(window.__iuVaultWebAuthnCeremonyLog)) {
      window.__iuVaultWebAuthnCeremonyLog = [];
    }
    return window.__iuVaultWebAuthnCeremonyLog;
  } catch (_) {
    return null;
  }
}

function recordWebAuthnCeremony(operation, purpose, result) {
  const log = ensureCeremonyLog();
  if (!log) return;
  const entry = {
    ceremonyIndex: log.length + 1,
    operation: operation === "create" ? "create" : "get",
    purpose: String(purpose || "").slice(0, 48),
    result: String(result || "").slice(0, 32),
  };
  log.push(entry);
  try {
    window.__iuVaultLastWebAuthnCeremony = entry;
  } catch (_) {}
  return entry;
}

export function clearWebAuthnCeremonyLog() {
  try {
    window.__iuVaultWebAuthnCeremonyLog = [];
    window.__iuVaultLastWebAuthnCeremony = null;
  } catch (_) {}
}

export function getWebAuthnCeremonyLog() {
  try {
    const log = window.__iuVaultWebAuthnCeremonyLog;
    if (!Array.isArray(log)) return [];
    return log.map((row) => ({
      ceremonyIndex: Number(row.ceremonyIndex) || 0,
      operation: String(row.operation || ""),
      purpose: String(row.purpose || ""),
      result: String(row.result || ""),
    }));
  } catch (_) {
    return [];
  }
}

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
  const stepMatch = msg.match(/step:([0-9]{2}-[a-z0-9-]+)/);
  if (stepMatch) return stepMatch[1];
  if (msg.includes("VAULT_ROTATE_FAIL")) return "07-rotate-existing-records";
  if (msg.includes("VAULT_IDB") || (err && err.name === "QuotaExceededError")) return "08-persist-device-wrapper";
  if (msg.includes("VAULT_LOCKED")) return "14-activate-l2-state";
  if (msg.includes("writeMeta") || msg.includes("writeKeyRecord")) return "09-persist-device-metadata";
  return "persist";
}

function sanitizeDiagExtra(extra) {
  const raw = String(extra || "");
  const out = {};
  const keyMatch = raw.match(/recordKey:([^|]+)/);
  const typeMatch = raw.match(/recordType:([^|]+)/);
  const phaseMatch = raw.match(/recordPhase:([^|]+)/);
  if (keyMatch) out.recordKey = keyMatch[1].slice(0, 64);
  if (typeMatch) out.recordType = typeMatch[1].slice(0, 32);
  if (phaseMatch) out.recordPhase = phaseMatch[1].slice(0, 16);
  return out;
}

function recordDeviceDiag(step, ok, detail) {
  const safeDetail = detail || {};
  const entry = {
    step: String(step || ""),
    ok: !!ok,
    operation: safeDetail.operation ? String(safeDetail.operation).slice(0, 48) : undefined,
    errorName: safeDetail.errorName ? String(safeDetail.errorName).slice(0, 48) : undefined,
    errorMessage: safeDetail.errorMessage ? String(safeDetail.errorMessage).slice(0, 96) : undefined,
    ...sanitizeDiagExtra(safeDetail.extra),
  };
  try {
    window.__iuVaultLastDeviceDiag = entry;
  } catch (_) {}
  return entry;
}

function deviceSetupTuple(step, err, operation, extra) {
  const name = err && err.name ? String(err.name) : "Error";
  const msg = sanitizeDeviceErrorDetail(name, err && err.message ? err.message : err);
  const parts = [
    `step:${step}`,
    `error.name:${name}`,
    `error.message:${msg}`,
    `operation:${operation}`,
  ];
  if (extra) parts.push(extra);
  return parts.join("|");
}

function throwDeviceSetupStep(step, err, operation, extra) {
  recordDeviceDiag(step, false, {
    errorName: err && err.name ? String(err.name) : "Error",
    errorMessage: sanitizeDeviceErrorDetail(err && err.name ? String(err.name) : "", err && err.message ? err.message : err),
    operation,
    extra: extra || "",
  });
  throw devicePhaseError("DEVICE_PERSIST_FAILED", deviceSetupTuple(step, err, operation, extra));
}

export function getLastDeviceSetupDiag() {
  try {
    const raw = window.__iuVaultLastDeviceDiag;
    if (!raw || typeof raw !== "object") return null;
    const out = {
      step: String(raw.step || ""),
      ok: !!raw.ok,
    };
    if (raw.operation) out.operation = String(raw.operation).slice(0, 48);
    if (raw.errorName) out.errorName = String(raw.errorName).slice(0, 48);
    if (raw.errorMessage) out.errorMessage = String(raw.errorMessage).slice(0, 96);
    if (raw.recordKey) out.recordKey = String(raw.recordKey).slice(0, 64);
    if (raw.recordType) out.recordType = String(raw.recordType).slice(0, 32);
    if (raw.recordPhase) out.recordPhase = String(raw.recordPhase).slice(0, 16);
    return out;
  } catch (_) {
    return null;
  }
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

async function evaluatePrfViaGet(credRawId, salt, signal, purpose) {
  let assertion = null;
  try {
    assertion = await navigator.credentials.get(buildPrfGetOptions(credRawId, salt, signal));
    recordWebAuthnCeremony("get", purpose || "prf_get", assertion ? "ok" : "empty");
  } catch (err) {
    const name = err && err.name ? String(err.name) : "";
    recordWebAuthnCeremony("get", purpose || "prf_get", name || "error");
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
    return { prfBytes: new Uint8Array(createPrf.results.first), prfSource: "create" };
  }
  if (createPrf && createPrf.enabled === false) {
    throw devicePhaseError("DEVICE_PRF_NOT_ENABLED");
  }
  const prfBytes = await evaluatePrfViaGet(cred.rawId, salt, signal, "prf_after_create");
  return { prfBytes, prfSource: "get" };
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
    recordWebAuthnCeremony("create", "device_activation_create", cred && cred.rawId ? "ok" : "empty");
  } catch (err) {
    const name = err && err.name ? String(err.name) : "";
    recordWebAuthnCeremony("create", "device_activation_create", name || "error");
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
      const prfBytes = await evaluatePrfViaGet(pending.credentialId, pending.prfSalt, signal, "prf_resume_pending");
      return {
        cred: { rawId: pending.credentialId },
        prfBytes,
        salt: pending.prfSalt,
        resumed: true,
        prfSource: "get",
      };
    }

    const cred = await createPlatformCredential(signal);
    await writePendingDeviceSetup(toCredRawIdUint8(cred.rawId), salt);
    const obtained = await obtainPrfBytesAfterCreate(cred, salt, signal);
    return {
      cred,
      prfBytes: obtained.prfBytes,
      salt,
      resumed: false,
      prfSource: obtained.prfSource || "get",
    };
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
    verifyPrf = await evaluatePrfViaGet(credRawId, salt, signal, "verify_wrap_unlock");
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
  const STEP_FLUSH = "02-flush-pending-writes";
  const STEP_ROTATE = "07-rotate-existing-records";
  const STEP_UNWRAP = "11-unwrap-mdk";
  const STEP_WRAP_PERSIST = "08-persist-device-wrapper";
  const STEP_META = "09-persist-device-metadata";
  const STEP_READBACK = "10-read-back-wrapper";
  const STEP_ACTIVATE = "14-activate-l2-state";

  try {
    recordDeviceDiag(STEP_FLUSH, true, { operation: "flushPendingVaultWrites" });
    await flushPendingVaultWrites();
  } catch (err) {
    throwDeviceSetupStep(STEP_FLUSH, err, "flushPendingVaultWrites");
  }

  try {
    recordDeviceDiag(STEP_ROTATE, true, { operation: "rotateVaultMdk" });
    await withVaultSecurityTransition(async () => {
      await rotateVaultMdk(oldMdk, testMdk);
      rotatedRef.value = true;
      recordDeviceDiag(STEP_UNWRAP, true, { operation: "unlockWithMdk" });
      await unlockWithMdk(testMdk);
    });
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    let extra = "";
    if (msg.startsWith("VAULT_ROTATE_FAIL:")) {
      const tail = msg.slice("VAULT_ROTATE_FAIL:".length);
      const parts = tail.split(":");
      const recordKey = parts[0] || "unknown";
      const recordPhase = parts[1] || "unknown";
      const recordTypeMatch = tail.match(/recordType:([^|:]+)/);
      const recordType = recordTypeMatch ? recordTypeMatch[1] : "unknown";
      extra = `recordKey:${recordKey}|recordPhase:${recordPhase}|recordType:${recordType}`;
    }
    const step = msg.includes("unlock") || String(err && err.step) === STEP_UNWRAP ? STEP_UNWRAP : STEP_ROTATE;
    throwDeviceSetupStep(step === STEP_UNWRAP ? STEP_UNWRAP : STEP_ROTATE, err, step === STEP_UNWRAP ? "unlockWithMdk" : "rotateVaultMdk", extra);
  }

  try {
    recordDeviceDiag(STEP_WRAP_PERSIST, true, { operation: "storeDeviceWrap" });
    await storeDeviceWrap(meta, deviceWrap);
  } catch (err) {
    throwDeviceSetupStep(STEP_WRAP_PERSIST, err, "storeDeviceWrap");
  }

  try {
    const readBack = await readKeyRecord("mdk:device");
    if (!readBack || !readBack.wrappedSeed) {
      throw new Error("device_wrapper_missing");
    }
    recordDeviceDiag(STEP_READBACK, true, { operation: "readKeyRecord", format: readBack.format || "unknown" });
  } catch (err) {
    throwDeviceSetupStep(STEP_READBACK, err, "readKeyRecord");
  }

  try {
    recordDeviceDiag(STEP_META, true, { operation: "clearPendingDeviceSetup" });
    await clearPendingDeviceSetup();
    recordDeviceDiag(STEP_ACTIVATE, true, { operation: "activateL2State" });
  } catch (err) {
    throwDeviceSetupStep(STEP_META, err, "clearPendingDeviceSetup");
  }
}

export async function setupDeviceUnlock() {
  const supported = await detectDeviceUnlockSupport();
  if (!supported) throw new Error("VAULT_DEVICE_UNSUPPORTED");

  clearWebAuthnCeremonyLog();

  const STEP_MDK = "01-get-existing-mdk";
  const STEP_CREATE = "03-create-webauthn-credential";
  const STEP_PRF = "04-extract-prf-result";
  const STEP_DERIVE = "05-derive-device-wrapping-key";
  const STEP_WRAP = "06-wrap-mdk";
  const STEP_VERIFY = "12-verify-test-record";

  let oldMdk = null;
  try {
    oldMdk = getMdk();
    recordDeviceDiag(STEP_MDK, true, { operation: "getMdk" });
  } catch (err) {
    throwDeviceSetupStep(STEP_MDK, err, "getMdk");
  }

  const meta = await readMeta();
  const seedBytes = crypto.getRandomValues(new Uint8Array(32));

  let testMdk = null;
  const rotatedRef = { value: false };
  try {
    const salt = prfSalt();
    let cred = null;
    let prfBytes = null;
    let activeSalt = salt;
    let prfSource = "get";
    try {
      const created = await createCredentialWithPrf(salt);
      cred = created.cred;
      prfBytes = created.prfBytes;
      activeSalt = created.salt || salt;
      prfSource = created.prfSource || "get";
      recordDeviceDiag(STEP_CREATE, true, { operation: "createCredentialWithPrf", resumed: !!created.resumed });
      recordDeviceDiag(STEP_PRF, true, { operation: "extractPrfResult" });
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (msg.includes("DEVICE_CREATE") || msg.includes("VAULT_DEVICE_CANCELLED") || msg.includes("VAULT_DEVICE_TIMEOUT")) {
        throw err;
      }
      throwDeviceSetupStep(STEP_PRF, err, "extractPrfResult");
    }

    let deviceWrap = null;
    try {
      recordDeviceDiag(STEP_DERIVE, true, { operation: "deriveDeviceAesKeyFromPrf" });
      const deviceAesKey = await deriveDeviceAesKeyFromPrf(prfBytes);
      recordDeviceDiag(STEP_WRAP, true, { operation: "wrapMdkSeedForDevice" });
      const wrappedSeed = await wrapMdkSeedForDevice(deviceAesKey, seedBytes);
      deviceWrap = await buildDeviceWrap(toCredRawIdUint8(cred.rawId), activeSalt, wrappedSeed);
      testMdk = await mdkFromDeviceWrap(deviceWrap, prfBytes);
      recordDeviceDiag("11-unwrap-mdk", true, { operation: "mdkFromDeviceWrap" });
    } catch (err) {
      throw devicePhaseError("DEVICE_WRAP_FAILED", sanitizeDeviceErrorDetail("", err && err.message ? err.message : err));
    }

    // Unlock path always uses credentials.get. If PRF already came from get
    // (create had no PRF results — typical Safari/iOS), a second verify get is
    // redundant Face ID. Only run verify get when PRF came from create alone.
    if (prfSource === "create") {
      await withWebAuthnWatchdog(async (signal) => {
        try {
          await verifyDeviceWrapUnlock(deviceWrap, cred.rawId, activeSalt, signal);
          recordDeviceDiag(STEP_VERIFY, true, { operation: "verifyDeviceWrapUnlock" });
        } catch (err) {
          throwDeviceSetupStep(STEP_VERIFY, err, "verifyDeviceWrapUnlock");
        }
      });
    } else {
      recordDeviceDiag(STEP_VERIFY, true, {
        operation: "verifySkippedPrfFromGet",
      });
    }

    await persistDeviceActivation(meta, deviceWrap, oldMdk, testMdk, rotatedRef);
    recordDeviceDiag("14-activate-l2-state", true, { operation: "setupDeviceUnlock" });
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
    let result = null;
    try {
      result = await navigator.credentials.get(buildPrfGetOptions(credId, salt, signal));
      recordWebAuthnCeremony("get", "device_unlock", result ? "ok" : "empty");
    } catch (err) {
      const name = err && err.name ? String(err.name) : "";
      recordWebAuthnCeremony("get", "device_unlock", name || "error");
      throw err;
    }
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
