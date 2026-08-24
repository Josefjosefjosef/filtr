/**
 * Vault bootstrap — must load before app.js (top-level await).
 */
import { ensureLevel1Mdk, registerAutoLockListeners, getVaultState, lockVault, unlockWithPin } from "./iu-vault-lock-v1.js";
import { installLocalStorageShim, preloadAllVaultRecords, notifyVaultMemoryHydrated } from "./iu-vault-storage-v1.js";
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

  let meta = await ensureLevel1Mdk();

  if (meta.pinEnabled || meta.deviceEnabled) {
    await lockVault("startup");
  } else {
    await migratePlaintextToVault();
    await preloadAllVaultRecords();
    notifyVaultMemoryHydrated();
  }

  window.addEventListener("iu-vault-unlocked", () => {
    readMeta()
      .then((m) => {
        if (!m || (!m.pinEnabled && !m.deviceEnabled)) return null;
        return migratePlaintextToVault()
          .then(() => preloadAllVaultRecords())
          .then(() => notifyVaultMemoryHydrated());
      })
      .catch(() => {});
  });

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
    window.dispatchEvent(new CustomEvent("iu-vault-hydrated"));
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
  lock: () => lockVault("manual"),
  unlockPin: (pin) => unlockWithPin(pin),
  unlockDevice: async () => {
    const { unlockWithDevice } = await import("./iu-vault-device-v1.js?v=iu-vault-l2-failsafe-v1-20260823");
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
    const { setupDeviceUnlock } = await import("./iu-vault-device-v1.js?v=iu-vault-l2-failsafe-v1-20260823");
    return setupDeviceUnlock();
  },
  disableDevice: async () => {
    const { disableDeviceUnlock } = await import("./iu-vault-device-v1.js?v=iu-vault-l2-failsafe-v1-20260823");
    return disableDeviceUnlock();
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
  },
};

window.iuVault = api;
window.dispatchEvent(new CustomEvent("iu-vault-ready", { detail: { meta } }));

export default api;
