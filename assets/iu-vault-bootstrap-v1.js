/**
 * Vault bootstrap — must load before app.js (top-level await).
 */
import {
  ensureLevel1Mdk,
  registerAutoLockListeners,
  getVaultState,
  lockVault,
  unlockWithPin,
  unlockWithMdk,
  readSecurityConfiguredState,
  setAppLockHintActive,
  registerVaultLockBroadcastListener,
  isVaultStorageRecoveryRequired,
  getVaultStorageRecoveryReason,
  getVaultStorageRecoveryKeyPath,
} from "./iu-vault-lock-v1.js";
import { installLocalStorageShim, preloadAllVaultRecords, notifyVaultMemoryHydrated, isVaultPersistBlocked, flushPendingVaultWrites } from "./iu-vault-storage-v1.js";
import { durableSet, durableRemove, durableFlush, assertDurableKeyPathReady, durableSetJson } from "./iu-vault-durable-adapter-v1.js";
import { migratePlaintextToVault } from "./iu-vault-migrate-v1.js";
import { readMeta } from "./iu-vault-db-v1.js";
import { detectDeviceUnlockSupport } from "./iu-vault-device-v1.js?v=iu-vault-desktop-shared-session-v3-20260826";
import { explainPinRejection } from "./iu-vault-core-v1.js";
import { wipeCalendarMirrorIdb } from "./iu-vault-db-v1.js";
import { initGlobalAppLock, enforceFailClosedAppLock, refreshGlobalAppLockUi } from "./iu-vault-app-lock-v1.js?v=iu-vault-killswitch-restrict-v1-20260831";
import {
  initDesktopSessionCoordinator,
  tryJoinDesktopSession,
  onDesktopSessionReady,
  wasDesktopJoinPending,
  isDesktopSharedSessionViewport,
  desktopSessionPeerTabCount,
} from "./iu-vault-desktop-session-v1.js";
import {
  initVaultPersistenceDiag,
  getPersistenceDiag,
  getPersistenceTimeline,
  recordVaultPersistenceEvent,
  captureSecOffReloadTrace,
  captureLifecycleSaveReopenTrace,
  captureMultiCanaryBootTrace,
} from "./iu-vault-persistence-diag-v1.js";

function vaultSecurityActive(meta) {
  return !!(
    meta &&
    (meta.pinEnabled ||
      meta.deviceEnabled ||
      meta.mindMenuUnlockMethod === "pin" ||
      meta.mindMenuUnlockMethod === "device")
  );
}

async function finishBootLockDecision(showRefresh) {
  try {
    window.__iuVaultBootLockDecisionPending = false;
  } catch (_) {}
  try {
    if (window.__iuVaultBootHandshakeTimer) {
      clearTimeout(window.__iuVaultBootHandshakeTimer);
      window.__iuVaultBootHandshakeTimer = null;
    }
  } catch (_) {}
  if (showRefresh) {
    try {
      await refreshGlobalAppLockUi(api);
    } catch (_) {}
  }
  // Hard fail-closed: never leave INITIALIZING after decision completes.
  try {
    const st = getVaultState();
    if (!st.unlocked) {
      window.__iuVaultBootPhase = "locked";
      document.documentElement.classList.remove("iu-vault-app-init");
      document.documentElement.classList.add("iu-vault-app-locked");
      const screen = document.getElementById("iuVaultAppLockScreen");
      if (screen) {
        screen.hidden = false;
        screen.removeAttribute("aria-hidden");
      }
      window.__iuVaultDeferMindMenuMount = true;
    }
  } catch (_) {}
}

function armBootHandshakeFailClosed() {
  try {
    if (window.__iuVaultBootHandshakeTimer) {
      clearTimeout(window.__iuVaultBootHandshakeTimer);
    }
  } catch (_) {}
  try {
    window.__iuVaultBootHandshakeTimer = setTimeout(() => {
      finishBootLockDecision(true).catch(() => {});
    }, 1200);
  } catch (_) {}
}

function vaultDisabled() {
  // V-KM-01: public URL/LS kill-switch is retired. SECURITY OFF remains the
  // supported no-lock path (L1 auto-MDK + encrypted-at-rest). Clear any legacy
  // sticky flag so prior origins cannot stay permanently disabled.
  try {
    if (localStorage.getItem("iu:vault:disabled:v1") === "1") {
      localStorage.removeItem("iu:vault:disabled:v1");
    }
  } catch (_) {}
  return false;
}

function conflictForensicsOnlyMode() {
  try {
    return new URLSearchParams(location.search || "").get("iuConflictForensics") === "1";
  } catch (_) {
    return false;
  }
}

