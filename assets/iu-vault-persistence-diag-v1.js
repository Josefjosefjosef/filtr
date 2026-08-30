/**
 * Safe mobile/tablet/PWA persistence diagnostics — metadata only, no record contents.
 */
import { isProtectedStorageKey } from "./iu-vault-protected-keys-v1.js";

const MAX_TIMELINE = 100;

/** @type {Array<object>} */
const timeline = [];
/** @type {Map<string, object>} */
const recordStats = new Map();

export const DIAG_PROBE_KEYS = [
  "iu.notes.store.v1",
  "iu.tasks.mvp.v1",
  "iu.calendar.store.v1",
  "iu.infoEvents.prefs.v1",
  "iuFollowedTopics",
  "iuWeatherCitySelectedV1",
  "infouzel_quicktools",
  "iu_mailboxes_v1",
];

function safeToken(value, maxLen) {
  return String(value == null ? "" : value)
    .replace(/[\r\n\t]/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, maxLen || 64);
}

function classifyKey(key) {
  const k = String(key || "");
  if (k === "iu.infoEvents.prefs.v1") return "info_prefs_filters";
  if (k.includes("notes")) return "notes";
  if (k.includes("tasks")) return "tasks";
  if (k.includes("calendar")) return "calendar";
  if (k.includes("Weather") || k === "iuFollowedTopics") return "filter_pref";
  if (k.includes("quicktools")) return "quick_links";
  if (k.includes("mailbox")) return "mailbox";
  if (isProtectedStorageKey(k)) return "protected_module";
  return "other";
}

function currentLifecycleTag() {
  try {
    const vis = document.visibilityState || "unknown";
    const boot = window.__iuVaultBootPhase || "unknown";
    return vis + ":" + boot;
  } catch (_) {
    return "unknown";
  }
}

function detectPlatform() {
  try {
    const ua = String(navigator.userAgent || "");
    if (/iPhone/i.test(ua)) return "ios_phone";
    if (/iPad/i.test(ua)) return "ios_tablet";
    if (/Android/i.test(ua) && /Mobile/i.test(ua)) return "android_phone";
    if (/Android/i.test(ua)) return "android_tablet";
    if (/Mobile/i.test(ua)) return "mobile_other";
    return "desktop_or_other";
  } catch (_) {
    return "unknown";
  }
}

function detectDisplayMode() {
  try {
    const standalone =
      (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
    if (standalone) return "standalone_pwa";
    if (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: minimal-ui)").matches) {
      return "minimal_ui";
    }
    return "browser_tab";
  } catch (_) {
    return "unknown";
  }
}

function detectBundleHint() {
  try {
    const build = document.querySelector('meta[name="iu-build"]');
    return build ? safeToken(build.getAttribute("content"), 96) : null;
  } catch (_) {
    return null;
  }
}

function serviceWorkerMeta() {
  try {
    const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!ctrl) return { controlled: false, scriptUrl: null };
    const url = String(ctrl.scriptURL || "");
    return {
      controlled: true,
      scriptUrl: safeToken(url.split("/").pop(), 120),
    };
  } catch (_) {
    return { controlled: false, scriptUrl: null };
  }
}

function touchRecordStats(key, step, detail) {
  const k = String(key || "");
  if (!k) return;
  let stats = recordStats.get(k);
  if (!stats) {
    stats = {
      blockedWriteCount: 0,
      lastWritePhase: null,
      lastHydratePhase: null,
      decryptStatus: null,
      generation: null,
      lastWriteAt: null,
      lastHydrateAt: null,
    };
    recordStats.set(k, stats);
  }
  if (detail && detail.writeBlocked) stats.blockedWriteCount += 1;
  if (detail && detail.generation != null) stats.generation = detail.generation;
  if (detail && detail.decryptStatus) stats.decryptStatus = detail.decryptStatus;
  const writeSteps = new Set([
    "01-user-write-request",
    "03-persist-request",
    "04-encrypt-start",
    "05-encrypt-success",
    "06-write-start",
    "07-write-transaction-complete",
    "08-write-confirmed",
    "23-persist-after-hydrate",
    "24-overwrite-blocked",
  ]);
  const hydrateSteps = new Set(["18-record-read", "19-decrypt-success", "19-decrypt-fail", "20-module-hydrate"]);
  if (writeSteps.has(step)) {
    stats.lastWritePhase = step;
    stats.lastWriteAt = Date.now();
  }
  if (hydrateSteps.has(step)) {
    stats.lastHydratePhase = step;
    stats.lastHydrateAt = Date.now();
  }
}

/**
 * @param {string} step
 * @param {object} [detail]
 */
export function recordVaultPersistenceEvent(step, detail) {
  const d = detail && typeof detail === "object" ? detail : {};
  const entry = {
    ts: Date.now(),
    step: safeToken(step, 48),
    key: d.key ? safeToken(d.key, 96) : null,
    keyType: d.keyType || (d.key ? classifyKey(d.key) : null),
    source: d.source ? safeToken(d.source, 48) : null,
    writeBlocked: d.writeBlocked === true,
    reason: d.reason ? safeToken(d.reason, 64) : null,
    decryptStatus: d.decryptStatus ? safeToken(d.decryptStatus, 24) : null,
    lifecycle: d.lifecycle ? safeToken(d.lifecycle, 48) : currentLifecycleTag(),
    pendingWrites: typeof d.pendingWrites === "number" ? d.pendingWrites : null,
    generation: typeof d.generation === "number" ? d.generation : null,
  };
  timeline.push(entry);
  if (timeline.length > MAX_TIMELINE) timeline.shift();
  if (d.key) touchRecordStats(d.key, entry.step, d);
}

