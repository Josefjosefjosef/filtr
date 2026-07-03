/**
 * infoUzel.cz — globální ochrana lokálních dat uživatele (local-first, jednorázový dialog).
 * Centrální služba pro celou aplikaci — jediný informační dialog při prvním ukládání.
 */

const KEY_NOTICE_ACCEPTED = "iu:local-data-protection:notice-accepted:v1";
const KEY_NOTICE_ACCEPTED_AT = "iu:local-data-protection:notice-accepted-at:v1";
const KEY_PERSISTENT_GRANTED = "iu:local-data-protection:persistent-granted:v1";
const KEY_PERSISTENT_PROMPT_AT = "iu:local-data-protection:persistent-prompt-at:v1";
const KEY_PWA_REC_SHOWN = "iu:local-data-protection:pwa-rec-shown:v1";
const KEY_STORAGE_WARN_AT = "iu:local-data-protection:storage-warn-at:v1";
/** Migrace starého souhlasu nástrojů */
const LEGACY_TOOL_CONSENT_KEY = "iu:tool-local-storage-consent:v1";

const STORAGE_USAGE_WARN_RATIO = 0.85;

const DIALOG_PROMISE_KEY = "__iuLdpDialogPromise";
const INFO_READONLY_PROMISE_KEY = "__iuLdpInfoDialogPromise";

/** Odstraní všechny LDP backdrop vrstvy a body lock — jediný teardown bod. */
function purgeLdpBackdrops() {
  try {
    document.querySelectorAll(".iu-ldp-backdrop").forEach((el) => {
      try {
        el.setAttribute("data-iu-ldp-closing", "1");
        el.style.pointerEvents = "none";
        el.remove();
      } catch (_) {}
    });
  } catch (_) {}
  try {
    document.documentElement.classList.remove("iu-ldp-dialog-open");
    document.body.classList.remove("iu-ldp-dialog-open");
  } catch (_) {}
}

function setLdpDialogOpen(open) {
  try {
    document.documentElement.classList.toggle("iu-ldp-dialog-open", !!open);
    document.body.classList.toggle("iu-ldp-dialog-open", !!open);
  } catch (_) {}
}

function teardownLdpBackdrop(backdrop) {
  try {
    if (backdrop) {
      backdrop.setAttribute("data-iu-ldp-closing", "1");
      backdrop.style.pointerEvents = "none";
      backdrop.remove();
    }
  } catch (_) {}
  purgeLdpBackdrops();
}

function getInfoDialogPromise() {
  if (typeof window === "undefined") return null;
  return window[INFO_READONLY_PROMISE_KEY] || null;
}

function setInfoDialogPromise(value) {
  if (typeof window === "undefined") return;
  if (value == null) {
    try {
      delete window[INFO_READONLY_PROMISE_KEY];
    } catch (_) {
      window[INFO_READONLY_PROMISE_KEY] = null;
    }
  } else {
    window[INFO_READONLY_PROMISE_KEY] = value;
  }
}

function getDialogPromise() {
  if (typeof window === "undefined") return null;
  return window[DIALOG_PROMISE_KEY] || null;
}

function setDialogPromise(value) {
  if (typeof window === "undefined") return;
  if (value == null) {
    try {
      delete window[DIALOG_PROMISE_KEY];
    } catch (_) {
      window[DIALOG_PROMISE_KEY] = null;
    }
  } else {
    window[DIALOG_PROMISE_KEY] = value;
  }
}

let stylesInjected = false;

const DIALOG_BODY =
  "InfoUzel ukládá vaše údaje pouze do tohoto zařízení.\n\n" +
  "Vaše data nejsou automaticky odesílána na server ani do cloudu.\n\n" +
  "Pro lepší ochranu může InfoUzel požádat tento prohlížeč o zapnutí bezpečnějšího trvalého úložiště.\n\n" +
  "To pomáhá chránit data před automatickým smazáním prohlížečem například při nedostatku místa.\n\n" +
  "Ani tato ochrana ale nezabrání ztrátě dat při ručním smazání dat webu, vymazání dat prohlížeče nebo odinstalování aplikace.\n\n" +
  "Důležité dokumenty proto doporučujeme pravidelně exportovat nebo stáhnout.\n\n" +
  "Tato informace se zobrazí pouze jednou.\n\n" +
  "Po jejím potvrzení bude stejný způsob ukládání používán ve všech částech InfoUzlu.";

