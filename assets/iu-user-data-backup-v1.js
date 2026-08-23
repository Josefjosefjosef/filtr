/**
 * InfoUzel.cz — iCentrum „Správa dat“ UI (export / import).
 */
import {
  LAST_EXPORT_KEY,
  CALENDAR_IDB,
  exportBackupJson,
  readBackupFileText,
  parseAndVerifyBackupText,
  getBackupPreview,
  applyBackupReplaceModeAsync,
  collectAllModules,
  storageSnapshotsEqual,
  formatBackupFilename,
  userMessageForError,
  errorCodeFrom,
} from "./iu-user-data-backup-core.js";
import { vaultSetItem, vaultRemoveItem, preloadAllVaultRecords, notifyVaultMemoryHydrated } from "./iu-vault-storage-v1.js";
import { isProtectedStorageKey } from "./iu-vault-protected-keys-v1.js";

function isVaultActive() {
  try {
    return typeof window.iuVault === "object" && window.iuVault !== null;
  } catch {
    return false;
  }
}

function isVaultUnlocked() {
  if (!isVaultActive()) return true;
  try {
    return !!window.iuVault.getState().unlocked;
  } catch {
    return false;
  }
}

function assertVaultUnlockedForBackup(op) {
  if (!isVaultActive()) return;
  if (!isVaultUnlocked()) {
    throw new Error(op === "export" ? "VAULT_LOCKED_EXPORT" : "VAULT_LOCKED_IMPORT");
  }
}

async function persistBackupEntry(key, value) {
  if (isVaultActive() && isProtectedStorageKey(key)) {
    assertVaultUnlockedForBackup("import");
    await vaultSetItem(key, value);
    return;
  }
  localStorage.setItem(key, value);
}

async function removeBackupEntry(key) {
  if (isVaultActive() && isProtectedStorageKey(key)) {
    assertVaultUnlockedForBackup("import");
    await vaultRemoveItem(key);
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

const backupPersistHooks = {
  persistEntry: persistBackupEntry,
  removeEntry: removeBackupEntry,
};

function createStorageAdapter() {
  return {
    getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      localStorage.setItem(key, value);
    },
    removeItem(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
    keys() {
      const out = [];
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i);
          if (k) out.push(k);
        }
      } catch {
        /* ignore */
      }
      return out;
    },
  };
}

function readAppVersion() {
  try {
    const meta = document.querySelector('meta[name="iu-build"]');
    return (meta && meta.getAttribute("content")) || "";
  } catch {
    return "";
  }
}

function getSubtle() {
  try {
    return crypto && crypto.subtle ? crypto.subtle : undefined;
  } catch {
    return undefined;
  }
}

async function readCalendarIdbMirror() {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(CALENDAR_IDB.dbName, 1);
      req.onupgradeneeded = () => {
        const database = req.result;
        if (!database.objectStoreNames.contains(CALENDAR_IDB.storeName)) {
          database.createObjectStore(CALENDAR_IDB.storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("idb open"));
    });
    const raw = await new Promise((resolve, reject) => {
      const tx = db.transaction(CALENDAR_IDB.storeName, "readonly");
      const rq = tx.objectStore(CALENDAR_IDB.storeName).get(CALENDAR_IDB.recordKey);
      rq.onsuccess = () => resolve(typeof rq.result === "string" ? rq.result : null);
      rq.onerror = () => reject(rq.error);
    });
    try {
      db.close();
    } catch {
      /* ignore */
    }
    return raw;
  } catch {
    return null;
  }
}

async function writeCalendarIdbMirror(value) {
  if (typeof indexedDB === "undefined") return;
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(CALENDAR_IDB.dbName, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(CALENDAR_IDB.storeName)) {
        database.createObjectStore(CALENDAR_IDB.storeName);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("idb open"));
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CALENDAR_IDB.storeName, "readwrite");
    tx.objectStore(CALENDAR_IDB.storeName).put(value, CALENDAR_IDB.recordKey);
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  try {
    db.close();
  } catch {
    /* ignore */
  }
}

function cloneStorageAdapter(base) {
  const map = new Map();
  for (const key of base.keys()) {
    const val = base.getItem(key);
    if (val != null) map.set(key, val);
  }
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
    keys() {
      return Array.from(map.keys());
    },
  };
}

function announce(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
}

function setBusy(btn, busy, busyLabel) {
  if (!btn) return;
  btn.disabled = !!busy;
  if (busy) {
    if (!btn.dataset.iuBackupPrevLabel) btn.dataset.iuBackupPrevLabel = btn.textContent || "";
    btn.textContent = busyLabel || "Probíhá…";
  } else if (btn.dataset.iuBackupPrevLabel) {
    btn.textContent = btn.dataset.iuBackupPrevLabel;
  }
}