export function getPersistenceTimeline(limit) {
  const n = Math.max(1, Math.min(Number(limit) || MAX_TIMELINE, MAX_TIMELINE));
  return timeline.slice(-n);
}

export async function getPersistenceDiag(options) {
  const opts = options && typeof options === "object" ? options : {};
  const keys = Array.isArray(opts.keys) && opts.keys.length ? opts.keys : DIAG_PROBE_KEYS;
  const { getVaultState, readSecurityConfiguredState } = await import("./iu-vault-lock-v1.js");
  const {
    isVaultPersistBlocked,
    hasEncryptedRecordAtRest,
    nativeLocalStorageGet,
    captureNativeLocalStorage,
    getPendingVaultWriteCount,
    isPlaintextStagingPresent,
  } = await import("./iu-vault-storage-v1.js");
  const { readRecord, readKeyRecord, listRecordKeys } = await import("./iu-vault-db-v1.js");
  const {
    readLevel1DurableMaterialBytes,
    isVaultStorageRecoveryRequired,
    getVaultStorageRecoveryReason,
    LEVEL1_MDK_MATERIAL_ID,
    LEVEL1_MDK_BACKUP_KEY,
  } = await import("./iu-vault-lock-v1.js");

  const st = getVaultState();
  let configured = { unlockMethod: "unknown", meta: null };
  try {
    configured = await readSecurityConfiguredState();
  } catch (_) {}

  captureNativeLocalStorage();
  const records = [];
  let ciphertextCount = 0;
  for (const key of keys) {
    const k = String(key);
    let idbEnvelope = false;
    try {
      const env = await readRecord(k);
      idbEnvelope = !!(env && env.ct);
    } catch (_) {}
    const lsEnvelope = hasEncryptedRecordAtRest(k);
    let plainStaging = false;
    try {
      plainStaging = isPlaintextStagingPresent(k);
    } catch (_) {}
    if (idbEnvelope || lsEnvelope) ciphertextCount += 1;
    const stats = recordStats.get(k) || {};
    let backend = "none";
    if (idbEnvelope && lsEnvelope) backend = "idb+ls_enc";
    else if (idbEnvelope) backend = "idb";
    else if (lsEnvelope) backend = "ls_enc";
    else if (plainStaging) backend = "ls_plain_staging";
    records.push({
      keyType: classifyKey(k),
      storageKey: k,
      persisted: idbEnvelope || lsEnvelope || plainStaging,
      backend,
      envelope: idbEnvelope || lsEnvelope,
      idbEnvelope,
      lsEnvelope,
      plainStaging,
      generation: stats.generation ?? null,
      lastWritePhase: stats.lastWritePhase ?? null,
      lastWriteAt: stats.lastWriteAt ?? null,
      lastHydratePhase: stats.lastHydratePhase ?? null,
      lastHydrateAt: stats.lastHydrateAt ?? null,
      decryptStatus: stats.decryptStatus ?? null,
      blockedWriteCount: stats.blockedWriteCount || 0,
      persistBlockedNow: isVaultPersistBlocked(k),
    });
  }

  let allRecordCount = 0;
  try {
    allRecordCount = (await listRecordKeys()).length;
  } catch (_) {}

  let cryptoKeyPresent = false;
  let cryptoKeyUsable = false;
  try {
    const keyRec = await readKeyRecord("mdk:level1");
    cryptoKeyPresent = !!(keyRec && keyRec.mdk);
    if (cryptoKeyPresent) {
      try {
        const { encryptString, decryptString } = await import("./iu-vault-core-v1.js");
        const env = await encryptString(keyRec.mdk, "iu.vault.selftest.v1", "ok");
        const pt = await decryptString(keyRec.mdk, "iu.vault.selftest.v1", env);
        cryptoKeyUsable = pt === "ok";
      } catch (_) {
        cryptoKeyUsable = false;
      }
    }
  } catch (_) {}

  let durableMaterialPresent = false;
  try {
    const raw = await readLevel1DurableMaterialBytes();
    durableMaterialPresent = !!(raw && raw.byteLength >= 16);
  } catch (_) {}

  let legacyBackupPresent = false;
  try {
    legacyBackupPresent = !!localStorage.getItem(LEVEL1_MDK_BACKUP_KEY);
  } catch (_) {}

  const recoveryRequired = (() => {
    try {
      return !!isVaultStorageRecoveryRequired();
    } catch (_) {
      return !!window.__iuVaultStorageRecoveryRequired;
    }
  })();

  const ciphertextPresent = ciphertextCount > 0 || allRecordCount > 0;
  let persistenceState = "STATE_1_NO_CIPHERTEXT";
  if (ciphertextPresent) {
    if (recoveryRequired && !cryptoKeyUsable && !durableMaterialPresent) {
      persistenceState = "STATE_3_CIPHERTEXT_PRESENT_KEY_PATH_LOST";
    } else if (cryptoKeyPresent && !cryptoKeyUsable && !durableMaterialPresent) {
      persistenceState = "STATE_4_CIPHERTEXT_PRESENT_DECRYPT_FAILED";
    } else if ((cryptoKeyUsable || durableMaterialPresent) && !st.unlocked) {
      persistenceState = "STATE_2_CIPHERTEXT_PRESENT_KEY_PRESENT";
    } else if ((cryptoKeyUsable || durableMaterialPresent) && st.unlocked && !window.__iuVaultHydrationComplete) {
      persistenceState = "STATE_5_DECRYPT_OK_HYDRATION_PENDING";
    } else if ((cryptoKeyUsable || durableMaterialPresent) && st.unlocked) {
      persistenceState = "STATE_2_CIPHERTEXT_PRESENT_KEY_PRESENT";
    } else if (!cryptoKeyUsable && !durableMaterialPresent) {
      persistenceState = "STATE_3_CIPHERTEXT_PRESENT_KEY_PATH_LOST";
    }
  }

  let storagePersisted = null;
  let storagePersistSupported = false;
  try {
    storagePersistSupported = !!(navigator.storage && typeof navigator.storage.persisted === "function");
    if (storagePersistSupported) storagePersisted = await navigator.storage.persisted();
  } catch (_) {}

  let pageOrigin = null;
  try {
    pageOrigin = String(location.origin || "").slice(0, 120);
  } catch (_) {}

  let confirmedWriteCount = 0;
  try {
    for (const ev of timeline) {
      if (ev && ev.step === "08-write-confirmed") confirmedWriteCount += 1;
    }
  } catch (_) {}

  return {
    capturedAt: Date.now(),
    platform: detectPlatform(),
    displayMode: detectDisplayMode(),
    lifecycle: currentLifecycleTag(),
    vaultState: {
      unlocked: !!st.unlocked,
      lockedReason: st.lockedReason ? safeToken(st.lockedReason, 32) : null,
      requiresUserReauth: !!st.requiresUserReauth,
    },
    securityMethod: configured.unlockMethod || "unknown",
    securityLevel: configured.meta && configured.meta.securityLevel != null ? configured.meta.securityLevel : null,
    hydrationPending: !!window.__iuVaultHydrationPending,
    hydrationComplete: !!window.__iuVaultHydrationComplete,
    bootPhase: window.__iuVaultBootPhase ? safeToken(window.__iuVaultBootPhase, 24) : null,
    pendingWriteCount: getPendingVaultWriteCount(),
    serviceWorker: serviceWorkerMeta(),
    bundleHint: detectBundleHint(),
    forensics: {
      dbName: "iu.vault.v1",
      schemaVersion: 1,
      origin: pageOrigin,
      storagePersistSupported,
      storagePersisted,
      recordCount: allRecordCount,
      probeCiphertextCount: ciphertextCount,
      cryptoKeyPresent,
      cryptoKeyUsable,
      durableMaterialPresent,
      legacyBackupPresent,
      recoveryRequired,
      recoveryReason: recoveryRequired
        ? safeToken(
            (typeof getVaultStorageRecoveryReason === "function" && getVaultStorageRecoveryReason()) ||
              window.__iuVaultStorageRecoveryReason ||
              "",
            64
          )
        : null,
      persistenceState,
      materialStoreId: LEVEL1_MDK_MATERIAL_ID ? "level1-material" : null,
      confirmedWriteCount,
      pendingWriteCount: getPendingVaultWriteCount(),
    },
    records,
  };
}

