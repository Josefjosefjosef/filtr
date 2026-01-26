/* debug.js – infoUzel.cz diagnostics (no DevTools needed)
   Zapnutí: ?debug=1
*/

(() => {
  "use strict";
  const DEBUG = new URLSearchParams(location.search).get("debug") === "1";
  if (!DEBUG) return;

  const NS = "iu:diag:";
  const MAX_FETCH_LOG = 30;

  function get(k){ try { return localStorage.getItem(NS+k); } catch(_) { return null; } }
  function set(k,v){ try { localStorage.setItem(NS+k, v); } catch(_) {} }

  function readJSON(k){
    const t = get(k); if (!t) return null;
    try { return JSON.parse(t); } catch(_) { return null; }
  }

  function esc(s){
    return String(s)
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function overlay() {
    let el = document.getElementById("iuDebugPanel");
    if (!el) {
      el = document.createElement("div");
      el.id = "iuDebugPanel";
      el.style.cssText = `
        position: fixed; left: 12px; bottom: 12px; width: min(520px, calc(100vw - 24px));
        z-index: 99998; background: rgba(255,255,255,0.94); border: 1px solid rgba(20,40,70,0.18);
        border-radius: 14px; box-shadow: 0 16px 48px rgba(0,0,0,0.12); backdrop-filter: blur(10px);
        font: 12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Arial;
        color: rgba(11,27,43,0.92);
        overflow: hidden;
      `;
      document.body.appendChild(el);
    }

    const lastErr = readJSON("last_error");
    const fetches = readJSON("last_fetches") || [];
    const lastOk = readJSON("last_ok");

    // Metriky feedu
    const newsList = document.getElementById("newsList");
    const feedItemsCount = newsList ? newsList.children.length : 0;
    const displayFeedLength = window.allItems ? window.allItems.length : (window.displayFeed ? window.displayFeed.length : 0);

    // Service Worker stav
    let swState = "—";
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          swState = reg.active ? "aktivní" : (reg.installing ? "instaluje se" : "čeká");
          const stateEl = document.getElementById("iuDbgSwState");
          if (stateEl) stateEl.textContent = swState;
        }
      }).catch(() => {});
    }

    // Paměťové metriky (pokud dostupné)
    let memInfo = "—";
    if (performance.memory) {
      const mem = performance.memory;
      memInfo = `Used: ${Math.round(mem.usedJSHeapSize / 1024 / 1024)}MB / Total: ${Math.round(mem.totalJSHeapSize / 1024 / 1024)}MB / Limit: ${Math.round(mem.jsHeapSizeLimit / 1024 / 1024)}MB`;
    }

    // Render optimizer stav
    const renderOptState = window.__iuRenderOptimizer ? "načten" : "není načten";

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(20,40,70,0.10);">
        <div style="font-weight:800;">DEBUG</div>
        <div style="opacity:.75;">online: <b>${navigator.onLine ? "yes" : "no"}</b></div>
        <div style="margin-left:auto;display:flex;gap:8px;">
          <button id="iuDbgCopy" style="padding:6px 8px;border-radius:10px;border:1px solid rgba(20,40,70,0.16);background:#fff;cursor:pointer;">Kopírovat</button>
          <button id="iuDbgClear" style="padding:6px 8px;border-radius:10px;border:1px solid rgba(20,40,70,0.16);background:#fff;cursor:pointer;">Vymazat</button>
          <button id="iuDbgClose" style="padding:6px 8px;border-radius:10px;border:1px solid rgba(20,40,70,0.16);background:#fff;cursor:pointer;">Zavřít</button>
        </div>
      </div>

      <div style="padding:10px 12px;max-height:55vh;overflow:auto;">
        <div style="font-weight:800;margin-bottom:6px;">Feed metriky</div>
        <div style="margin:0 0 10px 0;padding:8px;border-radius:12px;background:rgba(20,40,70,0.06);border:1px solid rgba(20,40,70,0.10);font-size:11px;">
          Položek v feedu: <b>${displayFeedLength}</b><br>
          Vykresleno v DOM: <b>${feedItemsCount}</b><br>
          Render optimizer: <b>${renderOptState}</b>
        </div>

        <div style="font-weight:800;margin-bottom:6px;">Service Worker</div>
        <div style="margin:0 0 10px 0;padding:8px;border-radius:12px;background:rgba(20,40,70,0.06);border:1px solid rgba(20,40,70,0.10);font-size:11px;">
          Stav: <b id="iuDbgSwState">${swState}</b>
        </div>

        <div style="font-weight:800;margin-bottom:6px;">Paměť</div>
        <div style="margin:0 0 10px 0;padding:8px;border-radius:12px;background:rgba(20,40,70,0.06);border:1px solid rgba(20,40,70,0.10);font-size:11px;">
          ${memInfo}
        </div>

        <div style="font-weight:800;margin-bottom:6px;">Poslední chyba</div>
        <pre style="margin:0 0 10px 0;padding:8px;border-radius:12px;background:rgba(20,40,70,0.06);border:1px solid rgba(20,40,70,0.10);white-space:pre-wrap;font-size:11px;">
${esc(lastErr ? JSON.stringify(lastErr, null, 2) : "—")}
        </pre>

        <div style="font-weight:800;margin-bottom:6px;">Poslední OK stav</div>
        <pre style="margin:0 0 10px 0;padding:8px;border-radius:12px;background:rgba(20,40,70,0.06);border:1px solid rgba(20,40,70,0.10);white-space:pre-wrap;font-size:11px;">
${esc(lastOk ? JSON.stringify(lastOk, null, 2) : "—")}
        </pre>

        <div style="font-weight:800;margin-bottom:6px;">Fetch log (posledních ${MAX_FETCH_LOG})</div>
        <pre style="margin:0;padding:8px;border-radius:12px;background:rgba(20,40,70,0.06);border:1px solid rgba(20,40,70,0.10);white-space:pre-wrap;font-size:11px;">
${esc(fetches.length ? fetches.map(x => `${x.t} | ${x.name} | ${x.url} | ${x.ok ? "OK" : "FAIL"} | ${x.source || ""} | ${x.msg || ""}`).join("\n") : "—")}
        </pre>
      </div>
    `;

    document.getElementById("iuDbgClose").onclick = () => el.remove();
    document.getElementById("iuDbgClear").onclick = () => {
      try {
        localStorage.removeItem(NS+"last_error");
        localStorage.removeItem(NS+"last_fetches");
        localStorage.removeItem(NS+"last_ok");
      } catch(_) {}
      overlay();
    };
    document.getElementById("iuDbgCopy").onclick = async () => {
      const pack = {
        timestamp: new Date().toISOString(),
        online: navigator.onLine,
        feed_metrics: {
          items_in_feed: displayFeedLength,
          rendered_in_dom: feedItemsCount,
          render_optimizer: renderOptState
        },
        service_worker: swState,
        memory: memInfo,
        last_error: lastErr,
        last_ok: lastOk,
        last_fetches: fetches
      };
      try { await navigator.clipboard.writeText(JSON.stringify(pack, null, 2)); } catch(_) {}
    };
  }

  overlay();

  window.addEventListener("focus", overlay);
})();
