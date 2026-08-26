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
  const { readRecord } = await import("./iu-vault-db-v1.js");

  const st = getVaultState();
  let configured = { unlockMethod: "unknown", meta: null };
  try {
    configured = await readSecurityConfiguredState();
  } catch (_) {}

  captureNativeLocalStorage();
  const records = [];
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