export function initVaultPersistenceDiag() {
  if (initVaultPersistenceDiag._done) return;
  initVaultPersistenceDiag._done = true;
  recordVaultPersistenceEvent("14-cold-bootstrap", { source: "init" });
  try {
    document.addEventListener("visibilitychange", () => {
      recordVaultPersistenceEvent(
        document.visibilityState === "hidden" ? "09-visibility-hidden" : "09-visibility-visible",
        { source: "visibilitychange" }
      );
    });
  } catch (_) {}
  try {
    window.addEventListener("pagehide", () => {
      recordVaultPersistenceEvent("10-pagehide", { source: "pagehide" });
    });
    window.addEventListener("pageshow", (ev) => {
      recordVaultPersistenceEvent("10-pageshow", {
        source: "pageshow",
        reason: ev && ev.persisted ? "bfcache" : "fresh",
      });
    });
  } catch (_) {}
  try {
    document.addEventListener("freeze", () => {
      recordVaultPersistenceEvent("11-freeze", { source: "freeze" });
    });
    document.addEventListener("resume", () => {
      recordVaultPersistenceEvent("11-resume", { source: "resume" });
    });
  } catch (_) {}
  try {
    window.addEventListener("iu-vault-locked", (ev) => {
      const reason = ev && ev.detail && ev.detail.reason ? ev.detail.reason : "";
      recordVaultPersistenceEvent("15-vault-locked", { source: "iu-vault-locked", reason });
    });
    window.addEventListener("iu-vault-unlocked", () => {
      recordVaultPersistenceEvent("17-mdk-unwrapped", { source: "iu-vault-unlocked" });
    });
    window.addEventListener("iu-vault-hydrated", () => {
      recordVaultPersistenceEvent("20-module-hydrate", { source: "iu-vault-hydrated" });
    });
    window.addEventListener("iu-local-store-changed", (ev) => {
      const key = ev && ev.detail && ev.detail.key ? ev.detail.key : null;
      const source = ev && ev.detail && ev.detail.source ? ev.detail.source : null;
      if (!key) return;
      recordVaultPersistenceEvent("02-module-state-updated", {
        key,
        source: source || "iu-local-store-changed",
      });
    });
  } catch (_) {}
}

/**
 * SECURITY OFF reload trace — fingerprints only (no plaintext body).
 * Distinguishes missing IDB, plaintext staging, decrypt fail, mem divergence after hydrate.
 */