function triggerDownload(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
      a.remove();
    } catch {
      /* ignore */
    }
  }, 0);
}

function formatCsDateTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("cs-CZ", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso || "—";
  }
}

function renderPreviewList(container, preview) {
  if (!container) return;
  container.innerHTML = "";
  if (!preview.modules.length) {
    const p = document.createElement("p");
    p.className = "iuInfoCenter__p";
    p.textContent = "Záloha neobsahuje žádná uložená data.";
    container.appendChild(p);
    return;
  }
  const ul = document.createElement("ul");
  ul.className = "iuInfoCenter__ul";
  preview.modules.forEach((m) => {
    const li = document.createElement("li");
    li.textContent = `${m.label}: ${m.count} položek`;
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

function initUserDataBackupUi() {
  const exportBtn = document.getElementById("iuDataMgmtExportBtn");
  const importBtn = document.getElementById("iuDataMgmtImportBtn");
  const fileInput = document.getElementById("iuDataMgmtImportFile");
  const statusLive = document.getElementById("iuDataMgmtStatus");
  const lastExportEl = document.getElementById("iuDataMgmtLastExport");
  const confirmDlg = document.getElementById("iuDataMgmtImportConfirm");
  const confirmSummary = document.getElementById("iuDataMgmtImportSummary");
  const confirmModules = document.getElementById("iuDataMgmtImportModules");
  const confirmApplyBtn = document.getElementById("iuDataMgmtImportApplyBtn");
  const confirmCancelBtn = document.getElementById("iuDataMgmtImportCancelBtn");
  const confirmCloseBtn = document.getElementById("iuDataMgmtImportConfirmClose");

  if (!exportBtn || !importBtn || !fileInput) return;
  if (exportBtn.dataset.iuBackupUiBound === "1") return;
  exportBtn.dataset.iuBackupUiBound = "1";

  /** @type {unknown} */
  let pendingBackup = null;
  /** @type {HTMLElement | null} */
  let returnFocusEl = null;

  function refreshLastExport() {
    if (!lastExportEl) return;
    try {
      const raw = localStorage.getItem(LAST_EXPORT_KEY);
      lastExportEl.textContent = raw ? formatCsDateTime(raw) : "Zatím nebyl na tomto zařízení proveden export.";
    } catch {
      lastExportEl.textContent = "—";
    }
  }

  function closeConfirmDialog() {
    if (!confirmDlg) return;
    confirmDlg.hidden = true;
    confirmDlg.setAttribute("aria-hidden", "true");
    pendingBackup = null;
    if (returnFocusEl && typeof returnFocusEl.focus === "function") {
      try {
        returnFocusEl.focus();
      } catch {
        /* ignore */
      }
    }
    returnFocusEl = null;
  }

  function openConfirmDialog(preview) {
    if (!confirmDlg) return;
    if (confirmSummary) {
      confirmSummary.textContent = `Záloha z ${formatCsDateTime(preview.createdAt)} · verze ${preview.backupVersion}${
        preview.appVersion ? ` · build ${preview.appVersion}` : ""
      }`;
    }
    renderPreviewList(confirmModules, preview);
    confirmDlg.hidden = false;
    confirmDlg.setAttribute("aria-hidden", "false");
    if (confirmApplyBtn) confirmApplyBtn.focus();
  }

  refreshLastExport();

  exportBtn.addEventListener("click", async () => {
    if (exportBtn.disabled) return;
    const storage = createStorageAdapter();
    const beforeClone = cloneStorageAdapter(storage);
    setBusy(exportBtn, true, "Vytvářím zálohu…");
    announce(statusLive, "Probíhá vytváření zálohy…");
    try {
      assertVaultUnlockedForBackup("export");
      const json = await exportBackupJson(storage, readAppVersion(), getSubtle());
      const filename = formatBackupFilename(new Date());
      triggerDownload(filename, json);
      try {
        localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
      } catch {
        /* ignore */
      }
      refreshLastExport();
      const afterClone = cloneStorageAdapter(storage);
      if (!storageSnapshotsEqual(beforeClone, afterClone)) {
        throw new Error("BACKUP_DATA_CHANGED");
      }
      announce(statusLive, "Záloha byla úspěšně stažena. Vaše data v InfoUzelu zůstala beze změny.");
    } catch (err) {
      announce(statusLive, userMessageForError(errorCodeFrom(err)) || "Zálohu se nepodařilo vytvořit.");
    } finally {
      setBusy(exportBtn, false);
    }
  });

  importBtn.addEventListener("click", () => {
    if (importBtn.disabled) return;
    returnFocusEl = importBtn;
    try {
      fileInput.value = "";
    } catch {
      /* ignore */
    }
    fileInput.click();
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    setBusy(importBtn, true, "Ověřuji zálohu…");
    announce(statusLive, "Probíhá ověřování zálohy…");
    try {
      const text = await readBackupFileText(file);
      const verified = await parseAndVerifyBackupText(text, getSubtle());
      pendingBackup = verified;
      const preview = getBackupPreview(verified);
      openConfirmDialog(preview);
      announce(statusLive, "Záloha je platná. Potvrďte obnovení nebo zrušte.");
    } catch (err) {
      pendingBackup = null;
      announce(statusLive, userMessageForError(errorCodeFrom(err)) || "Vybraný soubor není platná záloha.");
    } finally {
      setBusy(importBtn, false);
      try {
        fileInput.value = "";
      } catch {
        /* ignore */
      }
    }
  });

  async function applyImport() {
    if (!pendingBackup || !confirmApplyBtn) return;
    const storage = createStorageAdapter();
    const beforeClone = cloneStorageAdapter(storage);
    setBusy(confirmApplyBtn, true, "Obnovuji…");
    announce(statusLive, "Probíhá obnova dat…");
    try {
      assertVaultUnlockedForBackup("import");
      window.__iuBackupImportInProgress = true;
      await applyBackupReplaceModeAsync(
        storage,
        {},
        pendingBackup,
        backupPersistHooks
      );
      if (isVaultActive() && isVaultUnlocked()) {
        await preloadAllVaultRecords();
        notifyVaultMemoryHydrated();
      }
      closeConfirmDialog();
      announce(statusLive, "Obnova byla úspěšná. Načítám aktualizovaná data…");
      try {
        window.dispatchEvent(new CustomEvent("iu:user-data-imported", { detail: { mode: "replace" } }));
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          /* ignore */
        }
      }, 400);
    } catch (err) {
      const afterFail = cloneStorageAdapter(storage);
      const rolledBack = !storageSnapshotsEqual(beforeClone, afterFail);
      const baseMsg = rolledBack
        ? "Obnova selhala a byl proveden rollback."
        : "Obnova selhala a původní data byla zachována.";
      announce(statusLive, `${baseMsg} ${userMessageForError(errorCodeFrom(err))}`);
      setBusy(confirmApplyBtn, false);
    } finally {
      try {
        window.__iuBackupImportInProgress = false;
      } catch {
        /* ignore */
      }
    }
  }

  if (confirmApplyBtn) {
    confirmApplyBtn.addEventListener("click", () => {
      applyImport();
    });
  }
  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener("click", () => {
      pendingBackup = null;
      closeConfirmDialog();
      announce(statusLive, "Obnova zrušena.");
    });
  }
  if (confirmCloseBtn) {
    confirmCloseBtn.addEventListener("click", () => {
      pendingBackup = null;
      closeConfirmDialog();
      announce(statusLive, "Obnova zrušena.");
    });
  }
  if (confirmDlg) {
    confirmDlg.querySelectorAll("[data-iu-data-mgmt-close]").forEach((el) => {
      el.addEventListener("click", () => {
        pendingBackup = null;
        closeConfirmDialog();
        announce(statusLive, "Obnova zrušena.");
      });
    });
    confirmDlg.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        pendingBackup = null;
        closeConfirmDialog();
        announce(statusLive, "Obnova zrušena.");
      }
    });
  }
}

function exposeBackupGlobals() {
  window.iuUserDataBackupCollectSnapshot = () => collectAllModules(createStorageAdapter());
  window.iuUserDataBackupExportJson = () => {
    assertVaultUnlockedForBackup("export");
    return exportBackupJson(createStorageAdapter(), readAppVersion(), getSubtle());
  };
  window.iuUserDataBackupParseAndVerify = (text) => parseAndVerifyBackupText(text, getSubtle());
  window.iuUserDataBackupApplyReplace = async (backup) => {
    assertVaultUnlockedForBackup("import");
    const storage = createStorageAdapter();
    window.__iuBackupImportInProgress = true;
    try {
      await applyBackupReplaceModeAsync(
        storage,
        {},
        backup,
        backupPersistHooks
      );
      if (isVaultActive() && isVaultUnlocked()) {
        await preloadAllVaultRecords();
        notifyVaultMemoryHydrated();
      }
    } finally {
      try {
        window.__iuBackupImportInProgress = false;
      } catch {
        /* ignore */
      }
    }
  };
}

exposeBackupGlobals();
document.addEventListener("iu:info-center-mounted", initUserDataBackupUi);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initUserDataBackupUi);
} else {
  initUserDataBackupUi();
}
