/**
 * Vault runtime state — MDK in memory, lock/unlock, auto-lock.
 */
import {
  generateMdk,
  decryptString,
  encryptString,
} from "./iu-vault-core-v1.js";
import {
  readKeyRecord,
  writeKeyRecord,
  deleteKeyRecord,
  readMeta,
  writeMeta,
  defaultMeta,
} from "./iu-vault-db-v1.js";

const state = {
  mdk: null,
  unlocked: false,
  lockedReason: "",
  failedPinAttempts: 0,
  pinBackoffUntil: 0,
  autoLockPolicy: "background",
  idleTimer: null,
  lastActivity: Date.now(),
  requiresUserReauth: false,
};

async function refreshSecurityMode(meta) {
  const m = meta || await readMeta();
  state.requiresUserReauth = !!(m && (m.pinEnabled || m.deviceEnabled));
  return state.requiresUserReauth;
}

export function getVaultState() {
  return {
    unlocked: state.unlocked,
    lockedReason: state.lockedReason,
    autoLockPolicy: state.autoLockPolicy,
    failedPinAttempts: state.failedPinAttempts,
  };
}

export function getMdk() {
  if (!state.unlocked || !state.mdk) throw new Error("VAULT_LOCKED");
  return state.mdk;
}

export function touchActivity() {
  state.lastActivity = Date.now();
  scheduleIdleLock();
}

export function setAutoLockPolicy(policy) {
  state.autoLockPolicy = policy || "background";
}

function clearIdleTimer() {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
}

function scheduleIdleLock() {
  clearIdleTimer();
  if (!state.requiresUserReauth) return;
  const policy = state.autoLockPolicy;
  let ms = 0;
  if (policy === "idle_1m") ms = 60000;
  else if (policy === "idle_5m") ms = 300000;
  else if (policy === "idle_15m") ms = 900000;
  if (!ms || !state.unlocked) return;
  state.idleTimer = setTimeout(() => {
    lockVault("idle");
  }, ms);
}

export async function lockVault(reason = "manual") {
  if (!state.requiresUserReauth) return;
  clearIdleTimer();
  state.mdk = null;
  state.unlocked = false;
  state.lockedReason = reason;
  try {
    const { clearVaultMemoryCache } = await import("./iu-vault-storage-v1.js");
    clearVaultMemoryCache();
  } catch (_) {}
  try {
    window.dispatchEvent(new CustomEvent("iu-vault-locked", { detail: { reason } }));
  } catch (_) {}
}

export async function unlockWithMdk(mdk) {
  state.mdk = mdk;
  state.unlocked = true;
  state.lockedReason = "";
  state.failedPinAttempts = 0;
  state.pinBackoffUntil = 0;
  touchActivity();
  try {
    window.dispatchEvent(new CustomEvent("iu-vault-unlocked", { detail: {} }));
  } catch (_) {}
}

export async function ensureLevel1Mdk() {
  let meta = await readMeta();
  if (!meta) {
    meta = await defaultMeta();
    await writeMeta(meta);
  }
  state.autoLockPolicy = meta.autoLockPolicy || "background";
  await refreshSecurityMode(meta);

  if (meta.securityLevel === 1 && !meta.pinEnabled && !meta.deviceEnabled) {
    let keyRec = await readKeyRecord("mdk:level1");
    if (!keyRec || !keyRec.mdk) {
      const mdk = await generateMdk();
      await writeKeyRecord("mdk:level1", { type: "level1", mdk, createdAt: new Date().toISOString() });
      keyRec = await readKeyRecord("mdk:level1");
    }
    await unlockWithMdk(keyRec.mdk);
    return meta;
  }

  state.unlocked = false;
  return meta;
}

export async function activateLevel1AutoKey() {
  const meta = await readMeta();
  if (!meta) throw new Error("VAULT_META_MISSING");
  meta.securityLevel = 1;
  meta.pinEnabled = false;
  meta.deviceEnabled = false;
  await writeMeta(meta);
  await deleteKeyRecord("mdk:pin");
  await deleteKeyRecord("mdk:device");
  let keyRec = await readKeyRecord("mdk:level1");
  if (!keyRec || !keyRec.mdk) {
    const mdk = state.mdk || await generateMdk();
    await writeKeyRecord("mdk:level1", { type: "level1", mdk, createdAt: new Date().toISOString() });
    keyRec = await readKeyRecord("mdk:level1");
  }
  await unlockWithMdk(keyRec.mdk);
  await writeMeta(meta);
  await refreshSecurityMode(meta);
}

export function registerAutoLockListeners() {
  if (registerAutoLockListeners._done) return;
  registerAutoLockListeners._done = true;
  document.addEventListener("visibilitychange", () => {
    if (!state.requiresUserReauth) return;
    if (document.visibilityState === "hidden") {
      const p = state.autoLockPolicy;
      if (p === "background" || p === "tools_open") lockVault("background");
    }
  });
  ["pointerdown", "keydown", "touchstart"].forEach((ev) => {
    document.addEventListener(ev, () => touchActivity(), { passive: true });
  });
}

export function getPinBackoffRemainingMs() {
  const now = Date.now();
  if (state.pinBackoffUntil > now) return state.pinBackoffUntil - now;
  return 0;
}

export function registerPinFailure() {
  state.failedPinAttempts += 1;
  const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(state.failedPinAttempts - 1, 5)));
  state.pinBackoffUntil = Date.now() + delay;
}

export async function storePinWrap(meta, pinWrap) {
  await writeKeyRecord("mdk:pin", pinWrap);
  meta.pinEnabled = true;
  meta.securityLevel = meta.deviceEnabled ? 23 : 3;
  await deleteKeyRecord("mdk:level1");
  await writeMeta(meta);
  await refreshSecurityMode(meta);
  await lockVault("pin_enabled");
}

export async function storeDeviceWrap(meta, deviceWrap) {
  await writeKeyRecord("mdk:device", deviceWrap);
  meta.deviceEnabled = true;
  meta.securityLevel = meta.pinEnabled ? 23 : 2;
  await deleteKeyRecord("mdk:level1");
  await writeMeta(meta);
  await refreshSecurityMode(meta);
  await lockVault("device_enabled");
}

export async function verifyPinRecord(pinWrap, pin) {
  const { mdkFromPinWrap } = await import("./iu-vault-pin-crypto-v1.js");
  const remain = getPinBackoffRemainingMs();
  if (remain > 0) throw new Error("VAULT_PIN_BACKOFF");
  return mdkFromPinWrap(pinWrap, pin);
}

export async function unlockWithPin(pin) {
  const pinWrap = await readKeyRecord("mdk:pin");
  if (!pinWrap) throw new Error("VAULT_PIN_NOT_CONFIGURED");
  try {
    const mdk = await verifyPinRecord(pinWrap, pin);
    await unlockWithMdk(mdk);
    return true;
  } catch (e) {
    if (String(e.message || e).includes("BACKOFF")) throw e;
    registerPinFailure();
    throw new Error("VAULT_PIN_INVALID");
  }
}
