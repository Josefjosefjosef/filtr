/**
 * Vault bootstrap — must load before app.js (top-level await).
 */
import { ensureLevel1Mdk, registerAutoLockListeners, getVaultState, lockVault, unlockWithPin, readSecurityConfiguredState } from "./iu-vault-lock-v1.js";
import { installLocalStorageShim, preloadAllVaultRecords, notifyVaultMemoryHydrated, isVaultPersistBlocked, flushPendingVaultWrites } from "./iu-vault-storage-v1.js";
import { migratePlaintextToVault } from "./iu-vault-migrate-v1.js";
import { readMeta } from "./iu-vault-db-v1.js";
import { detectDeviceUnlockSupport } from "./iu-vault-device-v1.js";
import { wipeCalendarMirrorIdb } from "./iu-vault-db-v1.js";

function vaultDisabled() {
  try {
    if (new URLSearchParams(location.search).get("iuVault") === "0") return true;
    if (localStorage.getItem("iu:vault:disabled:v1") === "1") return true;
  } catch (_) {}
  return false;
}

async function initVault() {
  if (vaultDisabled()) return null;

  installLocalStorageShim();
  registerAutoLockListeners();
  try {
    window.addEventListener("pagehide", () => {
      flushPendingVaultWrites().catch(() => {});
    });
  } catch (_) {}

  let meta = await ensureLevel1Mdk();

  if (meta.pinEnabled || meta.deviceEnabled || meta.mindMenuUnlockMethod === "pin" || meta.mindMenuUnlockMethod === "device") {
    await lockVault("startup");
    try {
      window.__iuVaultHydrationPending = true;
      window.__iuVaultHydrationComplete = false;
    } catch (_) {}
  } else {
    await migratePlaintextToVault();
    await preloadAllVaultRecords();
    notifyVaultMemoryHydrated();
    try {
      window.__iuVaultHydrationPending = false;
      window.__iuVaultHydrationComplete = true;
    } catch (_) {}
  }

  window.addEventListener("iu-local-store-changed", (ev) => {
    const key = ev && ev.detail && ev.detail.key;
    if (key === "iu.calendar.store.v1") {
      try {
        if (window.__iuBackupImportInProgress) return;
      } catch (_) {}
      wipeCalendarMirrorIdb().catch(() => {});
    }
  });

  return meta;
}

const meta = await initVault().catch((err) => {
  window.__iuVaultBootError = String(err && err.message ? err.message : err);
  return null;
});

function notifyVaultHydrated() {
  try {
    if (window.__iuVaultHydrationComplete) {
      window.dispatchEvent(new CustomEvent("iu-vault-hydrated"));
    }
  } catch (_) {}
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", notifyVaultHydrated, { once: true });
} else {
  queueMicrotask(notifyVaultHydrated);
}

const api = {
  getState: () => getVaultState(),
  getMeta: () => readMeta(),
  getSecurityConfigured: () => readSecurityConfiguredState(),
  flushPendingWrites: () => flushPendingVaultWrites(),
  lock: () => lockVault("manual"),
  unlockPin: (pin) => unlockWithPin(pin),
  unlockDevice: async () => {
    const { unlockWithDevice } = await import("./iu-vault-device-v1.js?v=iu-vault-mindmenu-lock-ux-v1-20260824");
    return unlockWithDevice();
  },
  setupPin: async (pin, confirm) => {
    const { setupPin } = await import("./iu-vault-pin-v1.js");
    return setupPin(pin, confirm);
  },
  changePin: async (oldP, newP, confirm) => {
    const { changePin } = await import("./iu-vault-pin-v1.js");
    return changePin(oldP, newP, confirm);
  },
  disablePin: async (pin) => {
    const { disablePin } = await import("./iu-vault-pin-v1.js");
    return disablePin(pin);
  },
  setupDevice: async () => {
    const { setupDeviceUnlock } = await import("./iu-vault-device-v1.js?v=iu-vault-mindmenu-lock-ux-v1-20260824");
    return setupDeviceUnlock();
  },
  disableDevice: async () => {
    const { disableDeviceUnlock } = await import("./iu-vault-device-v1.js?v=iu-vault-mindmenu-lock-ux-v1-20260824");
    return disableDeviceUnlock();
  },
  disableMindMenuLock: async (authPin) => {
    const configured = await readSecurityConfiguredState();
    if (configured.unlockMethod === "pin") {
      if (!authPin) throw new Error("VAULT_PIN_REQUIRED");
      await unlockWithPin(authPin);
    } else if (configured.unlockMethod === "device") {
      const { unlockWithDevice } = await import("./iu-vault-device-v1.js?v=iu-vault-mindmenu-lock-ux-v1-20260824");
      await unlockWithDevice();
    }
    const { activateLevel1AutoKey } = await import("./iu-vault-lock-v1.js");
    await activateLevel1AutoKey();
    await migratePlaintextToVault();
    await preloadAllVaultRecords();
    const { notifyVaultMemoryHydrated: notify } = await import("./iu-vault-storage-v1.js");
    notify();
    try {
      window.__iuVaultHydrationPending = false;
      window.__iuVaultHydrationComplete = true;
      window.dispatchEvent(new CustomEvent("iu-vault-hydrated"));
      window.dispatchEvent(new CustomEvent("iu-vault-security-changed"));
    } catch (_) {}
  },
  detectDeviceSupport: () => detectDeviceUnlockSupport(),
  wipePersonal: async () => {
    const { wipePersonalVault } = await import("./iu-vault-wipe-v1.js");
    return wipePersonalVault();
  },
  setAutoLockPolicy: async (policy) => {
    const { setAutoLockPolicy } = await import("./iu-vault-lock-v1.js");
    const { writeMeta, readMeta: rm } = await import("./iu-vault-db-v1.js");
    setAutoLockPolicy(policy);
    const m = await rm();
    if (m) {
      m.autoLockPolicy = policy;
      await writeMeta(m);
    }
  },
  afterUnlock: async () => {
    await migratePlaintextToVault();
    await preloadAllVaultRecords();
    const { notifyVaultMemoryHydrated: notify } = await import("./iu-vault-storage-v1.js");
    notify();
    try {
      window.__iuVaultHydrationPending = false;
      window.__iuVaultHydrationComplete = true;
      window.dispatchEvent(new CustomEvent("iu-vault-hydrated"));
    } catch (_) {}
  },
  isPersistBlocked: (key) => isVaultPersistBlocked(key),
  isHydrationComplete: () => !!window.__iuVaultHydrationComplete,
};

window.iuVault = api;
window.dispatchEvent(new CustomEvent("iu-vault-ready", { detail: { meta } }));

export default api;
