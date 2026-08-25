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

export const APP_LOCK_HINT_KEY = "iu:vault:app-lock-active:v1";

let vaultBroadcast = null;

function getVaultBroadcast() {
  if (vaultBroadcast) return vaultBroadcast;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      vaultBroadcast = new BroadcastChannel("iu-vault-lock-v1");
    }
  } catch (_) {}
  return vaultBroadcast;
}

export function setAppLockHintActive() {
  try {
    localStorage.setItem(APP_LOCK_HINT_KEY, "1");
  } catch (_) {}
  try {
    document.documentElement.classList.add("iu-vault-app-locked");
  } catch (_) {}
}

export function clearAppLockHint() {
  try {
    localStorage.removeItem(APP_LOCK_HINT_KEY);
  } catch (_) {}
  try {
    document.documentElement.classList.remove("iu-vault-app-locked");
  } catch (_) {}
}

function postVaultLockMessage(type, reason) {
  try {
    getVaultBroadcast()?.postMessage({ type, reason: reason || "", ts: Date.now() });
  } catch (_) {}
}

export function registerVaultLockBroadcastListener(vault) {
  const bc = getVaultBroadcast();
  if (!bc || registerVaultLockBroadcastListener._done) return;
  registerVaultLockBroadcastListener._done = true;
  bc.addEventListener("message", (ev) => {
    const data = ev && ev.data ? ev.data : null;
    if (!data || !data.type) return;
    if (data.type === "wiped") {
      try {
        window.__iuVaultHydrationPending = true;
        window.__iuVaultHydrationComplete = false;
      } catch (_) {}
      try {
        window.location.reload();
      } catch (_) {}
      return;
    }
    if (data.type === "locked") {
      lockVault(data.reason || "remote_tab").catch(() => {});
      if (vault && typeof vault.isHydrationComplete === "function" && !vault.isHydrationComplete()) {
        try {
          window.__iuVaultHydrationPending = true;
          window.__iuVaultHydrationComplete = false;
        } catch (_) {}
      }
    }
  });
}

export { postVaultLockMessage };

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
  lockInProgress: false,
};

async function refreshSecurityMode(meta) {
  const m = meta || await readMeta();
  const pinWrap = await readKeyRecord("mdk:pin");
  const deviceWrap = await readKeyRecord("mdk:device");
  const method = resolveMindMenuUnlockMethod(m, pinWrap, deviceWrap);
  state.requiresUserReauth = method !== "none";
  return state.requiresUserReauth;
}