function readFlag(key) {
  try {
    const v = localStorage.getItem(key);
    if (v != null && v !== "") return v;
  } catch (_) {}
  try {
    const v = sessionStorage.getItem(key);
    if (v != null && v !== "") return v;
  } catch (_) {}
  return null;
}

function writeFlag(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (_) {}
  try {
    sessionStorage.setItem(key, value);
  } catch (_) {}
}

function migrateLegacyConsent() {
  if (readFlag(KEY_NOTICE_ACCEPTED) === "1") return;
  const legacy = readFlag(LEGACY_TOOL_CONSENT_KEY);
  if (legacy === "granted") {
    writeFlag(KEY_NOTICE_ACCEPTED, "1");
    if (!readFlag(KEY_NOTICE_ACCEPTED_AT)) {
      writeFlag(KEY_NOTICE_ACCEPTED_AT, String(Date.now()));
    }
  }
}

export function isLocalDataProtectionNoticeAccepted() {
  migrateLegacyConsent();
  return readFlag(KEY_NOTICE_ACCEPTED) === "1";
}

/** @deprecated alias pro zpětnou kompatibilitu */
export function isLocalStorageConsentGranted() {
  return isLocalDataProtectionNoticeAccepted();
}

export function hasLocalStorageConsentDecision() {
  migrateLegacyConsent();
  if (isLocalDataProtectionNoticeAccepted()) return true;
  return readFlag(LEGACY_TOOL_CONSENT_KEY) === "denied";
}

export function canUseLocalStorage() {
  return isLocalDataProtectionNoticeAccepted();
}

function markNoticeAccepted() {
  writeFlag(KEY_NOTICE_ACCEPTED, "1");
  if (!readFlag(KEY_NOTICE_ACCEPTED_AT)) {
    writeFlag(KEY_NOTICE_ACCEPTED_AT, String(Date.now()));
  }
  try {
    writeFlag(LEGACY_TOOL_CONSENT_KEY, "granted");
  } catch (_) {}
}

function injectDialogStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const css =
    ".iu-ldp-backdrop{position:fixed;inset:0;z-index:10200;background:rgba(15,23,42,.56);display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));box-sizing:border-box}" +
    ".iu-ldp-backdrop[data-iu-ldp-closing],.iu-ldp-backdrop:not(:has(.iu-ldp-dialog)){display:none!important;pointer-events:none!important;visibility:hidden!important}" +
    ".iu-ldp-dialog{width:min(540px,100%);max-height:min(90vh,780px);display:flex;flex-direction:column;background:#fff;border-radius:18px;box-shadow:0 28px 56px rgba(0,0,0,.24);border:1px solid rgba(15,23,42,.1);overflow:hidden}" +
    ".iu-ldp-dialog__head{padding:20px 22px 0;flex-shrink:0}" +
    ".iu-ldp-dialog__title{margin:0;font-size:17px;font-weight:750;line-height:1.35;color:#0f172a}" +
    ".iu-ldp-dialog__body{padding:14px 22px 8px;font-size:14px;line-height:1.58;color:#334155;white-space:pre-wrap;overflow:auto;flex:1 1 auto;-webkit-overflow-scrolling:touch}" +
    ".iu-ldp-dialog__actions{display:flex;flex-direction:column;gap:8px;padding:14px 18px 18px;border-top:1px solid rgba(15,23,42,.08);flex-shrink:0}" +
    ".iu-ldp-btn{width:100%;padding:12px 16px;font-size:14px;font-family:inherit;border-radius:12px;border:1px solid rgba(15,23,42,.14);cursor:pointer;background:#f8fafc;color:#0f172a;text-align:center;line-height:1.35}" +
    ".iu-ldp-btn--primary{background:#16964E;border-color:#16964E;color:#fff;font-weight:650}" +
    ".iu-ldp-btn--secondary{background:#fff;border-color:rgba(15,23,42,.18);color:#0f172a}" +
    ".iu-ldp-btn--ghost{background:transparent;border-color:transparent;color:#64748b;font-size:13px}" +
    "@media(min-width:520px){.iu-ldp-dialog__actions{flex-direction:row;flex-wrap:wrap;justify-content:flex-end}.iu-ldp-btn{width:auto;min-width:140px;flex:0 1 auto}}";
  const el = document.createElement("style");
  el.setAttribute("data-iu-local-data-protection", "1");
  el.textContent = css;
  document.head.appendChild(el);
}

