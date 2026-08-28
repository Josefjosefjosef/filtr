/**
 * Physical persistence diagnostic overlay — metadata only.
 * Activates only with ?iuPersistDiag=1.
 * Does NOT flush, write vault data, or change persistence semantics.
 */
(function iuPhysicalPersistDiagOverlay() {
  "use strict";
  try {
    if (new URLSearchParams(location.search || "").get("iuPersistDiag") !== "1") return;
  } catch (_) {
    return;
  }
  if (window.__iuPhysicalPersistDiagOverlay) return;
  window.__iuPhysicalPersistDiagOverlay = 1;

  function btn(label, act, flex) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("data-act", act);
    b.textContent = label;
    b.style.cssText = flex
      ? "flex:1;min-width:120px;padding:10px"
      : "padding:10px";
    return b;
  }

  var root = document.createElement("div");
  root.id = "iuPersistDiagOverlay";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "Persistence diagnostika");
  root.style.cssText =
    "position:fixed;z-index:2147483000;left:8px;right:8px;bottom:8px;max-height:46vh;overflow:auto;background:#111;color:#eee;border:1px solid #555;border-radius:10px;padding:10px;font:12px/1.35 ui-monospace,Consolas,monospace;box-shadow:0 8px 28px rgba(0,0,0,.45)";

  var row = document.createElement("div");
  row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px";
  row.appendChild(btn("1) BEFORE close", "before", true));
  row.appendChild(btn("2) AFTER reopen", "after", true));
  row.appendChild(btn("Kopírovat JSON", "copy", true));
  row.appendChild(btn("Zavřít", "close", false));
  root.appendChild(row);

  var pre = document.createElement("pre");
  pre.id = "iuPersistDiagOut";
  pre.style.cssText = "white-space:pre-wrap;word-break:break-word;margin:0";
  pre.textContent = "Čekám na vault…";
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
  function waitVault(ms) {
    return new Promise(function (resolve, reject) {
      var t0 = Date.now();
      (function tick() {
        if (window.iuVault && typeof window.iuVault.getPersistenceDiag === "function") {
          return resolve(window.iuVault);
        }
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
  async function capture(tag) {
    setText("Načítám " + tag + "…");
    try {
      var vault = await waitVault(20000);
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
  async function copyLast() {
    if (!lastPayload) {
      setText("Nejdřív stiskni BEFORE nebo AFTER.");
      return;
    }
    var text = JSON.stringify(lastPayload, null, 2);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setText(text + "\n\n---\nZkopírováno do schránky. Pošli mi tento JSON.");
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
      setText(text + "\n\n---\nZkuseno zkopírovat. Pokud schránka selhala, označ text výše a zkopíruj ručně.");
    } catch (_) {
      setText(text + "\n\n---\nOznač text a zkopíruj ručně.");
    }
  }
  root.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    var act = t.getAttribute("data-act");
    if (act === "before") capture("BEFORE_CLOSE");
    else if (act === "after") capture("AFTER_REOPEN");
    else if (act === "copy") copyLast();
    else if (act === "close") root.remove();
  });
})();
