/**
 * Physical persistence / conflict forensics overlay — metadata only.
 * ?iuPersistDiag=1 → BEFORE/AFTER persistence diag (may run normal vault boot)
 * ?iuConflictForensics=1 → READ-ONLY conflict topology (boot must skip migrate)
 * ?iuSecOffReloadDiag=1 → SECURITY OFF save→reload fingerprint trace
 * ?iuLifecycleDiag=1 → mobile/tablet/PWA SAVE→RELOAD→REOPEN lifecycle trace
 * ?iuKeyPathDiag=1 → key-path forensics (works on fail-closed recovery screen)
 * ?iuCanaryDiag=1 → weather+prefs+notes multi-canary BEFORE/AFTER reload trace
 * Does NOT flush or write vault data from this overlay (except sessionStorage fingerprints).
 */
(function iuPhysicalPersistDiagOverlay() {
  "use strict";
  var params;
  try {
    params = new URLSearchParams(location.search || "");
  } catch (_) {
    return;
  }
  var persistMode = params.get("iuPersistDiag") === "1";
  var conflictMode = params.get("iuConflictForensics") === "1";
  var secOffMode = params.get("iuSecOffReloadDiag") === "1";
  var lifecycleMode = params.get("iuLifecycleDiag") === "1";
  var keyPathMode = params.get("iuKeyPathDiag") === "1";
  var canaryMode = params.get("iuCanaryDiag") === "1";
  if (!persistMode && !conflictMode && !secOffMode && !lifecycleMode && !keyPathMode && !canaryMode) return;
  if (window.__iuPhysicalPersistDiagOverlay) return;
  window.__iuPhysicalPersistDiagOverlay = 1;

  function btn(label, act, flex) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("data-act", act);
    b.textContent = label;
    b.style.cssText = flex
      ? "flex:1;min-width:110px;padding:12px 10px;font-size:13px"
      : "padding:12px 10px;font-size:13px";
    return b;
  }

  var root = document.createElement("div");
  root.id = "iuPersistDiagOverlay";
  root.setAttribute("role", "dialog");
  root.setAttribute(
    "aria-label",
    canaryMode
      ? "Multi-canary persistence trace"
      : keyPathMode
      ? "Key path forensics"
      : lifecycleMode
      ? "Lifecycle SAVE REOPEN trace"
      : conflictMode
        ? "Conflict forensics"
        : secOffMode
          ? "SECURITY OFF reload trace"
          : "Persistence diagnostika"
  );
  root.style.cssText =
    "position:fixed;z-index:2147483646;left:6px;right:6px;bottom:6px;max-height:58vh;overflow:auto;background:#111;color:#eee;border:1px solid #555;border-radius:10px;padding:10px;font:12px/1.35 ui-monospace,Consolas,monospace;box-shadow:0 8px 28px rgba(0,0,0,.45)";

  var row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px";
  if (canaryMode) {
    row.appendChild(btn("1) Po SAVE (před reload)", "canaryBefore", true));
    row.appendChild(btn("2) Po RELOAD (hydrate+UI)", "canaryAfter", true));
    row.appendChild(btn("Early boot (auto)", "canaryEarly", true));
    row.appendChild(btn("Kopírovat JSON", "copy", true));
    row.appendChild(btn("Zavřít", "close", false));
  } else if (lifecycleMode) {
    row.appendChild(btn("1) Po SAVE", "lifeAfterSave", true));
    row.appendChild(btn("2) Po RELOAD", "lifeAfterReload", true));
    row.appendChild(btn("3) Po REOPEN", "lifeAfterReopen", true));
    row.appendChild(btn("Kopírovat JSON", "copy", true));
    row.appendChild(btn("Zavřít", "close", false));
  } else if (keyPathMode) {
    row.appendChild(btn("1) Capture key-path", "keyPath", true));
    row.appendChild(btn("Kopírovat JSON", "copy", true));
    row.appendChild(btn("Zavřít", "close", false));
  } else if (conflictMode) {
    row.appendChild(btn("1) Capture forensics", "conflict", true));
    row.appendChild(btn("Kopírovat JSON", "copy", true));
    row.appendChild(btn("Zavřít", "close", false));
  } else if (secOffMode) {
    row.appendChild(btn("1) Po SAVE", "secAfterSave", true));
    row.appendChild(btn("2) Po RELOAD", "secAfterReload", true));
    row.appendChild(btn("Kopírovat JSON", "copy", true));
    row.appendChild(btn("Zavřít", "close", false));
  } else {
    row.appendChild(btn("1) BEFORE close", "before", true));
    row.appendChild(btn("2) AFTER reopen", "after", true));
    row.appendChild(btn("Kopírovat JSON", "copy", true));
    row.appendChild(btn("Zavřít", "close", false));
  }
  root.appendChild(row);

  var pre = document.createElement("pre");
  pre.id = "iuPersistDiagOut";
  pre.style.cssText = "white-space:pre-wrap;word-break:break-word;margin:0";
  pre.textContent = keyPathMode
    ? "KEY-PATH FORENSICS (bez secrets). Capture na fail-closed i unlocked. Kopírovat JSON."
    : lifecycleMode
    ? "LIFECYCLE TRACE (bez plaintextu).\n1) Ulož filtr/notes/tasks/calendar → Po SAVE.\n2) Reload → Po RELOAD.\n3) Zavři browser/PWA úplně → otevři stejné URL → Po REOPEN.\nPak Kopírovat JSON."
    : conflictMode
      ? "READ-ONLY conflict forensics. Stiskni Capture. Žádný migrate/write."
      : secOffMode
        ? "SECURITY OFF reload trace. 1) Ulož filtr/data → Po SAVE. 2) Reload → Po RELOAD. Bez plaintextu."
        : "Čekám na vault…";
  root.appendChild(pre);

  function mount() {
    if (!document.body) return false;
    document.body.appendChild(root);
    return true;
  }
  if (!mount()) document.addEventListener("DOMContentLoaded", mount);

  var lastPayload = null;
  function setText(t) {
    pre.textContent = t;
  }

  function waitApi(ms, pred) {
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function tick() {
        try {
          if (pred()) return resolve(window.iuVault);
        } catch (_) {}
        if (Date.now() - t0 > ms) return reject(new Error("VAULT_DIAG_TIMEOUT"));
        setTimeout(tick, 200);
      })();
    });
  }

  function compactRecords(records) {
    var arr = Array.isArray(records) ? records : [];
    return arr.map(function (r) {
      return {
        storageKey: r && r.storageKey ? String(r.storageKey) : null,
        keyType: r && r.keyType ? String(r.keyType) : null,
        backend: r && r.backend ? String(r.backend) : null,
        idbEnvelope: !!(r && r.idbEnvelope),
        lsEnvelope: !!(r && r.lsEnvelope),
        plainStaging: !!(r && r.plainStaging),
        lastWritePhase: r && r.lastWritePhase ? String(r.lastWritePhase) : null,
        decryptStatus: r && r.decryptStatus ? String(r.decryptStatus) : null,
        blockedWriteCount: r && typeof r.blockedWriteCount === "number" ? r.blockedWriteCount : 0,
      };
    });
  }

  async function capturePersist(tag) {
    setText("Načítám " + tag + "…");
    try {
      var vault = await waitApi(20000, function () {
        return window.iuVault && typeof window.iuVault.getPersistenceDiag === "function";
      });
      var diag = await vault.getPersistenceDiag();
      lastPayload = {
        tag: tag,
        capturedAt: Date.now(),
        hrefPath: String(location.pathname || "").slice(0, 80),
        platform: diag && diag.platform ? diag.platform : null,
        displayMode: diag && diag.displayMode ? diag.displayMode : null,
        bootPhase: diag && diag.bootPhase ? diag.bootPhase : null,
        hydrationComplete: !!(diag && diag.hydrationComplete),
        pendingWriteCount: diag && typeof diag.pendingWriteCount === "number" ? diag.pendingWriteCount : null,
        serviceWorker: diag && diag.serviceWorker ? diag.serviceWorker : null,
        forensics: diag && diag.forensics ? diag.forensics : null,
        records: compactRecords(diag && diag.records),
      };
      setText(JSON.stringify(lastPayload, null, 2));
    } catch (err) {
      setText("FAIL: " + String(err && err.message ? err.message : err));
    }
  }

  async function captureSecOff(phase) {
    setText("Načítám " + phase + "…");
    try {
      var vault = await waitApi(25000, function () {
        return window.iuVault && typeof window.iuVault.captureSecOffReloadTrace === "function";
      });
      lastPayload = await vault.captureSecOffReloadTrace(phase);
      setText(JSON.stringify(lastPayload, null, 2));
    } catch (err) {
      setText("FAIL: " + String(err && err.message ? err.message : err));
    }
  }

  async function captureCanary(phase) {
    setText("Načítám canary " + phase + "…");
    try {
      var vault = await waitApi(30000, function () {
        return window.iuVault && typeof window.iuVault.captureMultiCanaryBootTrace === "function";
      });
      var live = await vault.captureMultiCanaryBootTrace(phase);
      lastPayload = {
        tag: "MULTI_CANARY_PHYSICAL_BUNDLE_V1",
        phase: phase,
        capturedAt: Date.now(),
        earlyBootAuto: window.__iuCanaryEarlyBoot || null,
        live: live,
      };
      setText(JSON.stringify(lastPayload, null, 2));
    } catch (err) {
      setText("FAIL: " + String(err && err.message ? err.message : err));
    }
  }

  async function captureLifecycle(phase) {
    setText("Načítám " + phase + "…");
    try {
      var vault = await waitApi(30000, function () {
        return window.iuVault && typeof window.iuVault.captureLifecycleSaveReopenTrace === "function";
      });
      lastPayload = await vault.captureLifecycleSaveReopenTrace(phase);
      setText(JSON.stringify(lastPayload, null, 2));
    } catch (err) {
      setText("FAIL: " + String(err && err.message ? err.message : err));
    }
  }

  async function captureConflict() {
    setText("Načítám READ-ONLY conflict forensics…");
    try {
      var vault = await waitApi(25000, function () {
        return window.iuVault && typeof window.iuVault.getConflictForensics === "function";
      });
      lastPayload = await vault.getConflictForensics();
      setText(JSON.stringify(lastPayload, null, 2));
    } catch (err) {
      setText("FAIL: " + String(err && err.message ? err.message : err));
    }
  }

  async function copyLast() {
    if (!lastPayload) {
      setText(
        lifecycleMode
          ? "Nejdřív Po SAVE / Po RELOAD / Po REOPEN."
          : conflictMode
            ? "Nejdřív Capture forensics."
            : secOffMode
              ? "Nejdřív Po SAVE nebo Po RELOAD."
              : "Nejdřív stiskni BEFORE nebo AFTER."
      );
      return;
    }
    var text = JSON.stringify(lastPayload, null, 2);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setText(text + "\n\n---\nZkopírováno. Pošli mi tento JSON.");
        return;
      }
    } catch (_) {}
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setText(text + "\n\n---\nZkuseno zkopírovat. Jinak označ text ručně.");
    } catch (_) {
      setText(text + "\n\n---\nOznač text a zkopíruj ručně.");
    }
  }

  async function captureKeyPath() {
    setText("Načítám key-path forensics…");
    await waitApi(90000, function () {
      return window.iuVault && typeof window.iuVault.getPersistenceDiag === "function";
    });
    var vault = window.iuVault;
    var diag = await vault.getPersistenceDiag({
      keys: ["iu.infoEvents.prefs.v1", "iu.notes.store.v1", "iu.tasks.mvp.v1", "iu.calendar.store.v1"],
    });
    var life = null;
    try {
      if (typeof vault.captureLifecycleSaveReopenTrace === "function") {
        life = await vault.captureLifecycleSaveReopenTrace("KEY_PATH_FORENSICS");
      }
    } catch (_) {}
    lastPayload = {
      tag: "KEY_PATH_FORENSICS_V1",
      capturedAt: Date.now(),
      recoveryRequired: !!(vault.isStorageRecoveryRequired && vault.isStorageRecoveryRequired()),
      recoveryReason: vault.getStorageRecoveryReason ? vault.getStorageRecoveryReason() : null,
      recoveryKeyPath: vault.getStorageRecoveryKeyPath ? vault.getStorageRecoveryKeyPath() : null,
      windowKeyPath: window.__iuVaultStorageRecoveryKeyPath || null,
      forensics: diag && diag.forensics ? diag.forensics : null,
      lifecycle: life
        ? {
            keyRecordPresent: life.keyRecordPresent,
            cryptoKeyUsable: life.cryptoKeyUsable,
            durableMaterialPresent: life.durableMaterialPresent,
            durableMaterialUsable: life.durableMaterialUsable,
            legacyBackupPresent: life.legacyBackupPresent,
            storageRecoveryReason: life.storageRecoveryReason,
            storageRecoveryKeyPath: life.storageRecoveryKeyPath,
            probes: life.probes,
            bundleHint: life.bundleHint,
            serviceWorker: life.serviceWorker,
            platform: life.platform,
            displayMode: life.displayMode,
            origin: life.origin,
          }
        : null,
    };
    setText(JSON.stringify(lastPayload, null, 2));
  }

  root.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    var act = t.getAttribute("data-act");
    if (act === "before") capturePersist("BEFORE_CLOSE");
    else if (act === "after") capturePersist("AFTER_REOPEN");
    else if (act === "secAfterSave") captureSecOff("AFTER_SAVE");
    else if (act === "secAfterReload") captureSecOff("AFTER_RELOAD");
    else if (act === "lifeAfterSave") captureLifecycle("AFTER_SAVE");
    else if (act === "lifeAfterReload") captureLifecycle("AFTER_RELOAD");
    else if (act === "lifeAfterReopen") captureLifecycle("AFTER_REOPEN");
    else if (act === "canaryBefore") captureCanary("BEFORE_RELOAD_AFTER_SAVE");
    else if (act === "canaryAfter") captureCanary("AFTER_RELOAD_HYDRATED_UI");
    else if (act === "canaryEarly") {
      lastPayload = {
        tag: "MULTI_CANARY_PHYSICAL_BUNDLE_V1",
        phase: "EARLY_BOOT_PRE_HYDRATE",
        capturedAt: Date.now(),
        earlyBootAuto: window.__iuCanaryEarlyBoot || null,
        live: null,
      };
      setText(
        lastPayload.earlyBootAuto
          ? JSON.stringify(lastPayload, null, 2)
          : "Early boot snapshot zatím chybí — reloadni s ?iuCanaryDiag=1"
      );
    }
    else if (act === "conflict") captureConflict();
    else if (act === "keyPath") captureKeyPath();
    else if (act === "copy") copyLast();
    else if (act === "close") root.remove();
  });

  if (canaryMode) {
    setTimeout(function () {
      if (window.__iuCanaryEarlyBoot) {
        lastPayload = {
          tag: "MULTI_CANARY_PHYSICAL_BUNDLE_V1",
          phase: "EARLY_BOOT_PRE_HYDRATE",
          capturedAt: Date.now(),
          earlyBootAuto: window.__iuCanaryEarlyBoot,
          live: null,
        };
        setText(
          "EARLY_BOOT auto-captured. Po hydrate stiskni „Po RELOAD“. JSON:\n\n" +
            JSON.stringify(lastPayload, null, 2)
        );
      }
      captureCanary("AFTER_RELOAD_HYDRATED_UI");
    }, 1800);
  } else if (conflictMode) {
    setTimeout(function () {
      captureConflict();
    }, 400);
  } else if (keyPathMode) {
    setTimeout(function () {
      captureKeyPath();
    }, 600);
  } else if (lifecycleMode) {
    setTimeout(function () {
      captureLifecycle("BOOT_HYDRATED");
    }, 1400);
  } else if (secOffMode) {
    setTimeout(function () {
      captureSecOff("BOOT_HYDRATED");
    }, 1200);
    setTimeout(function () {
      captureSecOff("BOOT_PLUS_4S");
    }, 5200);
  }
})();