function showFirstSaveDialog() {
  injectDialogStyles();
  purgeLdpBackdrops();
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "iu-ldp-backdrop";
    backdrop.setAttribute("role", "presentation");
    backdrop.setAttribute("data-iu-ldp-active", "1");
    setLdpDialogOpen(true);

    const dialog = document.createElement("div");
    dialog.className = "iu-ldp-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "iuLdpDialogTitle");

    const head = document.createElement("div");
    head.className = "iu-ldp-dialog__head";
    const title = document.createElement("h2");
    title.id = "iuLdpDialogTitle";
    title.className = "iu-ldp-dialog__title";
    title.textContent = "Bezpečné ukládání vašich dat";
    head.appendChild(title);

    const body = document.createElement("div");
    body.className = "iu-ldp-dialog__body";
    body.textContent = DIALOG_BODY;

    const actions = document.createElement("div");
    actions.className = "iu-ldp-dialog__actions";

    const btnPersist = document.createElement("button");
    btnPersist.type = "button";
    btnPersist.className = "iu-ldp-btn iu-ldp-btn--primary";
    btnPersist.textContent = "Povolit bezpečnější ukládání a uložit";

    const btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.className = "iu-ldp-btn iu-ldp-btn--secondary";
    btnSave.textContent = "Uložit bez toho";

    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.className = "iu-ldp-btn iu-ldp-btn--ghost";
    btnCancel.textContent = "Zrušit";

    function cleanup(result) {
      teardownLdpBackdrop(backdrop);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    }

    btnPersist.addEventListener("click", () => cleanup({ action: "persist-and-save" }));
    btnSave.addEventListener("click", () => cleanup({ action: "save-only" }));
    btnCancel.addEventListener("click", () => cleanup({ action: "cancel" }));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cleanup({ action: "cancel" });
    });

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup({ action: "cancel" });
      }
    }
    document.addEventListener("keydown", onKey);

    actions.appendChild(btnPersist);
    actions.appendChild(btnSave);
    actions.appendChild(btnCancel);
    dialog.appendChild(head);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    try {
      btnPersist.focus();
    } catch (_) {}
  });
}

export function isPersistentStorageSupported() {
  try {
    return !!(navigator.storage && typeof navigator.storage.persist === "function");
  } catch (_) {
    return false;
  }
}

export async function isPersistentStorageActive() {
  try {
    if (navigator.storage && typeof navigator.storage.persisted === "function") {
      return !!(await navigator.storage.persisted());
    }
  } catch (_) {}
  return readFlag(KEY_PERSISTENT_GRANTED) === "1";
}

export async function requestPersistentStorage() {
  writeFlag(KEY_PERSISTENT_PROMPT_AT, String(Date.now()));
  if (!isPersistentStorageSupported()) {
    writeFlag(KEY_PERSISTENT_GRANTED, "0");
    return false;
  }
  try {
    const ok = await navigator.storage.persist();
    writeFlag(KEY_PERSISTENT_GRANTED, ok ? "1" : "0");
    return !!ok;
  } catch (_) {
    writeFlag(KEY_PERSISTENT_GRANTED, "0");
    return false;
  }
}