export async function captureSecOffReloadTrace(phase) {
  const keys = ["iu.infoEvents.prefs.v1", "iu.notes.store.v1", "iu.tasks.mvp.v1", "iu.calendar.store.v1"];
  const { getVaultState, readSecurityConfiguredState, getMdk } = await import("./iu-vault-lock-v1.js");
  const {
    nativeLocalStorageGet,
    captureNativeLocalStorage,
    getPendingVaultWriteCount,
    isPlaintextStagingPresent,
    getMemoryCachePlaintext,
  } = await import("./iu-vault-storage-v1.js");
  const { readRecord, readMeta } = await import("./iu-vault-db-v1.js");
  const { decryptString } = await import("./iu-vault-core-v1.js");

  captureNativeLocalStorage();
  const st = getVaultState();
  let configured = { unlockMethod: "unknown" };
  try {
    configured = await readSecurityConfiguredState();
  } catch (_) {}
  let meta = null;
  try {
    meta = await readMeta();
  } catch (_) {}

  async function fp8(text) {
    try {
      const data = new TextEncoder().encode(String(text || ""));
      const dig = await crypto.subtle.digest("SHA-256", data);
      const hex = Array.from(new Uint8Array(dig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return hex.slice(0, 8);
    } catch (_) {
      return null;
    }
  }

  const probes = [];
  for (const key of keys) {
    let idbPresent = false;
    let decryptOk = false;
    let idbFp = null;
    let idbLen = null;
    try {
      const env = await readRecord(key);
      idbPresent = !!(env && env.ct);
      if (idbPresent && st.unlocked) {
        try {
          const mdk = getMdk();
          const pt = await decryptString(mdk, key, env);
          decryptOk = true;
          idbLen = String(pt || "").length;
          idbFp = await fp8(pt);
        } catch (_) {
          decryptOk = false;
        }
      }
    } catch (_) {}
    let memFp = null;
    let memLen = null;
    let memPresent = false;
    try {
      const mem = getMemoryCachePlaintext(key);
      if (mem != null) {
        memPresent = true;
        memLen = String(mem).length;
        memFp = await fp8(mem);
      }
    } catch (_) {}
    let shimPresent = false;
    let shimFp = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        shimPresent = true;
        shimFp = await fp8(raw);
      }
    } catch (_) {}
    probes.push({
      key: safeToken(key, 64),
      keyType: classifyKey(key),
      idbPresent,
      decryptOk,
      idbFp,
      idbLen,
      plainStaging: !!isPlaintextStagingPresent(key),
      nativePlainLen: (() => {
        try {
          const n = nativeLocalStorageGet(key);
          return n == null ? null : String(n).length;
        } catch (_) {
          return null;
        }
      })(),
      memPresent,
      memFp,
      memLen,
      shimPresent,
      shimFp,
      fpMatchIdbMem: !!(idbFp && memFp && idbFp === memFp),
      fpMatchIdbShim: !!(idbFp && shimFp && idbFp === shimFp),
    });
  }

  const payload = {
    tag: "SEC_OFF_RELOAD_TRACE_V1",
    phase: safeToken(phase || "unknown", 32),
    capturedAt: Date.now(),
    securityMethod: configured.unlockMethod || "unknown",
    securityLevel: meta && meta.securityLevel != null ? meta.securityLevel : null,
    l1IdbOnly: !!(meta && meta.l1IdbOnly),
    unlocked: !!st.unlocked,
    requiresUserReauth: !!st.requiresUserReauth,
    hydrationPending: !!window.__iuVaultHydrationPending,
    hydrationComplete: !!window.__iuVaultHydrationComplete,
    pendingWriteCount: getPendingVaultWriteCount(),
    platform: detectPlatform(),
    displayMode: detectDisplayMode(),
    serviceWorker: serviceWorkerMeta(),
    probes,
  };

  let firstDiff = null;
  try {
    const prevRaw = sessionStorage.getItem("iu:vault:sec-off-reload-trace:v1");
    if (prevRaw) {
      const prev = JSON.parse(prevRaw);
      if (prev && Array.isArray(prev.probes)) {
        for (const now of probes) {
          const old = prev.probes.find((p) => p && p.key === now.key);
          if (!old) continue;
          if (old.idbFp && now.idbFp && old.idbFp !== now.idbFp) {
            firstDiff = {
              key: now.key,
              kind: "idb_fp_changed",
              fromPhase: prev.phase,
              toPhase: payload.phase,
              fromFp: old.idbFp,
              toFp: now.idbFp,
            };
            break;
          }
          if (old.idbPresent && !now.idbPresent) {
            firstDiff = { key: now.key, kind: "idb_lost", fromPhase: prev.phase, toPhase: payload.phase };
            break;
          }
          if (old.decryptOk && !now.decryptOk && now.idbPresent) {
            firstDiff = { key: now.key, kind: "decrypt_failed", fromPhase: prev.phase, toPhase: payload.phase };
            break;
          }
          if (now.plainStaging) {
            firstDiff = firstDiff || {
              key: now.key,
              kind: "plain_staging_present",
              fromPhase: prev.phase,
              toPhase: payload.phase,
            };
          }
          if (old.idbFp && now.memPresent && now.memFp && old.idbFp !== now.memFp) {
            firstDiff = {
              key: now.key,
              kind: "mem_diverged_from_prior_idb",
              fromPhase: prev.phase,
              toPhase: payload.phase,
              priorIdbFp: old.idbFp,
              memFp: now.memFp,
            };
            break;
          }
        }
      }
    }
  } catch (_) {}
  payload.firstDiff = firstDiff;

  try {
    sessionStorage.setItem("iu:vault:sec-off-reload-trace:v1", JSON.stringify(payload));
  } catch (_) {}

  return payload;
}

/**
 * Mobile/tablet/PWA lifecycle SAVE→RELOAD→REOPEN trace — metadata + fingerprints only.
 * Distinguishes durability miss vs record loss vs key-path vs decrypt vs hydration vs SW skew.
 */