async function initVault() {
  if (vaultDisabled()) return null;

  installLocalStorageShim();
  initVaultPersistenceDiag();
  registerAutoLockListeners();

  // Hold hydration gate for ALL boots (SECURITY OFF included) so early module
  // defaults cannot poison memoryCache / plant plaintext before IDB preload.
  try {
    window.__iuVaultHydrationPending = true;
    window.__iuVaultHydrationComplete = false;
  } catch (_) {}

  try {
    if (new URLSearchParams(location.search || "").get("iuCanaryDiag") === "1") {
      const { captureMultiCanaryBootTrace } = await import("./iu-vault-persistence-diag-v1.js");
      window.__iuCanaryEarlyBoot = await captureMultiCanaryBootTrace("EARLY_BOOT_PRE_HYDRATE");
    }
  } catch (_) {}

  // READ-ONLY physical conflict forensics: do not migrate/repair/write.
  if (conflictForensicsOnlyMode()) {
    try {
      window.__iuVaultConflictForensicsOnly = true;
      window.__iuVaultHydrationPending = false;
      window.__iuVaultHydrationComplete = false;
    } catch (_) {}
    let meta = null;
    try {
      meta = await readMeta();
    } catch (_) {}
    return { meta, storageRecovery: false, forensicsOnly: true };
  }

  try {
    window.addEventListener("pagehide", () => {
      flushPendingVaultWrites().catch(() => {});
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushPendingVaultWrites().catch(() => {});
      }
    });
  } catch (_) {}

  let meta = await ensureLevel1Mdk();

  if (isVaultStorageRecoveryRequired()) {
    const { showVaultStorageRecovery } = await import("./iu-vault-l1-recovery-ui-v1.js");
    showVaultStorageRecovery(getVaultStorageRecoveryReason(), getVaultStorageRecoveryKeyPath());
    return { meta, storageRecovery: true };
  }

  if (meta && meta.securityLevel === 1 && !meta.pinEnabled && !meta.deviceEnabled) {
    const { requestVaultStoragePersist } = await import("./iu-vault-l1-recovery-ui-v1.js");
    requestVaultStoragePersist()
      .then((res) => {
        recordVaultPersistenceEvent("09-storage-persist", {
          supported: !!res.supported,
          persisted: !!res.persisted,
          requested: !!res.requested,
        });
      })
      .catch(() => {});
  }

  let desktopJoinMdk = null;

  if (meta.pinEnabled || meta.deviceEnabled || meta.mindMenuUnlockMethod === "pin" || meta.mindMenuUnlockMethod === "device") {
    setAppLockHintActive();
    await initDesktopSessionCoordinator();
    await lockVault("startup", { localOnly: true });
    desktopJoinMdk = await tryJoinDesktopSession();
    if (!desktopJoinMdk) {
      try {
        window.__iuVaultHydrationPending = true;
        window.__iuVaultHydrationComplete = false;
      } catch (_) {}
    }
  } else {
    await migratePlaintextToVault();
    await preloadAllVaultRecords();
    notifyVaultMemoryHydrated();
    try {
      window.__iuVaultHydrationPending = false;
      window.__iuVaultHydrationComplete = true;
      window.dispatchEvent(new CustomEvent("iu-vault-hydrated"));
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

  return { meta, desktopJoinMdk };
}

const boot = await initVault().catch((err) => {
  window.__iuVaultBootError = String(err && err.message ? err.message : err);
  try {
    window.__iuVaultHydrationPending = false;
  } catch (_) {}
  return null;
});
const meta = boot && boot.meta ? boot.meta : boot;
const desktopJoinMdk = boot && boot.desktopJoinMdk ? boot.desktopJoinMdk : null;
const storageRecoveryBoot = !!(boot && boot.storageRecovery);
const forensicsOnlyBoot = !!(boot && boot.forensicsOnly);

const api = {
  getState: () => getVaultState(),
  getMeta: () => readMeta(),
  getSecurityConfigured: () => readSecurityConfiguredState(),
  flushPendingWrites: () => flushPendingVaultWrites(),
  durableSet: (key, value) => durableSet(key, value),
  durableSetJson: (key, obj) => durableSetJson(key, obj),
  durableRemove: (key) => durableRemove(key),
  durableFlush: () => durableFlush(),
  assertKeyPathReady: () => assertDurableKeyPathReady(),
  isKeyPathDurableReady: () => !!window.__iuVaultKeyPathDurableReady,
  lock: async () => {
    await lockVault("manual");
    await refreshGlobalAppLockUi(api);
  },
  unlockPin: async (pin) => {
    try {
      window.__iuVaultHydrationPending = true;
      window.__iuVaultHydrationComplete = false;
    } catch (_) {}
    try {
      return await unlockWithPin(pin);
    } catch (err) {
      try {
        window.__iuVaultHydrationPending = false;
      } catch (_) {}
      throw err;
    }
  },
  unlockDevice: async () => {
    try {
      window.__iuVaultHydrationPending = true;
      window.__iuVaultHydrationComplete = false;
    } catch (_) {}
    try {
      const { unlockWithDevice } = await import("./iu-vault-device-v1.js?v=iu-vault-desktop-shared-session-v3-20260826");
      return await unlockWithDevice();
    } catch (err) {
      try {
        window.__iuVaultHydrationPending = false;
      } catch (_) {}
      throw err;
    }
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
    const { setupDeviceUnlock } = await import("./iu-vault-device-v1.js?v=iu-vault-desktop-shared-session-v3-20260826");
    return setupDeviceUnlock();
  },
  disableDevice: async () => {
    const { disableDeviceUnlock } = await import("./iu-vault-device-v1.js?v=iu-vault-desktop-shared-session-v3-20260826");
    return disableDeviceUnlock();
  },
  disableMindMenuLock: async (authPin) => {
    const configured = await readSecurityConfiguredState();
    if (configured.unlockMethod === "pin") {
      if (!authPin) throw new Error("VAULT_PIN_REQUIRED");
      await unlockWithPin(authPin);
    } else if (configured.unlockMethod === "device") {
      const { unlockWithDevice } = await import("./iu-vault-device-v1.js?v=iu-vault-desktop-shared-session-v3-20260826");
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
    await refreshGlobalAppLockUi(api);
  },
  detectDeviceSupport: () => detectDeviceUnlockSupport(),
  validatePinPolicy: (pin) => explainPinRejection(pin),
  getLastDeviceDiag: async () => {
    const { getLastDeviceSetupDiag } = await import("./iu-vault-device-v1.js?v=iu-vault-desktop-shared-session-v3-20260826");
    return getLastDeviceSetupDiag();
  },
  getWebAuthnCeremonyLog: async () => {
    const { getWebAuthnCeremonyLog } = await import("./iu-vault-device-v1.js?v=iu-vault-desktop-shared-session-v3-20260826");
    return getWebAuthnCeremonyLog();
  },
  clearWebAuthnCeremonyLog: async () => {
    const { clearWebAuthnCeremonyLog } = await import("./iu-vault-device-v1.js?v=iu-vault-desktop-shared-session-v3-20260826");
    return clearWebAuthnCeremonyLog();
  },
  wipePersonal: async () => {
    const { wipePersonalVault } = await import("./iu-vault-wipe-v1.js");
    return wipePersonalVault();
  },
  isWipeConfirmPhraseAccepted: async (value) => {
    const { isWipeConfirmPhraseAccepted } = await import("./iu-vault-wipe-v1.js");
    return isWipeConfirmPhraseAccepted(value);
  },
  diagLifecycle: async (phase, moduleKey) => {
    const key = moduleKey ? String(moduleKey) : "";
    const st = getVaultState();
    const configured = await readSecurityConfiguredState();
    let encExists = false;
    let protectedPlainExists = false;
    if (key) {
      try {
        encExists = !!localStorage.getItem("iu:vault:enc:v1:" + key);
      } catch (_) {}
      try {
        // Native probe via unlocked cache presence only â€” never return value.
        protectedPlainExists = st.unlocked && !!(await import("./iu-vault-storage-v1.js").then(() => {
          try {
            return localStorage.getItem(key) != null;
          } catch (_) {
            return false;
          }
        }));
      } catch (_) {}
    }
    return {
      phase: String(phase || ""),
      moduleId: key || null,
      protectedKeyExists: protectedPlainExists,
      encryptedEnvelopeExists: encExists,
      cacheStateExists: null,
      hydrationPending: !!window.__iuVaultHydrationPending,
      hydrationComplete: !!window.__iuVaultHydrationComplete,
      persistBlocked: key ? isVaultPersistBlocked(key) : !!window.__iuVaultHydrationPending,
      unlocked: !!st.unlocked,
      unlockMethod: configured.unlockMethod,
      bfcachePersisted: null,
      lifecycleEvent: String(phase || ""),
      securityLevel: configured.meta && configured.meta.securityLevel,
    };
  },
  getPersistenceDiag: (options) => getPersistenceDiag(options),
  getPersistenceTimeline: (limit) => getPersistenceTimeline(limit),
  recordPersistenceEvent: (step, detail) => recordVaultPersistenceEvent(step, detail),
  captureSecOffReloadTrace: (phase) => captureSecOffReloadTrace(phase),
  captureLifecycleSaveReopenTrace: (phase) => captureLifecycleSaveReopenTrace(phase),
  captureMultiCanaryBootTrace: (phase) => captureMultiCanaryBootTrace(phase),
  getConflictForensics: async () => {
    const { getConflictForensics } = await import("./iu-vault-conflict-forensics-v1.js");
    return getConflictForensics();
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
    try {
      window.__iuVaultHydrationPending = true;
      window.__iuVaultHydrationComplete = false;
    } catch (_) {}
    recordVaultPersistenceEvent("20-module-hydrate", { source: "afterUnlock-start" });
    const withTimeout = async (promise, ms, label) => {
      let timer = null;
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(label)), ms);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    try {
      await withTimeout(flushPendingVaultWrites(), 10000, "VAULT_FLUSH_TIMEOUT");
    } catch (_) {}
    try {
      await withTimeout(migratePlaintextToVault(), 15000, "VAULT_MIGRATE_TIMEOUT");
    } catch (_) {}
    try {
      await withTimeout(preloadAllVaultRecords(), 25000, "VAULT_PRELOAD_TIMEOUT");
    } catch (_) {}
    const { notifyVaultMemoryHydrated: notify } = await import("./iu-vault-storage-v1.js");
    notify();
    try {
      window.__iuVaultHydrationPending = false;
      window.__iuVaultHydrationComplete = true;
      window.dispatchEvent(new CustomEvent("iu-vault-hydrated"));
    } catch (_) {}
    recordVaultPersistenceEvent("23-persist-after-hydrate", { source: "afterUnlock-complete" });
    try {
      await withTimeout(refreshGlobalAppLockUi(api), 5000, "VAULT_APP_LOCK_UI_TIMEOUT");
    } catch (_) {}
  },
  refreshAppLockUi: () => refreshGlobalAppLockUi(api),
  isPersistBlocked: (key) => isVaultPersistBlocked(key),
  isHydrationComplete: () => !!window.__iuVaultHydrationComplete,
  getProtectedSyncReadState: async (key) => {
    const { getProtectedSyncReadState } = await import("./iu-vault-storage-v1.js");
    return getProtectedSyncReadState(key);
  },
  isStorageRecoveryRequired: () => isVaultStorageRecoveryRequired(),
  getStorageRecoveryReason: () => getVaultStorageRecoveryReason(),
  getStorageRecoveryKeyPath: () => getVaultStorageRecoveryKeyPath(),
  isAppLocked: async () => {
    const configured = await readSecurityConfiguredState();
    const st = getVaultState();
    return configured.unlockMethod !== "none" && !st.unlocked;
  },
};

window.iuVault = api;

if (forensicsOnlyBoot) {
  // No migrate, no recovery UI, no lock enforce — overlay captures read-only topology.
} else if (window.__iuVaultBootError && meta) {
  await enforceFailClosedAppLock(api, meta);
} else if (storageRecoveryBoot) {
  registerVaultLockBroadcastListener(api);
} else {
  registerVaultLockBroadcastListener(api);
  if (desktopJoinMdk) {
    await unlockWithMdk(desktopJoinMdk);
    await finishBootLockDecision(true);
    await api.afterUnlock();
  } else if (vaultSecurityActive(meta)) {
    let deferBootDecision = false;
    if (wasDesktopJoinPending() && isDesktopSharedSessionViewport()) {
      const peerTabs = await desktopSessionPeerTabCount();
      deferBootDecision = peerTabs > 1;
    }
    if (!deferBootDecision) {
      await finishBootLockDecision(true);
    } else {
      armBootHandshakeFailClosed();
    }
  }
  await initGlobalAppLock(api);
  onDesktopSessionReady(async () => {
    try {
      const st = getVaultState();
      if (st.unlocked) {
        await finishBootLockDecision(true);
        return;
      }
      const mdk = await tryJoinDesktopSession();
      if (!mdk) {
        await finishBootLockDecision(true);
        return;
      }
      await unlockWithMdk(mdk);
      await finishBootLockDecision(true);
      await api.afterUnlock();
    } catch (_) {
      await finishBootLockDecision(true);
    }
  });
}

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

window.dispatchEvent(new CustomEvent("iu-vault-ready", { detail: { meta } }));

export default api;