export async function getStorageEstimate() {
  try {
    if (navigator.storage && typeof navigator.storage.estimate === "function") {
      const est = await navigator.storage.estimate();
      return {
        usage: typeof est.usage === "number" ? est.usage : null,
        quota: typeof est.quota === "number" ? est.quota : null,
      };
    }
  } catch (_) {}
  return { usage: null, quota: null };
}

export function formatBytes(n) {
  if (n == null || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}

export async function maybeWarnStorageCapacity() {
  if (!isLocalDataProtectionNoticeAccepted()) return;
  const est = await getStorageEstimate();
  if (est.usage == null || est.quota == null || est.quota <= 0) return;
  const ratio = est.usage / est.quota;
  if (ratio < STORAGE_USAGE_WARN_RATIO) return;
  const last = parseInt(readFlag(KEY_STORAGE_WARN_AT) || "0", 10);
  const dayMs = 86400000;
  if (Date.now() - last < dayMs) return;
  writeFlag(KEY_STORAGE_WARN_AT, String(Date.now()));
  try {
    if (typeof window.iuToast === "function") {
      window.iuToast(
        "Místo v prohlížeči se plní (" +
          Math.round(ratio * 100) +
          " %). Důležitá data pravidelně exportujte nebo stáhněte.",
        { kind: "warn", duration: 8000 }
      );
    }
  } catch (_) {}
}

export function isPwaStandalone() {
  try {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.navigator && window.navigator.standalone === true) return true;
  } catch (_) {}
  return false;
}

export function maybeRecommendPwa() {
  if (isPwaStandalone()) return;
  if (readFlag(KEY_PWA_REC_SHOWN) === "1") return;
  if (!isLocalDataProtectionNoticeAccepted()) return;
  writeFlag(KEY_PWA_REC_SHOWN, "1");
  try {
    if (typeof window.iuInfoCenterOpenSection === "function") {
      if (typeof window.iuToast === "function") {
        window.iuToast("Tip: ikona InfoUzel na ploše usnadní přístup. Otevřete iCentrum › PWA.", {
          kind: "info",
          duration: 9000,
        });
      }
    }
  } catch (_) {}
}

export function getLocalDataProtectionStatus() {
  migrateLegacyConsent();
  return {
    noticeAccepted: isLocalDataProtectionNoticeAccepted(),
    noticeAcceptedAt: readFlag(KEY_NOTICE_ACCEPTED_AT),
    persistentGrantedFlag: readFlag(KEY_PERSISTENT_GRANTED),
    persistentPromptAt: readFlag(KEY_PERSISTENT_PROMPT_AT),
    pwaRecommendationShown: readFlag(KEY_PWA_REC_SHOWN) === "1",
  };
}

export function showLocalDataProtectionInfoReadOnly() {
  injectDialogStyles();
  const existing = getInfoDialogPromise();
  if (existing) return existing;

  const pending = new Promise((resolve) => {
    purgeLdpBackdrops();
    const backdrop = document.createElement("div");
    backdrop.className = "iu-ldp-backdrop";
    backdrop.setAttribute("role", "presentation");
    backdrop.setAttribute("data-iu-ldp-active", "1");
    setLdpDialogOpen(true);

    const dialog = document.createElement("div");
    dialog.className = "iu-ldp-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "iuLdpInfoTitle");

    const head = document.createElement("div");
    head.className = "iu-ldp-dialog__head";
    const title = document.createElement("h2");
    title.id = "iuLdpInfoTitle";
    title.className = "iu-ldp-dialog__title";
    title.textContent = "Bezpečné ukládání vašich dat";
    head.appendChild(title);

    const body = document.createElement("div");
    body.className = "iu-ldp-dialog__body";
    body.textContent = DIALOG_BODY;

    const actions = document.createElement("div");
    actions.className = "iu-ldp-dialog__actions";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "iu-ldp-btn iu-ldp-btn--secondary";
    closeBtn.textContent = "Zavřít";

    function cleanup() {
      teardownLdpBackdrop(backdrop);
      document.removeEventListener("keydown", onKey);
      resolve();
    }

    closeBtn.addEventListener("click", cleanup);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) cleanup();
    });
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup();
      }
    }
    document.addEventListener("keydown", onKey);

    actions.appendChild(closeBtn);
    dialog.appendChild(head);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);
    try {
      closeBtn.focus();
    } catch (_) {}
  }).finally(() => {
    setInfoDialogPromise(null);
  });

  setInfoDialogPromise(pending);
  return pending;
}