export async function captureLifecycleSaveReopenTrace(phase) {
  const keys = [
    "iu.infoEvents.prefs.v1",
    "iu.notes.store.v1",
    "iu.tasks.mvp.v1",
    "iu.calendar.store.v1",
  ];
  const { getVaultState, readSecurityConfiguredState, getMdk } = await import("./iu-vault-lock-v1.js");
  const {
    nativeLocalStorageGet,
    captureNativeLocalStorage,
    getPendingVaultWriteCount,
    isPlaintextStagingPresent,
    getMemoryCachePlaintext,
  } = await import("./iu-vault-storage-v1.js");
  const { readRecord, readKeyRecord, readMeta } = await import("./iu-vault-db-v1.js");
  const { decryptString, encryptString } = await import("./iu-vault-core-v1.js");

  captureNativeLocalStorage();
  const st = getVaultState();
  let configured = { unlockMethod: "unknown" };
  try {
    configured = await readSecurityConfiguredState();
  } catch (_) {}
  let meta = null;
  try {
    meta = await readMeta();
  } catch (_) {}

  async function fp8(text) {
    try {
      const data = new TextEncoder().encode(String(text || ""));
      const dig = await crypto.subtle.digest("SHA-256", data);
      const hex = Array.from(new Uint8Array(dig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return hex.slice(0, 8);
    } catch (_) {
      return null;
    }
  }

  function uaFamily() {
    try {
      const ua = String(navigator.userAgent || "");
      if (/Firefox\//i.test(ua)) return "gecko";
      if (/AppleWebKit/i.test(ua) && /Safari/i.test(ua) && !/Chrome|CriOS|Edg|OPR|Brave/i.test(ua)) return "webkit";
      if (/Chrome|CriOS|Edg|OPR|Brave|SamsungBrowser/i.test(ua)) return "chromium";
      return "other";
    } catch (_) {
      return "unknown";
    }
  }

  let keyRecordPresent = false;
  let cryptoKeyUsable = false;
  let durableMaterialPresent = false;
  let durableMaterialUsable = false;
  let legacyBackupPresent = false;
  try {
    const keyRec = await readKeyRecord("mdk:level1");
    keyRecordPresent = !!(keyRec && keyRec.mdk);
    if (keyRec && keyRec.mdk) {
      try {
        const probe = await encryptString(keyRec.mdk, "iu.diag.probe.v1", "ok");
        const pt = await decryptString(keyRec.mdk, "iu.diag.probe.v1", probe);
        cryptoKeyUsable = pt === "ok";
      } catch (_) {
        cryptoKeyUsable = false;
      }
    }
  } catch (_) {}
  try {
    const { readLevel1DurableMaterialBytes } = await import("./iu-vault-lock-v1.js");
    const raw = await readLevel1DurableMaterialBytes();
    durableMaterialPresent = !!(raw && raw.byteLength >= 16);
    if (durableMaterialPresent) {
      try {
        const { importMdkRaw } = await import("./iu-vault-core-v1.js");
        const mdk = await importMdkRaw(raw);
        const probe = await encryptString(mdk, "iu.diag.mat.v1", "ok");
        const pt = await decryptString(mdk, "iu.diag.mat.v1", probe);
        durableMaterialUsable = pt === "ok";
      } catch (_) {
        durableMaterialUsable = false;
      }
    }
  } catch (_) {}
  try {
    legacyBackupPresent = !!nativeLocalStorageGet("iu:vault:mdk-level1-backup:v1");
  } catch (_) {}

  let storagePersisted = null;
  let storagePersistSupported = false;
  try {
    storagePersistSupported = !!(navigator.storage && typeof navigator.storage.persisted === "function");
    if (storagePersistSupported) storagePersisted = await navigator.storage.persisted();
  } catch (_) {}

  const probes = [];
  for (const key of keys) {
    let idbPresent = false;
    let encFp = null;
    let encLen = null;
    let decryptOk = false;
    let idbFp = null;
    let idbLen = null;
    let independentReadbackSame = null;
    try {
      const env = await readRecord(key);
      idbPresent = !!(env && env.ct);
      if (idbPresent) {
        encLen = String(env.ct || "").length;
        encFp = await fp8(String(env.v || "") + ":" + String(env.ct || "").slice(0, 64));
        if (st.unlocked) {
          try {
            const mdk = getMdk();
            const pt = await decryptString(mdk, key, env);
            decryptOk = true;
            idbLen = String(pt || "").length;
            idbFp = await fp8(pt);
            // Independent second read of same record — durability/readback proof.
            const env2 = await readRecord(key);
            if (env2 && env2.ct) {
              const pt2 = await decryptString(mdk, key, env2);
              independentReadbackSame = (await fp8(pt2)) === idbFp;
            } else {
              independentReadbackSame = false;
            }
          } catch (_) {
            decryptOk = false;
          }
        }
      }
    } catch (_) {}

    let memFp = null;
    let memLen = null;
    let memPresent = false;
    try {
      const mem = getMemoryCachePlaintext(key);
      if (mem != null) {
        memPresent = true;
        memLen = String(mem).length;
        memFp = await fp8(mem);
      }
    } catch (_) {}

    let shimPresent = false;
    let shimFp = null;
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) {
        shimPresent = true;
        shimFp = await fp8(raw);
      }
    } catch (_) {}

    probes.push({
      key: safeToken(key, 64),
      keyType: classifyKey(key),
      idbPresent,
      encFp,
      encLen,
      decryptOk,
      idbFp,
      idbLen,
      independentReadbackSame,
      plainStaging: !!isPlaintextStagingPresent(key),
      nativePlainLen: (() => {
        try {
          const n = nativeLocalStorageGet(key);
          return n == null ? null : String(n).length;
        } catch (_) {
          return null;
        }
      })(),
      memPresent,
      memFp,
      memLen,
      shimPresent,
      shimFp,
      fpMatchIdbMem: !!(idbFp && memFp && idbFp === memFp),
      fpMatchIdbShim: !!(idbFp && shimFp && idbFp === shimFp),
    });
  }

  let swCacheHint = null;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      const url = String(navigator.serviceWorker.controller.scriptURL || "");
      swCacheHint = safeToken(url, 160);
    }
  } catch (_) {}

  const payload = {
    tag: "LIFECYCLE_SAVE_REOPEN_TRACE_V1",
    phase: safeToken(phase || "unknown", 32),
    capturedAt: Date.now(),
    origin: (() => {
      try {
        return safeToken(location.origin || "", 120);
      } catch (_) {
        return null;
      }
    })(),
    pathname: (() => {
      try {
        return safeToken(location.pathname || "", 80);
      } catch (_) {
        return null;
      }
    })(),
    searchFlags: (() => {
      try {
        const p = new URLSearchParams(location.search || "");
        return {
          iuLifecycleDiag: p.get("iuLifecycleDiag") === "1",
          nosw: p.get("nosw") === "1",
        };
      } catch (_) {
        return null;
      }
    })(),
    securityMethod: configured.unlockMethod || "unknown",
    securityLevel: meta && meta.securityLevel != null ? meta.securityLevel : null,
    l1IdbOnly: !!(meta && meta.l1IdbOnly),
    unlocked: !!st.unlocked,
    requiresUserReauth: !!st.requiresUserReauth,
    hydrationPending: !!window.__iuVaultHydrationPending,
    hydrationComplete: !!window.__iuVaultHydrationComplete,
    pendingWriteCount: getPendingVaultWriteCount(),
    platform: detectPlatform(),
    displayMode: detectDisplayMode(),
    uaFamily: uaFamily(),
    bundleHint: detectBundleHint(),
    bundleHintSource: "meta[name=iu-build]|projects/version.json (product stamp; not SW CACHE_VERSION)",
    serviceWorker: serviceWorkerMeta(),
    swCacheHint,
    storagePersistSupported,
    storagePersisted,
    keyRecordPresent,
    cryptoKeyUsable,
    durableMaterialPresent,
    durableMaterialUsable,
    legacyBackupPresent,
    storageRecoveryRequired: !!(st && st.storageRecoveryRequired),
    storageRecoveryReason: st && st.storageRecoveryReason ? safeToken(st.storageRecoveryReason, 64) : null,
    storageRecoveryKeyPath: st && st.storageRecoveryKeyPath ? st.storageRecoveryKeyPath : null,
    probes,
    prefsUi: await (async () => {
      try {
        const diag = window.__iuPrehledPrefsDiag;
        if (!diag || typeof diag.getStatePrefs !== "function" || typeof diag.getLivePrefs !== "function") {
          return { present: false };
        }
        const stateP = diag.getStatePrefs();
        const liveP = diag.getLivePrefs();
        function structCanon(p) {
          if (!p || typeof p !== "object") return "";
          return JSON.stringify({
            sections: Array.isArray(p.sections) ? p.sections.slice().sort() : [],
            sourceGroups: Array.isArray(p.sourceGroups) ? p.sourceGroups.slice().sort() : [],
            lanesLen: Array.isArray(p.lanes) ? p.lanes.length : 0,
            localitiesLen: Array.isArray(p.localities) ? p.localities.length : 0,
            homeKrajLen: String(p.homeKraj || "").length,
            homeOkresLen: String(p.homeOkres || "").length,
            homeObecLen: String(p.homeObec || "").length,
            roadsLen: p.feedFilter && Array.isArray(p.feedFilter.roads) ? p.feedFilter.roads.length : 0,
            orpLen:
              p.feedFilter && p.feedFilter.chmi && Array.isArray(p.feedFilter.chmi.orpCodes)
                ? p.feedFilter.chmi.orpCodes.length
                : 0,
            unreadOnly: !!p.unreadOnly,
            savedOnly: !!p.savedOnly,
            favoritesOnly: !!p.favoritesOnly,
            searchQueryLen: String(p.searchQuery || "").length,
          });
        }
        const stateFp = await fp8(structCanon(stateP));
        const liveFp = await fp8(structCanon(liveP));
        const prefsProbe = probes.find((p) => p && p.key === "iu.infoEvents.prefs.v1") || null;
        // Compare apples-to-apples: structCanon(live) vs structCanon(parsed mem).
        // Raw memFp (full JSON SHA) is incompatible with structCanon fps.
        let memStructFp = null;
        try {
          const memRaw = getMemoryCachePlaintext("iu.infoEvents.prefs.v1");
          if (memRaw != null) {
            memStructFp = await fp8(structCanon(JSON.parse(String(memRaw) || "{}")));
          }
        } catch (_) {
          memStructFp = null;
        }
        return {
          present: true,
          stateFp,
          liveFp,
          memFp: prefsProbe ? prefsProbe.memFp : null,
          memStructFp,
          idbFp: prefsProbe ? prefsProbe.idbFp : null,
          stateMatchesLive: !!(stateFp && liveFp && stateFp === liveFp),
          liveMatchesMem: !!(liveFp && memStructFp && liveFp === memStructFp),
          appliedReason: window.__iuPrehledPrefsAppliedReason || null,
          appliedAt: window.__iuPrehledPrefsAppliedAt || null,
        };
      } catch (_) {
        return { present: false };
      }
    })(),
    moduleSaveTrace: (() => {
      try {
        const arr = window.__iuModuleSaveTrace;
        return Array.isArray(arr) ? arr.slice(-24) : [];
      } catch (_) {
        return [];
      }
    })(),
  };

  let firstDiff = null;
  try {
    const prevRaw = sessionStorage.getItem("iu:vault:lifecycle-save-reopen-trace:v1");
    if (prevRaw) {
      const prev = JSON.parse(prevRaw);
      if (prev && Array.isArray(prev.probes)) {
        if (prev.origin && payload.origin && prev.origin !== payload.origin) {
          firstDiff = {
            kind: "origin_changed",
            fromPhase: prev.phase,
            toPhase: payload.phase,
            fromOrigin: prev.origin,
            toOrigin: payload.origin,
          };
        }
        if (!firstDiff && prev.displayMode && payload.displayMode && prev.displayMode !== payload.displayMode) {
          firstDiff = {
            kind: "display_mode_changed",
            fromPhase: prev.phase,
            toPhase: payload.phase,
            from: prev.displayMode,
            to: payload.displayMode,
          };
        }
        for (const now of probes) {
          if (firstDiff) break;
          const old = prev.probes.find((p) => p && p.key === now.key);
          if (!old) continue;
          if (old.idbPresent && old.independentReadbackSame === false) {
            firstDiff = {
              key: now.key,
              kind: "prior_save_readback_failed",
              fromPhase: prev.phase,
              toPhase: payload.phase,
            };
            break;
          }
          if (old.idbPresent && !now.idbPresent) {
            firstDiff = { key: now.key, kind: "idb_lost", fromPhase: prev.phase, toPhase: payload.phase };
            break;
          }
          if (old.encFp && now.encFp && old.encFp !== now.encFp) {
            firstDiff = {
              key: now.key,
              kind: "enc_fp_changed",
              fromPhase: prev.phase,
              toPhase: payload.phase,
              fromFp: old.encFp,
              toFp: now.encFp,
            };
            break;
          }
          if (old.idbFp && now.idbFp && old.idbFp !== now.idbFp) {
            firstDiff = {
              key: now.key,
              kind: "idb_fp_changed",
              fromPhase: prev.phase,
              toPhase: payload.phase,
              fromFp: old.idbFp,
              toFp: now.idbFp,
            };
            break;
          }
          if (old.decryptOk && !now.decryptOk && now.idbPresent) {
            firstDiff = { key: now.key, kind: "decrypt_failed", fromPhase: prev.phase, toPhase: payload.phase };
            break;
          }
          if (old.idbFp && now.memPresent && now.memFp && old.idbFp !== now.memFp) {
            firstDiff = {
              key: now.key,
              kind: "mem_diverged_from_prior_idb",
              fromPhase: prev.phase,
              toPhase: payload.phase,
              priorIdbFp: old.idbFp,
              memFp: now.memFp,
            };
            break;
          }
          if (now.plainStaging) {
            firstDiff = {
              key: now.key,
              kind: "plain_staging_present",
              fromPhase: prev.phase,
              toPhase: payload.phase,
            };
            break;
          }
        }
        if (!firstDiff && prev.keyRecordPresent && !payload.keyRecordPresent) {
          firstDiff = { kind: "key_record_lost", fromPhase: prev.phase, toPhase: payload.phase };
        }
        if (!firstDiff && prev.cryptoKeyUsable && !payload.cryptoKeyUsable) {
          firstDiff = { kind: "crypto_key_unusable", fromPhase: prev.phase, toPhase: payload.phase };
        }
      }
    }
  } catch (_) {}
  payload.firstDiff = firstDiff;

  try {
    sessionStorage.setItem("iu:vault:lifecycle-save-reopen-trace:v1", JSON.stringify(payload));
  } catch (_) {}

  return payload;
}