export function resolveMindMenuUnlockMethod(meta, pinWrap, deviceWrap) {
  const m = meta || {};
  if (m.mindMenuUnlockMethod === "pin" || m.mindMenuUnlockMethod === "device" || m.mindMenuUnlockMethod === "none") {
    if (m.mindMenuUnlockMethod === "pin" && !pinWrap && !m.pinEnabled) return "none";
    if (m.mindMenuUnlockMethod === "device" && !deviceWrap && !m.deviceEnabled) return "none";
    return m.mindMenuUnlockMethod;
  }
  if (deviceWrap || m.deviceEnabled) return pinWrap || m.pinEnabled ? "device" : "device";
  if (pinWrap || m.pinEnabled) return "pin";
  return "none";
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

export async function repairVaultMetaFromKeys(meta) {
  if (!meta) return null;
  const pinWrap = await readKeyRecord("mdk:pin");
  const deviceWrap = await readKeyRecord("mdk:device");
  let changed = false;
  const method = resolveMindMenuUnlockMethod(meta, pinWrap, deviceWrap);
  if (meta.mindMenuUnlockMethod !== method) {
    meta.mindMenuUnlockMethod = method;
    changed = true;
  }
  const pinOn = method === "pin";
  const devOn = method === "device";
  if (meta.pinEnabled !== pinOn) {
    meta.pinEnabled = pinOn;
    changed = true;
  }
  if (meta.deviceEnabled !== devOn) {
    meta.deviceEnabled = devOn;
    changed = true;
  }
  const level = method === "pin" ? 3 : method === "device" ? 2 : 1;
  if (meta.securityLevel !== level) {
    meta.securityLevel = level;
    changed = true;
  }
  if (pinOn && deviceWrap) {
    await deleteKeyRecord("mdk:device");
    changed = true;
  }
  if (devOn && pinWrap) {
    await deleteKeyRecord("mdk:pin");
    changed = true;
  }
  if (changed) {
    await writeMeta(meta);
    await refreshSecurityMode(meta);
  }
  return meta;
}

export async function readSecurityConfiguredState(meta) {
  const m = meta || await readMeta();
  const pinWrap = await readKeyRecord("mdk:pin");
  const deviceWrap = await readKeyRecord("mdk:device");
  const unlockMethod = resolveMindMenuUnlockMethod(m, pinWrap, deviceWrap);
  return {
    unlockMethod,
    pinConfigured: unlockMethod === "pin",
    deviceConfigured: unlockMethod === "device",
    meta: m,
  };
}

export async function lockVault(reason = "manual") {
  if (!state.requiresUserReauth) return;
  if (state.lockInProgress) {
    try {
      const { flushPendingVaultWrites } = await import("./iu-vault-storage-v1.js");
      await flushPendingVaultWrites();
    } catch (_) {}
    return;
  }
  state.lockInProgress = true;
  try {
    // Block NEW module writes BEFORE flush/clear — mobile visibilitychange races otherwise
    // overwrite ciphertext while encrypt is still in flight.
    try {
      window.__iuVaultHydrationPending = true;
      window.__iuVaultHydrationComplete = false;
    } catch (_) {}
    try {
      const { flushPendingVaultWrites } = await import("./iu-vault-storage-v1.js");
      await flushPendingVaultWrites();
    } catch (_) {}
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
    // Wipe clears security in the same turn; broadcasting "locked" would race
    // async lock-UI refresh and re-show APP_LOCKED after clean L1 is ready.
    if (reason !== "wiped") {
      postVaultLockMessage("locked", reason);
    }
  } finally {
    state.lockInProgress = false;
  }
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
  postVaultLockMessage("unlocked", "");
}

export async function ensureLevel1Mdk() {
  let meta = await readMeta();
  if (!meta) {
    meta = await defaultMeta();
    await writeMeta(meta);
  }
  meta = await repairVaultMetaFromKeys(meta);
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
  meta.mindMenuUnlockMethod = "none";
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
  clearAppLockHint();
}

export function registerAutoLockListeners() {
  if (registerAutoLockListeners._done) return;
  registerAutoLockListeners._done = true;
  document.addEventListener("visibilitychange", () => {
    if (!state.requiresUserReauth) return;
    if (document.visibilityState === "hidden") {
      const p = state.autoLockPolicy;
      if (p === "background" || p === "tools_open") {
        // Fire-and-follow: do not leave flush unstarted on iOS suspend.
        lockVault("background").catch(() => {});
      }
    }
  });
  try {
    window.addEventListener("pagehide", () => {
      if (!state.requiresUserReauth) return;
      try {
        window.__iuVaultHydrationPending = true;
      } catch (_) {}
      import("./iu-vault-storage-v1.js")
        .then((m) => m.flushPendingVaultWrites())
        .catch(() => {});
      const p = state.autoLockPolicy;
      if (state.unlocked && (p === "background" || p === "tools_open")) {
        lockVault("pagehide").catch(() => {});
      }
    });
    window.addEventListener("pageshow", (ev) => {
      if (!state.requiresUserReauth) return;
      const bf = !!(ev && ev.persisted);
      if (!state.unlocked) {
        try {
          // Fresh launch: bootstrap already sets pending. Re-assert if cleared early.
          // BFCache: always re-assert + clear frozen empty runtime cache.
          if (bf || !window.__iuVaultHydrationPending) {
            window.__iuVaultHydrationPending = true;
            window.__iuVaultHydrationComplete = false;
          }
        } catch (_) {}
        if (bf) {
          import("./iu-vault-storage-v1.js")
            .then((m) => {
              try {
                m.clearVaultMemoryCache();
              } catch (_) {}
            })
            .catch(() => {});
        }
      }
      if (!bf) return;
      try {
        window.dispatchEvent(
          new CustomEvent("iu-vault-bfcache-restore", {
            detail: { persisted: true, unlocked: !!state.unlocked },
          })
        );
      } catch (_) {}
    });
  } catch (_) {}
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
  await deleteKeyRecord("mdk:device");
  meta.pinEnabled = true;
  meta.deviceEnabled = false;
  meta.mindMenuUnlockMethod = "pin";
  meta.securityLevel = 3;
  await deleteKeyRecord("mdk:level1");
  await writeMeta(meta);
  await refreshSecurityMode(meta);
  setAppLockHintActive();
  await lockVault("pin_enabled");
}

export async function storeDeviceWrap(meta, deviceWrap) {
  await writeKeyRecord("mdk:device", deviceWrap);
  await deleteKeyRecord("mdk:pin");
  meta.deviceEnabled = true;
  meta.pinEnabled = false;
  meta.mindMenuUnlockMethod = "device";
  meta.securityLevel = 2;
  await deleteKeyRecord("mdk:level1");
  await writeMeta(meta);
  await refreshSecurityMode(meta);
  setAppLockHintActive();
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