/**
 * Centrální brána před prvním uložením důležitých dat.
 * @returns {Promise<boolean>} true = pokračovat v ukládání, false = zrušeno
 */
export async function ensureLocalDataProtectionBeforeSave() {
  migrateLegacyConsent();
  if (isLocalDataProtectionNoticeAccepted()) {
    void maybeWarnStorageCapacity();
    return true;
  }
  const existing = getDialogPromise();
  if (existing) return existing;

  const pending = (async () => {
    const result = await showFirstSaveDialog();
    if (!result || result.action === "cancel") return false;
    markNoticeAccepted();
    if (result.action === "persist-and-save") {
      await requestPersistentStorage();
    }
    void maybeRecommendPwa();
    void maybeWarnStorageCapacity();
    try {
      document.dispatchEvent(new CustomEvent("iu:local-data-protection-accepted"));
    } catch (_) {}
    return true;
  })().finally(() => {
    setDialogPromise(null);
  });

  setDialogPromise(pending);
  return pending;
}

/** @deprecated — alias pro starší importy */
export function ensureLocalStorageConsent() {
  return ensureLocalDataProtectionBeforeSave();
}

export async function refreshDeviceStorageStatusPanel(root) {
  if (!root) return;
  const persistEl = root.querySelector("[data-iu-ldp-persist-status]");
  const pwaEl = root.querySelector("[data-iu-ldp-pwa-status]");
  const usageEl = root.querySelector("[data-iu-ldp-usage]");
  const acceptedEl = root.querySelector("[data-iu-ldp-accepted-at]");

  const st = getLocalDataProtectionStatus();
  let persistLabel = "Nepodporováno";
  if (isPersistentStorageSupported()) {
    const active = await isPersistentStorageActive();
    persistLabel = active ? "Aktivní" : "Nepovoleno";
  }

  if (persistEl) persistEl.textContent = persistLabel;
  if (pwaEl) pwaEl.textContent = isPwaStandalone() ? "Ano" : "Ne";

  const est = await getStorageEstimate();
  if (usageEl) {
    if (est.usage != null && est.quota != null) {
      usageEl.textContent = formatBytes(est.usage) + " / " + formatBytes(est.quota);
    } else if (est.usage != null) {
      usageEl.textContent = formatBytes(est.usage);
    } else {
      usageEl.textContent = "—";
    }
  }

  if (acceptedEl) {
    const ts = parseInt(st.noticeAcceptedAt || "0", 10);
    if (ts > 0) {
      try {
        acceptedEl.textContent = new Date(ts).toLocaleString("cs-CZ");
      } catch (_) {
        acceptedEl.textContent = "—";
      }
    } else {
      acceptedEl.textContent = st.noticeAccepted ? "Ano (bez data)" : "—";
    }
  }
}

if (typeof window !== "undefined") {
  try {
    document.addEventListener("iu:local-data-protection-accepted", () => purgeLdpBackdrops());
  } catch (_) {}
  window.iuLocalDataProtection = {
    ensureLocalDataProtectionBeforeSave,
    ensureLocalStorageConsent,
    isLocalDataProtectionNoticeAccepted,
    isLocalStorageConsentGranted,
    canUseLocalStorage,
    showLocalDataProtectionInfoReadOnly,
    purgeLdpBackdrops,
    getLocalDataProtectionStatus,
    refreshDeviceStorageStatusPanel,
    requestPersistentStorage,
    isPersistentStorageActive,
    isPersistentStorageSupported,
    getStorageEstimate,
    formatBytes,
    isPwaStandalone,
  };
}