const CANARY_KEYS = Object.freeze({
  weatherGps: "iuWeatherGpsSelectedV1",
  weatherMode: "iu_location_mode",
  weatherManual: "iu_manual_location",
  prefs: "iu.infoEvents.prefs.v1",
  notes: "iu.notes.store.v1",
});

/**
 * Multi-canary boot divergence trace (weather UI pref + filters + personal note).
 * Metadata / fingerprints only — no plaintext bodies, no secrets.
 */
export async function captureMultiCanaryBootTrace(phase) {
  const { getVaultState, readSecurityConfiguredState } = await import("./iu-vault-lock-v1.js");
  const {
    nativeLocalStorageGet,
    captureNativeLocalStorage,
    getPendingVaultWriteCount,
    getMemoryCachePlaintext,
    isVaultPersistBlocked,
  } = await import("./iu-vault-storage-v1.js");
  const { isProtectedStorageKey } = await import("./iu-vault-protected-keys-v1.js");
  const { readRecord, readMeta } = await import("./iu-vault-db-v1.js");
  const { decryptString } = await import("./iu-vault-core-v1.js");
  const { getMdk } = await import("./iu-vault-lock-v1.js");

  captureNativeLocalStorage();
  const st = getVaultState();
  let configured = { unlockMethod: "unknown" };
  try {
    configured = await readSecurityConfiguredState();
  } catch (_) {}
  let meta = null;
  try {
    meta = await readMeta();
  } catch (_) {}

  async function fp8(text) {
    try {
      const data = new TextEncoder().encode(String(text || ""));
      const dig = await crypto.subtle.digest("SHA-256", data);
      const hex = Array.from(new Uint8Array(dig))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return hex.slice(0, 8);
    } catch (_) {
      return null;
    }
  }

  const canaries = {};
  for (const [name, key] of Object.entries(CANARY_KEYS)) {
    const protectedKey = isProtectedStorageKey(key);
    let shimGet = null;
    try {
      shimGet = localStorage.getItem(key);
    } catch (_) {}
    const mem = getMemoryCachePlaintext(key);
    let idbPresent = false;
    let idbFp = null;
    let decryptOk = false;
    let decryptFp = null;
    try {
      const env = await readRecord(key);
      idbPresent = !!(env && env.ct);
      if (idbPresent) idbFp = await fp8(JSON.stringify(env));
      const mdk = getMdk();
      if (mdk && env && env.ct) {
        try {
          const pt = await decryptString(mdk, key, env);
          decryptOk = pt != null;
          decryptFp = pt != null ? await fp8(pt) : null;
        } catch (_) {
          decryptOk = false;
        }
      }
    } catch (_) {}
    let nativePlain = null;
    try {
      nativePlain = nativeLocalStorageGet(key);
    } catch (_) {}
    canaries[name] = {
      key,
      storageFamily: protectedKey ? "vault_protected_idb" : "native_ls",
      protectedKey,
      shimGetPresent: shimGet != null && String(shimGet).length > 0,
      shimGetFp: shimGet != null ? await fp8(shimGet) : null,
      memPresent: mem != null && String(mem).length > 0,
      memFp: mem != null ? await fp8(mem) : null,
      idbPresent,
      idbFp,
      decryptOk,
      decryptFp,
      nativePlainPresent: nativePlain != null && String(nativePlain).length > 0,
      persistBlocked: !!isVaultPersistBlocked(key),
    };
  }

  let weatherUiPhase = null;
  let weatherOverlayVisible = null;
  let weatherHasPersonalized = null;
  try {
    const card = document.querySelector("[data-iu-silver-wx-phase], #iuSilverWeatherCard, .iuSilverWeatherCard");
    weatherUiPhase = card ? String(card.getAttribute("data-iu-silver-wx-phase") || "") || null : null;
  } catch (_) {}
  try {
    const ov = document.getElementById("iuSilverWeatherGeoOverlay");
    weatherOverlayVisible = !!(ov && !ov.hidden && ov.getAttribute("aria-hidden") !== "true");
  } catch (_) {}
  try {
    weatherHasPersonalized = !!(
      (canaries.weatherGps && canaries.weatherGps.shimGetPresent) ||
      (canaries.weatherManual && canaries.weatherManual.shimGetPresent)
    );
  } catch (_) {}

  let swCache = null;
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      swCache = "controller_present";
    } else {
      swCache = "no_controller";
    }
  } catch (_) {
    swCache = "unknown";
  }

  let displayMode = "browser";
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) displayMode = "standalone";
    else if (window.navigator.standalone) displayMode = "ios_standalone";
  } catch (_) {}

  const payload = {
    tag: "MULTI_CANARY_BOOT_TRACE_V1",
    phase: String(phase || ""),
    capturedAt: Date.now(),
    origin: String(location.origin || ""),
    pathname: String(location.pathname || ""),
    displayMode,
    swCache,
    hydrationPending: !!window.__iuVaultHydrationPending,
    hydrationComplete: !!window.__iuVaultHydrationComplete,
    keyPathDurableReady: !!window.__iuVaultKeyPathDurableReady,
    unlocked: !!(st && st.unlocked),
    unlockMethod: configured.unlockMethod,
    securityLevel: meta && meta.securityLevel,
    pendingWrites: getPendingVaultWriteCount(),
    canaries,
    weatherUi: {
      phaseAttr: weatherUiPhase,
      overlayVisible: weatherOverlayVisible,
      hasPersonalizedFromShim: weatherHasPersonalized,
      wouldShowFirstVisitDialog: weatherHasPersonalized === false,
    },
  };

  try {
    const prevRaw = sessionStorage.getItem("iu:vault:multi-canary-boot-trace:v1");
    if (prevRaw) {
      const prev = JSON.parse(prevRaw);
      payload.priorPhase = prev && prev.phase ? prev.phase : null;
      payload.priorCanaries = prev && prev.canaries ? prev.canaries : null;
      let firstDiff = null;
      if (prev && prev.canaries) {
        for (const name of Object.keys(CANARY_KEYS)) {
          const a = prev.canaries[name];
          const b = payload.canaries[name];
          if (!a || !b) continue;
          if (a.idbPresent && !b.idbPresent) {
            firstDiff = { canary: name, kind: "idb_lost", fromPhase: prev.phase, toPhase: payload.phase };
            break;
          }
          if (a.decryptFp && b.decryptOk && a.decryptFp !== b.decryptFp) {
            firstDiff = {
              canary: name,
              kind: "decrypt_fp_changed",
              fromPhase: prev.phase,
              toPhase: payload.phase,
              fromFp: a.decryptFp,
              toFp: b.decryptFp,
            };
            break;
          }
          if (a.idbPresent && a.decryptFp && !b.shimGetPresent && payload.hydrationComplete) {
            firstDiff = {
              canary: name,
              kind: "idb_ok_but_shim_missing_after_hydrate",
              fromPhase: prev.phase,
              toPhase: payload.phase,
            };
            break;
          }
          if (a.shimGetPresent && !b.shimGetPresent) {
            firstDiff = { canary: name, kind: "shim_lost", fromPhase: prev.phase, toPhase: payload.phase };
            break;
          }
        }
      }
      if (
        !firstDiff &&
        prev.weatherUi &&
        prev.weatherUi.wouldShowFirstVisitDialog === false &&
        payload.weatherUi &&
        payload.weatherUi.wouldShowFirstVisitDialog === true
      ) {
        firstDiff = {
          canary: "weatherGps",
          kind: "ui_first_visit_regressed",
          fromPhase: prev.phase,
          toPhase: payload.phase,
        };
      }
      payload.firstDiff = firstDiff;
    }
  } catch (_) {}

  try {
    sessionStorage.setItem("iu:vault:multi-canary-boot-trace:v1", JSON.stringify(payload));
  } catch (_) {}

  return payload;
}
