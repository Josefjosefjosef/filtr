console.log("[BOOT] app.js loaded", new Date().toISOString());

// === MAINTENANCE
// ::contentReference[oaicite:0]{index=0}
// REŽIM: MAINTENANCE
// Stav: FEED STABLE
// Povolené zásahy:
// - drobné UI úpravy mimo feed
// - přidání nových funkcí mimo render pipeline
// Zakázané zásahy:
// - loadData / applyFilter / renderFeed
// - state.cachedItems / state.filteredItems logika
// - změny routování přes contentType
// === INFOUZEL FEED INVARIANTS (NO-GO ZONE) ===
// - jediný zdroj pravdy: state.*
// - jediná render pipeline: loadData → state.cachedItems → applyFilter → renderFeed
// - render výhradně do #feed (safeTarget)
// - routování výhradně přes item.contentType
// Porušení = BUG (ne warning)
console.log("[BOOT] app.js loaded", new Date().toISOString());

window.addEventListener("error", (e) => {
  try {
    console.error("[WINERROR]", e?.message, e?.filename, e?.lineno, e?.colno, e?.error);
  } catch {}
});

window.addEventListener("unhandledrejection", (e) => {
  try {
    console.error("[UNHANDLED]", e?.reason);
  } catch {}
});

(() => {
  document.documentElement.setAttribute("data-iu-js","loaded");
  try { document.documentElement.setAttribute("data-iu-path", location.pathname + location.search); } catch {}
  try { document.documentElement.setAttribute("data-iu-buildstamp", document.querySelector('meta[name="iu-build"]')?.content || "no-meta"); } catch {}
  const $ = (sel) => document.querySelector(sel);
  /*
  Release summary (UI/data):

  Render zapisuje pouze do ověřeného #feed přes safeTarget.

  Routing je řízen jen item.contentType ("article"/"video").

  Veškerý stav je ve state.* (bez globálních proměnných).

  Produkce je tichá: diagnostika běží jen při ?debug=1.

  Chyby se propisují přes persistLastError + #lastErrInline, bez potřeby debug režimu.
  */
  function qsSafe(selector) {
    try {
      const el = document.querySelector(selector);
      if (!el) {
        debugWarn("[DOM] missing", selector);
      }
      return el;
    } catch (err) {
      debugWarn("[DOM] missing", selector, err);
      return null;
    }
  }

  const elStatus = $("#dataStatus");
  const elDebugPanel = $("#debugPanel");
  const elDebugOut = $("#debugOut");
  const elDataCount = $("#dataCount");
  const btnToggleDebug = $("#toggleDebugBtn");
  const elNewsList = document.getElementById("newsList");
  const elFeed = document.getElementById("feed");
  const emptyBox = document.getElementById("emptyBox");
  const sectionLabel = document.getElementById("sectionLabel");
  const sectionsBar = document.getElementById("sectionsBar");
  const searchForm = document.getElementById("searchForm");
  const searchInput = document.getElementById("searchInput");
  const searchModal = document.getElementById("searchModal");
  const modalGoogle = document.getElementById("modalGoogle");
  const modalCancel = document.getElementById("modalCancel");

  const SECTION_KEYS = ["vse", "aktualne", "doprava", "pocasi", "sport", "finance", "krimi", "zdravi", "video"];
  let activeSections = ["vse"];
  const state = {
    cachedItems: [],
    filteredItems: [],
    hasLoadedData: false,
    loadRequestId: 0,
    stats: { articlesCount: 0, videosCount: 0 },
    lastArticlesGeneratedAt: null,
    lastVideosGeneratedAt: null,
    lastArticlesKeys: null,
    lastVideosKeys: null,
    lastArticlesUpdatedAt: null,
    lastVideosUpdatedAt: null,
    lastProbe: null,
    isLoadingData: false,
    consecutiveLoadFailures: 0,
    activeTopic: null,
    activeSection: null,
    activeFilter: null,
    searchQuery: "",
    sections: new Set(activeSections),
    // FEED pagination (render-only; no pipeline touch)
    pageSize: 200,
    page: 1,
    // DATA retention (optional sharded history under /projects/data/articles/)
    retentionDays: [],
    retentionCursor: 0,
    retentionLoadedDays: new Set(),
    retentionIsLoading: false,
  };
  state.cachedItems ??= [];
  state.filteredItems ??= [];
  const ALLOWED_CONTENT_TYPES = new Set(["article", "video"]);
  const isDebugLogging = location.search.includes("debug=1");

  // Feature flags
  const IU_ENABLE_NAMEDAY = false; // hard off: no request, no DOM update

  function debugLog(...args) {
    if (!isDebugLogging) return;
    console.log(...args);
  }
  function debugWarn(...args) {
    if (!isDebugLogging) return;
    console.warn(...args);
  }
  const DEBUG =
    location.search.includes("debug=1") || localStorage.getItem("iu_debug") === "1";
  if (location.search.includes("debug=1")) {
    localStorage.setItem("iu_debug", "1");
  }
  const diagScriptSrc =
    document.querySelector('script[src*="app.js"]')?.getAttribute("src") || "";
  const diagMeta = {
    articlesUrl: "",
    videosUrl: "",
    articlesStatus: "?",
    videosStatus: "?",
  };
  let diagBarEl = null;
  let diagStartInfo = null;

  function ensureDiagBar() {
    if (!DEBUG) return null;
    if (diagBarEl) return diagBarEl;
    diagBarEl = document.createElement("div");
    diagBarEl.id = "iuDiagBar";
    diagBarEl.style.cssText =
      "font-size:12px;padding:6px;background:#f5f5ff;border-bottom:1px solid rgba(0,0,0,0.1);font-family:inherit;display:flex;gap:10px;align-items:center;";
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "copy";
    copyBtn.style.cssText =
      "font-size:12px;padding:2px 8px;background:#1f3557;color:white;border:none;border-radius:2px;cursor:pointer;";
    copyBtn.addEventListener("click", () => {
      const text = diagBarEl.textContent || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
          const range = document.createRange();
          range.selectNodeContents(diagBarEl);
          window.getSelection().removeAllRanges();
          window.getSelection().addRange(range);
        });
      } else {
        const range = document.createRange();
        range.selectNodeContents(diagBarEl);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        document.execCommand("copy");
      }
    });
    diagBarEl.appendChild(copyBtn);
    document.body.prepend(diagBarEl);
    return diagBarEl;
  }

  function updateDiagBar(text) {
    const bar = ensureDiagBar();
    if (!bar) return;
    const copyBtn = bar.querySelector("button");
    if (copyBtn) {
      bar.textContent = text;
      bar.appendChild(copyBtn);
    } else {
      bar.textContent = text;
    }
  }

  function ensureDebugBox() {
    try {
      const params = new URLSearchParams(location.search || "");
      if (params.get("debug") !== "1") return null;
      let box = document.getElementById("iuDebugBox");
      if (box) return box;
      box = document.createElement("div");
      box.id = "iuDebugBox";
      box.style.cssText = [
        "position:fixed",
        "left:12px",
        "bottom:12px",
        "z-index:99999",
        "max-width:420px",
        "background:rgba(0,0,0,0.85)",
        "color:#fff",
        "padding:10px 12px",
        "border-radius:10px",
        "font:12px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Arial",
        "box-shadow:0 8px 22px rgba(0,0,0,0.35)",
        "white-space:pre-wrap",
      ].join(";");
      box.textContent = "iu debug: init…";
      document.body.appendChild(box);
      return box;
    } catch (err) {
      return null;
    }
  }

  function iuCopyTextToClipboard(text) {
    try {
      const s = String(text ?? "");
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(s).catch(() => {
          try {
            const ta = document.createElement("textarea");
            ta.value = s;
            ta.setAttribute("readonly", "readonly");
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            ta.style.top = "-9999px";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
          } catch (_) {}
        });
      }
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "readonly");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return Promise.resolve();
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = String(text ?? "");
        ta.setAttribute("readonly", "readonly");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        ta.style.top = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch (_) {}
      return Promise.resolve();
    }
  }

  function ensureDebugBoxUi(box) {
    try {
      if (!box) return null;
      const hasUi = box.querySelector("[data-iu-debug-actions]") && box.querySelector("[data-iu-debug-text]");
      if (!hasUi) {
        const existingText = String(box.textContent || "");
        box.textContent = "";

        const actions = document.createElement("div");
        actions.setAttribute("data-iu-debug-actions", "1");
        actions.style.cssText = [
          "display:flex",
          "gap:8px",
          "align-items:center",
          "margin-bottom:8px",
          "flex-wrap:wrap",
        ].join(";");

        const btnDump = document.createElement("button");
        btnDump.type = "button";
        btnDump.textContent = "Copy CLS dump";
        btnDump.style.cssText = [
          "font-size:12px",
          "padding:4px 8px",
          "background:#1f3557",
          "color:#fff",
          "border:none",
          "border-radius:6px",
          "cursor:pointer",
        ].join(";");
        btnDump.addEventListener("click", () => {
          try {
            const payload =
              typeof window.__iuDumpCLS === "function"
                ? window.__iuDumpCLS()
                : {
                    realTotal: window.__iuCLSRealTotal || 0,
                    log: window.__iuCLSLog || [],
                  };
            const json = JSON.stringify(payload, null, 2);
            iuCopyTextToClipboard(json);
          } catch (_) {}
        });

        const btnLines = document.createElement("button");
        btnLines.type = "button";
        btnLines.textContent = "Copy last [IU] lines";
        btnLines.style.cssText = btnDump.style.cssText;
        btnLines.addEventListener("click", () => {
          try {
            const full = Array.isArray(window.__iuCLSLog) ? window.__iuCLSLog : [];
            const tail = full.slice(Math.max(0, full.length - 50));
            const realTotal =
              typeof window.__iuCLSRealTotal === "number"
                ? window.__iuCLSRealTotal
                : window.__iuCLSRealTotal || 0;
            const header = [
              `[IU] href=${String(location.href || "")}`,
              `[IU] __iuCLSRealTotal=${String(realTotal)}`,
              `[IU] __iuCLSLog.len=${String(full.length)}`,
            ].join("\n");
            const lines = tail.map((r) => {
              try {
                const t = r && r.t ? String(r.t) : "";
                const v = typeof r?.value === "number" ? r.value : 0;
                const recent = r?.hadRecentInput ? "1" : "0";
                const debugOnly = r?.debugOnly ? "1" : "0";
                const sc = typeof r?.sourceCount === "number" ? r.sourceCount : (Array.isArray(r?.sources) ? r.sources.length : 0);
                const nodes = (Array.isArray(r?.sources) ? r.sources : [])
                  .map((s) => (s && s.node ? String(s.node) : ""))
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(", ");
                return `[IU][CLS] t=${t} shift=${v.toFixed(4)} recentInput=${recent} debugOnly=${debugOnly} sources=${sc} nodes=${nodes || "(none)"}`;
              } catch (_) {
                return "[IU][CLS] (unparseable entry)";
              }
            });
            iuCopyTextToClipboard([header, ...lines].join("\n"));
          } catch (_) {}
        });

        const btnReal = document.createElement("button");
        btnReal.type = "button";
        btnReal.textContent = "Copy REAL CLS (top10)";
        btnReal.style.cssText = btnDump.style.cssText;
        btnReal.addEventListener("click", () => {
          try {
            const dump = typeof window.__iuDumpCLS === "function" ? window.__iuDumpCLS() : null;
            const payload = dump
              ? {
                  ts: dump.ts,
                  href: dump.href,
                  realTotal: dump.realTotal,
                  realTopShifts: dump.realTopShifts || [],
                }
              : {
                  realTotal: window.__iuCLSRealTotal || 0,
                  realTopShifts: [],
                };
            iuCopyTextToClipboard(JSON.stringify(payload, null, 2));
          } catch (_) {}
        });

        actions.appendChild(btnDump);
        actions.appendChild(btnLines);
        actions.appendChild(btnReal);

        const pre = document.createElement("pre");
        pre.setAttribute("data-iu-debug-text", "1");
        pre.style.cssText = [
          "margin:0",
          "white-space:pre-wrap",
          "max-height:260px",
          "overflow:auto",
        ].join(";");
        pre.textContent = existingText || "";

        box.appendChild(actions);
        box.appendChild(pre);
      }
      return box.querySelector("[data-iu-debug-text]");
    } catch (_) {
      return null;
    }
  }

  function debugBoxSet(msg) {
    const box = ensureDebugBox();
    if (!box) return;
    const textEl = ensureDebugBoxUi(box);
    if (textEl) textEl.textContent = String(msg ?? "");
    else box.textContent = String(msg ?? "");
  }

  function appendDebugLine(msg) {
    if (!isDebugLogging) return;
    const box = ensureDebugBox();
    if (!box) return;
    const textEl = ensureDebugBoxUi(box);
    if (textEl) textEl.textContent += `\n${String(msg ?? "")}`;
    else box.textContent += `\n${String(msg ?? "")}`;
  }

  // ===== CLS / Layout Shift Debug (debug=1 only) =====
  function installCLSObserver() {
    try {
      const iuIsDebug = !!isDebugLogging;
      if (!iuIsDebug) return;
      if (window.__iuCLSObserverInstalled) return;
      if (window.__iuCLSObserverInstalling) return;

      if (typeof PerformanceObserver === "undefined") {
        debugWarn("[CLS] PerformanceObserver not available");
        return;
      }

      window.__iuCLSObserverInstalling = true;

      const MAX = 10;
      window.__iuCLSLog = Array.isArray(window.__iuCLSLog) ? window.__iuCLSLog : [];

      function rectToObj(r) {
        if (!r) return null;
        return {
          x: Math.round(r.x || 0),
          y: Math.round(r.y || 0),
          width: Math.round(r.width || 0),
          height: Math.round(r.height || 0),
          top: Math.round(r.top || 0),
          left: Math.round(r.left || 0),
          bottom: Math.round(r.bottom || 0),
          right: Math.round(r.right || 0),
        };
      }

      function nodeLabel(node) {
        try {
          if (!node) return "(null)";
          if (!(node instanceof Element)) return "(non-element)";
          const tag = (node.tagName || "").toLowerCase() || "(tag)";
          const id = node.id ? `#${node.id}` : "";
          const cls =
            node.classList && node.classList.length
              ? `.${Array.from(node.classList).slice(0, 4).join(".")}`
              : "";

          // best-effort data-* hints (keep short)
          const attrs = [];
          if (node.attributes) {
            for (let i = 0; i < node.attributes.length; i++) {
              const a = node.attributes[i];
              if (!a || !a.name) continue;
              if (a.name.indexOf("data-") !== 0) continue;
              attrs.push(
                `${a.name}=${JSON.stringify(String(a.value || "").slice(0, 40))}`
              );
              if (attrs.length >= 3) break;
            }
          }
          const data = attrs.length ? ` [${attrs.join(" ")}]` : "";
          return `${tag}${id}${cls}${data}`;
        } catch (_) {
          return "(err)";
        }
      }

      function pushLog(entry) {
        window.__iuCLSLog.push(entry);
        if (window.__iuCLSLog.length > MAX) {
          window.__iuCLSLog.splice(0, window.__iuCLSLog.length - MAX);
        }
      }

      function isDebugOverlayNode(node) {
        try {
          if (!node) return false;
          if (!(node instanceof Element)) return false;
          return node.id === "iuDebugBox" || node.id === "iuLayoutShiftBox";
        } catch (_) {
          return false;
        }
      }

      // Debug-only: keep layout-shift attribution evidence for post-mortem.
      window.__iuCLSShiftEntries = Array.isArray(window.__iuCLSShiftEntries)
        ? window.__iuCLSShiftEntries
        : [];
      window.__iuCLSShiftEntriesTotal =
        typeof window.__iuCLSShiftEntriesTotal === "number"
          ? window.__iuCLSShiftEntriesTotal
          : 0;
      const MAX_SHIFT_ENTRIES = 200;

      function round1(n) {
        const x = typeof n === "number" ? n : 0;
        return Math.round(x * 10) / 10;
      }

      function rectToObj1(r) {
        if (!r) return null;
        return {
          x: round1(r.x || 0),
          y: round1(r.y || 0),
          width: round1(r.width || 0),
          height: round1(r.height || 0),
          top: round1(r.top || 0),
          left: round1(r.left || 0),
          bottom: round1(r.bottom || 0),
          right: round1(r.right || 0),
        };
      }

      function safeCssIdent(s) {
        return String(s || "")
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .slice(0, 64);
      }

      function selectorForNode(node) {
        try {
          if (!node) return "__unresolved__";
          if (!(node instanceof Element)) return "__unresolved__";
          if (node.id) return `#${safeCssIdent(node.id)}`;

          const parts = [];
          let el = node;
          let depth = 0;
          while (el && el instanceof Element && depth < 6) {
            const tag = (el.tagName || "").toLowerCase() || "div";
            if (el.id) {
              parts.unshift(`#${safeCssIdent(el.id)}`);
              break;
            }
            const classes =
              el.classList && el.classList.length
                ? Array.from(el.classList)
                    .map((c) => safeCssIdent(c))
                    .filter(Boolean)
                    .slice(0, 3)
                : [];
            let part = tag;
            if (classes.length) part += `.${classes.join(".")}`;

            let nth = 1;
            try {
              const parent = el.parentElement;
              if (parent) {
                const sibs = Array.from(parent.children || []).filter(
                  (c) =>
                    c &&
                    c.tagName &&
                    String(c.tagName).toLowerCase() === tag
                );
                if (sibs.length > 1) {
                  nth = sibs.indexOf(el) + 1;
                } else {
                  nth = 0;
                }
              }
            } catch (_) {
              nth = 0;
            }
            if (nth > 0) part += `:nth-of-type(${nth})`;

            parts.unshift(part);
            if (tag === "body" || tag === "html") break;
            el = el.parentElement;
            depth++;
          }

          return parts.join(" > ") || "__unresolved__";
        } catch (_) {
          return "__unresolved__";
        }
      }

      // Debug-only: aggregate "real" CLS total (excluding debug overlays and recent input)
      let realTotal = 0;
      let lastRealLogAt = 0;
      let lastRealTotalLogged = -1;
      let lastRealValue = 0;
      let lastRealSources = [];

      const observer = new PerformanceObserver((list) => {
        try {
          const entries = list.getEntries() || [];
          for (const e of entries) {
            const sources = Array.isArray(e.sources) ? e.sources : [];
            const debugOnly =
              sources.length > 0 &&
              sources.every((s) => isDebugOverlayNode(s && s.node));

            // Debug-only evidence: store layout shift entries + attribution sources.
            try {
              const shiftEntry = {
                t: new Date().toISOString(),
                value: typeof e.value === "number" ? e.value : 0,
                hadRecentInput: !!e.hadRecentInput,
                startTime: typeof e.startTime === "number" ? e.startTime : null,
                debugOnly,
                sources: sources.map((s) => {
                  const prev = rectToObj1(s && s.previousRect);
                  const cur = rectToObj1(s && s.currentRect);
                  const dx =
                    prev && cur && typeof prev.x === "number" && typeof cur.x === "number"
                      ? round1(cur.x - prev.x)
                      : null;
                  const dy =
                    prev && cur && typeof prev.y === "number" && typeof cur.y === "number"
                      ? round1(cur.y - prev.y)
                      : null;
                  return {
                    node: nodeLabel(s && s.node),
                    selector: selectorForNode(s && s.node),
                    previousRect: prev,
                    currentRect: cur,
                    deltaX: dx,
                    deltaY: dy,
                  };
                }),
              };
              window.__iuCLSShiftEntriesTotal =
                (typeof window.__iuCLSShiftEntriesTotal === "number"
                  ? window.__iuCLSShiftEntriesTotal
                  : 0) + 1;
              window.__iuCLSShiftEntries.push(shiftEntry);
              if (window.__iuCLSShiftEntries.length > MAX_SHIFT_ENTRIES) {
                window.__iuCLSShiftEntries.splice(
                  0,
                  window.__iuCLSShiftEntries.length - MAX_SHIFT_ENTRIES
                );
              }
            } catch (_) {}

            const rec = {
              t: new Date().toISOString(),
              value: typeof e.value === "number" ? e.value : 0,
              hadRecentInput: !!e.hadRecentInput,
              sourceCount: sources.length,
              debugOnly,
              sources: sources.map((s) => ({
                node: nodeLabel(s && s.node),
                previousRect: rectToObj(s && s.previousRect),
                currentRect: rectToObj(s && s.currentRect),
              })),
            };
            pushLog(rec);

            try {
              const prefix = debugOnly ? "[IU][CLS][debug-only]" : "[IU][CLS]";
              console.groupCollapsed(
                `${prefix} shift=${rec.value.toFixed(4)} sources=${rec.sourceCount} recentInput=${rec.hadRecentInput}`
              );
              console.log("record:", rec);
              console.log("window.__iuCLSLog (last 10):", window.__iuCLSLog);
              console.groupEnd();
            } catch (_) {}

            // Update real-only total and log occasionally when it changes.
            try {
              if (iuIsDebug) {
                const isRealShift = !rec.hadRecentInput && !rec.debugOnly;
                if (isRealShift) {
                  realTotal += rec.value || 0;
                  window.__iuCLSRealTotal = realTotal;
                  lastRealValue = rec.value || 0;
                  lastRealSources = (rec.sources || [])
                    .map((s) => s && s.node)
                    .filter(
                      (lbl) =>
                        lbl &&
                        lbl.indexOf("iuDebugBox") === -1 &&
                        lbl.indexOf("iuLayoutShiftBox") === -1
                    )
                    .slice(0, 2);
                }

                const now = Date.now();
                const shouldLog =
                  now - lastRealLogAt > 500 && realTotal !== lastRealTotalLogged;
                if (shouldLog) {
                  lastRealLogAt = now;
                  lastRealTotalLogged = realTotal;
                  console.log(
                    `[IU][CLS][real-total] total=${realTotal.toFixed(4)} last=${lastRealValue.toFixed(4)} sources=${lastRealSources.join(", ") || "(none)"}`
                  );
                }
              }
            } catch (_) {}
          }
        } catch (_) {}
      });

      observer.observe({ type: "layout-shift", buffered: true });
      window.__iuCLSObserverInstalled = true;
      window.__iuCLSObserverInstalling = false;

      // Debug-only helper for one-shot runtime capture (no prod impact).
      try {
        if (iuIsDebug && typeof window.__iuDumpCLS !== "function") {
          window.__iuClearCLS = function () {
            try {
              window.__iuCLSShiftEntries = [];
              window.__iuCLSShiftEntriesTotal = 0;
              window.__iuCLSLog = [];
              realTotal = 0;
              lastRealLogAt = 0;
              lastRealTotalLogged = -1;
              lastRealValue = 0;
              lastRealSources = [];
              window.__iuCLSRealTotal = 0;
              return { ok: true };
            } catch (err) {
              return { ok: false, error: String((err && err.message) || err) };
            }
          };
          window.__iuDumpCLS = function () {
            try {
              const fullLog = Array.isArray(window.__iuCLSLog) ? window.__iuCLSLog : [];
              const log = fullLog.slice(Math.max(0, fullLog.length - 30));
              const fullShift = Array.isArray(window.__iuCLSShiftEntries)
                ? window.__iuCLSShiftEntries
                : [];
              const kept = fullShift.slice(Math.max(0, fullShift.length - 200));
              const topShifts = kept
                .slice()
                .sort((a, b) => (b?.value || 0) - (a?.value || 0))
                .slice(0, 20)
                .map((e) => ({
                  value: e?.value || 0,
                  startTime: e?.startTime,
                  sources: Array.isArray(e?.sources) ? e.sources : [],
                }));
              const realTopShifts = kept
                .filter((e) => e && !e.debugOnly && !e.hadRecentInput)
                .slice()
                .sort((a, b) => (b?.value || 0) - (a?.value || 0))
                .slice(0, 10)
                .map((e) => ({
                  value: e?.value || 0,
                  t: e?.t || null,
                  startTime: e?.startTime,
                  sources: Array.isArray(e?.sources) ? e.sources : [],
                }));
              const withSources = kept.filter((e) => (e?.sources || []).length > 0).length;
              const withoutSources = kept.length - withSources;

              function probeRightHeight() {
                try {
                  const el =
                    document.getElementById("iuRight") ||
                    document.querySelector(".iu-rightContent") ||
                    document.querySelector("aside.accordionCol");
                  if (!el || !el.getBoundingClientRect) return null;
                  return round1(el.getBoundingClientRect().height || 0);
                } catch (_) {
                  return null;
                }
              }

              function probeFeedCount() {
                try {
                  const feed = document.getElementById("feed");
                  const scope = feed || document;
                  const n = scope.querySelectorAll(".news-card").length;
                  return typeof n === "number" ? n : null;
                } catch (_) {
                  return null;
                }
              }

              let debugBoxTail = [];
              try {
                const el = document.getElementById("iuDebugBox");
                const txt = el && el.textContent ? String(el.textContent) : "";
                debugBoxTail = txt ? txt.split("\n").slice(-30) : [];
              } catch (_) {}
              return {
                ts: new Date().toISOString(),
                href: String(location.href || ""),
                context: {
                  url: String(location.href || ""),
                  vw: typeof innerWidth === "number" ? innerWidth : null,
                  vh: typeof innerHeight === "number" ? innerHeight : null,
                  dpr: typeof devicePixelRatio === "number" ? devicePixelRatio : null,
                },
                observerInstalled: !!window.__iuCLSObserverInstalled,
                realTotal:
                  typeof window.__iuCLSRealTotal === "number"
                    ? window.__iuCLSRealTotal
                    : window.__iuCLSRealTotal || 0,
                log,
                debugBoxTail,
                topShifts,
                realTopShifts,
                counts: {
                  entriesTotal:
                    typeof window.__iuCLSShiftEntriesTotal === "number"
                      ? window.__iuCLSShiftEntriesTotal
                      : kept.length,
                  entriesKept: kept.length,
                  withSources,
                  withoutSources,
                },
                layoutProbes: {
                  rightHeight: probeRightHeight(),
                  feedItemCount: probeFeedCount(),
                },
              };
            } catch (err) {
              return { error: String((err && err.message) || err) };
            }
          };
        }
      } catch (_) {}

      debugLog("[CLS] observer installed");
    } catch (_) {
      try {
        window.__iuCLSObserverInstalling = false;
      } catch (_) {}
    }
  }

  const lastFetchDiag = {
    articles: null,
    videos: null,
    health: null,
    probe: null,
  };

  async function fetchDiag(url, kind) {
    if (!isDebugLogging) {
      return fetchJsonNoCache(url);
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      const status = response.status;
      const ok = response.ok;
      const redirected = response.redirected;
      const finalUrl = response.url;
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      const head = text.slice(0, 200).replace(/\s+/g, " ");
      const length = text.length;
      const diag = {
        kind,
        url,
        finalUrl,
        status,
        ok,
        redirected,
        contentType,
        length,
        head,
      };
      if (kind in lastFetchDiag) {
        lastFetchDiag[kind] = diag;
      }
      const infoLine = `[FETCHDIAG] kind=${kind} url=${url} status=${status} ok=${ok} redirected=${redirected} finalUrl=${finalUrl} contentType=${contentType}`;
      const headLine = `[FETCHDIAG] kind=${kind} head=${head}`;
      const lengthLine = `[FETCHDIAG] kind=${kind} length=${length}`;
      debugLog(infoLine);
      debugLog(headLine);
      appendDebugLine(infoLine);
      appendDebugLine(headLine);
      appendDebugLine(lengthLine);
      const isLikelyJson =
        contentType.includes("application/json") ||
        text.trim().startsWith("{") ||
        text.trim().startsWith("[");
      if (!isLikelyJson) {
        debugWarn(`[FETCHDIAG] kind=${kind} not JSON`, contentType, head);
        appendDebugLine(`[FETCHDIAG] kind=${kind} not JSON`);
        return null;
      }
      try {
        return JSON.parse(text);
      } catch (parseErr) {
        debugWarn(`[FETCHDIAG] kind=${kind} parse error`, parseErr);
        appendDebugLine(`[FETCHDIAG] kind=${kind} parse error ${parseErr.message || parseErr}`);
        return null;
      }
    } catch (err) {
      debugWarn(`[FETCHDIAG] kind=${kind} fetch failed`, err);
      appendDebugLine(`[FETCHDIAG] kind=${kind} fetch failed ${err.message || err}`);
      return null;
    }
  }

  function formatDiagLine(kind) {
    const diag = lastFetchDiag[kind];
    if (!diag) return `${kind}: (no diag)`;
    return `${kind}: status=${diag.status} ok=${diag.ok} ct=${diag.contentType} final=${diag.finalUrl} len=${diag.length} head="${diag.head}"`;
  }

  // === STATUS HELPERS EXTENSION (maintenance-safe) ===
  window.iuSetDataStatus = function(articlesCount, videosCount){
    const el = document.getElementById("dataStatus");
    if (!el) return;
    el.textContent = `Načteno: ${articlesCount} článků, ${videosCount} videí`;
  };

  window.iuSetDataError = function(msg){
    const el = document.getElementById("lastErrInline");
    if (!el) return;
    el.style.display = "block";
    el.textContent = msg;
  };

  function formatDiagText(itemsLen, typeCounts, feedExists, before, after, renderedCount) {
    const hrefValue = location.href;
    const aUrl = diagMeta.articlesUrl || "-";
    const vUrl = diagMeta.videosUrl || "-";
    const aSt = diagMeta.articlesStatus || "?";
    const vSt = diagMeta.videosStatus || "?";
    return `DIAG | href=${hrefValue} | js=${diagScriptSrc} | aUrl=${aUrl} aSt=${aSt} | vUrl=${vUrl} vSt=${vSt} | items=${itemsLen} | a=${typeCounts.article} v=${typeCounts.video} u=${typeCounts.unknown} | feed=${feedExists} | before=${before} after=${after} rendered=${renderedCount}`;
  }

  function diagLog(tag, info) {
    if (!DEBUG) return;
    console.log("[DIAG]", tag, info);
  }
  // DEBUG KONTRAKT:
  // debug se aktivuje pouze location.search.includes("debug=1")
  // debug je pouze console logging
  // v UI nesmí existovat #debugPanel ani žádný debug box
  // debug nesmí blokovat render ani měnit state.*
  if (isDebugLogging && document.getElementById("debugPanel")) {
    debugWarn("[DEBUG] Unexpected #debugPanel present in DOM (should not exist).");
  }
  const BASE_ROOT = getBaseRoot();
  const DATA_URL = `${BASE_ROOT}data/articles.json`;
  const VIDEOS_URL = `${BASE_ROOT}data/videos.json`;
  const SECTION_LABELS = {
    vse: "Vše",
    aktualne: "Aktuálně",
    doprava: "Doprava",
    pocasi: "Počasí",
    sport: "Sport",
    finance: "Finance",
    krimi: "Krimi",
    zdravi: "Zdraví",
    video: "Video",
  };

  function makeDataUrl(relativePath) {
    if (!relativePath) {
      return BASE_ROOT;
    }
    const sanitized = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
    const base = BASE_ROOT.endsWith("/") ? BASE_ROOT : `${BASE_ROOT}/`;
    return sanitized ? `${base}${sanitized}` : base;
  }

  function withCacheBust(url) {
    const candidate = String(url || "");
    if (!candidate) return "";
    if (!/(articles|videos)\.json/.test(candidate)) return candidate;
    const separator = candidate.includes("?") ? "&" : "?";
    return `${candidate}${separator}v=${Date.now()}`;
  }

  function withTs(url) {
    const u = new URL(url, location.href);
    u.searchParams.set("ts", String(Date.now()));
    return `${u.pathname}?${u.searchParams.toString()}`;
  }

  async function fetchJsonNoCache(url, opts = {}) {
    const {
      timeoutMs = 9000,
      retries = 2,
      backoffMs = 600,
      maxBackoffMs = 2500,
    } = opts;

    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await fetch(withTs(url), {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
          signal: controller.signal,
        });
        clearTimeout(timer);

        const ct = res.headers.get("content-type") || "";
        debugBoxSet(`[FETCH] ${url}\nstatus=${res.status}\nct=${ct}`);

        if (!res.ok) throw new Error(`HTTP_${res.status}`);
        try {
          return await res.json();
        } catch (err) {
          const txt = await res.text().catch(() => "");
          debugWarn("[JSON PARSE FAIL]", url, "head=", txt.slice(0, 120));
          throw err;
        }
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;

        const msg = (e && e.message) ? e.message : String(e);
        const is4xx = msg.startsWith("HTTP_4");
        const isAbort = msg.includes("AbortError");
        const is5xx = msg.startsWith("HTTP_5");
        if (is4xx || (attempt === retries && !is5xx && !isAbort)) {
          break;
        }

        if (attempt === retries) break;

        const wait = Math.min(maxBackoffMs, backoffMs * Math.pow(2, attempt));
        await new Promise((r) => setTimeout(r, wait));
      }
    }

    throw lastErr || new Error("FETCH_FAILED");
  }

  function assertFreshGeneratedAt(data, maxAgeMs = 24 * 60 * 60 * 1000) {
    if (!data || !data.generatedAt) return;
    const t = Date.parse(data.generatedAt);
    if (!Number.isFinite(t)) return;
    if (Date.now() - t > maxAgeMs) throw new Error("STALE_FEED");
  }

  function isSuspiciousTitle(title) {
    if (!title || typeof title !== "string") return false;

    const t = title.trim();

    const deathPatterns = [
      /\bzemřel[ai]\b/i,
      /\bskonal[ai]\b/i,
      /\bumřel[ai]\b/i,
      /\btragick[ýá]\b/i,
    ];

    const oddSuffixPatterns = [
      /O'Haraov[áa]/i,
      /[A-Za-z]\bov[áa]\b/i,
    ];

    const clickbaitPatterns = [
      /\bšok\b/i,
      /\bneuvěřiteln[ěý]\b/i,
      /\btohle\b/i,
      /\bnikdo\b.*\bnečekal\b/i,
    ];

    const hit = (arr) => arr.some((re) => re.test(t));

    if (hit(deathPatterns)) return true;
    if (hit(oddSuffixPatterns) && hit(clickbaitPatterns)) return true;
    if (hit(oddSuffixPatterns)) return true;

    return false;
  }

  function parseProbeTimestamp(raw) {
    if (!raw) return null;
    const str = String(raw).trim();
    const isoMatch = str.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
    if (isoMatch) {
      const parsed = Date.parse(isoMatch[0]);
      if (Number.isFinite(parsed)) return parsed;
    }
    const fallback = Date.parse(str);
    return Number.isFinite(fallback) ? fallback : null;
  }

  function withBust(url) {
    const candidate = String(url || "");
    if (!candidate) return "";
    const separator = candidate.includes("?") ? "&" : "?";
    return `${candidate}${separator}v=${Date.now()}`;
  }

  const PREFERRED_TTL_MS = 48 * 60 * 60 * 1000;
  const PREFERRED_STORAGE_KEY = "iu.preferredUrls";

  function loadPreferredPair() {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(PREFERRED_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.articlesUrl !== "string" || typeof parsed.videosUrl !== "string") {
        return null;
      }
      return {
        articlesUrl: parsed.articlesUrl,
        videosUrl: parsed.videosUrl,
        preferredAt: Number(parsed.preferredAt) || 0,
      };
    } catch {
      return null;
    }
  }

  function savePreferredPair(articlesUrl, videosUrl) {
    if (!articlesUrl || !videosUrl) return false;
    if (typeof localStorage === "undefined") return false;
    try {
      localStorage.setItem(
        PREFERRED_STORAGE_KEY,
        JSON.stringify({ articlesUrl, videosUrl, preferredAt: Date.now() })
      );
      return true;
    } catch {
      return false;
    }
  }

  async function evaluatePreferredPair() {
    const entry = loadPreferredPair();
    if (!entry) {
      return { articlesUrl: null, videosUrl: null, status: "missing" };
    }
    if (!entry.preferredAt || Date.now() - entry.preferredAt > PREFERRED_TTL_MS) {
      return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "expired" };
    }
    const [articlesOk, videosOk] = await Promise.all([
      quickCheckUrl(entry.articlesUrl),
      quickCheckUrl(entry.videosUrl),
    ]);
    if (articlesOk && videosOk) {
      return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "ok" };
    }
    if (!articlesOk) {
      return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "articles-unreachable" };
    }
    return { articlesUrl: entry.articlesUrl, videosUrl: entry.videosUrl, status: "videos-unreachable" };
  }

  function buildCandidateListFromPair(preferredEntry, type, baseSequence) {
    const seen = new Set();
    const list = [];
    const push = (value) => {
      if (!value) return;
      if (seen.has(value)) return;
      seen.add(value);
      list.push(value);
    };
    const preferredUrl = preferredEntry?.[`${type}Url`];
    if (preferredEntry?.status === "ok" && preferredUrl) {
      push(preferredUrl);
    }
    baseSequence.forEach(push);
    if (preferredUrl && preferredEntry?.status !== "ok") {
      push(preferredUrl);
    }
    return list;
  }

  async function quickCheckUrl(url) {
    if (!url) return false;
    const testUrl = withCacheBust(url);
    try {
      const headRes = await timeoutFetch(testUrl, { method: "HEAD", cache: "no-store" }, 2800);
      if (headRes.ok) return true;
      if (headRes.status === 405) {
        const fallback = await timeoutFetch(testUrl, { cache: "no-store" }, 2800);
        return fallback.ok;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function probeRootPaths() {
    const rootArticlesPath = "/projects/data/articles.json";
    const rootVideosPath = "/projects/data/videos.json";
    const [articlesOk, videosOk] = await Promise.all([
      quickCheckUrl(rootArticlesPath),
      quickCheckUrl(rootVideosPath),
    ]);
    return {
      ok: articlesOk && videosOk,
      articlesOk,
      videosOk,
      articlesPath: rootArticlesPath,
      videosPath: rootVideosPath,
    };
  }

  // === DATA ENDPOINT OVERRIDE (maintenance-safe) ===
  (function(){
    const ARTICLES_ENDPOINT = "/projects/data/articles.json";
    const VIDEOS_ENDPOINT   = "/projects/data/videos.json";
    const hasWithCacheBust = typeof window.withCacheBust === "function";

    if (typeof window.makeDataUrl === "function") {
      const _makeDataUrl = window.makeDataUrl;
      window.makeDataUrl = function(type, ...rest){
        if (type === "articles" || type === "article") {
          return hasWithCacheBust ? window.withCacheBust(ARTICLES_ENDPOINT) : ARTICLES_ENDPOINT;
        }
        if (type === "videos" || type === "video") {
          return hasWithCacheBust ? window.withCacheBust(VIDEOS_ENDPOINT) : VIDEOS_ENDPOINT;
        }
        return _makeDataUrl.call(this, type, ...rest);
      };
    }
  })();

  // === PREFLIGHT CHECK FOR DATA ENDPOINTS ===
  (async function preflightDataEndpoints(){
    const endpoints = [
      "/projects/data/articles.json",
      "/projects/data/videos.json"
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { method: "HEAD", cache: "no-store" });
        console.info("[preflight]", url, "→", res.status, res.url);
        if (!res.ok && typeof window.persistLastError === "function") {
          window.persistLastError(`Preflight ${url} → ${res.status}`);
        }
      } catch (err) {
        console.error("[preflight error]", url, err);
        if (typeof window.persistLastError === "function") {
          window.persistLastError(`Preflight ${url} → network error`);
        }
      }
    }
  })();

  async function tryFetchJson(url, timeoutMs = 9000) {
    const requestUrl = withBust(url);
    try {
      const res = await timeoutFetch(
        requestUrl,
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "cache-control": "no-cache",
          },
        },
        timeoutMs,
      );
      const text = await res.text();
      if (!res.ok) {
        const preview = text ? text.slice(0, 200) : "";
        return {
          ok: false,
          url: requestUrl,
          json: null,
          status: res.status,
          error: `HTTP ${res.status} ${preview ? `| ${preview}` : ""}`,
        };
      }
      try {
        const json = JSON.parse(text);
        return { ok: true, url: requestUrl, json, status: res.status, error: null };
      } catch {
        return { ok: false, url: requestUrl, json: null, status: res.status, error: "Invalid JSON" };
      }
    } catch (err) {
      return {
        ok: false,
        url: requestUrl,
        json: null,
        status: 0,
        error: `Fetch failed: ${err && err.message ? err.message : "unknown"}`,
      };
    }
  }

  async function pickFirstWorkingJson(urls, timeoutMs = 9000) {
    let lastError = "";
    for (const url of urls) {
      if (!url) continue;
      const result = await tryFetchJson(url, timeoutMs);
      if (result.ok) {
        return { url: result.url, json: result.json };
      }
      lastError = `[${result.url}] ${result.error}`;
    }
    persistLastError(`DATA fetch failed: ${lastError} | tried ${urls.join(", ")}`);
    return null;
  }

  function normalizeFeedJson(json) {
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json.articles)) return json.articles;
    if (json && Array.isArray(json.videos)) return json.videos;
    if (json && Array.isArray(json.items)) return json.items;
    return [];
  }

  // === DATA RETENTION (sharded articles history) ===
  function dayKeyFromPublished(it){
    const s = String(it?.publishedAt || it?.published || it?.date || it?.time || "").trim();
    return s.length >= 10 ? s.slice(0, 10) : "";
  }

  function canonicalizeUrlForKey(url){
    try{
      const u = new URL(String(url || ""), location.href);
      u.hash = "";
      // remove tracking params
      const drop = new Set(["fbclid","gclid","yclid","cmpid","pk_campaign","pk_source"]);
      for (const [k] of Array.from(u.searchParams.entries())){
        const lk = String(k || "").toLowerCase();
        if (lk.startsWith("utm_") || drop.has(lk)) {
          u.searchParams.delete(k);
        }
      }
      // keep pathname + sanitized query
      return u.toString();
    }catch{
      return String(url || "");
    }
  }

  function retentionKey(it){
    const url = String(it?.url || "").trim();
    if (url) return "url:" + canonicalizeUrlForKey(url);
    const src0 = Array.isArray(it?.sources) ? (it.sources[0] || null) : null;
    const su = String(src0?.url || "").trim();
    if (su) return "url:" + canonicalizeUrlForKey(su);
    const host = (() => { try { return new URL(su).hostname || ""; } catch { return ""; } })();
    const pub = String(it?.publishedAt || "").trim();
    const title = String(it?.title || "").trim();
    return "h:" + [host, pub, title].join("|");
  }

  async function initRetentionIndex(){
    if (state.retentionIsLoading) return;
    state.retentionIsLoading = true;
    try{
      // mark already-loaded days from current cache
      try{
        state.retentionLoadedDays = new Set(
          (Array.isArray(state.cachedItems) ? state.cachedItems : [])
            .filter((x) => x && String(x.contentType || "article").toLowerCase() === "article")
            .map(dayKeyFromPublished)
            .filter(Boolean)
        );
      }catch{
        state.retentionLoadedDays = new Set();
      }

      const indexUrl = "/projects/data/articles/index.json";
      const idx = await fetchDiag(indexUrl, "articles");
      const days = Array.isArray(idx?.days) ? idx.days : [];
      const dates = days
        .map((d) => String(d?.date || "").trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));

      state.retentionDays = dates;
      // advance cursor past already loaded days
      let c = 0;
      while (c < state.retentionDays.length && state.retentionLoadedDays.has(state.retentionDays[c])) c++;
      state.retentionCursor = c;
    }catch{
      state.retentionDays = [];
      state.retentionCursor = 0;
    }finally{
      state.retentionIsLoading = false;
    }
  }

  async function loadRetentionUntilVisibleCount(targetVisibleCount){
    if (!Array.isArray(state.retentionDays) || state.retentionDays.length === 0) return false;
    if (state.retentionIsLoading) return false;
    state.retentionIsLoading = true;
    try{
      const seen = new Set(
        (Array.isArray(state.cachedItems) ? state.cachedItems : [])
          .filter((x) => x && String(x.contentType || "article").toLowerCase() === "article")
          .map(retentionKey)
      );

      while (state.retentionCursor < state.retentionDays.length) {
        // Stop early if we already have enough after filtering
        const curLen = Array.isArray(state.filteredItems) ? state.filteredItems.length : 0;
        if (curLen >= targetVisibleCount) break;

        const day = state.retentionDays[state.retentionCursor++];
        if (!day) continue;
        if (state.retentionLoadedDays.has(day)) continue;
        state.retentionLoadedDays.add(day);

        const dayUrl = `/projects/data/articles/${day}.json`;
        const dayJson = await fetchDiag(dayUrl, "articles");
        const dayItems = normalizeFeedJson(dayJson);
        if (!Array.isArray(dayItems) || dayItems.length === 0) continue;

        for (const it of dayItems) {
          if (!it || typeof it !== "object") continue;
          // ensure contentType stays stable
          if (!it.contentType) it.contentType = "article";
          const k = retentionKey(it);
          if (seen.has(k)) continue;
          seen.add(k);
          state.cachedItems.push(it);
        }

        // keep cachedItems sorted by time desc (matches existing behavior)
        state.cachedItems = (state.cachedItems || []).map((item) => {
          const published =
            (item && String(item.publishedAt || item.published || item.date || item.createdAt || item.uploadedAt || item.time)) ||
            "";
          return { ...item, _ts: published ? Date.parse(published) || 0 : 0 };
        }).sort((a, b) => (b._ts || 0) - (a._ts || 0));

        // recompute filteredItems without resetting page and without rendering
        applyFilter({ resetPage: false, render: false });
      }

      return true;
    } finally {
      state.retentionIsLoading = false;
    }
  }

  function getBaseRoot() {
    let p = location.pathname.replace(/\\/g, "/");
    if (p.endsWith("index.html")) {
      p = p.slice(0, -10);
    }
    if (!p.endsWith("/")) {
      p += "/";
    }
    return p || "/";
  }

  function getBuildStamp() {
    const meta = document.querySelector('meta[name="iu-build"]');
    const value = meta ? (meta.getAttribute("content") || "").trim() : "";
    return value || null;
  }

  const BUILD_STAMP = getBuildStamp();
  debugLog("[BUILD]", BUILD_STAMP || "no-build-stamp");

  function freezeScroll() {
    if (freezeScroll.lock) return;
    freezeScroll.lock = { x: window.scrollX, y: window.scrollY };
    window.requestAnimationFrame(() => {
      window.scrollTo(freezeScroll.lock.x, freezeScroll.lock.y);
      window.requestAnimationFrame(() => window.scrollTo(freezeScroll.lock.x, freezeScroll.lock.y));
    });
  }
  freezeScroll.lock = null;

  function restoreScroll() {
    if (!freezeScroll.lock || restoreScroll.pending) return;
    restoreScroll.pending = true;
    const { x, y } = freezeScroll.lock;
    window.requestAnimationFrame(() => {
      window.scrollTo(x, y);
      window.requestAnimationFrame(() => {
        window.scrollTo(x, y);
        freezeScroll.lock = null;
        restoreScroll.pending = false;
      });
    });
  }
  restoreScroll.pending = false;

  function withScrollLock(fn) {
    freezeScroll();
    try {
      fn();
    } finally {
      restoreScroll();
    }
  }

  function isDebugOn() {
    return isDebugLogging;
  }

  function setDebug(on) {
    const params = new URLSearchParams(location.search);
    if (on) {
      params.set("debug", "1");
    } else {
      params.delete("debug");
    }
    const search = params.toString();
    const next = `${location.pathname}${search ? `?${search}` : ""}`;
    location.replace(next);
  }

  function renderDebugVisibility() {
    const on = isDebugOn();
    if (elDebugPanel) {
      elDebugPanel.style.display = on ? "block" : "none";
    }
    if (btnToggleDebug) {
      btnToggleDebug.textContent = on ? "Vypnout debug" : "Zapnout debug";
    }
  }

  let iuLastStatusLine = "";
  function setStatus(text) {
    if (elStatus) {
      elStatus.textContent = text;
    }
  }
  function iuWriteStatus(line) {
    iuLastStatusLine = String(line || "");
    setStatus(iuLastStatusLine);
  }
  function iuHasStatusPlaceholders(line) {
    const s = String(line || "");
    if (!s) return true;
    const placeholders = [
      "YES|NO",
      "preferred|fallback",
      "OK|NEOK",
      "…",
      "articles=…",
      "videos=…",
      "articles=<…>",
      "videos=<…>",
      "Načteno: články X, videa Y",
      "#feed children: N",
    ];
    if (placeholders.some((token) => s.includes(token))) return true;
    if (s.includes("<") || s.includes(">")) return true;
    if (/\bX\b/.test(s) || /\bY\b/.test(s) || /\bN\b/.test(s)) return true;
    return false;
  }

  function safeText(value) {
    if (value == null) return "";
    return String(value);
  }

  function safeUrl(value) {
    if (!value) return null;
    try {
      const url = new URL(value, location.origin);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.href;
      }
    } catch {
      return null;
    }
    return null;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return safeText(iso);
    return d.toLocaleString("cs-CZ");
  }

  function normalizeItems(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      if (Array.isArray(data.items)) return data.items;
      if (Array.isArray(data.articles)) return data.articles;
    }
    return [];
  }

  function iuExtractYouTubeId(item) {
    if (!item || typeof item !== "object") return null;
    const candidates = [];
    const directId = item.videoId;
    if (typeof directId === "string" && /^[A-Za-z0-9_-]{11}$/.test(directId.trim())) {
      return directId.trim();
    }
    const pushUrl = (value) => {
      if (!value) return;
      try {
        const normalized = new URL(value, location.origin).href;
        candidates.push(normalized);
      } catch {
        candidates.push(String(value));
      }
    };
    if (item.url) pushUrl(item.url);
    if (item.link) {
      if (typeof item.link === "string") pushUrl(item.link);
      else if (item.link.href) pushUrl(item.link.href);
    }
    if (item.canonicalUrl) pushUrl(item.canonicalUrl);
    if (Array.isArray(item.sources)) {
      for (const source of item.sources) {
        if (!source) continue;
        if (typeof source === "string") pushUrl(source);
        else if (source.url) pushUrl(source.url);
        else if (source.href) pushUrl(source.href);
      }
    }
    const patterns = [
      /(?:v=)([A-Za-z0-9_-]{11})/,
      /(?:\/embed\/)([A-Za-z0-9_-]{11})/,
      /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
      /(?:\/shorts\/)([A-Za-z0-9_-]{11})/,
      /(?:\/live\/)([A-Za-z0-9_-]{11})/,
    ];
    for (const candidate of candidates) {
      if (!candidate) continue;
      for (const pattern of patterns) {
        const match = candidate.match(pattern);
        if (match && match[1]) return match[1];
      }
    }
    return null;
  }

  function normalizeVideoList(input) {
    const source =
      Array.isArray(input) ? input
      : (input && Array.isArray(input.videos) ? input.videos
      : (input && Array.isArray(input.items) ? input.items : []));

    return source
      .map((video) => {
        if (!video || typeof video !== "object") return null;
        const inferredId = iuExtractYouTubeId(video);
        if (!video.videoId && inferredId) {
          video.videoId = inferredId;
        }
        const id = video.videoId || inferredId;
        if (!id) return null;
        const published = safeText(video.publishedAt || video.date || video.published || "");
        const url = safeUrl(video.url) || safeUrl(`https://www.youtube.com/watch?v=${id}`);
        if (!url) return null;
        const title = safeText(video.title || video.name || video.headline || "Video");
        return {
          ...video,
          contentType: "video",
          videoId: id,
          title,
          publishedAt: published,
          url,
          channel: safeText(video.channel || video.source || ""),
          section: "video",
          summary: safeText(video.summary || video.description || ""),
        };
      })
      .filter(Boolean);
  }

  function buildCombinedFeed(articles, videos) {
    const normalizedArticles = Array.isArray(articles)
      ? articles.map((item) => ({
          ...item,
          contentType: String(item.contentType || "article").toLowerCase(),
        }))
      : [];

    const normalizedVideos = Array.isArray(videos) ? videos : [];

    const combined = [...normalizedArticles, ...normalizedVideos];
    combined.sort((a, b) => {
      const ta = Number(new Date(a?.publishedAt || a?.date || a?.published || 0));
      const tb = Number(new Date(b?.publishedAt || b?.date || b?.published || 0));
      if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
      if (!Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb)) return -1;
      return tb - ta;
    });

    return combined;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDateShort(value) {
    if (!value) return "";
    let date;
    if (value instanceof Date) {
      date = value;
    } else {
      date = new Date(value);
    }
    if (Number.isNaN(date.getTime())) return "";
    const iso = date.toISOString();
    return iso.replace("T", " ").split(".")[0];
  }

  function getJsonTimestamp(json) {
    if (!json || typeof json !== "object") return "";
    const fields = ["updatedAt", "generatedAt", "buildAt"];
    for (const field of fields) {
      const value = json[field];
      const label = formatDateShort(value);
      if (label) return label;
    }
    return "";
  }

  function getSectionLabelText(keys) {
    const names = keys
      .map((key) => SECTION_LABELS[key] || key)
      .filter(Boolean);
    return names.length ? names.join(", ") : SECTION_LABELS.vse;
  }

  function updateSectionLabel() {
    if (!sectionLabel) return;
    const labelText = getSectionLabelText(activeSections);
    sectionLabel.textContent = `Sekce: ${labelText}`;
  }

  function renderSectionsBar() {
    if (!sectionsBar) return;
    sectionsBar.innerHTML = "";
    SECTION_KEYS.forEach((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secBtn";
      btn.dataset.section = key;
      btn.textContent = SECTION_LABELS[key] || key;
      btn.addEventListener("click", () => handleSectionClick(key));
      sectionsBar.appendChild(btn);
    });
    updateSectionButtons();
  }

  function updateSectionButtons() {
    if (!sectionsBar) return;
    sectionsBar.querySelectorAll(".secBtn").forEach((btn) => {
      const key = btn.dataset.section;
      btn.classList.toggle("isActive", activeSections.includes(key));
    });
  }

  function handleSectionClick(key) {
    if (key === "vse") {
      if (location.hash.replace(/^#/, "") === "vse") {
        setSectionsFromHash();
        applyFilter();
        return;
      }
      location.hash = "#vse";
      return;
    }

    const current = new Set(activeSections.filter((k) => k !== "vse"));
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    const next = SECTION_KEYS.filter((k) => current.has(k));
    const finalSections = next.length ? next : ["vse"];
    const hashValue = finalSections.join(",");
    if (location.hash.replace(/^#/, "") === hashValue) {
      setSectionsFromHash();
      if (isDebugLogging) console.log("[LOAD DEBUG] before applyFilter cached=", state.cachedItems.length);
      applyFilter();
      return;
    }
    location.hash = `#${hashValue}`;
  }

  function setSectionsFromHash() {
    const hash = location.hash.replace(/^#/, "");
    const parsed = hash
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && SECTION_KEYS.includes(s));

    activeSections = parsed.length ? parsed : ["vse"];
    state.sections = new Set(activeSections);
    if (!state.sections || state.sections.size === 0) {
      state.sections = new Set(["aktualne"]);
      activeSections = ["aktualne"];
    }
    updateSectionLabel();
    updateSectionButtons();
  }

  function matchesSections(item, sections = activeSections) {
    if (!item) return false;
    const type = String(item.contentType || "article").toLowerCase();
    if (type === "ad") return true;
    const effectiveSections = sections && sections.length ? sections : ["vse"];
    if (effectiveSections.includes("vse")) return true;
    const sectionValue = ((item.section || item.topic) || "").toLowerCase();
    return effectiveSections.some((section) => section === sectionValue);
  }

  function ensureFeedTarget() {
    let feed = document.getElementById("feed");
    if (feed) return feed;

    const newsList = document.getElementById("newsList");
    if (newsList) {
      feed = document.createElement("div");
      feed.id = "feed";
      newsList.appendChild(feed);
      return feed;
    }

    return null;
  }

  function getFeedTarget() {
    return ensureFeedTarget();
  }

  function insideTarget(target, fallback) {
    return target || fallback;
  }

  const STATUS_SCROLL_KEY = "iu:scrolledToStatus";

  function scrollToStatusOnce() {
    if (!("sessionStorage" in window)) return;
    if (sessionStorage.getItem(STATUS_SCROLL_KEY)) return;
    const el = document.getElementById("dataStatusArticles");
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    sessionStorage.setItem(STATUS_SCROLL_KEY, "1");
  }

  function renderEmpty(message, extraHtml = "") {
    const target = getFeedTarget();
    if (target) {
      withScrollLock(() => {
        // CLS mitigation: avoid mezistav "prázdný feed" (clear a až pak další DOM).
        // Zachovat #sectionsBar jako reálný DOM node, stejně jako v renderFeed().
        const sectionsBar = document.getElementById("sectionsBar");
        if (sectionsBar) target.replaceChildren(sectionsBar);
        else target.replaceChildren();
      });
    }
    if (isDebugLogging) {
      debugLog("[RENDER EMPTY]", { message, cached: state.cachedItems.length });
    }
    if (emptyBox) {
      emptyBox.innerHTML = `<p>${escapeHtml(message)}</p>${extraHtml ? extraHtml : ""}`;
      emptyBox.style.display = "block";
    }
    if (elDataCount) elDataCount.textContent = "0";
  }

  // === LOCKED PIPELINE ===
  // Jakákoli změna této funkce MUSÍ respektovat invarianty feedu.
  // Druhá render cesta je zakázaná.
  function renderFeed(target, items) {
    if (DEBUG) {
      console.log("[renderFeed] items.length:", items.length);
      console.log("[renderFeed] first rows:", items.slice(0, 3));
      console.log(
        "[renderFeed] unique contentTypes:",
        [...new Set(items.map((i) => i.contentType))]
      );
    }
    if (isDebugLogging) {
      const kinds = Array.from(new Set((items || []).map((item) => String(item?.contentType || "unknown"))));
      console.log("[RENDER DEBUG] items.len=", items?.length ?? 0, "samples=", (items || []).slice(0, 3), "types=", kinds);
    }
    const feedEl = document.getElementById("feed");
    const feedExists = !!(feedEl && feedEl.id === "feed");
    const feedChildrenBefore = feedEl ? feedEl.childElementCount : 0;
    const targetSelector = feedEl ? "#feed" : "(missing)";
    diagStartInfo = {
      itemsLen: items ? items.length : 0,
      feedExists,
      childrenBefore: feedChildrenBefore,
    };
    diagLog("renderFeed:start", {
      itemsLen: items ? items.length : 0,
      target: targetSelector,
      feedExists,
      feedChildrenBefore,
    });
    if (!feedEl || feedEl.id !== "feed") {
      persistLastError("Invariant breach: invalid render target");
      return;
    }
    const safeTarget = insideTarget(target, feedEl);
    if (emptyBox) {
      emptyBox.style.display = "none";
      emptyBox.innerHTML = "";
    }
    const beforeChildren = safeTarget.childElementCount;
    // Zachovat #sectionsBar jako reálný DOM node před clear
    const sectionsBar = document.getElementById("sectionsBar");
    if (!items || items.length === 0) {
      renderEmpty("Žádné články k zobrazení. Zkontroluj Stav dat.");
      return;
    }

    // Render-only paging: show at most pageSize*page items, no other slicing elsewhere
    const pageSize = Number(state.pageSize) > 0 ? Number(state.pageSize) : 200;
    const page = Number(state.page) >= 1 ? Number(state.page) : 1;
    const visibleCount = page * pageSize;
    const visibleItems = items.slice(0, visibleCount);
    const hasMore = visibleItems.length < items.length;
    // debug/gate-friendly snapshot (read-only)
    try{ window.__iuFeedPaging = { pageSize, page, visibleCount, totalCount: items.length, visibleCountRendered: visibleItems.length, hasMore }; }catch{}

    // CLS mitigation: žádný mezistav "prázdný feed" (clear + append v cyklu).
    // Postav nový obsah mimo DOM a jednorázově ho vyměň přes replaceChildren().
    const nextNodes = [];
    for (const item of visibleItems) {
      const kind = String(item.contentType || "").toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(kind)) {
        persistLastError("Invariant breach: neznámý contentType");
        renderInlineError("Obsah dočasně nedostupný.");
        return;
      }
      const markup = kind === "video" ? buildVideoAsArticleCard(item) : buildArticleHtml(item);
      if (!markup) {
        persistLastError("Invariant breach: builder returned falsy markup");
        renderInlineError("Obsah se nepodařilo zobrazit. Zkus stránku obnovit.");
        continue;
      }
      const template = document.createElement("template");
      template.innerHTML = markup.trim();
      const node = template.content.firstElementChild;
      if (!node || !(node instanceof HTMLElement)) {
        persistLastError("Invariant breach: builder returned invalid node");
        renderInlineError("Obsah se nepodařilo zobrazit. Zkus stránku obnovit.");
        continue;
      }
      nextNodes.push(node);
    }

    // "Load more" button (no infinite auto-load)
    let loadMoreWrap = null;
    const canLoadRetention =
      Boolean(state.retentionIsLoading) ||
      (Array.isArray(state.retentionDays) && state.retentionCursor < state.retentionDays.length);
    if (hasMore || canLoadRetention) {
      const wrap = document.createElement("div");
      wrap.className = "iuLoadMoreWrap";
      wrap.innerHTML = `
        <button type="button" class="iuLoadMoreBtn" aria-label="Načíst další stránku">
          Načíst další stránku
        </button>
        <div class="iuLoadMoreMeta">${visibleItems.length} / ${items.length}${canLoadRetention ? "+" : ""}</div>
      `.trim();
      loadMoreWrap = wrap;
    }

    if (sectionsBar) {
      if (loadMoreWrap) safeTarget.replaceChildren(sectionsBar, ...nextNodes, loadMoreWrap);
      else safeTarget.replaceChildren(sectionsBar, ...nextNodes);
    } else {
      if (loadMoreWrap) safeTarget.replaceChildren(...nextNodes, loadMoreWrap);
      else safeTarget.replaceChildren(...nextNodes);
    }

    const feedChildrenAfter = safeTarget.childElementCount;
    const renderedCount = nextNodes.length;
    const typeCounts = visibleItems.reduce(
      (acc, entry) => {
        const kind = String(entry.contentType || "").toLowerCase();
        if (kind === "article") acc.article += 1;
        else if (kind === "video") acc.video += 1;
        else acc.unknown += 1;
        return acc;
      },
      { article: 0, video: 0, unknown: 0 }
    );
    diagLog("renderFeed:end", {
      itemsCount: items.length,
      visibleCount: visibleItems.length,
      pageSize,
      page,
      renderedCount,
      feedChildrenAfter,
      typeCounts,
      hasMore,
    });
    if (diagStartInfo) {
      updateDiagBar(
        formatDiagText(
          diagStartInfo.itemsLen,
          typeCounts,
          diagStartInfo.feedExists,
          diagStartInfo.childrenBefore,
          feedChildrenAfter,
          renderedCount
        )
      );
    }
    if (items.length > 0 && renderedCount === 0) {
      safeTarget.insertAdjacentHTML(
        "beforeend",
        `<div class="empty" style="margin-top:10px;color:rgba(11,27,43,0.7);font-weight:600;">Data načtena, ale nic se nevykreslilo. Obnov stránku.<br /><small>${items.length} položek</small></div>`
      );
      const preview = items.slice(0, 3).map((it) => `${it.contentType || "unknown"}:${it.title || it.name || "(bez názvu)"}`);
      diagLog("renderFeed:fallback", {
        preview,
        feedChildrenAfter,
      });
      persistLastError("Data existují, ale nic nebylo vykresleno");
      renderInlineError("Obsah se nepodařilo zobrazit. Zkus stránku obnovit.");
      setStatus("Stav dat: chyba (viz feed)");
      return;
    }
    if (elDataCount) elDataCount.textContent = String(items.length);

    // wire load more click (new node each render, safe)
    if (loadMoreWrap) {
      const btn = loadMoreWrap.querySelector(".iuLoadMoreBtn");
      if (btn) {
        btn.addEventListener("click", () => {
          const nextPage = (Number(state.page) >= 1 ? Number(state.page) : 1) + 1;
          state.page = nextPage;
          const desiredVisible = nextPage * pageSize;
          (async () => {
            // If we need older data beyond the current cache, fetch day-shards lazily (no auto-load).
            if (desiredVisible > (state.filteredItems?.length ?? 0)) {
              const prevText = btn.textContent;
              try{
                btn.disabled = true;
                btn.textContent = "Načítám…";
                await loadRetentionUntilVisibleCount(desiredVisible);
              }catch{}
              btn.disabled = false;
              btn.textContent = prevText;
            }
            renderFeed(safeTarget, state.filteredItems);
          })();
        });
      }
    }
    if (!Array.isArray(state.cachedItems)) {
      persistLastError("Invariant breach: state.cachedItems není pole");
      renderInlineError("Obsah dočasně nedostupný.");
      return;
    }
    for (const it of state.cachedItems) {
      if (!it || !it.contentType) {
        persistLastError("Invariant breach: položka bez contentType");
        renderInlineError("Obsah dočasně nedostupný.");
        break;
      }
    }
  }

  function renderInlineError(message) {
    const inline = document.getElementById("lastErrInline");
    if (!inline) return;
    inline.textContent = message;
    inline.style.display = "block";
    inline.style.opacity = "1";
  }

  function renderItems(items) {
    const target = getFeedTarget();
    renderFeed(target, items);
  }

  function renderFeedItemHtml(item) {
    if (!item) return "";
    const type = String(item.contentType || "article").toLowerCase();
    if (type === "video") return buildVideoAsArticleCard(item);
    if (type === "ad") return buildAdHtml(item);
    return buildArticleHtml(item);
  }

  function normalizeMediaName(name) {
    if (!name || typeof name !== "string") return "";
    const normalized = name.toLowerCase().trim();
    
    // Mapování variant názvů médií na canonical tvar
    const mediaMap = {
      "česká televize": "ct24",
      "ceska televize": "ct24",
      "ct24": "ct24",
      "irozhlas": "irozhlas",
      "irozhlas.cz": "irozhlas",
      "irozhlas sport": "irozhlas-sport",
      "idnes": "idnes",
      "idnes.cz": "idnes",
      "seznam zpravy": "seznamzpravy",
      "seznam zprávy": "seznamzpravy",
      "seznamzpravy": "seznamzpravy",
    };
    
    return mediaMap[normalized] || normalized;
  }

  function renderSourcesMetaLine(it) {
    const srcRaw = Array.isArray(it.sources) ? it.sources : [];
    const seen = new Set();
    const src = [];

    for (const s of srcRaw) {
      const name = (s?.name || "").trim();
      const url = (s?.url || "").trim();
      if (!name || !url) continue;

      // Normalizace URL: base URL bez query params a hash
      const urlBase = url.split('?')[0].split('#')[0].toLowerCase();
      
      // Normalizace názvu média
      const canonicalName = normalizeMediaName(name);
      
      // Klíč pro deduplikaci: base URL + canonical name
      const key = `${urlBase}||${canonicalName}`;
      
      if (seen.has(key)) continue;
      seen.add(key);
      src.push({ name, url });
    }

    if (!src.length) return "";

    const primary = src[0];
    const others = src.slice(1);

    const dateText = fmtDate(it.publishedAt || it.date || it.published || "");
    const datePart = dateText ? `<span class="iu-meta-date">${escapeHtml(dateText)}</span>` : "";
    const primaryPart = `<span class="iu-meta-src">Zdroj: <a class="iu-meta-link" href="${escapeHtml(primary.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(primary.name)}</a></span>`;

    const othersPart = others.length
      ? `<span class="iu-meta-others">Píší také: ${others.map(o =>
          `<a class="iu-meta-link iu-meta-link-secondary" href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(o.name)}</a>`
        ).join(", ")}</span>`
      : "";

    const sep = datePart ? `<span class="iu-meta-sep"> | </span>` : "";
    const sep2 = othersPart ? `<span class="iu-meta-sep"> | </span>` : "";

    return `<div class="iu-meta-line">${datePart}${sep}${primaryPart}${sep2}${othersPart}</div>`;
  }

  function buildArticleHtml(it) {
    const title = safeText(it.title || it.name || "(bez názvu)");
    const linkUrl =
      it.url ||
      (Array.isArray(it.sources) ? (it.sources.find((s) => s && s.url && s.url.trim())?.url || "") : "") ||
      (it.canonicalUrl || "") ||
      (typeof it.link === "string"
        ? it.link
        : (it.link && typeof it.link === "object" ? (it.link.href || it.link.url || "") : ""));
    if (!linkUrl) {
      persistLastError("Article without URL skipped");
      return "";
    }
    
    const titleMarkup = linkUrl
      ? `<a class="news-titleLink" href="${linkUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`
      : `<span class="news-titleLink">${escapeHtml(title)}</span>`;

    const suspiciousFlag = it?.suspiciousTitle
      ? `<span class="iuSuspicious" title="Titulek doporučeno ověřit u zdroje" aria-label="Titulek doporučeno ověřit u zdroje">⚑</span>`
      : "";

    const sourcesMetaLine = renderSourcesMetaLine(it);

    debugLog("[RENDER ARTICLE]", title);
    return `
      <article class="news-card" data-feed-type="article">
        <h2 class="news-title">${titleMarkup}${suspiciousFlag}</h2>
        ${sourcesMetaLine}
      </article>
    `;
  }

function buildVideoAsArticleCard(it) {
    const title = safeText(it.title || "Video");
    const augmentedTitle = `VIDEO: ${title}`;
    const publishedAt = fmtDate(it.publishedAt || it.date || it.published || "");
    const channel = safeText(it.channel || "YouTube");
    const url =
      safeUrl(it.url) ||
      (it.videoId ? `https://www.youtube.com/watch?v=${it.videoId}` : "");
    const titleMarkup = url
      ? `<a class="news-titleLink" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(
          augmentedTitle
        )}</a>`
      : `<span class="news-titleLink">${escapeHtml(augmentedTitle)}</span>`;

    return `
      <article class="news-card" data-feed-type="video">
        <h2 class="news-title">${titleMarkup}</h2>
        <div class="news-row2">
          ${publishedAt ? `<span class="meta-time">${escapeHtml(publishedAt)}</span>` : ""}
          <span class="news-sourceLabel">Zdroj:</span>
          <span class="news-sources">
            <span class="sourceDomain">${escapeHtml(channel)}</span>
          </span>
        </div>
        ${publishedAt ? `<div class="news-row3"><span class="meta-time">Publikováno: ${escapeHtml(publishedAt)}</span></div>` : ""}
      </article>
    `;
  }

  function buildAdHtml(it) {
    const label = escapeHtml(it.adLabel || "Reklamní okýnko");
    const slot = escapeHtml(it.adSlot || "slot");
    return `
      <article class="ad-card" aria-hidden="true">
        <div class="ad-head">
          <span class="pos">${slot}</span>
          <span class="ad-label">${label}</span>
        </div>
      </article>
    `;
  }

  function ensureFallbackMessage() {
    const target = getFeedTarget();
    if (!target) return;
    if (target.children.length > 0) return;
    if (emptyBox && emptyBox.textContent.trim()) return;
    renderEmpty("Žádná data k zobrazení. Zkontroluj Stav dat.");
  }

  function iuComputeTopbarStackH(){
    try{
      const bars = Array.from(document.querySelectorAll(".iuBar, .topbar"));
      const visible = bars.filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.height > 0.5;
      });

      const total = Math.round(
        visible.reduce((sum, el) => sum + el.getBoundingClientRect().height, 0)
      );

      document.documentElement.style.setProperty("--topbarStackH", Math.max(total, 0) + "px");
    }catch(e){}
  }

  function iuInitTopbarWatcher(){
    iuComputeTopbarStackH();
    window.addEventListener("load", iuComputeTopbarStackH, { passive: true });

    let t = 0;
    window.addEventListener("resize", () => {
      clearTimeout(t);
      t = setTimeout(iuComputeTopbarStackH, 120);
    }, { passive: true });

    const mo = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(iuComputeTopbarStackH, 60);
    });

    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  }

  function writeDebug(obj) {
    if (!elDebugOut) return;
    try {
      elDebugOut.textContent = safeStringify(obj, null, 2);
    } catch {
      elDebugOut.textContent = String(obj);
    }
  }

  function openSearchModal() {
    if (searchModal) searchModal.classList.add("show");
  }

  function hideSearchModal() {
    if (searchModal) searchModal.classList.remove("show");
  }

  function resetSearchAndReload() {
    if (searchInput) searchInput.value = "";
    hideSearchModal();
    applyFilter();
  }

  // === LOCKED PIPELINE ===
  // Jakákoli změna této funkce MUSÍ respektovat invarianty feedu.
  // Druhá render cesta je zakázaná.
  function applyFilter(opts) {
    const options = opts && typeof opts === "object" ? opts : {};
    const resetPage = options.resetPage !== false; // default: reset
    const doRender = options.render !== false;     // default: render
    if (!state.hasLoadedData) return;
    state.searchQuery = (searchInput && searchInput.value.trim()) || "";
    // paging reset on any filter/search change (render-only)
    if (resetPage) state.page = 1;

    // SAFETY: pokud není aktivní žádné téma/sekce/filtr ani hledání, zobraz rovnou celý cache feed
    const hasTopic = !!(state && state.activeTopic);
    const hasSection = !!(state && state.activeSection);
    const hasFilter = !!(state && state.activeFilter);
    const hasQuery = !!(state && typeof state.searchQuery === "string" && state.searchQuery.trim().length);

    if (!hasTopic && !hasSection && !hasFilter && !hasQuery) {
      state.filteredItems = Array.isArray(state.cachedItems) ? state.cachedItems.slice() : [];
      if (doRender) renderItems(state.filteredItems);
      return;
    }
    if (DEBUG) {
      console.log("[applyFilter] cachedItems before filter:", state.cachedItems.length);
    }

    if (isDebugLogging) {
      console.log("[FILTER DEBUG] cachedItems.len=", state.cachedItems?.length ?? 0);
    }

    if (
      !state.activeSection &&
      !state.activeTopic &&
      !state.activeFilter
    ) {
      state.filteredItems = Array.isArray(state.cachedItems)
        ? state.cachedItems.slice()
        : [];
      if (doRender) renderItems(state.filteredItems);
      return;
    }

    if (
      !state.activeSection &&
      !state.activeTopic &&
      !state.activeFilter
    ) {
      state.filteredItems = Array.isArray(state.cachedItems)
        ? state.cachedItems.slice()
        : [];
      if (doRender) renderItems(state.filteredItems);
      return;
    }

    debugLog(
      "[FILTER]",
      "section:", state.activeSection,
      "topic:", state.activeTopic,
      "filter:", state.activeFilter,
      "cached:", state.cachedItems?.length,
      "filtered:", state.filteredItems?.length
    );
    const query = state.searchQuery || "";
    const normalizedQuery = query.toLowerCase();
    const sectionsToUse = activeSections && activeSections.length ? activeSections : ["vse"];
    let filtered = state.cachedItems.filter((item) => matchesSections(item, sectionsToUse));
    if (normalizedQuery) {
      filtered = filtered.filter((item) => {
        const type = String(item.contentType || "article").toLowerCase();
        if (type === "ad") return true;
        const haystackData = [
          item.title,
          item.name,
          item.summary,
          item.section,
          item.topic,
          item.channel,
          ...(Array.isArray(item.sources) ? item.sources.map((s) => s.name || s.title || s) : []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystackData.includes(normalizedQuery);
      });
    }
    state.filteredItems = filtered;
    if (DEBUG) {
      console.log("[applyFilter] filteredItems after filter:", filtered.length);
      console.log("[applyFilter] first filtered items:", filtered.slice(0, 3));
    }

    if (isDebugLogging) {
      console.log("[FILTER DEBUG] filteredItems.len=", state.filteredItems?.length ?? 0);
    }

    if (filtered.length === 0) {
      if (query) {
        if (doRender) openSearchModal();
      } else {
        if (doRender) hideSearchModal();
        renderInlineError("Filtry nenašly žádné články.");
      }
      if (doRender) setStatus(`Stav dat: OK (zobrazeno: 0 / celkem: ${state.cachedItems.length})`);
      if (isDebugOn()) {
        writeDebug({
          sections: activeSections,
          hash: location.hash,
          search: query,
          totalItems: state.cachedItems.length,
          filtered: 0,
        });
      }
      return;
    }
    if (!Array.isArray(state.filteredItems)) {
      persistLastError("Invariant breach: filteredItems is not array");
      state.filteredItems = [];
    }

    if (doRender) {
      hideSearchModal();
      renderItems(filtered);
      setStatus(`Stav dat: OK (zobrazeno: ${filtered.length} / celkem: ${state.cachedItems.length})`);
    }
    if (isDebugOn()) {
      writeDebug({
        sections: activeSections,
        hash: location.hash,
        search: query,
        totalItems: state.cachedItems.length,
        filtered: filtered.length,
      });
    }
  }

    ensureFallbackMessage();


  let firstLoadQuiet = false;

  function safeNumber(value, fallback = 0) {
    const num = Number(value);
    if (Number.isNaN(num)) {
      debugWarn("[SAFE] invalid number", value);
      return fallback;
    }
    return num;
  }

  const selfDiag = {
    build: getBuildStamp() || "no-build",
    articlesState: "INIT",
    articlesCount: "-",
    videosState: "INIT",
    videosCount: "-",
    swController: "no",
    swWaiting: "no"
  };

  let refreshInProgress = false;

  async function softRefreshData() {
    if (refreshInProgress) return;
    refreshInProgress = true;
    debugLog("[REFRESH] start");
    try {
      await Promise.all([fetchArticlesStatus(), fetchVideosStatus()]);
      await loadData();
    } catch (error) {
      debugWarn("[REFRESH] error", error && error.message ? error.message : error);
    } finally {
      refreshInProgress = false;
      debugLog("[REFRESH] done");
    }
  }

  function safeDateParse(value) {
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        debugWarn("[DATE] invalid", value);
        return null;
      }
      return date;
    } catch {
      debugWarn("[DATE] invalid", value);
      return null;
    }
  }

  function logSelfStatus() {
    debugLog(`[SELF] build=${selfDiag.build}`);
    debugLog(`[SELF] articles=${selfDiag.articlesState} count=${selfDiag.articlesCount}`);
    debugLog(`[SELF] videos=${selfDiag.videosState} count=${selfDiag.videosCount}`);
    debugLog(`[SELF] swController=${selfDiag.swController} swWaiting=${selfDiag.swWaiting}`);
  }

  function renderDiagBox() {
    const isDiag = new URLSearchParams(location.search).get("diag") === "1";
    if (!isDiag) return;
    const box = document.createElement("div");
    box.id = "iuDiagBox";
    const updatedLabel = document.getElementById("dataStatusUpdated")?.textContent || "Aktualizace: —";
    const swLabel = document.getElementById("dataStatusSW")?.textContent || "SW: —";
    const lastError = localStorage.getItem("iu:lastError") || "—";
    const lastOkAt = localStorage.getItem("iu:lastArticlesOkAt") || "—";
    const lastOkCount = localStorage.getItem("iu:lastArticlesCount") || "—";
    box.innerHTML = `
      <div style="padding:8px;border:1px solid rgba(0,0,0,0.14);background:#fff;margin:6px;">
        <p><strong>diag</strong></p>
        <p>build: ${selfDiag.build}</p>
        <p>articles: ${selfDiag.articlesState} count=${selfDiag.articlesCount}</p>
        <p>videos: ${selfDiag.videosState} count=${selfDiag.videosCount}</p>
        <p>${updatedLabel}</p>
        <p>${swLabel}</p>
        <p>lastError: ${lastError}</p>
        <p>last OK: ${lastOkAt} / ${lastOkCount}</p>
      </div>
    `;
    document.body.insertBefore(box, document.body.firstChild);
  }

  const eventThrottleMs = 500;
  const eventLastTs = new Map();

  function addTelemetryEvent(name, detail = "") {
    try {
      const raw = localStorage.getItem("iu:events");
      const parsed = raw ? JSON.parse(raw) : [];
      const arr = Array.isArray(parsed) ? parsed : [];
      const now = Date.now();
      const last = eventLastTs.get(name) || 0;
      if (now - last < eventThrottleMs) {
        debugLog("[EVENT] throttled", name);
        return;
      }
      eventLastTs.set(name, now);
      arr.push({ t: new Date().toISOString(), name, detail });
      while (arr.length > 10) arr.shift();
      localStorage.setItem("iu:events", safeStringify(arr));
      updateEventsUI();
    } catch {
      // ignore
    }
  }

  function safeStringify(value, replacer = null, space = 0) {
    try {
      return JSON.stringify(value, replacer, space);
    } catch {
      return "";
    }
  }

  function updateEventsUI() {
    const el = document.getElementById("dataStatusEvents");
    if (!el) return;
    try {
      const raw = localStorage.getItem("iu:events");
      const arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr) || !arr.length) {
        el.textContent = "Události: —";
        return;
      }
      const latest = arr.slice(-5);
      el.innerHTML = "Události:<br />" + latest.map((item) => `${new Date(item.t).toLocaleTimeString("cs-CZ")} ${item.name}`).join("<br />");
    } catch {
      el.textContent = "Události: chybné data";
    }
  }

  function updateLastArticlesInfo(count, updatedAt) {
    const prevCount = localStorage.getItem("iu:lastArticlesCount");
    const now = new Date().toISOString();
    try {
      localStorage.setItem("iu:lastArticlesOkAt", now);
      localStorage.setItem("iu:lastArticlesCount", String(count));
      localStorage.setItem("iu:lastArticlesUpdatedAt", updatedAt || "");
      if (prevCount !== null && prevCount !== String(count)) {
        debugLog("[DIFF] articles count", prevCount, "->", count);
        localStorage.setItem("iu:lastArticlesDiffAt", now);
      }
    } catch {
      // ignore
    }
    const label = document.getElementById("dataStatusUpdated");
    if (!label) return;
    const lastOkTime = new Date(now).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
    const updatedText = updatedAt ? fmtTime(updatedAt) : "neznámá";
    let ageWarning = "";
    if (updatedAt) {
      const parsed = safeDateParse(updatedAt);
      if (parsed) {
        const ageMinutes = Math.floor((Date.now() - parsed.getTime()) / 60000);
        if (ageMinutes > 360) {
          const hours = Math.floor(ageMinutes / 60);
          ageWarning = ` Zastaralé (${hours} h)`;
        }
      }
    }
    label.textContent = `Aktualizace: ${updatedText} (last OK: ${lastOkTime}, count: ${count})${ageWarning}`;
  }

  function finalStateReport() {
    const updatedAt = localStorage.getItem("iu:lastArticlesUpdatedAt") || "—";
    const parsedUpdated = safeDateParse(updatedAt);
    const dataAgeMin = parsedUpdated
      ? Math.round((Date.now() - parsedUpdated.getTime()) / 60000)
      : null;
    const report = {
      build: selfDiag.build || "no-build",
      online: navigator.onLine ? "yes" : "no",
      articlesStatus: selfDiag.articlesState,
      articlesCount: selfDiag.articlesCount,
      videosStatus: selfDiag.videosState,
      videosCount: selfDiag.videosCount,
      updatedAt: updatedAt === "" ? "—" : updatedAt,
      dataAgeMin,
      swController: selfDiag.swController,
      swWaiting: selfDiag.swWaiting,
      lastErrorAt: localStorage.getItem("iu:lastErrorAt") || "—",
      lastError: localStorage.getItem("iu:lastError") || "—"
    };
    debugLog("[STATE]", report);
  }

  logSelfStatus();

  function updateBuildStatusLabel() {
    const build = getBuildStamp() || "no-build";
    const seen = localStorage.getItem("iu:lastBuildSeen") || "";
    const label = document.getElementById("dataStatusBuild");
    if (!label) return;
    if (seen && seen !== build) {
      debugWarn("[BUILD] mismatch seen/current", seen, build);
      label.textContent = `Build: ${build} (změna)`;
    } else {
      label.textContent = `Build: ${build}`;
    }
  }

  function recordBuildSeen() {
    const build = getBuildStamp();
    if (!build) return;
    const prev = localStorage.getItem("iu:lastBuildSeen");
    const now = new Date().toISOString();
    try {
      localStorage.setItem("iu:lastBuildSeen", build);
      localStorage.setItem("iu:lastBuildSeenAt", now);
    } catch {
      // ignore
    }
    if (prev && prev !== build) {
      debugLog("[BUILD] changed", prev, "->", build);
    }
  }

  async function nukeCachesAndSwOnBuildChange() {
    const build = getBuildStamp() || "no-build";
    const prev = localStorage.getItem("iu:lastBuildHard") || "";
    if (prev === build) return;
    try {
      localStorage.setItem("iu:lastBuildHard", build);
    } catch (_) {}
    debugWarn("[BUILD] change detected -> clearing caches + SW", prev, "->", build);

    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        debugLog("[BUILD] caches cleared", keys);
      }
    } catch (err) {
      debugWarn("[BUILD] caches clear failed", err);
    }

    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        debugLog("[BUILD] service workers unregistered", regs.length);
      }
    } catch (err) {
      debugWarn("[BUILD] sw unregister failed", err);
    }

    try {
      sessionStorage.removeItem("iu:swReloaded");
      sessionStorage.removeItem("iu:swReloadedAt");
      sessionStorage.removeItem("iu:scrolledToStatus");
    } catch (_) {}

    window.location.reload();
  }

  function timeoutFetch(url, options = {}, ms = 10000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
  }

  function resolveArray(data, fields) {
    if (Array.isArray(data)) return data;
    for (const field of fields) {
      if (Array.isArray(data?.[field])) return data[field];
    }
    return null;
  }

  const ARTICLE_RETRY_DELAYS = [2000, 6000];

  let loggedEmptyTitle = false;
  function normalizeArticleList(items) {
    return items.filter((it) => {
      const hasTitle = Boolean(it?.title || it?.headline || it?.name);
      const link = it?.url || it?.link || it?.href;
      let validLink = false;
      if (link) {
        try {
          new URL(link, location.origin);
          validLink = true;
        } catch {
          debugWarn("[DATA] invalid URL", link);
        }
      }
      if (!hasTitle && !loggedEmptyTitle) {
        debugWarn("[DATA] missing article title, substituting fallback");
        loggedEmptyTitle = true;
      }
      if (!hasTitle) {
        if (it) {
          it.title = "Bez názvu";
        }
      }
      return hasTitle && validLink;
    });
  }

  async function fetchArticlesStatus(attempt = 1) {
    const el = document.getElementById("dataStatusArticles");
    if (!el) return;
    try {
      const res = await timeoutFetch(makeDataUrl("data/articles.json"), { cache: "no-store" }, 9000);
      if (!res.ok) {
        el.textContent = `Články: chyba (${res.status})`;
        selfDiag.articlesState = "FAIL";
        selfDiag.articlesCount = "-";
        logSelfStatus();
        return;
      }
      const data = await res.json();
      const size = safeStringify(data).length;
      debugLog("[DATA] size=", size);
      const items = resolveArray(data, ["items", "articles"]);
      const validItems = items ? normalizeArticleList(items) : [];
      if (items && validItems.length < items.length) {
        debugWarn("[DATA] filtered invalid items", items.length, "->", validItems.length);
      }
      if (!items) {
        el.textContent = "Články: chyba formátu";
        debugWarn("[DATA] articles schema unexpected", Object.keys(data || {}));
        selfDiag.articlesState = "FAIL";
        selfDiag.articlesCount = "-";
        logSelfStatus();
        return;
      }
      const updatedAtValue = data?.updatedAt ?? data?.updated_at ?? null;
      const count = safeNumber(validItems.length);
      const ageMinutes = updatedAtValue ? Math.floor((Date.now() - new Date(updatedAtValue).getTime()) / 60000) : 0;
      if (!items.length || !count) {
        el.textContent = "Články: prázdné";
        selfDiag.articlesState = "EMPTY";
        selfDiag.articlesCount = "0";
        logSelfStatus();
        updateLastArticlesInfo(count, updatedAtValue);
        addTelemetryEvent("articles", `EMPTY count=${count}`);
        return;
      }
      if (ageMinutes > 1440 && !firstLoadQuiet) {
        el.textContent = "Články: zastaralé (24h+)";
        debugWarn("[DATA] articles too old");
      } else {
        el.textContent = `Články: OK (${count})`;
      }
      selfDiag.articlesState = "OK";
      selfDiag.articlesCount = String(count);
      logSelfStatus();
      updateLastArticlesInfo(count, updatedAtValue);
      addTelemetryEvent("articles", `OK count=${count} updated=${updatedAtValue || "—"}`);
      const firstItem = validItems[0] || {};
      const firstTitle = firstItem.title || firstItem.headline || firstItem.name || "—";
      debugLog("[SELF] firstTitle=", firstTitle);
      const dates = validItems
        .map((item) => item.publishedAt || item.date || item.published || "")
        .map((value) => new Date(value))
        .filter((d) => !Number.isNaN(d.getTime()))
        .map((d) => d.getTime());
      for (let i = 1; i < dates.length; i += 1) {
        if (dates[i] > dates[i - 1]) {
          debugWarn("[DATA] articles not sorted");
          break;
        }
      }
    } catch (err) {
      el.textContent = "Články: chyba";
      selfDiag.articlesState = "FAIL";
      selfDiag.articlesCount = "-";
      logSelfStatus();
      if (attempt <= ARTICLE_RETRY_DELAYS.length) {
        const delay = ARTICLE_RETRY_DELAYS[attempt - 1];
        debugWarn("[RETRY] articles attempt", attempt);
        el.textContent = `Články: retry (${attempt})`;
        setTimeout(() => fetchArticlesStatus(attempt + 1), delay);
      }
      if (err?.name === "AbortError") {
        addTelemetryEvent("timeout", "articles");
        if (!firstLoadQuiet) {
          el.textContent = "Články: timeout";
        }
      }
      addTelemetryEvent("articles", `FAIL attempt=${attempt} err=${err && err.message ? err.message : "timeout"}`);
    }
  }

  async function fetchVideosStatus() {
    const el = document.getElementById("dataStatusVideos");
    if (!el) return;
    try {
      const res = await timeoutFetch(makeDataUrl("data/videos.json"), { cache: "no-store" }, 9000);
      if (res.status === 404) {
        el.textContent = "Videa: není k dispozici";
        selfDiag.videosState = "404";
        selfDiag.videosCount = "-";
        logSelfStatus();
        addTelemetryEvent("videos", "404");
        return;
      }
      if (!res.ok) {
        el.textContent = `Videa: chyba (${res.status})`;
        selfDiag.videosState = "FAIL";
        selfDiag.videosCount = "-";
        logSelfStatus();
        addTelemetryEvent("videos", `FAIL status=${res.status}`);
        return;
      }
      const data = await res.json();
      const size = safeStringify(data).length;
      debugLog("[DATA] size=", size);
      const items = resolveArray(data, ["items", "videos"]);
      if (!items) {
        el.textContent = "Videa: chyba formátu";
        debugWarn("[DATA] videos schema unexpected", Object.keys(data || {}));
        selfDiag.videosState = "FAIL";
        selfDiag.videosCount = "-";
        logSelfStatus();
        return;
      }
      if (!items.length) {
        el.textContent = "Videa: prázdná";
        selfDiag.videosState = "EMPTY";
        selfDiag.videosCount = "0";
        logSelfStatus();
        addTelemetryEvent("videos", "EMPTY");
        return;
      }
      el.textContent = `Videa: OK (${items.length})`;
      selfDiag.videosState = "OK";
      selfDiag.videosCount = String(items.length);
      logSelfStatus();
      addTelemetryEvent("videos", `OK count=${items.length}`);
    } catch (err) {
      el.textContent = "Videa: chyba";
      selfDiag.videosState = "FAIL";
      selfDiag.videosCount = "-";
      logSelfStatus();
      addTelemetryEvent("videos", "FAIL timeout");
      if (err?.name === "AbortError") {
        addTelemetryEvent("timeout", "videos");
        if (!firstLoadQuiet) {
          el.textContent = "Videa: timeout";
        }
      }
    }
  }

  function isLatestLoadRequest(id) {
    return id === state.loadRequestId;
  }

  function iuBuildDiagStatusLine({
    preferredSaved,
    preferredModeUsed,
    articlesOk,
    videosOk,
    chosenArticlesUrl,
    chosenVideosUrl,
    countArticles,
    countVideos,
    feedChildren,
    generatedAtArticles,
    generatedAtVideos,
    articlesKeys,
    videosKeys,
    effectiveUpdatedAtArticles,
    effectiveUpdatedAtVideos,
  }) {
    const ps = preferredSaved ? "YES" : "NO";
    const pm = preferredModeUsed === "preferred" ? "preferred" : "fallback";
    const as = articlesOk ? "OK" : "NEOK";
    const vs = videosOk ? "OK" : "NEOK";
    const au = chosenArticlesUrl || "-";
    const vu = chosenVideosUrl || "-";
    const ca = Number.isFinite(countArticles) ? countArticles : 0;
    const cv = Number.isFinite(countVideos) ? countVideos : 0;
    const fc = Number.isFinite(feedChildren) ? feedChildren : 0;
    const ga = generatedAtArticles || "none";
    const gv = generatedAtVideos || "none";
    return [
      `preferred saved: ${ps}`,
      `preferred mode used: ${pm}`,
      `articles status: ${as} | videos status: ${vs}`,
      `Vybrané URL: articles=${au} , videos=${vu}`,
      `Načteno: články ${ca}, videa ${cv}`,
      `#feed children: ${fc}`,
      `generatedAt articles: ${ga}`,
      `generatedAt videos: ${gv}`,
      `effective updatedAt articles: ${effectiveUpdatedAtArticles}`,
      `effective updatedAt videos: ${effectiveUpdatedAtVideos}`,
      `articles keys: ${articlesKeys || "none"}`,
      `videos keys: ${videosKeys || "none"}`,
    ].join("\n");
  }

  function iuHasStatusPlaceholders(s) {
    if (!s) return true;
    const bad = [
      "YES|NO",
      "preferred|fallback",
      "OK|NEOK",
      "…",
      "articles=…",
      "videos=…",
      "Načteno: články X, videa Y",
      "#feed children: N",
    ];
    return bad.some((t) => s.includes(t));
  }

  // === TOPIC GROUPING FEATURE ===
  const ENABLE_TOPIC_GROUPING = true;
  const TOPIC_GROUPING_TIME_WINDOW_HOURS = 12;
  const TOPIC_GROUPING_MAX_OTHERS = 999; // žádný limit na počet sloučených článků

  function normalizeTitleForKey(title) {
    if (!title || typeof title !== "string") return "";
    
    let normalized = title
      .toLowerCase()
      // Odstranění diakritiky (základní)
      .replace(/[áàä]/g, "a")
      .replace(/[éèě]/g, "e")
      .replace(/[íì]/g, "i")
      .replace(/[óòö]/g, "o")
      .replace(/[úùůü]/g, "u")
      .replace(/[ý]/g, "y")
      .replace(/[č]/g, "c")
      .replace(/[ď]/g, "d")
      .replace(/[ň]/g, "n")
      .replace(/[ř]/g, "r")
      .replace(/[š]/g, "s")
      .replace(/[ť]/g, "t")
      .replace(/[ž]/g, "z")
      // Odstranění interpunkce a speciálních znaků
      .replace(/[^\w\s]/g, " ")
      // Odstranění čísel (konzervativně - jen samostatné)
      .replace(/\b\d+\b/g, " ")
      // Redukce whitespace
      .replace(/\s+/g, " ")
      .trim();
    
    // Odstranění "měkkých" stop slov (konzervativně)
    const softStopWords = ["video", "zive", "aktualne", "live", "breaking"];
    const words = normalized.split(/\s+/);
    const filtered = words.filter(w => w.length > 2 && !softStopWords.includes(w));
    
    return filtered.join(" ");
  }

  function computeTopicKey(article) {
    if (!article) return null;
    
    const title = article.title || article.headline || article.name || "";
    const normalizedTitle = normalizeTitleForKey(title);
    
    // Pokud normalizovaný title je příliš krátký (< 10 znaků), použij fallback
    if (normalizedTitle.length < 10) {
      const topic = (article.topic || "").toLowerCase().trim();
      const section = (article.section || "").toLowerCase().trim();
      if (topic || section) {
        return `${topic}||${section}`;
      }
    }
    
    return normalizedTitle || null;
  }

  function jaccardSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const tokens1 = new Set(str1.toLowerCase().split(/\s+/).filter(t => t.length > 2));
    const tokens2 = new Set(str2.toLowerCase().split(/\s+/).filter(t => t.length > 2));
    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  function getTitleTokens(title) {
    if (!title) return [];
    return normalizeTitleForKey(title).split(/\s+/).filter(t => t.length > 2);
  }

  function mergeSourcesDedup(sourcesArrayList) {
    const seen = new Set();
    const merged = [];
    
    for (const sources of sourcesArrayList) {
      if (!Array.isArray(sources)) continue;
      
      for (const source of sources) {
        if (!source || typeof source !== "object") continue;
        
        const name = String(source.name || source.title || "").trim();
        const url = String(source.url || source.link || "").trim();
        
        if (!name || !url) continue;
        
        // Normalizace URL: base URL bez query params a hash
        const urlBase = url.split('?')[0].split('#')[0].toLowerCase();
        
        // Normalizace názvu média
        const canonicalName = normalizeMediaName(name);
        
        // Klíč pro deduplikaci: base URL + canonical name
        const key = `${urlBase}||${canonicalName}`;
        
        if (seen.has(key)) continue;
        seen.add(key);
        
        merged.push({ name, url });
      }
    }
    
    return merged;
  }

  function groupArticlesByTopic(articles, hours) {
    if (!Array.isArray(articles) || articles.length === 0) return articles;
    if (!Number.isFinite(hours) || hours <= 0) return articles;
    
    // Mapování: topicKey -> skupina článků
    const groups = new Map();
    
    // Krok 1: Seřadit články podle publishedAt (ASC - nejstarší první)
    const sorted = [...articles].sort((a, b) => {
      const ta = new Date(a.publishedAt || a.date || a.published || 0).getTime();
      const tb = new Date(b.publishedAt || b.date || b.published || 0).getTime();
      return ta - tb; // ASC
    });
    
    // Krok 2: Seskupit články podle topicKey s pojistkami
    const groupedArticles = new Set(); // Sledovat, které články byly seskupeny
    
    for (const article of sorted) {
      const topicKey = computeTopicKey(article);
      if (!topicKey) {
        // Pokud nelze vypočítat klíč, ponechat článek samostatně
        continue;
      }
      
      const articleTitle = article.title || article.headline || article.name || "";
      const articleTokens = getTitleTokens(articleTitle);
      const articleTopic = (article.topic || "").toLowerCase().trim();
      const articleSection = (article.section || "").toLowerCase().trim();
      
      if (!groups.has(topicKey)) {
        // Nová skupina - první článek je hlavní
        const publishedAt = article.publishedAt || article.date || article.published || "";
        const firstTime = new Date(publishedAt).getTime();
        
        groups.set(topicKey, {
          primary: article,
          related: [],
          firstTime: firstTime,
          timeWindowEnd: firstTime + (hours * 60 * 60 * 1000), // +hours v ms
          primaryTitle: articleTitle,
          primaryTokens: articleTokens,
          primaryTopic: articleTopic,
          primarySection: articleSection,
        });
        groupedArticles.add(article);
      } else {
        // Existující skupina - zkontrolovat časové okno a podobnost
        const group = groups.get(topicKey);
        const articleTime = new Date(article.publishedAt || article.date || article.published || 0).getTime();
        
        if (articleTime <= group.timeWindowEnd) {
          // Časové okno OK - zkontrolovat tokenovou podobnost
          const similarity = jaccardSimilarity(group.primaryTitle, articleTitle);
          const minTokens = 3;
          const minSimilarity = 0.55;
          
          let shouldGroup = false;
          
          // Pokud má title málo tokenů (< 3), vyžaduj navíc shodu topic||section
          if (articleTokens.length < minTokens || group.primaryTokens.length < minTokens) {
            const topicMatch = articleTopic && group.primaryTopic && articleTopic === group.primaryTopic;
            const sectionMatch = articleSection && group.primarySection && articleSection === group.primarySection;
            if (topicMatch || sectionMatch) {
              shouldGroup = true;
            }
          } else if (similarity >= minSimilarity) {
            // Dostatečná tokenová podobnost
            shouldGroup = true;
          }
          
          if (shouldGroup) {
            group.related.push(article);
            groupedArticles.add(article);
          }
          // Pokud nesplní podobnost, článek zůstane samostatně (bude přidán v kroku 4)
        }
        // Pokud je mimo okno, ignorovat (jiná událost, jen podobný title)
      }
    }
    
    // Krok 3: Vytvořit výstupní články ze skupin
    const result = [];
    
    for (const [topicKey, group] of groups.entries()) {
      const primary = group.primary;
      
      // Sloučit sources z primary + related
      const allSources = [
        Array.isArray(primary.sources) ? primary.sources : [],
        ...group.related.map(a => Array.isArray(a.sources) ? a.sources : [])
      ];
      const mergedSources = mergeSourcesDedup(allSources);
      
      // Validace výstupního článku
      if (!primary.title || !primary.url || !Array.isArray(mergedSources)) {
        debugWarn("[GROUP] Invalid grouped article, skipping", { topicKey, primary });
        // Fallback: přidat primary samostatně
        result.push(primary);
        continue;
      }
      
      // Vytvořit seskupený článek
      const groupedArticle = {
        ...primary,
        sources: mergedSources,
        // Volitelné metadata pro debug
        _groupMeta: {
          relatedCount: group.related.length,
          timeWindow: `${hours}h`,
          topicKey: topicKey,
        },
      };
      
      result.push(groupedArticle);
    }
    
    // Krok 4: Přidat články, které nebyly seskupeny (nemají topicKey nebo nesplnily podobnost)
    for (const article of sorted) {
      if (!groupedArticles.has(article)) {
        result.push(article);
      }
    }
    
    return result;
  }

  async function loadData() {
    const startedAt = new Date();
    if (state.isLoadingData) return;
    state.isLoadingData = true;
    const requestToken = ++state.loadRequestId;
    state.cachedItems = [];
    state.hasLoadedData = false;
    const lastErrInline = document.getElementById("lastErrInline");
    if (lastErrInline) {
      lastErrInline.style.display = "none";
    }
    if (emptyBox) {
      emptyBox.style.display = "block";
      emptyBox.innerHTML = "<p>Načítám data…</p>";
    }
    const preferredEntry = await evaluatePreferredPair();
    const baseArticleUrls = [
      "/projects/data/articles.json",
      makeDataUrl("projects/data/articles.json"),
      "/projects/data/articles.json",
      "/projects/data/articles.json",
      makeDataUrl("projects/data/articles.json"),
      makeDataUrl("filtr/data/articles.json"),
    ].filter(Boolean);
    const baseVideoUrls = [
      "/projects/data/videos.json",
      makeDataUrl("projects/data/videos.json"),
      "/projects/data/videos.json",
      "/projects/data/videos.json",
      makeDataUrl("projects/data/videos.json"),
      makeDataUrl("filtr/data/videos.json"),
    ].filter(Boolean);
    const articleUrls = buildCandidateListFromPair(preferredEntry, "articles", baseArticleUrls);
    const videoUrls = buildCandidateListFromPair(preferredEntry, "videos", baseVideoUrls);
    let preferredSaved = false;
    let preferredSavedReason = "";
    let preferredUpdatedToRoot = false;
    let chosenArticlesUrl = "";
    let chosenVideosUrl = "";
    let articleFetchResult = null;
    let videoFetchResult = null;
    let normalizedVideoSource = [];
    let articleStatusCode = null;
    let videoStatusCode = null;
    let articleStatusLabel = "404";
    let videoStatusLabel = "404";
    let articlesOk = false;
    let videosOk = false;
    let data = null;
    setStatus("Stav dat: načítám…");
    debugBoxSet(`iu debug: loading…\nhref=${location.href}\nstatus=loading`);

    try {
      const probeUrl = "/projects/data/_probe.txt";
      const ARTICLES_URL = "https://infouzel.cz/projects/data/articles.json";
      const VIDEOS_URL = "https://infouzel.cz/projects/data/videos.json";
      const articlesUrl = ARTICLES_URL;
      const videosUrl = VIDEOS_URL;

      debugBoxSet(
        `iu debug: fetching…\nhref=${location.href}\narticlesUrl=${articlesUrl}\nvideosUrl=${videosUrl}`
      );

      const probePromise = fetch(withTs(probeUrl), {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      }).then((res) => {
        if (!res.ok) throw new Error(`PROBE_HTTP_${res.status}`);
        return res.text();
      });

      const probeText = await probePromise.catch(() => null);
      state.lastProbe = probeText;

      const articlesData = await fetchDiag(articlesUrl, "articles");
      const videosData = await fetchDiag(videosUrl, "videos");

      const articlesArr = Array.isArray(articlesData)
        ? articlesData
        : Array.isArray(articlesData?.articles)
          ? articlesData.articles
          : [];

      const videosArr = Array.isArray(videosData)
        ? videosData
        : Array.isArray(videosData?.videos)
          ? videosData.videos
          : [];

      const articlesOk = Boolean(articlesData);
      let videosOk = Boolean(videosData);
      if (articlesOk && videosOk) {
        setStatus("Stav dat: OK");
      } else if (articlesOk && !videosOk) {
        setStatus("Stav dat: částečně (videa se teď nenačetla, obnova běží)");
      } else if (!articlesOk && videosOk) {
        setStatus("Stav dat: částečně (články se teď nenačetly, obnova běží)");
      }

      if (articlesData) assertFreshGeneratedAt(articlesData);
      if (videosData) assertFreshGeneratedAt(videosData);

      if (articlesData) {
        articleStatusCode = 200;
        articleStatusLabel = "OK";
        chosenArticlesUrl = articlesUrl;
        articleFetchResult = { json: articlesData, status: 200 };
        data = articlesData;
      }

      const articlesGeneratedAt = articlesData?.generatedAt || articlesData?.meta?.generatedAt || null;
      const articleGeneratedTs = articlesGeneratedAt ? Date.parse(articlesGeneratedAt) : null;
      const probeStamp = parseProbeTimestamp(state.lastProbe);
      if (
        Number.isFinite(probeStamp) &&
        Number.isFinite(articleGeneratedTs) &&
        articleGeneratedTs + 10 * 60 * 1000 < probeStamp
      ) {
        debugWarn("PROBE_JSON_MISMATCH (non-fatal)", { probeStamp, articleGeneratedTs });
      }
      state.lastArticlesGeneratedAt = articlesGeneratedAt ? String(articlesGeneratedAt) : null;
      const articlesKeys = articlesData && typeof articlesData === "object" ? Object.keys(articlesData).sort().join(",") : "none";
      state.lastArticlesKeys = articlesKeys;
      const articlesUpdatedAt = typeof articlesData?.updatedAt === "string" ? articlesData.updatedAt : null;
      state.lastArticlesUpdatedAt = articlesUpdatedAt;
      state.articlesRaw = articlesData;

      const safeArticlesArray = Array.isArray(articlesArr) ? articlesArr : [];
      if (isDebugLogging) {
        debugLog("[LOADDATA] articlesArr isArray=", Array.isArray(articlesArr), "len=", (articlesArr?.length ?? -1));
        debugLog("[LOADDATA] videosArr  isArray=", Array.isArray(videosArr),  "len=", (videosArr?.length ?? -1));
        debugLog("[LOADDATA] safeArticlesArray isArray=", Array.isArray(safeArticlesArray), "len=", safeArticlesArray.length);
      }
      const totalArticles = Array.isArray(safeArticlesArray) ? safeArticlesArray.length : 0;
      let sanitizedArticles = normalizeArticleList(Array.isArray(safeArticlesArray) ? safeArticlesArray : []).map((item) => ({
        ...item,
        contentType: "article",
        suspiciousTitle: isSuspiciousTitle(item.title),
      }));
      if (DEBUG) {
        sanitizedArticles.forEach((item) => {
          if (!item.contentType) {
            console.warn("[normalize] Missing contentType:", item);
          }
        });
      }
      sanitizedArticles.forEach((item) => {
        if (!item.contentType) {
          debugWarn("Missing contentType", item);
        }
      });
      debugLog("[ARTICLES NORMALIZED]", sanitizedArticles.length);
      if (sanitizedArticles.length < totalArticles) {
        debugWarn("[DATA] filtered invalid items", totalArticles, "->", sanitizedArticles.length);
      }

      debugLog("[DATA] articles loaded count=", sanitizedArticles.length);
      debugLog("[DATA] articles first=", sanitizedArticles[0]?.title, sanitizedArticles[0]?.url);
      if (isDebugLogging) {
      debugLog("[ARTICLES] loaded", sanitizedArticles.length, sanitizedArticles.slice(0, 3));
      }

      const safeVideosArray = Array.isArray(videosArr) ? videosArr : [];
      if (isDebugLogging) {
        debugLog("[LOADDATA] safeVideosArray  isArray=", Array.isArray(safeVideosArray), "len=", safeVideosArray.length);
      }
      normalizedVideoSource = Array.isArray(safeVideosArray) ? safeVideosArray : [];
      let videoItems = normalizeVideoList(Array.isArray(normalizedVideoSource) ? normalizedVideoSource : []);

      const videosKeys =
        videosData && typeof videosData === "object" ? Object.keys(videosData).sort().join(",") : "none";
      state.lastVideosKeys = videosKeys;
      const videosUpdatedAt = typeof videosData?.updatedAt === "string" ? videosData.updatedAt : null;
      state.lastVideosUpdatedAt = videosUpdatedAt;
      state.videosRaw = videosData;
      const videosGeneratedAt = videosData?.generatedAt || videosData?.meta?.generatedAt || null;
      state.lastVideosGeneratedAt = videosGeneratedAt ? String(videosGeneratedAt) : null;

      chosenVideosUrl = videosUrl;
      videoStatusLabel = "OK";
      videoStatusCode = 200;
      videoFetchResult = { json: videosData, status: 200 };
      videosOk = true;
      diagMeta.articlesUrl = chosenArticlesUrl || "";
      diagMeta.articlesStatus = articleStatusLabel || "404";
      diagMeta.videosUrl = chosenVideosUrl || "";
      diagMeta.videosStatus = videoStatusLabel || "404";
      // === PROOF LOGS (maintenance-safe) ===
      try {
        console.info("[proof] articles loaded:", sanitizedArticles.length, chosenArticlesUrl || articleUrls[0] || "");
        console.info("[proof] videos loaded:", videoItems.length, chosenVideosUrl || videoUrls[0] || "");
        if (typeof window.iuSetDataStatus === "function") {
          window.iuSetDataStatus(sanitizedArticles.length, videoItems.length);
        }
      } catch (_) {}
      const articlesJson = articleFetchResult?.json;
      const videosJson = videoFetchResult?.json;
      const normalizedArticles = Array.isArray(articlesArr) ? articlesArr : [];
      const hasArticlesField = Array.isArray(articlesJson?.articles);
      const hasNormalizedArticles = normalizedArticles.length > 0;
      const hasVideosField = Array.isArray(videosJson?.videos);
      const hasNormalizedVideos = Array.isArray(normalizedVideoSource) && normalizedVideoSource.length > 0;
      if (chosenArticlesUrl && chosenVideosUrl) {
        if ((hasArticlesField || hasNormalizedArticles) && (hasVideosField || hasNormalizedVideos)) {
          const storedPair = savePreferredPair(chosenArticlesUrl, chosenVideosUrl);
          if (storedPair) {
            preferredSaved = true;
            preferredSavedReason = "";
          } else if (!preferredSaved) {
            preferredSavedReason = "localStorage blocked";
          }
        } else if (!preferredSaved) {
          preferredSavedReason = "missing expected JSON arrays";
        }
      } else if (!preferredSaved && !preferredSavedReason) {
        preferredSavedReason = "no URLs to store";
      }

      if (!isLatestLoadRequest(requestToken)) {
        debugLog("[DATA] request canceled, token", requestToken);
        return;
      }
      
      // === TOPIC GROUPING ===
      let articlesForFeed = sanitizedArticles;
      if (ENABLE_TOPIC_GROUPING) {
        try {
          const grouped = groupArticlesByTopic(sanitizedArticles, TOPIC_GROUPING_TIME_WINDOW_HOURS);
          
          // Validace výstupu
          const isValid = Array.isArray(grouped) && grouped.every(item => 
            item && 
            typeof item.title === "string" && 
            typeof item.url === "string" && 
            Array.isArray(item.sources)
          );
          
          if (isValid) {
            articlesForFeed = grouped;
            
            // Debug telemetrie pro seskupování (jen v debug režimu)
            if (isDebugLogging) {
              debugLog("[GROUP] articles grouped:", sanitizedArticles.length, "->", grouped.length);
              const groupsWithMeta = grouped.filter(a => a._groupMeta && a._groupMeta.relatedCount > 0);
              const topGroups = groupsWithMeta
                .sort((a, b) => (b._groupMeta.relatedCount || 0) - (a._groupMeta.relatedCount || 0))
                .slice(0, 10);
              
              debugLog(`[GROUP] === TOP ${topGroups.length} GROUPS ===`);
              topGroups.forEach((g, idx) => {
                const sources = Array.isArray(g.sources) ? g.sources.map(s => s.name).filter(Boolean) : [];
                const primaryTime = g.publishedAt || g.date || g.published || "";
                const relatedCount = g._groupMeta.relatedCount || 0;
                const timeWindow = g._groupMeta.timeWindow || "12h";
                const keyDisplay = g._groupMeta.topicKey.substring(0, 60) + (g._groupMeta.topicKey.length > 60 ? "..." : "");
                
                debugLog(`[GROUP] #${idx + 1}: key="${keyDisplay}"`);
                debugLog(`[GROUP]   count: ${relatedCount + 1} articles, timeWindow: ${timeWindow}, primaryTime: ${primaryTime}`);
                debugLog(`[GROUP]   sources (${sources.length}): ${sources.slice(0, 8).join(", ")}${sources.length > 8 ? "..." : ""}`);
              });
              debugLog(`[GROUP] === END TOP GROUPS ===`);
            }
          } else {
            debugWarn("[GROUP] Validation failed, using original articles");
            articlesForFeed = sanitizedArticles;
          }
        } catch (err) {
          debugWarn("[GROUP] Error during grouping:", err);
          articlesForFeed = sanitizedArticles; // Fallback na původní
        }
      }
      
      const combined = buildCombinedFeed(articlesForFeed, videoItems);
      const enriched = combined.map((item) => {
        const published =
          (item && String(item.publishedAt || item.published || item.date || item.createdAt || item.uploadedAt || item.time)) ||
          "";
        return {
          ...item,
          _ts: published ? Date.parse(published) || 0 : 0,
        };
      });
      const sorted = enriched.sort((a, b) => (b._ts || 0) - (a._ts || 0));
      const articlesOnly = sorted.filter((entry) => entry?.contentType === "article");
      const videosOnly = sorted.filter((entry) => entry?.contentType === "video");
      const mixed = [];
      let videoIndex = 0;
      for (let i = 0; i < articlesOnly.length; i++) {
        mixed.push(articlesOnly[i]);
        if ((i + 1) % 10 === 0 && videoIndex < videosOnly.length) {
          mixed.push(videosOnly[videoIndex++]);
        }
      }
      while (videoIndex < videosOnly.length) {
        mixed.push(videosOnly[videoIndex++]);
      }
      state.stats.articlesCount = articlesOnly.length;
      state.stats.videosCount = videosOnly.length;
      state.cachedItems = mixed.length ? mixed : combined;
      if (DEBUG) {
        console.log("[loadData] cachedItems length:", state.cachedItems.length);
        console.log("[loadData] first items:", state.cachedItems.slice(0, 3));
      }
      const combinedSources = [];
      if (articlesOk) combinedSources.push("articles");
      if (videosOk) combinedSources.push("videos");
      if (isDebugLogging) {
        debugLog("[LOADDATA] combined count", combined.length);
        debugLog("[LOADDATA] rendering from", combinedSources.length ? combinedSources.join(",") : "none");
      }

      if (combined.length === 0) {
        renderEmpty("Obsah se teď nenačetl (žádná data z backendu)");
        return;
      }

      state.cachedItems = combined;
      if (!Array.isArray(state.cachedItems)) state.cachedItems = [];
      state.hasLoadedData = true;
      state.consecutiveLoadFailures = 0;
      state.filteredItems = Array.isArray(state.cachedItems) ? state.cachedItems.slice() : [];
      renderItems(state.filteredItems);
      if (isDebugLogging) {
        debugLog(
          "[CACHE] total",
          combined.length,
          "articles",
          sanitizedArticles.length,
          "videos",
          videoItems.length,
        );
        debugLog(
          "[ARTICLES] sample",
          sanitizedArticles.slice(0, 3).map((item) => ({
            title: item.title,
            url: item.url,
          })),
        );
        debugLog(
          "[VIDEOS] sample",
          videoItems.slice(0, 3).map((item) => ({
            title: item.title,
            url: item.url,
          })),
        );
      }
      // Non-blocking: load retention index for historical day-shards
      initRetentionIndex();
      applyFilter();
      const countArticles = state.cachedItems.filter((entry) => entry?.contentType === "article").length;
      const countVideos = state.cachedItems.filter((entry) => entry?.contentType === "video").length;
      const feedChildren = elFeed?.children?.length ?? 0;
      const preferredUsed = Boolean(
        preferredEntry?.status === "ok" &&
          chosenArticlesUrl === preferredEntry.articlesUrl &&
          chosenVideosUrl === preferredEntry.videosUrl
      );
      const preferredModeUsed = preferredUsed ? "preferred" : "fallback";
      const effectiveUpdatedAtArticles =
        state.lastArticlesGeneratedAt || state.lastArticlesUpdatedAt || "none";
      const effectiveUpdatedAtVideos =
        state.lastVideosGeneratedAt || state.lastVideosUpdatedAt || "none";
      
      // === FIX: Odvodit articlesStamp a videosStamp z generatedAt ===
      const articlesStamp = state.lastArticlesGeneratedAt 
        ? state.lastArticlesGeneratedAt.substring(0, 16).replace(/T/, " ")
        : null;
      const videosStamp = state.lastVideosGeneratedAt
        ? state.lastVideosGeneratedAt.substring(0, 16).replace(/T/, " ")
        : null;
      
      const statusLine = iuBuildDiagStatusLine({
        preferredSaved,
        preferredModeUsed,
        articlesOk,
        videosOk,
        chosenArticlesUrl,
        chosenVideosUrl,
        countArticles,
        countVideos,
        feedChildren,
        generatedAtArticles: state.lastArticlesGeneratedAt,
        generatedAtVideos: state.lastVideosGeneratedAt,
        articlesKeys: state.lastArticlesKeys,
        videosKeys: state.lastVideosKeys,
        effectiveUpdatedAtArticles,
        effectiveUpdatedAtVideos,
      });
      if (iuHasStatusPlaceholders(statusLine)) {
        persistLastError("DIAG PLACEHOLDER DETECTED: " + statusLine.slice(0, 180));
        setStatus("Stav dat: načítám…");
      } else {
        persistLastError(null);
        persistLastOk({
          at: new Date().toISOString(),
          build: articlesStamp || videosStamp || "",
          articles: countArticles,
          videos: countVideos,
        });
        const feedSegment = feedChildren ? ` • feed ${feedChildren}` : "";
        let statusParts = ["Stav dat: OK"];
        if (articlesStamp && videosStamp && articlesStamp === videosStamp) {
          statusParts.push(`build ${articlesStamp}`);
          statusParts.push(`články ${countArticles}`);
          statusParts.push(`videa ${countVideos}`);
        } else {
          statusParts.push(`články ${countArticles}${articlesStamp ? ` (build ${articlesStamp})` : ""}`);
          statusParts.push(`videa ${countVideos}${videosStamp ? ` (build ${videosStamp})` : ""}`);
        }
        if (feedSegment.trim()) statusParts.push(feedSegment.replace(/^ • /, ""));
        if (state.lastProbe) {
          statusParts.push(`probe ${state.lastProbe}`);
        }
        setStatus(statusParts.join(" • "));
      }
      updateLastArticlesInfo(sanitizedArticles.length, data?.updatedAt ?? data?.updated_at ?? null);

      debugLog("[DATA] combined count=", state.cachedItems.length);
      debugLog("[DATA] combined first type=", state.cachedItems[0]?.contentType, state.cachedItems[0]?.title);

      debugBoxSet(
        `iu debug: parsed\narticlesCountRaw=${Array.isArray(articlesData) ? articlesData.length : -1}\nvideosCountRaw=${Array.isArray(videosData) ? videosData.length : -1}\narticlesCountSanitized=${Array.isArray(sanitizedArticles) ? sanitizedArticles.length : -1}\nvideosCountSanitized=${Array.isArray(normalizedVideoSource) ? normalizedVideoSource.length : -1}`
      );

      setTimeout(() => {
        const feed = document.getElementById("feed");
        const cards = feed ? feed.querySelectorAll("article, .card, .newsCard, .iuCard").length : -1;
        const prev = document.getElementById("iuDebugBox")?.textContent || "";
        debugBoxSet(`${prev}\niu debug: DOM\nfeedExists=${Boolean(feed)}\ncardsInDom=${cards}`);
        if (feed) {
          const hasData = (state.cachedItems?.length || 0) > 0;
          if (hasData && cards === 0) {
            const warning = document.createElement("div");
            warning.style.cssText = "padding:12px;margin:12px 0;border:1px dashed #999;border-radius:10px;";
            warning.textContent = "IU: DATA JSOU NAČTENÁ, ALE NIC SE NERENDERUJE (debug=1). Zkontroluj konzoli a iuDebugBox.";
            feed.appendChild(warning);
          }
        }
      }, 0);

      if (isDebugOn()) {
        writeDebug({
          ok: true,
          url: chosenArticlesUrl || articleUrls[0] || "",
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          rawType: Array.isArray(data) ? "array" : typeof data,
          keys:
            data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data) : [],
          itemsCount: state.cachedItems.length,
          sample: state.cachedItems.slice(0, 3),
        });
      }
    } catch (err) {
      if (!isLatestLoadRequest(requestToken)) {
        debugLog("[DATA] failure ignored, token", requestToken);
        return;
      }

      state.consecutiveLoadFailures = (state.consecutiveLoadFailures || 0) + 1;
      debugWarn("[loadData] error", err);

      const hasLast = Array.isArray(state.cachedItems) && state.cachedItems.length > 0;
      const feedChildren = elFeed?.children?.length ?? 0;
      
      // === FIX: Pokud máme data a feed je vykreslen, neukazovat "výpadek" ===
      if (hasLast && feedChildren > 0) {
        // Data jsou OK, feed je vykreslen → jen warning, ne "výpadek"
        debugWarn("[loadData] error during processing, but feed is rendered", err);
        setStatus("Stav dat: OK (částečná chyba při zpracování)");
      } else {
        setStatus("Stav dat: výpadek (automatický pokus o obnovení)");
      }

      if (hasLast) {
        const box = document.querySelector("#emptyBox") || document.querySelector("#empty");
        if (box) {
          box.style.display = "";
          box.textContent = "Dočasný výpadek načtení dat. Zobrazuji poslední úspěšná data, probíhá obnova.";
        }
      } else {
        const feed = document.querySelector("#feed");

        const msg = "Obsah se teď nenačetl (chyba načtení dat). Zkus obnovit stránku.";
        const details = [
          "DETAIL (auto):",
          formatDiagLine("articles"),
          formatDiagLine("videos"),
        ].join("\n");
        const box = document.querySelector("#emptyBox") || document.querySelector("#empty");
        if (box) {
          box.style.display = "";
          box.textContent = `${msg}\n${details}`;
        } else if (feed) {
          // CLS mitigation: postav nový obsah mimo DOM a jednorázově ho vyměň.
          const div = document.createElement("div");
          div.className = "iuErrorBox";
          div.textContent = `${msg}\n${details}`;
          const sectionsBar = document.getElementById("sectionsBar");
          if (sectionsBar) feed.replaceChildren(sectionsBar, div);
          else feed.replaceChildren(div);
        }
      }

      const delay =
        state.consecutiveLoadFailures >= 10 ? 180000 :
        state.consecutiveLoadFailures >= 5 ? 60000 :
        15000;
      setTimeout(() => {
        if (document.visibilityState === "visible") {
          loadData();
        }
      }, delay);
    } finally {
      state.isLoadingData = false;
    }
  }

  let iuRefreshTimer = null;
  function startAutoRefresh() {
    if (iuRefreshTimer) clearInterval(iuRefreshTimer);
    iuRefreshTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (document.body && document.body.classList && document.body.classList.contains("iu-home")) return;
      loadData();
    }, 7 * 60 * 1000);
  }

  // Safe public shims for UI-only routers (do not expose pipeline internals).
  // These are used to guarantee that navigating from Home -> any feed section triggers data load immediately.
  try{
    window.__iuLoadData = function(){ try{ return loadData(); }catch{} };
    window.__iuStartAutoRefresh = function(){ try{ return startAutoRefresh(); }catch{} };
    window.__iuStopAutoRefresh = function(){
      try{
        if (iuRefreshTimer) clearInterval(iuRefreshTimer);
        iuRefreshTimer = null;
      }catch{}
    };
  }catch{}

  async function fetchFeedHealth() {
    try {
      const res = await timeoutFetch(makeDataUrl("data/feed_health.json"), { cache: "no-store" }, 5000);
      if (res.status === 404) {
        debugWarn("[HEALTH] feed_health not found");
        return;
      }
      if (!res.ok) {
        debugWarn("[HEALTH] feed_health error", res.status);
        return;
      }
      const data = await res.json();
      const updated = data?.updatedAt ?? data?.updated_at;
      debugLog("[HEALTH] feed_health OK", updated ? `updatedAt=${updated}` : "updatedAt=—");
    } catch (err) {
      debugWarn("[HEALTH] feed_health fetch failed", err && err.message ? err.message : err);
    }
  }

  function persistLastOk(data) {
    try {
      localStorage.setItem("iu:lastOkAt", new Date().toISOString());
      localStorage.setItem("iu:lastOk", JSON.stringify(data));
    } catch {
      // ignore
    }
  }

  function persistLastError(message) {
    try {
      if (!message) {
        localStorage.removeItem("iu:lastErrorAt");
        localStorage.removeItem("iu:lastError");
      } else {
        localStorage.setItem("iu:lastErrorAt", new Date().toISOString());
        localStorage.setItem("iu:lastError", message);
      }
    } catch {
      // ignore
    }
    const el = document.getElementById("dataStatusLastError");
    if (el) {
      el.textContent = `Poslední chyba: ${message}`;
    }
    const inline = document.getElementById("lastErrInline");
    if (inline) {
      inline.textContent = `Poslední chyba: ${message}`;
      inline.style.display = "block";
    }
    console.error("[ERR]", message);
  }

  function handleMissingFeedContainer() {
    const msg = "[DOM] feed container missing";
    persistLastError(msg);
    const articlesEl = document.getElementById("dataStatusArticles");
    if (articlesEl) {
      articlesEl.textContent = "Články: chyba DOM";
    }
    return;
  }

  window.addEventListener("error", (event) => {
    try {
      const info = `${event.message} (${event.filename}:${event.lineno})`;
      persistLastError(info);
    } catch (err) {
      console.error("[ERR]", "error handler failed", err);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    try {
      const reason = event.reason ? event.reason.message || String(event.reason) : "unknown";
      persistLastError(`Promise rejection: ${reason}`);
    } catch (err) {
      console.error("[ERR]", "rejection handler failed", err);
    }
  });

  function updateNetworkStatus() {
    const el = document.getElementById("dataStatusNet");
    if (!el) return;
    el.textContent = `Síť: ${navigator.onLine ? "online" : "offline"}`;
  }

  function initAccordion() {
    const headers = document.querySelectorAll(".accordionCol .accHeader");
    headers.forEach((header) => {
      const targetId = header.getAttribute("aria-controls");
      const content = targetId ? document.getElementById(targetId) : header.nextElementSibling;
      if (!content) return;
      content.style.maxHeight = "0px";
      content.style.overflow = "hidden";
      header.setAttribute("aria-expanded", "false");
      header.addEventListener("click", () => {
        const isExpanded = header.classList.toggle("is-open");
        header.setAttribute("aria-expanded", isExpanded ? "true" : "false");
        if (isExpanded) {
          content.style.maxHeight = `${content.scrollHeight}px`;
        } else {
          content.style.maxHeight = "0px";
        }
      });
    });
  }

  function updateSwStatusLabel() {
    const el = document.getElementById("dataStatusSW");
    if (!el) return;
    if (!("serviceWorker" in navigator)) {
      el.textContent = "SW: nepodporováno";
      return;
    }
    const controller = navigator.serviceWorker.controller ? "controller=ANO" : "controller=NE";
    const waiting = selfDiag.swWaiting === "yes" ? " waiting=ANO" : "";
    el.textContent = `SW: ${controller}${waiting}`;
  }

  function buildReportText() {
    const build = selfDiag.build || "no-build";
    const articles = `${selfDiag.articlesState} count=${selfDiag.articlesCount}`;
    const videos = `${selfDiag.videosState} count=${selfDiag.videosCount}`;
    const swController = navigator.serviceWorker?.controller ? "controller=ANO" : "controller=NE";
    const swWaiting = selfDiag.swWaiting === "yes" ? " waiting=ANO" : "";
    const updatedEl = document.getElementById("dataStatusUpdated");
    const updated = updatedEl ? updatedEl.textContent.trim() : "Aktualizace: —";
    const lastErrorAt = localStorage.getItem("iu:lastErrorAt") || "—";
    const lastError = localStorage.getItem("iu:lastError") || "—";
    const lastOkAt = localStorage.getItem("iu:lastArticlesOkAt") || "—";
    const lastOkCount = localStorage.getItem("iu:lastArticlesCount") || "—";
    return [
      `[REPORT] build=${build}`,
      `[REPORT] articles=${articles}`,
      `[REPORT] videos=${videos}`,
      `[REPORT] updated=${updated}`,
      `[REPORT] sw=${swController}${swWaiting}`,
      `[REPORT] lastErrorAt=${lastErrorAt}`,
      `[REPORT] lastError=${lastError}`,
      `[REPORT] lastOkAt=${lastOkAt}`,
      `[REPORT] lastOkCount=${lastOkCount}`,
    ].join("\n");
  }

  async function copyReportToClipboard() {
    const text = buildReportText();
    try {
      await navigator.clipboard.writeText(text);
      debugLog("[REPORT] copied");
    } catch {
      try {
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "absolute";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
        debugLog("[REPORT] clipboard fallback used");
        debugLog("[REPORT] copied");
      } catch (fallbackErr) {
        const fallback = window.prompt("Copy report (Ctrl+C)", text);
        if (fallback !== null) {
          debugLog("[REPORT] copied");
        }
      }
    }
  }

  function refreshDebugPanelText() {
    const label = document.getElementById("dataDebugLabel");
    if (!label) return;
    label.textContent = `Debug: ${isDebugOn() ? "ON" : "OFF"}`;
  }

  const SW_RELOAD_KEY = "iu:swReloaded";
  const SW_RELOAD_AT_KEY = "iu:swReloadedAt";

  function clearStaleReloadGuard() {
    const at = Number(sessionStorage.getItem(SW_RELOAD_AT_KEY) || "0");
    if (!at) return false;
    if (Date.now() - at > 10 * 60 * 1000) {
      sessionStorage.removeItem(SW_RELOAD_KEY);
      sessionStorage.removeItem(SW_RELOAD_AT_KEY);
      debugLog("[SW] reload guard cleared");
      return false;
    }
    return Boolean(sessionStorage.getItem(SW_RELOAD_KEY));
  }

  function scheduleSWReload(worker) {
    if (!worker || !("sessionStorage" in window)) return;
    if (clearStaleReloadGuard()) return;
    try {
      worker.postMessage({ type: "SKIP_WAITING" });
      addTelemetryEvent("sw", "skip waiting");
    } catch (error) {
      debugWarn("[SW]", "skip waiting message failed", error);
    }
    sessionStorage.setItem(SW_RELOAD_KEY, "1");
    sessionStorage.setItem(SW_RELOAD_AT_KEY, Date.now().toString());
    window.location.reload();
  }

  function watchForSWUpdates() {
    if (!("serviceWorker" in navigator)) return;
    const handleRegistration = (reg) => {
      if (!reg) return;
      selfDiag.swController = navigator.serviceWorker?.controller ? "yes" : "no";
      if (reg.waiting) {
      addTelemetryEvent("sw", "waiting");
        selfDiag.swWaiting = "yes";
        logSelfStatus();
        scheduleSWReload(reg.waiting);
        return;
      }
      selfDiag.swWaiting = "no";
      logSelfStatus();
    updateSwStatusLabel();
      if (reg.waiting) {
        scheduleSWReload(reg.waiting);
        return;
      }
      const onUpdateFound = () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && reg.waiting) {
            scheduleSWReload(reg.waiting);
          }
        });
      };
      reg.addEventListener("updatefound", onUpdateFound);
      onUpdateFound();
    };

    navigator.serviceWorker
      .getRegistration()
      .then(handleRegistration)
      .catch(() => {});
    navigator.serviceWorker
      .ready
      .then(handleRegistration)
      .catch(() => {});
  }

  function auditLog() {
    const loadMoreEl = document.querySelector("[data-load-more], .loadMore");
    const loadMoreState = loadMoreEl && !loadMoreEl.hidden ? "visible" : "hidden";
    const swState = selfDiag.swWaiting === "yes"
      ? "waiting"
      : (selfDiag.swController === "yes" ? "controller" : "none");
    debugLog(`[AUDIT] build=${selfDiag.build}`);
    debugLog(`[AUDIT] articles=${selfDiag.articlesState} count=${selfDiag.articlesCount}`);
    debugLog(`[AUDIT] videos=${selfDiag.videosState} count=${selfDiag.videosCount}`);
    debugLog(`[AUDIT] loadMore=${loadMoreState}`);
    debugLog(`[AUDIT] sw=${swState}`);
  }

  // === IU Daily Panel (right sidebar top) — time/date + nameday + weather + hours ===
  window.iuDailyPanelInit = function iuDailyPanelInit(){
    const TZ = "Europe/Prague";

    const elTime = document.getElementById("iuDailyTime");
    const elDate = document.getElementById("iuDailyDate");
    const elNameday = document.getElementById("iuDailyNameday");

    const elWeather = document.getElementById("iuDailyWeather");
    const elErr = document.getElementById("iuDailyErr");

    const elPlace = document.getElementById("iuWxPlace");
    const elIcon = document.getElementById("iuWxIcon");
    const elTemp = document.getElementById("iuWxTemp");
    const elMinMax = document.getElementById("iuWxMinMax");
    const elHours = document.getElementById("iuWxHours");

    if (!elTime && !elDate && !elWeather && !elErr) return;

    function fmtTime(d){
      return new Intl.DateTimeFormat("cs-CZ",{hour:"2-digit",minute:"2-digit",timeZone:TZ}).format(d);
    }
    function fmtDate(d){
      return new Intl.DateTimeFormat("cs-CZ",{weekday:"long",day:"numeric",month:"long",timeZone:TZ}).format(d);
    }
    function fmtHour(d){
      return new Intl.DateTimeFormat("cs-CZ",{hour:"numeric",hour12:false,timeZone:TZ}).format(d) + "h";
    }
    function fmtDeg(n){
      if (typeof n !== "number" || !isFinite(n)) return "—";
      return Math.round(n) + "°";
    }
    function iconFromCode(code){
      if (code === 0) return "☀️";
      if (code === 1 || code === 2) return "🌤";
      if (code === 3) return "☁️";
      if (code >= 45 && code <= 48) return "🌫";
      if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "🌧";
      if (code >= 71 && code <= 77) return "❄️";
      if (code >= 95) return "⛈";
      return "🌤";
    }

    // TIME/DATE tick (idempotent)
    function tick(){
      const now = new Date();
      if (elTime) elTime.textContent = fmtTime(now);
      if (elDate) elDate.textContent = fmtDate(now);
    }
    tick();
    if (window.__iu_daily_timer) clearInterval(window.__iu_daily_timer);
    window.__iu_daily_timer = setInterval(tick, 60000);

    // NAME DAY (Svátky)
    function updateNameday(){
      if (!IU_ENABLE_NAMEDAY) return;
      if (!elNameday) return;

      elNameday.hidden = false;
      elNameday.textContent = "Svátek má načítám…";
      fetch("https://svatky.adresa.info/json", { cache: "no-store" })
        .then(r => r.json())
        .then(d => {
          if (d && d.name) {
            elNameday.textContent = "Svátek má " + String(d.name);
            elNameday.hidden = false;
          } else {
            elNameday.hidden = true;
          }
        })
        .catch(() => {
          elNameday.hidden = true;
        });
    }
    updateNameday();

    // WEATHER (Open-Meteo) + hourly strip + min/max
    // Default Praha (později lze udělat volbu města)
    const placeName = "Praha";
    const lat = 50.0755;
    const lon = 14.4378;

    if (elErr) elErr.hidden = true;
    if (elWeather) elWeather.hidden = false;

    if (elPlace) elPlace.textContent = placeName;
    if (elTemp) elTemp.textContent = "—°C";
    if (elMinMax) elMinMax.textContent = "Max —° · Min —°";
    if (elIcon) elIcon.textContent = "🌤";
    // CLS mitigation: hodiny mají předrenderované "sloty" v HTML (skeleton),
    // takže je tady nemažeme (mazání + pozdější append = layout shift).
    if (elHours) {
      try { elHours.classList.add("iuWxHours--skeleton"); } catch(_){}
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Europe%2FPrague`;

    fetch(url, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        const cur = d && d.current;
        const hourly = d && d.hourly;
        const daily = d && d.daily;

        if (!cur || typeof cur.temperature_2m !== "number") throw new Error("bad current");

        const t = Math.round(cur.temperature_2m);
        const code = cur.weather_code;

        if (elTemp) elTemp.textContent = `${t}°C`;
        if (elIcon) elIcon.textContent = iconFromCode(code);

        // min/max
        const max0 = daily && Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null;
        const min0 = daily && Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null;
        if (elMinMax) {
          elMinMax.textContent = `Max ${fmtDeg(max0)} · Min ${fmtDeg(min0)}`;
        }

        // hourly strip: vyber 8 hodin od "teď" dopředu (stabilní sloty)
        if (elHours && hourly && Array.isArray(hourly.time) && Array.isArray(hourly.temperature_2m) && Array.isArray(hourly.weather_code)) {
          const now = new Date();
          const items = [];
          for (let i = 0; i < hourly.time.length; i++){
            const dt = new Date(hourly.time[i]);
            if (isNaN(dt.getTime())) continue;
            if (dt < now) continue;
            items.push({
              d: dt,
              temp: hourly.temperature_2m[i],
              code: hourly.weather_code[i],
            });
            if (items.length >= 8) break;
          }

          // Update existujících slotů (případně doplň chybějící) – bez změny výšky kontejneru
          const slots = Array.from(elHours.querySelectorAll(".iuWxHour"));
          while (slots.length < 8) {
            const div = document.createElement("div");
            div.className = "iuWxHour";
            div.innerHTML = `<div>--h</div><div class="iuWxHourTemp">—</div><div>🌤</div>`;
            div.setAttribute("aria-hidden", "true");
            elHours.appendChild(div);
            slots.push(div);
          }

          for (let i = 0; i < 8; i++){
            const slot = slots[i];
            const it = items[i];
            if (!slot) continue;
            if (it) {
              slot.innerHTML = `
                <div>${fmtHour(it.d)}</div>
                <div class="iuWxHourTemp">${fmtDeg(it.temp)}</div>
                <div>${iconFromCode(it.code)}</div>
              `;
              slot.removeAttribute("aria-hidden");
            } else {
              // keep stable height even if fewer items
              slot.innerHTML = `<div>--h</div><div class="iuWxHourTemp">—</div><div>🌤</div>`;
              slot.setAttribute("aria-hidden", "true");
            }
          }

          try { elHours.classList.remove("iuWxHours--skeleton"); } catch(_){}
        }

        if (elWeather) elWeather.hidden = false;
        if (elErr) elErr.hidden = true;
      })
      .catch(() => {
        if (elWeather) elWeather.hidden = true;
        if (elErr) elErr.hidden = false;
      });
  };

  function init() {
    if (sessionStorage.getItem("iu:firstLoadDone")) {
      debugLog("[LOAD] repeat");
    } else {
      debugLog("[LOAD] first");
      sessionStorage.setItem("iu:firstLoadDone", "1");
      firstLoadQuiet = true;
      setTimeout(() => {
        firstLoadQuiet = false;
      }, 5000);
    }
    renderDebugVisibility();
    installCLSObserver();
    renderSectionsBar();
    setSectionsFromHash();
    iuInitTopbarWatcher();

    if (typeof window.iuDailyPanelInit === "function") {
      window.iuDailyPanelInit();
    }
    setTimeout(() => {
      if (typeof window.iuDailyPanelInit === "function") {
        window.iuDailyPanelInit();
      }
    }, 300);

    if (btnToggleDebug) {
      btnToggleDebug.addEventListener("click", () => {
        setDebug(!isDebugOn());
        if (isDebugOn() && (!elDebugOut || !elDebugOut.textContent.trim())) {
          writeDebug({ note: "Debug aktivní. Pokud data nejdou načíst, uvidíš chybu zde." });
        }
      });
    }

    if (searchForm) {
      searchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        applyFilter();
      });
    }

    if (modalGoogle) {
      modalGoogle.addEventListener("click", () => {
        const query = (searchInput && searchInput.value.trim()) || "";
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        window.open(url, "_blank", "noopener");
        resetSearchAndReload();
      });
    }

    const retryBtn = document.getElementById("dataRetryBtn");
    if (retryBtn) {
      retryBtn.addEventListener("click", () => {
        fetchArticlesStatus();
        fetchVideosStatus();
        loadData();
      });
    }

    const debugBtn = document.getElementById("dataDebugToggle");
    if (debugBtn) {
      debugBtn.addEventListener("click", () => {
        const current = isDebugOn();
        setDebug(!current);
        refreshDebugPanelText();
        location.reload();
      });
      refreshDebugPanelText();
    }

    const copyBtn = document.getElementById("dataCopyReportBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        copyReportToClipboard();
      });
    }
    const hardBtn = document.getElementById("dataHardRefreshBtn");
    if (hardBtn) {
      hardBtn.addEventListener("click", () => {
        ["iu:swReloaded", "iu:swReloadedAt", "iu:scrolledToStatus"].forEach((key) => sessionStorage.removeItem(key));
        softRefreshData();
      });
    }
    renderDiagBox();
    initAccordion();
    updateBuildStatusLabel();
    recordBuildSeen();
    nukeCachesAndSwOnBuildChange();

    window.addEventListener("online", updateNetworkStatus);
    window.addEventListener("offline", updateNetworkStatus);
    updateNetworkStatus();

    if (modalCancel) {
      modalCancel.addEventListener("click", () => {
        resetSearchAndReload();
      });
    }

    fetchArticlesStatus();
    fetchVideosStatus();
    // Home view must not run feed pipeline on entry (UI-only).
    // If user navigates to a feed section later, data will load via visibility/focus/refresh.
    let initialIsHome = false;
    try{
      const params = new URLSearchParams(window.location.search);
      initialIsHome = String(params.get("section") || "").trim().toLowerCase() === "home";
    }catch{}
    if (!initialIsHome) {
      loadData();
      startAutoRefresh();
    }
    watchForSWUpdates();
    updateSwStatusLabel();
    auditLog();
    fetchFeedHealth();
    updateEventsUI();
    finalStateReport();

  }

  document.addEventListener("visibilitychange", () => {
    debugLog("[VIS]", document.visibilityState);
    if (document.visibilityState === "visible") {
      if (!(document.body && document.body.classList && document.body.classList.contains("iu-home"))) {
        loadData();
        startAutoRefresh();
      }
    } else if (iuRefreshTimer) {
      clearInterval(iuRefreshTimer);
      iuRefreshTimer = null;
    }
  });

  window.addEventListener("focus", () => debugLog("[FOCUS] in"));
  window.addEventListener("blur", () => debugLog("[FOCUS] out"));

  window.addEventListener("hashchange", () => {
    freezeScroll();
    setSectionsFromHash();
    applyFilter();
    restoreScroll();
  });

  init();
})();


// CHECKPOINT: FEED STABLE
// Stav ověřen: invarianty splněny, render pipeline uzamčena,
// fail-soft aktivní, emergency visibility aktivní.
// Jakákoli změna výše musí projít kontrolou invariant.
// === NO-GO ZONE END ===
// Jakýkoli zásah pod tímto bodem je porušením technického standardu infoUzel.cz
// === MAINTENANCE MODE ACTIVE ===
// Jakákoli změna nad tímto bodem vyžaduje nový checkpoint

// === POPOVER PRO SLEDOVÁNÍ ZÁSILEK (IZOLOVANÁ FUNKCIONALITA) ===
(function(){
  'use strict';
  
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  
  const parcelsBtn = document.getElementById('iuParcelsBtn');
  const parcelsBtnMobile = document.getElementById('iuParcelsBtnMobile');
  const modal = document.getElementById('iuParcelsPopover');
  const overlay = document.querySelector('.iu-parcels-overlay');
  
  const carriers = {
    packeta: {
      name: 'Zásilkovna',
      baseUrl: 'https://tracking.app.packeta.com/cs/',
      deepUrl: (code) => `https://tracking.app.packeta.com/cs/${encodeURIComponent(code)}`,
      urlFallback: (code) => `https://tracking.packeta.com/cs/${encodeURIComponent(code)}`
    },
    balikovna: {
      name: 'Balíkovna / Česká pošta',
      baseUrl: 'https://www.balikovna.cz/cs/sledovat-balik',
      deepUrl: (code) => `https://www.balikovna.cz/cs/sledovat-balik/-/balik/${encodeURIComponent(code)}`
    },
    ppl: {
      name: 'PPL',
      baseUrl: 'https://www.ppl.cz/vyhledat-zasilku',
      useClipboard: true
    },
    dpd: {
      name: 'DPD',
      baseUrl: 'https://tracking.dpd.de/status/cs_CZ/',
      deepUrl: (code) => `https://tracking.dpd.de/status/cs_CZ/parcel/${encodeURIComponent(code)}`,
      useClipboard: true
    },
    gls: {
      name: 'GLS',
      baseUrl: 'https://gls-group.com/CZ/cs/sledovani-zasilek',
      useClipboard: true
    },
    wedo: {
      name: 'WE|DO',
      baseUrl: 'https://trace.wedo.cz/',
      deepUrl: (code) => `https://trace.wedo.cz/?orderNumber=${encodeURIComponent(code)}`,
      urlFallback: () => 'https://trace.wedo.cz/'
    },
    dhl: {
      name: 'DHL',
      baseUrl: 'https://www.dhl.com/cz-en/home/tracking.html',
      useClipboard: true
    },
    messenger: {
      name: 'Messenger',
      baseUrl: 'https://www.msng.cz/',
      useClipboard: true
    }
  };
  
  function openParcels(){
    if(!modal || !overlay) return;
    overlay.classList.add('is-open');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    if(location.search.includes("debug=1")){
      console.log('[ParcelsModal] Opened - overlay.has(.is-open):', overlay.classList.contains('is-open'), 'modal.has(.is-open):', modal.classList.contains('is-open'));
    }
  }
  
  function closeParcels(){
    if(!modal || !overlay) return;
    overlay.classList.remove('is-open');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if(location.search.includes("debug=1")){
      console.log('[ParcelsModal] Closed - overlay.has(.is-open):', overlay.classList.contains('is-open'), 'modal.has(.is-open):', modal.classList.contains('is-open'));
    }
  }
  
  function addParcelRow(carrierId){
    const rowsContainer = $(`.iu-parcelRows[data-carrier="${carrierId}"]`);
    if(!rowsContainer) return;
    
    const row = document.createElement('div');
    row.className = 'iu-parcel-row';
    row.innerHTML = `
      <div class="iu-parcel-row-inputs">
        <input type="text" class="iu-parcel-input" placeholder="Číslo zásilky" data-carrier="${carrierId}">
        <button class="iu-parcel-search-btn" type="button">Vyhledat</button>
      </div>
    `;
    
    const searchBtn = row.querySelector('.iu-parcel-search-btn');
    searchBtn.addEventListener('click', () => handleSearch(carrierId, row.querySelector('.iu-parcel-input')));
    
    rowsContainer.appendChild(row);
  }
  
  function openCarrierUrl(url){
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  
  function getFirstFilledCode(carrierId){
    const inputs = $$(`.iu-parcel-input[data-carrier="${carrierId}"]`);
    for(const input of inputs){
      const code = (input.value || '').trim();
      if(code) return code;
    }
    return null;
  }
  
  function handleSearch(carrierId, input){
    const code = (input.value || '').trim();
    const carrier = carriers[carrierId];
    if(!carrier || !carrier.baseUrl) return;
    
    let urlToOpen = carrier.baseUrl;
    
    if(code && carrier.deepUrl){
      urlToOpen = carrier.deepUrl(code);
    }
    
    openCarrierUrl(urlToOpen);
  }
  
  function handleFallback(carrierId){
    const code = getFirstFilledCode(carrierId);
    if(!code) return;
    
    const carrier = carriers[carrierId];
    if(!carrier || !carrier.urlFallback) return;
    
    const fallbackUrl = carrier.urlFallback(code);
    openCarrierUrl(fallbackUrl);
  }
  
  function initParcelsModal(){
    if(!modal || !overlay) return;
    
    if(location.search.includes("debug=1")){
      console.log('[ParcelsModal] Initialized - parcelsBtn:', !!parcelsBtn, 'parcelsBtnMobile:', !!parcelsBtnMobile, 'modal:', !!modal, 'overlay:', !!overlay);
    }

    if(parcelsBtn){
      parcelsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openParcels();
      });
    }
    if(parcelsBtnMobile){
      parcelsBtnMobile.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openParcels();
      });
    }

    overlay.addEventListener('click', closeParcels);

    const closeBtn = modal.querySelector('.iu-parcels-modal-close');
    if(closeBtn) closeBtn.addEventListener('click', closeParcels);

    document.addEventListener('keydown', (e) => {
      if(e.key === 'Escape') closeParcels();
    });
    
    $$('.iu-parcel-add-btn').forEach(btn => {
      const carrierId = btn.getAttribute('data-carrier');
      btn.addEventListener('click', () => addParcelRow(carrierId));
    });
    
    $$('.iu-parcel-search-btn').forEach(btn => {
      const row = btn.closest('.iu-parcel-row');
      const input = row?.querySelector('.iu-parcel-input');
      const carrierId = input?.getAttribute('data-carrier');
      if(carrierId){
        btn.addEventListener('click', () => handleSearch(carrierId, input));
      }
    });
    
    $$('.iu-parcel-fallback-btn').forEach(btn => {
      const carrierId = btn.getAttribute('data-carrier');
      if(carrierId){
        btn.addEventListener('click', () => handleFallback(carrierId));
      }
    });
  }
  
  initParcelsModal();
})();

// === AI PANEL (Quick Links) — centered modal (like Parcels) ===
(function(){
  'use strict';

  function initAiPanel(){
    const aiPanel = document.getElementById('iu-aiPanel');
    if (!aiPanel) return;

    const aiOverlay = document.getElementById('iu-aiOverlay');
    const aiModal = aiPanel.querySelector('.iu-aiModal');
    const aiClose = aiPanel.querySelector('.iu-aiClose');

    function getBtns(){
      return Array.from(document.querySelectorAll('[data-action="ai-panel"]'));
    }

    function setExpanded(isOpen){
      getBtns().forEach(btn => btn.setAttribute('aria-expanded', String(isOpen)));
    }

    function lockScroll(lock){
      document.documentElement.style.overflow = lock ? 'hidden' : '';
    }

    function openPanel(){
      aiPanel.hidden = false;
      if (aiOverlay) aiOverlay.hidden = false;
      lockScroll(true);
      aiPanel.dataset.open = '1';
      setExpanded(true);
    }

    function closePanel(){
      aiPanel.hidden = true;
      if (aiOverlay) aiOverlay.hidden = true;
      lockScroll(false);
      aiPanel.dataset.open = '0';
      setExpanded(false);
    }

    function togglePanel(){
      if (aiPanel.hidden) openPanel();
      else closePanel();
    }

    // 1) Klik na tlačítko (delegace)
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="ai-panel"]');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      togglePanel();
    }, true);

    // 2) Zavření: ✕
    if (aiClose){
      aiClose.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        closePanel();
      });
    }

    // 3) Zavření: klik mimo (overlay)
    if (aiOverlay){
      aiOverlay.addEventListener('click', closePanel);
    }

    // 4) Zavření: klik na backdrop (panel wrapper mimo modal)
    aiPanel.addEventListener('click', e => {
      if (e.target === aiPanel) closePanel();
    });

    // 5) Klik uvnitř modalu nemá zavírat
    if (aiModal){
      aiModal.addEventListener('click', e => {
        e.stopPropagation();
      });
    }

    // 6) ESC zavře
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closePanel();
    });

    // 7) Klik na "Otevřít" zavře
    aiPanel.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (a) closePanel();
    });

    // init
    aiPanel.hidden = true;
    if (aiOverlay) aiOverlay.hidden = true;
    aiPanel.dataset.open = '0';
    setExpanded(false);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initAiPanel);
  } else {
    initAiPanel();
  }

})();

// === RADIO VIEW (left rail) — middle column toggle (UI-only) ===
// Requirements:
// - NO changes to loadData / applyFilter / renderFeed (feed pipeline untouched)
// - Toggle visibility only: #feed <-> #iuRadioView
// - Static link chips only (no audio/streams)
(function(){
  'use strict';

  const RADIO_ITEMS = [
    { title: "Radiožurnál", url: "https://radiozurnal.rozhlas.cz/", desc: "Zpravodajství ČRo" },
    { title: "Dvojka", url: "https://dvojka.rozhlas.cz/", desc: "Mluvené slovo" },
    { title: "Vltava", url: "https://vltava.rozhlas.cz/", desc: "Kultura a hudba" },
    { title: "Evropa 2", url: "https://www.evropa2.cz/", desc: "Pop a zábava" },
    { title: "Impuls", url: "https://www.impuls.cz/", desc: "Hity + servis" },
    { title: "Fajn rádio", url: "https://fajnradio.cz/", desc: "Aktuální hity" },
    { title: "Kiss", url: "https://kiss.cz/", desc: "Hudba a zábava" },
    { title: "Rádio Beat", url: "https://www.radiobeat.cz/", desc: "Rock" },
    { title: "Blaník", url: "https://www.radioblanik.cz/", desc: "České hity" }
  ];

  // Unified navigation router (UI-only)
  // NOTE: non-radio sections still use the normal feed view.
  const VIEW_MAP = { home: 'home', media: 'media', radio: 'radio', jizdnirady: 'jizdnirady' };
  const STORAGE_KEY_WISH = "iuRadioWishDraftV1";
  const STORAGE_KEY_WISH_OPEN = "iuRadioWishOpenV1";

  // === RADIO WISH — fallback data (safe MVP, no backend) ===
  const FALLBACK_WISH = {
    radios: [
      { id: "impuls", label: "Rádio Impuls", method: "email", emailTo: "impuls@impuls.cz" },
      { id: "frekvence1", label: "Frekvence 1", method: "form", url: "https://www.frekvence1.cz/napiste-nam", hintText: "Kategorie ve formuláři: „Vysílání rádia“." },
      { id: "evropa2", label: "Evropa 2", method: "form", url: "https://www.evropa2.cz/kontakt" },
      { id: "cro_pisnicky_na_prani", label: "Český rozhlas – Písničky na přání", method: "form_or_sms", url: "https://program.rozhlas.cz/pisnicky-na-prani-7232426/o-poradu", smsHint: "Instrukce SMS jsou na stránce pořadu (MVP jen nápověda)." }
    ],
    // calendar first names (fallback subset)
    names: ["Jana","Jan","Petr","Petra","Pavel","Lucie","Marie","Tomáš","Veronika","David","Daniel","Andrea","Eliška","Karel","Jiří","Josef","Anna","Tereza","Marek","Kristýna"],
    // exactly 100 artists on prod via projects/data/artists_whitelist.json
    artists: ["Queen","ABBA","The Beatles","Michael Jackson","Adele","Ed Sheeran","Coldplay","Avicii","Lucie","Kabát"],
    // optional "Já jsem" roles
    iam: ["kamarád/ka","partner/ka","manžel/ka","přítel/přítelkyně","kolega/kolegyně","bratr/sestra","syn/dcera","maminka/tatínek","babička/dědeček"]
  };

  let wishData = { ...FALLBACK_WISH };

  function escapeHtml(s){
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function toPlainStringList(list){
    if (!Array.isArray(list)) return [];
    return list.map((x) => String(x || "").trim()).filter(Boolean);
  }

  function normalizeForSearch(s){
    try{
      return String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    }catch{
      return String(s || "").toLowerCase().trim();
    }
  }

  function isValidEmail(v){
    const s = String(v || "").trim();
    if (!s) return false;
    if (/\s/.test(s)) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  async function loadWishDataIntoState(){
    // NOTE: do not touch feed pipeline state; add a new safe bucket only
    const out = {
      radios: Array.isArray(FALLBACK_WISH.radios) ? [...FALLBACK_WISH.radios] : [],
      names: Array.isArray(FALLBACK_WISH.names) ? [...FALLBACK_WISH.names] : [],
      artists: Array.isArray(FALLBACK_WISH.artists) ? [...FALLBACK_WISH.artists] : [],
      iam: Array.isArray(FALLBACK_WISH.iam) ? [...FALLBACK_WISH.iam] : []
    };

    try{
      // Self-contained fetch (do not depend on outer helpers).
      // Relative URLs resolve under /projects/ (same origin).
      const withTs = (rel) => {
        try{
          const u = new URL(String(rel || ""), window.location.href);
          u.searchParams.set("ts", String(Date.now()));
          return u.toString();
        }catch{
          return String(rel || "");
        }
      };
      const fetchJson = async (rel, timeoutMs = 4500) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try{
          const res = await fetch(withTs(rel), {
            cache: "no-store",
            headers: { "cache-control": "no-cache" },
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`HTTP_${res.status}`);
          return await res.json();
        } finally {
          clearTimeout(timer);
        }
      };

      const [radiosJson, calendarNamesJson, artistsJson, iamJson, legacyNamesJson] = await Promise.allSettled([
        fetchJson("/projects/data/radio_requests.json", 4500),
        fetchJson("/projects/data/calendar_first_names.json", 4500),
        fetchJson("/projects/data/artists_whitelist.json", 4500),
        fetchJson("/projects/data/iam_whitelist.json", 4500),
        // legacy fallback (older versions)
        fetchJson("/projects/data/names_whitelist.json", 4500)
      ]);

      if (radiosJson.status === "fulfilled" && radiosJson.value && Array.isArray(radiosJson.value.radios)) {
        out.radios = radiosJson.value.radios
          .filter((r) => r && r.id && r.label && r.method)
          .map((r) => ({
            id: String(r.id),
            label: String(r.label),
            method: String(r.method),
            emailTo: r.emailTo ? String(r.emailTo) : undefined,
            url: r.url ? String(r.url) : undefined,
            hintText: r.hintText ? String(r.hintText) : undefined,
            smsHint: r.smsHint ? String(r.smsHint) : undefined
          }));
      }

      if (calendarNamesJson.status === "fulfilled" && calendarNamesJson.value && Array.isArray(calendarNamesJson.value.names)) {
        out.names = toPlainStringList(calendarNamesJson.value.names);
      } else if (legacyNamesJson.status === "fulfilled" && legacyNamesJson.value && Array.isArray(legacyNamesJson.value.names)) {
        out.names = toPlainStringList(legacyNamesJson.value.names);
      }

      if (artistsJson.status === "fulfilled" && artistsJson.value && Array.isArray(artistsJson.value.artists)) {
        // enforce unique + first 100 (spec: exactly 100 on prod via file contents)
        out.artists = toPlainStringList(artistsJson.value.artists)
          .filter((x, i, arr) => arr.indexOf(x) === i)
          .slice(0, 100);
      }

      if (iamJson.status === "fulfilled" && iamJson.value && Array.isArray(iamJson.value.iam)) {
        out.iam = toPlainStringList(iamJson.value.iam);
      }
    }catch{}

    wishData = out;
    try{
      // Store in a non-feed bucket (UI-only) for debugging/inspection.
      // We intentionally use window.state (not the feed's internal state closure).
      if (!window.state || typeof window.state !== "object") {
        window.state = {};
      }
      window.state.radioWish = { ...out, loadedAt: Date.now() };
    }catch{}
    return out;
  }

  function renderRadioView(viewEl){
    const wishForm = `
      <details class="iuRadioWish iuWishAcc" id="iuRadioWish" aria-label="Přání do rádia">
        <summary class="iuWishAccSummary">
          <span class="iuWishAccTitle">Přání do rádia</span>
          <span class="iuWishAccCaret" aria-hidden="true"></span>
        </summary>

        <div class="iuWishAccBody">
          <div class="iuWishRows" role="group" aria-label="Formulář přání">
          <!-- Row 1: 3 equal blocks -->
          <div class="iuWishRow iuWishRow--3" aria-label="Základní volby">
            <div class="iuWishCard">
              <label class="iuWishCardBody">
                <span class="iuLabel">Typ požadavku</span>
                <select class="iuCtrl" id="iuWishType">
                  <option value="">— vyberte —</option>
                  <option value="narozeniny">Narozeninám</option>
                  <option value="svatek">Svátek</option>
                  <option value="vyroci">Výročí</option>
                  <option value="uspech">Úspěch / gratulace</option>
                  <option value="jen_tak">Jen tak pro radost</option>
                  <option value="jiny">Jiný</option>
                </select>
              </label>
            </div>

            <div class="iuWishCard">
              <div class="iuWishCardBody">
                <label class="iuLabel" for="iuWishRadio">Rádio *</label>
                <select class="iuCtrl" id="iuWishRadio" required>
                  <option value="">— vyberte —</option>
                </select>
                <div class="iuHint" id="iuWishRadioHint" hidden></div>
              </div>
            </div>

            <div class="iuWishCard">
              <div class="iuWishCardBody">
                <span class="iuLabel">Písnička od</span>
                <select class="iuCtrl" id="iuWishSong">
                  <option value="">— vyberte —</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Row 2: 3 equal blocks -->
          <div class="iuWishRow iuWishRow--3" aria-label="Adresáti a text přání">
            <div class="iuWishCard">
              <div class="iuWishCardBody">
                <span class="iuLabel">Pro koho *</span>
                <input class="iuCtrl" id="iuWishTo" type="text" required placeholder="Komu je přání určeno" />
                <div class="iuErr" id="iuWishToErr" hidden>Vyplňte pole Pro koho.</div>
              </div>
            </div>

            <div class="iuWishCard">
              <div class="iuWishCardBody">
                <span class="iuLabel">Od koho *</span>
                <input class="iuCtrl" id="iuWishFrom" type="text" required placeholder="Kdo přání posílá" />
                <div class="iuErr" id="iuWishFromErr" hidden>Vyplňte pole Od koho.</div>
              </div>
            </div>

            <div class="iuWishCard">
              <label class="iuWishCardBody">
                <span class="iuLabel">Text přání</span>
                <textarea class="iuCtrl" id="iuWishText" placeholder="Zde můžete napsat text přání (nepovinné)"></textarea>
              </label>
            </div>
          </div>

          <!-- Row 3: emails -->
          <div class="iuWishRow iuWishRow--2" aria-label="E-maily (volitelné)">
            <div class="iuWishCard">
              <label class="iuWishCardBody">
                <span class="iuLabel">Email komu přeji</span>
                <input class="iuCtrl" id="iuWishEmailTo" type="email" autocomplete="email" inputmode="email" placeholder="např. jmeno@domena.cz" />
              </label>
            </div>
            <div class="iuWishCard">
              <label class="iuWishCardBody">
                <span class="iuLabel">Telefon komu přeji</span>
                <input class="iuCtrl" id="iuWishPhoneTo" type="tel" autocomplete="tel" inputmode="tel" placeholder="např. 777 123 456" />
              </label>
            </div>
          </div>
          </div>

          <div class="iuWishActions">
            <button class="iuBtn" id="iuWishSendRadio" type="button">Odeslat rádiu</button>
            <div class="iuWishStatus" id="iuWishStatus" aria-live="polite"></div>
            <div class="iuErr iuErrBlock" id="iuWishErrors" hidden></div>
          </div>
        </div>
      </details>
    `;

    const chips = RADIO_ITEMS.map((it) => {
      const title = escapeHtml(it.title);
      const url = escapeHtml(it.url);
      const desc = escapeHtml(it.desc || "");
      const descHtml = desc ? `<span class="iuRadioChipDesc">${desc}</span>` : "";
      return `
        <a class="iuRadioChip" href="${url}" target="_blank" rel="noopener noreferrer">
          <span class="iuRadioChipTitle">${title}</span>
          ${descHtml}
        </a>
      `;
    }).join("");

    viewEl.innerHTML = wishForm + `<div class="iuRadioGrid" role="list" aria-label="Odkazy na rádia">${chips}</div>`;
  }

  function ensureHomeView(){
    const existing = document.getElementById('iuHomeView');
    if (existing) return existing;
    const newsList = document.getElementById('newsList');
    if (!newsList) return null;

    const el = document.createElement('div');
    el.id = 'iuHomeView';
    el.className = 'iuHomeView';
    el.hidden = true;
    el.innerHTML = `
      <div class="iuHomeCanvas" role="region" aria-label="Domů">
        <section class="iuHomeWeather" data-home-key="pocasi" aria-label="Počasí">
          <div class="iuHomeWeatherShell" role="group" aria-label="Počasí dnes">
            <div class="iuHomeWeatherSkeleton" id="iuHomeWeatherSkeleton">loading weather…</div>
            <div class="iuHomeWeatherContent" id="iuHomeWeatherContent" hidden>
              <div class="iuHomeWeatherTopRow">
                <div class="iuHomeWeatherMeta">
                  <div class="iuHomeWeatherCity" id="iuHomeWxCity">—</div>
                  <div class="iuHomeWeatherDate" id="iuHomeWxDate">—</div>
                  <div class="iuHomeWeatherDesc" id="iuHomeWxDesc">—</div>
                </div>
                <div class="iuHomeWeatherNow">
                  <div class="iuHomeWeatherTemp" id="iuHomeWxTemp">—°</div>
                  <div class="iuHomeWeatherIcon" id="iuHomeWxIcon" aria-hidden="true">🌤</div>
                </div>
              </div>

              <div class="iuHomeWeatherForecast" id="iuHomeWxForecast" aria-label="Předpověď (3 hodiny)">
                <div class="iuHomeWxChip" aria-hidden="true"><div class="iuHomeWxChipT">--h</div><div class="iuHomeWxChipV">—</div></div>
                <div class="iuHomeWxChip" aria-hidden="true"><div class="iuHomeWxChipT">--h</div><div class="iuHomeWxChipV">—</div></div>
                <div class="iuHomeWxChip" aria-hidden="true"><div class="iuHomeWxChipT">--h</div><div class="iuHomeWxChipV">—</div></div>
              </div>
            </div>
          </div>
        </section>
        <div class="iuHomeHexGrid" id="iuHomeHexGrid" aria-label="Sekce"></div>
        <section class="iuHomeText" aria-label="O infoUzel.cz">
          <div class="iuHomeTextInner">
            <h2 class="iuHomeTextTitle">infoUzel.cz</h2>
            <p class="iuHomeTextBody">
              Rychlý přehled zpráv, rádia, TV, mapy a cestování na jednom místě. Domů je rozcestník — vyberte sekci a pokračujte.
            </p>
          </div>
        </section>

        <section class="iuHomeFav" aria-label="Oblíbené moduly">
          <div class="iuHomeFavHead">
            <h2 class="iuHomeFavTitle">Oblíbené</h2>
            <button class="iuHomeFavAdd" type="button" aria-label="Přidat modul">+ Přidat modul</button>
          </div>
          <div class="iuHomeFavGrid" aria-hidden="true"></div>
        </section>
      </div>
    `.trim();

    // Insert into the same middle column container as #feed (inside #newsList).
    // Keep #feed as the render target for normal sections.
    const feed = document.getElementById('feed');
    if (feed && feed.parentElement === newsList) {
      newsList.insertBefore(el, feed);
    } else {
      newsList.appendChild(el);
    }
    return el;
  }

  function renderHomeWeather(){
    const skeletonEl = document.getElementById('iuHomeWeatherSkeleton');
    const contentEl = document.getElementById('iuHomeWeatherContent');
    const cityEl = document.getElementById('iuHomeWxCity');
    const dateEl = document.getElementById('iuHomeWxDate');
    const tempEl = document.getElementById('iuHomeWxTemp');
    const iconEl = document.getElementById('iuHomeWxIcon');
    const descEl = document.getElementById('iuHomeWxDesc');
    const forecastEl = document.getElementById('iuHomeWxForecast');
    if (!skeletonEl && !contentEl && !cityEl && !dateEl && !tempEl && !iconEl && !descEl && !forecastEl) return;

    // idempotent: prevent parallel fetches
    try{
      if (window.__iuHomeWxLoading) return;
      window.__iuHomeWxLoading = true;
    }catch{}

    const fmtDeg = (n) => {
      if (typeof n !== 'number' || !isFinite(n)) return '—';
      return Math.round(n) + '°';
    };
    const fmtHour = (s) => {
      try{
        const d = new Date(String(s || ''));
        if (isNaN(d.getTime())) return '--h';
        const h = d.getHours();
        return String(h) + 'h';
      }catch{
        return '--h';
      }
    };
    const fmtDate = () => {
      try{
        const TZ = "Europe/Prague";
        return new Intl.DateTimeFormat("cs-CZ",{weekday:"long",day:"numeric",month:"long",timeZone:TZ}).format(new Date());
      }catch{
        return "";
      }
    };
    const iconFromDesc = (desc) => {
      const s = String(desc || "").toLowerCase();
      if (s.includes("slun")) return "☀️";
      if (s.includes("jas")) return "☀️";
      if (s.includes("obla")) return "☁️";
      if (s.includes("zamra")) return "☁️";
      if (s.includes("déšť") || s.includes("dest") || s.includes("mrhol")) return "🌧";
      if (s.includes("sníh") || s.includes("snih")) return "❄️";
      if (s.includes("bouř")) return "⛈";
      return "🌤";
    };

    // Skeleton first (no CLS)
    try{ if (skeletonEl) skeletonEl.hidden = false; }catch{}
    try{ if (contentEl) contentEl.hidden = true; }catch{}

    const withTs = (rel) => {
      try{
        const u = new URL(String(rel || ''), window.location.href);
        u.searchParams.set('ts', String(Date.now()));
        return u.toString();
      }catch{
        return String(rel || '');
      }
    };

    fetch(withTs('/projects/data/weather.json'), { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!d || typeof d !== 'object') throw new Error('bad weather');
        const city = String(d.place || '—');
        const desc = String(d?.current?.desc || '—');
        if (cityEl) cityEl.textContent = city;
        if (dateEl) dateEl.textContent = fmtDate();
        if (tempEl) tempEl.textContent = fmtDeg(d?.current?.temp);
        if (descEl) descEl.textContent = desc;
        if (iconEl) iconEl.textContent = iconFromDesc(desc);

        if (forecastEl) {
          const hours = Array.isArray(d.hours) ? d.hours.slice(0, 3) : [];
          const chips = Array.from(forecastEl.querySelectorAll('.iuHomeWxChip'));
          for (let i = 0; i < 3; i++){
            const chip = chips[i];
            const it = hours[i];
            if (!chip) continue;
            if (it) {
              chip.innerHTML = `<div class="iuHomeWxChipT">${escapeHtml(fmtHour(it.time))}</div><div class="iuHomeWxChipV">${escapeHtml(fmtDeg(it.temp))}</div>`;
              chip.removeAttribute('aria-hidden');
            } else {
              chip.innerHTML = `<div class="iuHomeWxChipT">--h</div><div class="iuHomeWxChipV">—</div>`;
              chip.setAttribute('aria-hidden', 'true');
            }
          }
        }

        try{ if (skeletonEl) skeletonEl.hidden = true; }catch{}
        try{ if (contentEl) contentEl.hidden = false; }catch{}
      })
      .catch(() => {
        try{
          if (skeletonEl) skeletonEl.textContent = 'Počasí nedostupné';
        }catch{}
      })
      .finally(() => {
        try{ window.__iuHomeWxLoading = false; }catch{}
      });
  }

  function buildHomeHexGrid(){
    const grid = document.getElementById('iuHomeHexGrid');
    if (!grid) return;
    grid.replaceChildren();

    const navItems = Array.from(document.querySelectorAll('.iu-leftNav .iu-leftNavItem[data-accent]'));
    const sections = [];
    const seen = new Set();
    for (const it of navItems) {
      const key = String(it.getAttribute('data-accent') || '').trim().toLowerCase();
      if (!key || key === 'home') continue;
      if (seen.has(key)) continue;
      seen.add(key);

      const labelEl = it.querySelector('.iu-leftNavLabel');
      const label = (labelEl ? labelEl.textContent : it.textContent || '').trim();

      // Icon SVG: reuse exact markup from left rail (sanitized: drop any on* attributes).
      let svgHtml = '';
      try{
        const svg = it.querySelector('.iu-leftNavIcon svg');
        if (svg) {
          const clone = svg.cloneNode(true);
          const nodes = [clone, ...Array.from(clone.querySelectorAll('*'))];
          nodes.forEach((n) => {
            try{
              Array.from(n.attributes || []).forEach((a) => {
                if (!a || !a.name) return;
                if (/^on/i.test(a.name)) n.removeAttribute(a.name);
              });
            }catch{}
          });
          svgHtml = clone.outerHTML;
        }
      }catch{}

      // Section accent: use stable CSS variables (required), fallback to blue.
      const varKey = (k) => {
        if (k === 'mapy') return 'maps';
        if (k === 'jr') return 'timetable';
        return k;
      };
      const accentVar = `--iu-accent-${varKey(key)}`;
      const accentExpr = `var(${accentVar}, #3B82F6)`;

      sections.push({ key, label, svgHtml, accentExpr });
    }

    for (const s of sections) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'iuHomeHex';
      btn.setAttribute('data-section', s.key);
      btn.setAttribute('aria-label', String(s.label || s.key));
      btn.style.setProperty('--iuHexBg', s.accentExpr || '#3B82F6');
      const iconHtml = s.svgHtml ? `<span class="iuHomeHexIcon" aria-hidden="true">${s.svgHtml}</span>` : '';
      btn.innerHTML = `${iconHtml}<span class="iuHomeHexLabel">${escapeHtml(s.label || s.key)}</span>`;
      btn.addEventListener('click', () => {
        // keep tile key stable for ordering (data-section = left-rail accent key),
        // but always persist normalized URL section (e.g. jr -> jizdnirady).
        persistSection(normalizeSection(s.key));
        applySectionFromURL();
      });
      grid.appendChild(btn);
    }

    iuHomeApplyRailOrder();
    requestAnimationFrame(iuHomeApplyRailOrder);
    setTimeout(iuHomeApplyRailOrder, 200);

    iuHomeApplyRailSectionOrder();
    requestAnimationFrame(iuHomeApplyRailSectionOrder);
    setTimeout(iuHomeApplyRailSectionOrder, 200);
  }

  function iuHomeApplyRailOrder() {
    try {
      if ((document.body?.dataset?.section || '') !== 'home') return;

      const railKeys = Array.from(
        document.querySelectorAll('.iu-leftNav .iu-leftNavItem[data-accent]')
      )
        .map(el => String(el.getAttribute('data-accent') || '').trim().toLowerCase())
        .filter(k => k && k !== 'home');

      const tiles = Array.from(
        document.querySelectorAll('.iuHomeHex434 .iuHex, #iuHomeHexGrid .iuHomeHex')
      );
      if (!railKeys.length || !tiles.length) return;

      const tileKey = (el) => {
        const ds = String(el.getAttribute('data-section') || '').trim().toLowerCase();
        if (ds) return ds;
        const cls = Array.from(el.classList).find(c => c.startsWith('iuHex--'));
        return cls ? cls.slice('iuHex--'.length).toLowerCase() : '';
      };

      const map = new Map();
      tiles.forEach(el => {
        const k = tileKey(el);
        if (k) map.set(k, el);
      });

      railKeys.forEach((k, i) => {
        const el = map.get(k);
        if (el) el.style.order = String(i + 1);
      });

      const railSet = new Set(railKeys);
      tiles.forEach(el => {
        const k = tileKey(el);
        if (!k || !railSet.has(k)) el.style.order = '999';
      });

    } catch (e) {
      console.warn('[HOME ORDER] failed', e);
    }
  }

  function iuHomeApplyRailSectionOrder() {
    try {
      if ((document.body?.dataset?.section || '') !== 'home') return;

      const railKeys = Array.from(
        document.querySelectorAll('.iu-leftNav .iu-leftNavItem[data-accent]')
      )
        .map(el => String(el.getAttribute('data-accent') || '').trim().toLowerCase())
        .filter(k => k && k !== 'home');

      const homeRoot = document.getElementById('iuHomeView') || document.body;
      const sections = Array.from(homeRoot.querySelectorAll('section[data-home-key]'));

      if (!railKeys.length || !sections.length) return;

      const railIndex = new Map(railKeys.map((k,i)=>[k, i+1]));
      const missingInRail = [];

      for (const s of sections) {
        const key = String(s.getAttribute('data-home-key') || '').trim().toLowerCase();
        const ord = railIndex.get(key);
        if (ord) s.style.order = String(ord);
        else { s.style.order = '999'; if (key) missingInRail.push(key); }
      }

      if (!window.__iuHomeSectionOrderLogged) {
        window.__iuHomeSectionOrderLogged = true;
        if (missingInRail.length) console.warn('[HOME SECTION ORDER] Section keys not in rail:', Array.from(new Set(missingInRail)));
      }
    } catch (e) {
      console.warn('[HOME SECTION ORDER] failed', e);
    }
  }

  window.iuHomeOrderProof = function () {
    const rail = [...document.querySelectorAll('.iu-leftNav .iu-leftNavItem[data-accent]')]
      .map(el => String(el.getAttribute('data-accent') || '').trim().toLowerCase())
      .filter(k => k && k !== 'home');

    const tiles = [...document.querySelectorAll('.iuHomeHex434 .iuHex, #iuHomeHexGrid .iuHomeHex')].map(el => {
      const ds = String(el.getAttribute('data-section') || '').trim().toLowerCase();
      const cls = [...el.classList].find(c => c.startsWith('iuHex--'));
      const key = ds || (cls ? cls.slice('iuHex--'.length).toLowerCase() : '');
      return {
        key,
        order: Number(getComputedStyle(el).order)
      };
    });

    console.log('rail=', rail);
    console.table(tiles);

    const mismatches = rail
      .map((k,i)=>({k,expected:i+1,got:tiles.find(t=>t.key===k)?.order}))
      .filter(x=>x.expected!==x.got);

    console.log('mismatches=', mismatches);

    const sec = [...document.querySelectorAll('section[data-home-key]')].map(s => ({
      key: String(s.getAttribute('data-home-key') || '').trim().toLowerCase(),
      order: Number(getComputedStyle(s).order || 0),
      class: s.className
    }));
    console.table(sec);

    const secMap = new Map(sec.map(x => [x.key, x]));
    const sectionMismatches = rail
      .map((k,i)=>({k,expected:i+1,got:secMap.get(k)?.order}))
      .filter(x=>typeof x.got === 'number' && x.got !== 0 && x.expected !== x.got);
    console.log('section_mismatches=', sectionMismatches);
  };

  function setLeftNavActive(key){
    const rawKey = String(key || '').trim().toLowerCase();
    const k = rawKey === 'jizdnirady' ? 'jr' : rawKey;
    const items = document.querySelectorAll('.iu-leftNav .iu-leftNavItem');
    items.forEach(el=>{
      el.classList.remove('is-active');
      el.removeAttribute('aria-current');
    });

    const active = document.querySelector(`.iu-leftNav .iu-leftNavItem[data-accent="${k}"]`);
    if(active){
      active.classList.add('is-active');
      active.setAttribute('aria-current','page');
    }
  }

  function showView(key){
    const feedEl = document.getElementById('feed');
    const viewEl = document.getElementById('iuRadioView');
    const homeEl = document.getElementById('iuHomeView');
    const jrEl = document.getElementById('iuJizdniRadyView');

    if (feedEl) feedEl.hidden = true;
    if (viewEl) viewEl.hidden = true;
    if (homeEl) homeEl.hidden = true;
    if (jrEl) jrEl.hidden = true;

    if(key === 'home' && homeEl) homeEl.hidden = false;
    if(key === 'radio' && viewEl) viewEl.hidden = false;
    if(key === 'jizdnirady' && jrEl) jrEl.hidden = false;
    // default feed view for all other sections
    if(key !== 'home' && key !== 'radio' && key !== 'jizdnirady' && feedEl) feedEl.hidden = false;
  }

  function normalizeSection(raw){
    const k = String(raw || '').trim().toLowerCase();
    if (k === 'home') return 'home';
    if (k === 'radio') return 'radio';
    if (k === 'jr') return 'jizdnirady'; // legacy alias (left rail accent key)
    if (k === 'jizdnirady') return 'jizdnirady';
    // allow other left-rail sections to roundtrip via URL without changing feed pipeline
    const allowed = new Set(['media','tv','tvonline','jizdnirady','mapy','travel','pocasi','namedays','tvprogram','culture','ads']);
    return allowed.has(k) ? k : 'media';
  }

  // ==============================
  // JÍZDNÍ ŘÁDY (JR) — UI-only view
  // - Local dataset for suggestions
  // - Deep-link results to IDOS (no scraping)
  // ==============================
  const JR_STOPS_URL = '/projects/data/jr_stops_min.json';
  const JR_FAVS_KEY = 'iuJR:favs';
  const JR_MODE_KEY = 'iuJR:mode';
  // IDOS departures prefill support is NOT verified yet.
  // Default to safe planner fallback (never lands on a blank departures page).
  const JR_DEPARTURES_SUPPORTS_PREFILL = false;
  const JR_SUGGEST_LIMIT = 15;
  let __iuJRStops = null; // [{ raw, norm, first }]
  let __iuJRBucket = null; // Map firstChar -> array
  let __iuJRInited = false;

  function iuJRNormalize(s){
    try{
      return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }catch{
      return String(s || '').toLowerCase().trim();
    }
  }

  function iuJRTokenize(qNorm){
    return String(qNorm || '').split(' ').map(x => x.trim()).filter(Boolean);
  }

  async function iuJRLoadStopsOnce(){
    if (__iuJRStops) return __iuJRStops;
    try{
      const res = await fetch(JR_STOPS_URL, { cache: 'force-cache' });
      if (!res.ok) throw new Error('stops http ' + res.status);
      const arr = await res.json();
      const list = Array.isArray(arr) ? arr : [];
      __iuJRStops = list
        .map((raw) => String(raw || '').trim())
        .filter(Boolean)
        .map((raw) => {
          const norm = iuJRNormalize(raw);
          const first = norm ? norm[0] : '';
          return { raw, norm, first };
        });

      __iuJRBucket = new Map();
      for (const it of __iuJRStops){
        const k = it.first || '';
        if (!__iuJRBucket.has(k)) __iuJRBucket.set(k, []);
        __iuJRBucket.get(k).push(it);
      }
      // If user already typed while loading, refresh suggestions.
      try{
        const a = document.activeElement;
        const sec = String(document.body?.dataset?.section || '').trim().toLowerCase();
        if (sec === 'jizdnirady' && a && (a.id === 'iuJrFrom' || a.id === 'iuJrTo' || a.id === 'iuJrStop')) {
          a.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }catch{}
      return __iuJRStops;
    }catch(e){
      console.warn('[JR] stops load failed', e);
      __iuJRStops = [];
      __iuJRBucket = new Map();
      return __iuJRStops;
    }
  }

  const JR_TOP = new Set(['praha','brno','ostrava','plzen','hradec kralove','pardubice','olomouc','liberec','usti nad labem']);

  function iuJRRank(items, qNorm, tokens){
    const out = [];
    for (const it of items){
      if (!it || !it.norm) continue;
      let ok = true;
      for (const t of tokens){
        if (!it.norm.includes(t)) { ok = false; break; }
      }
      if (!ok) continue;
      const starts = it.norm.startsWith(qNorm);
      const contains = !starts && it.norm.includes(qNorm);
      if (!starts && !contains) continue;

      let score = starts ? 0 : 10;
      if (JR_TOP.has(it.norm)) score -= 1;
      score += Math.min(6, Math.max(0, it.raw.length - 5) / 10);
      out.push({ it, score });
    }
    out.sort((a,b) => (a.score - b.score) || a.it.raw.localeCompare(b.it.raw, 'cs', { sensitivity: 'base' }));
    return out.slice(0, JR_SUGGEST_LIMIT).map(x => x.it.raw);
  }

  function iuJRGetSuggestions(q){
    const qNorm = iuJRNormalize(q);
    if (!qNorm || qNorm.length < 1) return [];
    const tokens = iuJRTokenize(qNorm);
    const first = qNorm[0] || '';
    const base = (__iuJRBucket && __iuJRBucket.get(first)) ? __iuJRBucket.get(first) : (__iuJRStops || []);
    return iuJRRank(base, qNorm, tokens);
  }

  function iuJRFormatDateDMY(iso){
    // input[type=date] => yyyy-mm-dd
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return '';
    return `${Number(m[3])}.${Number(m[2])}.${m[1]}`;
  }

  function iuJRFormatTimeHM(hhmm){
    const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return '';
    return `${Number(m[1])}:${m[2]}`;
  }

  function iuJRBuildIdosUrl(opts){
    const f = encodeURIComponent(String(opts.from || '').trim());
    const t = encodeURIComponent(String(opts.to || '').trim());
    const date = encodeURIComponent(String(opts.date || ''));
    const time = encodeURIComponent(String(opts.time || ''));
    const byarr = opts.byarr ? 'true' : 'false';
    const direct = opts.direct ? 'true' : 'false';
    return `https://idos.idnes.cz/vlakyautobusymhdvse/spojeni/?f=${f}&t=${t}&date=${date}&time=${time}&byarr=${byarr}&direct=${direct}&submit=true`;
  }

  function iuJRBuildIdosDeparturesUrl(opts){
    // If prefill is unverified, treat /odjezdy/ as a landing page (no params).
    if (!JR_DEPARTURES_SUPPORTS_PREFILL) return 'https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/';
    const f = encodeURIComponent(String(opts.stop || '').trim());
    const date = encodeURIComponent(String(opts.date || ''));
    const time = encodeURIComponent(String(opts.time || ''));
    const base = 'https://idos.idnes.cz/vlakyautobusymhdvse/odjezdy/';
    const qs = `?f=${f}${date ? `&date=${date}` : ''}${time ? `&time=${time}` : ''}&submit=true`;
    return base + qs;
  }

  function iuJROpenIdos(opts){
    const url = iuJRBuildIdosUrl(opts);
    try{
      window.open(url, '_blank', 'noopener,noreferrer');
    }catch{
      try{ window.location.href = url; }catch{}
    }
  }

  function iuJROpenIdosDepartures(opts){
    // Fallback-by-design:
    // - If departures prefill is verified, open /odjezdy/ with params.
    // - Otherwise ALWAYS open planner with f=<stop>&submit=true, so user never lands on a blank page.
    const stop = String(opts?.stop || '').trim();
    const date = String(opts?.date || '');
    const time = String(opts?.time || '');
    if (JR_DEPARTURES_SUPPORTS_PREFILL) {
      const url = iuJRBuildIdosDeparturesUrl({ stop, date, time });
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    iuJROpenIdos({ from: stop, to: '', date, time, byarr: false, direct: false });
  }

  function iuJRGetFavs(){
    try{
      const raw = localStorage.getItem(JR_FAVS_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch{
      return [];
    }
  }
  function iuJRSetFavs(arr){
    try{ localStorage.setItem(JR_FAVS_KEY, JSON.stringify(arr)); }catch{}
  }

  function iuJRRenderFavs(container, onPick){
    if (!container) return;
    container.replaceChildren();
    const favs = iuJRGetFavs();
    for (const f of favs){
      const from = String(f?.from || '').trim();
      const to = String(f?.to || '').trim();
      if (!from || !to) continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'iuJrChip';
      btn.textContent = `${from} → ${to}`;
      btn.addEventListener('click', () => { try{ onPick(from, to); }catch{} });
      container.appendChild(btn);
    }
  }

  function iuJRBindSuggest(inputEl, wrapEl, listEl){
    if (!inputEl || !wrapEl || !listEl) return;
    let open = false;
    let active = -1;
    let lastItems = [];
    let t = 0;

    const close = () => {
      open = false;
      active = -1;
      lastItems = [];
      try{ wrapEl.hidden = true; }catch{}
      try{ inputEl.setAttribute('aria-expanded','false'); }catch{}
      try{ inputEl.removeAttribute('aria-activedescendant'); }catch{}
      try{ listEl.replaceChildren(); }catch{}
    };

    const render = (items) => {
      lastItems = items;
      listEl.replaceChildren();
      active = items.length ? 0 : -1;
      items.forEach((label, i) => {
        const opt = document.createElement('div');
        opt.className = 'iuJrOpt';
        opt.id = `${listEl.id}-opt-${i}`;
        opt.setAttribute('role','option');
        opt.setAttribute('aria-selected', i === active ? 'true' : 'false');
        opt.dataset.value = label;
        opt.textContent = label;
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          inputEl.value = label;
          close();
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        });
        listEl.appendChild(opt);
      });
      if (items.length){
        wrapEl.hidden = false;
        inputEl.setAttribute('aria-expanded','true');
        inputEl.setAttribute('aria-activedescendant', `${listEl.id}-opt-${active}`);
        open = true;
      } else {
        close();
      }
    };

    const move = (dir) => {
      if (!open || !lastItems.length) return;
      active = Math.max(0, Math.min(lastItems.length - 1, active + dir));
      Array.from(listEl.children).forEach((c, idx) => {
        try{ c.setAttribute('aria-selected', idx === active ? 'true' : 'false'); }catch{}
      });
      inputEl.setAttribute('aria-activedescendant', `${listEl.id}-opt-${active}`);
    };

    const pickActive = () => {
      if (!open || active < 0 || active >= lastItems.length) return false;
      inputEl.value = lastItems[active];
      close();
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    };

    const update = () => {
      const q = inputEl.value || '';
      if (String(q).trim().length < 1){ close(); return; }
      const items = iuJRGetSuggestions(q);
      render(items);
    };

    inputEl.addEventListener('input', () => {
      if (t) clearTimeout(t);
      t = setTimeout(update, 70);
    });
    inputEl.addEventListener('focus', () => { update(); });
    inputEl.addEventListener('blur', () => { setTimeout(close, 140); });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown'){ e.preventDefault(); if (!open) update(); move(1); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); if (!open) update(); move(-1); }
      else if (e.key === 'Enter'){
        if (open){
          if (pickActive()) e.preventDefault();
        }
      }
      else if (e.key === 'Escape'){ if (open){ e.preventDefault(); close(); } }
    });
  }

  function iuJRInitView(){
    if (__iuJRInited) return;
    const view = document.getElementById('iuJizdniRadyView');
    if (!view) return;
    __iuJRInited = true;

    const elForm = document.getElementById('iuJrForm');
    const elModeRoutes = document.getElementById('iuJrModeRoutes');
    const elModeDeps = document.getElementById('iuJrModeDepartures');
    const panelRoutes = document.getElementById('iuJrPanelRoutes');
    const panelDeps = document.getElementById('iuJrPanelDepartures');

    const elFrom = document.getElementById('iuJrFrom');
    const elTo = document.getElementById('iuJrTo');
    const elDate = document.getElementById('iuJrDate');
    const elTime = document.getElementById('iuJrTime');
    const elDirect = document.getElementById('iuJrDirect');
    const elSubmit = document.getElementById('iuJrSubmit');
    const elSave = document.getElementById('iuJrSaveFav');
    const elErrFrom = document.getElementById('iuJrErrFrom');
    const elErrTo = document.getElementById('iuJrErrTo');
    const favWrap = document.getElementById('iuJrFavChips');

    const elStop = document.getElementById('iuJrStop');
    const elDepTime = document.getElementById('iuJrDepTime');
    const elDepTimeWrap = document.getElementById('iuJrDepTimeWrap');
    const elDepTimeEnable = document.getElementById('iuJrDepTimeEnable');
    const elNow = document.getElementById('iuJrNow');
    const elDepSubmit = document.getElementById('iuJrDepartSubmit');
    const elErrStop = document.getElementById('iuJrErrStop');

    const setDefaults = () => {
      try{
        const now = new Date();
        if (elDate && !elDate.value){
          const y = now.getFullYear();
          const m = String(now.getMonth()+1).padStart(2,'0');
          const d = String(now.getDate()).padStart(2,'0');
          elDate.value = `${y}-${m}-${d}`;
        }
        if (elTime && !elTime.value){
          const ms = now.getTime();
          const step = 5 * 60 * 1000;
          const rounded = new Date(Math.ceil(ms / step) * step);
          const hh = String(rounded.getHours()).padStart(2,'0');
          const mm = String(rounded.getMinutes()).padStart(2,'0');
          elTime.value = `${hh}:${mm}`;
        }
        if (elDepTime && !elDepTime.value){
          const ms = now.getTime();
          const step = 5 * 60 * 1000;
          const rounded = new Date(Math.ceil(ms / step) * step);
          const hh = String(rounded.getHours()).padStart(2,'0');
          const mm = String(rounded.getMinutes()).padStart(2,'0');
          elDepTime.value = `${hh}:${mm}`;
        }
      }catch{}
    };
    setDefaults();

    const getMode = () => {
      try{
        const v = String(localStorage.getItem(JR_MODE_KEY) || '').trim().toLowerCase();
        return (v === 'departures' || v === 'routes') ? v : 'routes';
      }catch{
        return 'routes';
      }
    };
    const setMode = (mode) => {
      const m = (mode === 'departures') ? 'departures' : 'routes';
      try{ localStorage.setItem(JR_MODE_KEY, m); }catch{}
      if (elModeRoutes) {
        elModeRoutes.setAttribute('aria-selected', m === 'routes' ? 'true' : 'false');
        elModeRoutes.setAttribute('tabindex', m === 'routes' ? '0' : '-1');
      }
      if (elModeDeps) {
        elModeDeps.setAttribute('aria-selected', m === 'departures' ? 'true' : 'false');
        elModeDeps.setAttribute('tabindex', m === 'departures' ? '0' : '-1');
      }
      if (panelRoutes) panelRoutes.hidden = (m !== 'routes');
      if (panelDeps) panelDeps.hidden = (m !== 'departures');
    };
    setMode(getMode());

    // Minimal runtime gate helper (manual console proof).
    try{
      window.iuJRModeProof = function(){
        const section = String(document.body?.dataset?.section || '').trim().toLowerCase();
        const mode = String(localStorage.getItem(JR_MODE_KEY) || '').trim().toLowerCase();
        const r = document.getElementById('iuJrPanelRoutes');
        const d = document.getElementById('iuJrPanelDepartures');
        return {
          section,
          mode,
          departures_supports_prefill: JR_DEPARTURES_SUPPORTS_PREFILL,
          routes_visible: !!(r && !r.hidden),
          departures_visible: !!(d && !d.hidden)
        };
      };
    }catch{}

    const syncButtons = () => {
      const hasFrom = !!String(elFrom?.value || '').trim();
      const hasTo = !!String(elTo?.value || '').trim();
      if (elSubmit) elSubmit.disabled = !(hasFrom && hasTo);
      if (elSave) elSave.disabled = !(hasFrom && hasTo);
      if (elErrFrom) elErrFrom.hidden = true;
      if (elErrTo) elErrTo.hidden = true;

      const hasStop = !!String(elStop?.value || '').trim();
      if (elDepSubmit) elDepSubmit.disabled = !hasStop;
      if (elErrStop) elErrStop.hidden = true;
    };
    if (elFrom) elFrom.addEventListener('input', syncButtons);
    if (elTo) elTo.addEventListener('input', syncButtons);
    if (elStop) elStop.addEventListener('input', syncButtons);
    syncButtons();

    iuJRBindSuggest(elFrom, document.getElementById('iuJrFromWrap'), document.getElementById('iuJrFromList'));
    iuJRBindSuggest(elTo, document.getElementById('iuJrToWrap'), document.getElementById('iuJrToList'));
    iuJRBindSuggest(elStop, document.getElementById('iuJrStopWrap'), document.getElementById('iuJrStopList'));

    iuJRRenderFavs(favWrap, (from, to) => {
      if (elFrom) elFrom.value = from;
      if (elTo) elTo.value = to;
      syncButtons();
      try{ elFrom && elFrom.focus(); }catch{}
    });

    if (elModeRoutes) elModeRoutes.addEventListener('click', () => { setMode('routes'); });
    if (elModeDeps) elModeDeps.addEventListener('click', () => { setMode('departures'); });

    // ARIA tabs keyboard: Left/Right switches, Enter/Space activates focused tab.
    const tabKey = (e) => {
      const isRoutes = e.currentTarget === elModeRoutes;
      const isDeps = e.currentTarget === elModeDeps;
      if (!isRoutes && !isDeps) return;
      const curMode = getMode();
      const focusedMode = isDeps ? 'departures' : 'routes';
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight'){
        e.preventDefault();
        const next = (e.key === 'ArrowLeft') ? 'routes' : 'departures';
        setMode(next);
        try{ (next === 'routes' ? elModeRoutes : elModeDeps)?.focus(); }catch{}
      } else if (e.key === 'Enter' || e.key === ' '){
        if (curMode !== focusedMode){
          e.preventDefault();
          setMode(focusedMode);
        }
      }
    };
    if (elModeRoutes) elModeRoutes.addEventListener('keydown', tabKey);
    if (elModeDeps) elModeDeps.addEventListener('keydown', tabKey);

    const setNowMode = (on) => {
      const enabled = !!on;
      if (elNow) elNow.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      if (elDepTime) elDepTime.disabled = enabled;
      if (elDepTimeWrap) elDepTimeWrap.classList.toggle('is-now', enabled);
      if (elDepTimeEnable) elDepTimeEnable.hidden = !enabled;
      if (enabled && elDepTime){
        try{
          const now = new Date();
          const step = 5 * 60 * 1000;
          const rounded = new Date(Math.ceil(now.getTime() / step) * step);
          const hh = String(rounded.getHours()).padStart(2,'0');
          const mm = String(rounded.getMinutes()).padStart(2,'0');
          elDepTime.value = `${hh}:${mm}`;
        }catch{}
      }
    };
    // default = "Odjezd nyní" on
    setNowMode(true);

    if (elNow){
      elNow.addEventListener('click', () => {
        setNowMode(true);
      });
    }
    if (elDepTimeEnable){
      elDepTimeEnable.addEventListener('click', () => {
        setNowMode(false);
        try{ elDepTime && elDepTime.focus(); }catch{}
      });
    }
    if (elDepTime){
      elDepTime.addEventListener('focus', () => { setNowMode(false); });
      elDepTime.addEventListener('input', () => { setNowMode(false); });
      elDepTime.addEventListener('change', () => { setNowMode(false); });
    }

    if (elDepSubmit){
      elDepSubmit.addEventListener('click', () => {
        const stop = String(elStop?.value || '').trim();
        if (!stop){ if (elErrStop) elErrStop.hidden = false; try{ elStop && elStop.focus(); }catch{}; return; }
        const date = iuJRFormatDateDMY(elDate?.value);
        const time = iuJRFormatTimeHM(elDepTime?.value);
        iuJROpenIdosDepartures({ stop, date, time });
      });
    }

    if (elSave){
      elSave.addEventListener('click', () => {
        const from = String(elFrom?.value || '').trim();
        const to = String(elTo?.value || '').trim();
        if (!from || !to) return;
        const favs = iuJRGetFavs();
        const next = [{ from, to }, ...favs.filter(x => iuJRNormalize(x?.from) !== iuJRNormalize(from) || iuJRNormalize(x?.to) !== iuJRNormalize(to))].slice(0, 12);
        iuJRSetFavs(next);
        iuJRRenderFavs(favWrap, (f,t) => {
          if (elFrom) elFrom.value = f;
          if (elTo) elTo.value = t;
          syncButtons();
        });
      });
    }

    if (elForm){
      elForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const from = String(elFrom?.value || '').trim();
        const to = String(elTo?.value || '').trim();
        if (!from){ if (elErrFrom) elErrFrom.hidden = false; try{ elFrom && elFrom.focus(); }catch{}; return; }
        if (!to){ if (elErrTo) elErrTo.hidden = false; try{ elTo && elTo.focus(); }catch{}; return; }
        const date = iuJRFormatDateDMY(elDate?.value);
        const time = iuJRFormatTimeHM(elTime?.value);
        const byarr = (() => {
          try{
            const r = elForm.querySelector('input[name="byarr"]:checked');
            return String(r?.value || '0') === '1';
          }catch{ return false; }
        })();
        const direct = !!(elDirect && elDirect.checked);
        iuJROpenIdos({ from, to, date, time, byarr, direct });
      });
    }
  }

  function getInitialSection(){
    try{
      const params = new URLSearchParams(window.location.search);
      return normalizeSection(params.get('section') || 'media');
    }catch{
      return 'media';
    }
  }

  function persistSection(section){
    try{
      const url = new URL(window.location.href);
      url.searchParams.set('section', section);
      history.replaceState(null, '', url);
    }catch{}
  }

  function applySectionFromURL(){
    const section = getInitialSection(); // already normalized + fallback->media
    // safe: UI-only section marker for stable CSS scoping (no feed pipeline touch)
    try{ document.body && (document.body.dataset.section = section); }catch{}
    // home layout marker
    try{ document.body && document.body.classList.toggle('iu-home', section === 'home'); }catch{}
    // ensure home view exists and hexes reflect current menu
    if (section === 'home') {
      ensureHomeView();
      buildHomeHexGrid();
      renderHomeWeather();
      iuHomeApplyRailSectionOrder();
      requestAnimationFrame(iuHomeApplyRailSectionOrder);
      setTimeout(iuHomeApplyRailSectionOrder, 200);
      // stop any periodic data refresh while on Home
      try{ window.__iuStopAutoRefresh && window.__iuStopAutoRefresh(); }catch{}
    }
    // feed paging must reset on section change
    try{ state.page = 1; }catch{}
    setLeftNavActive(section);
    showView(VIEW_MAP[section] ?? 'media');

    if (section === 'jizdnirady') {
      iuJRInitView();
      iuJRLoadStopsOnce();
    }

    // leaving Home: ALWAYS load feed data immediately (idempotent) + ensure auto-refresh is running
    if (section !== 'home') {
      try{ window.__iuLoadData && window.__iuLoadData(); }catch{}
      try{ window.__iuStartAutoRefresh && window.__iuStartAutoRefresh(); }catch{}
    }
  }

  function initRadioWish(viewEl){
    const accEl = document.getElementById("iuRadioWish");
    const elType = document.getElementById("iuWishType");
    const elRadio = document.getElementById("iuWishRadio");
    const elRadioHint = document.getElementById("iuWishRadioHint");
    const elTo = document.getElementById("iuWishTo");
    const elToErr = document.getElementById("iuWishToErr");
    const elFrom = document.getElementById("iuWishFrom");
    const elFromErr = document.getElementById("iuWishFromErr");
    const elSong = document.getElementById("iuWishSong");
    const elText = document.getElementById("iuWishText");
    const elEmailTo = document.getElementById("iuWishEmailTo");
    const elPhoneTo = document.getElementById("iuWishPhoneTo");
    const elErrors = document.getElementById("iuWishErrors");
    const elStatus = document.getElementById("iuWishStatus");
    const btnSendRadio = document.getElementById("iuWishSendRadio");

    if (!viewEl || !elType || !elRadio || !elTo || !elFrom || !elSong || !btnSendRadio) {
      return { setData: () => {} };
    }

    // Accordion open/close persistence (default: closed)
    if (accEl && String(accEl.tagName || "").toUpperCase() === "DETAILS") {
      try{
        const v = sessionStorage.getItem(STORAGE_KEY_WISH_OPEN);
        accEl.open = v === "1";
      }catch{}
      accEl.addEventListener("toggle", () => {
        try{
          sessionStorage.setItem(STORAGE_KEY_WISH_OPEN, accEl.open ? "1" : "0");
        }catch{}
      });
    }

    let radios = Array.isArray(wishData.radios) ? wishData.radios : [];
    let artists = Array.isArray(wishData.artists) ? wishData.artists : [];

    let artistsSet = new Set(artists);
    let radiosById = new Map(radios.map((r) => [String(r.id), r]));
    let restoredOnce = false;

    function setData(next){
      radios = Array.isArray(next?.radios) ? next.radios : radios;
      artists = Array.isArray(next?.artists) ? next.artists : artists;
      artistsSet = new Set(artists);
      radiosById = new Map(radios.map((r) => [String(r.id), r]));
      populateRadioSelect();
      populateArtistSelect();
      showHintForRadio();
      // Safe restore after data is available (prevents typed-but-not-selected restore).
      if (!restoredOnce) restoreFromSession();
      // if current selections are no longer valid, clear them (quietly)
      hardValidateSelected(false);
    }

    function populateRadioSelect(){
      const prev = String(elRadio.value || "");
      elRadio.innerHTML = `<option value="">— vyberte —</option>` + radios
        .map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.label)}</option>`)
        .join("");
      if (prev && radiosById.has(prev)) elRadio.value = prev;
    }

    function populateArtistSelect(){
      const prev = String(elSong.value || "");
      const sorted = (Array.isArray(artists) ? artists : [])
        .slice()
        .sort((a, b) => String(a).localeCompare(String(b), "cs", { sensitivity: "base" }));
      elSong.innerHTML = `<option value="">— vyberte —</option>` + sorted
        .map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`)
        .join("");
      if (prev && artistsSet.has(prev)) elSong.value = prev;
    }

    function showHintForRadio(){
      if (!elRadioHint) return;
      const id = String(elRadio.value || "");
      const r = radiosById.get(id);
      const hint = r ? (r.hintText || r.smsHint || r.url || (r.method === "email" ? r.emailTo : "")) : "";
      if (hint) {
        elRadioHint.hidden = false;
        elRadioHint.textContent = hint;
      } else {
        elRadioHint.hidden = true;
        elRadioHint.textContent = "";
      }
    }

    function getDraft(){
      return {
        type: String(elType.value || ""),
        radioId: String(elRadio.value || ""),
        to: String(elTo.value || "").trim(),
        from: String(elFrom.value || "").trim(),
        artist: String(elSong.value || ""),
        wishText: String(elText?.value || "").trim(),
        emailTo: String(elEmailTo?.value || "").trim(),
        phoneTo: String(elPhoneTo?.value || "").trim()
      };
    }

    function sanitizeDraft(d){
      const allowedTypes = new Set(["narozeniny","svatek","vyroci","uspech","jen_tak","jiny"]);
      const legacyTo = String(d?.to || d?.toSelected || "");
      const legacyFrom = String(d?.from || d?.fromSelected || "");
      const legacyArtist = String(d?.artist || d?.songArtist || d?.songSelected || "");
      const wishText = String(d?.wishText || d?.text || d?.message || "").trim();
      const phoneTo = String(d?.phoneTo || d?.tel || d?.phone || "").trim();
      const safe = {
        type: allowedTypes.has(d?.type) ? d.type : "",
        radioId: radiosById.has(String(d?.radioId || "")) ? String(d.radioId) : "",
        to: legacyTo.trim().slice(0, 80),
        from: legacyFrom.trim().slice(0, 80),
        artist: artistsSet.has(legacyArtist) ? legacyArtist : "",
        wishText: wishText.slice(0, 500),
        emailTo: isValidEmail(d?.emailTo) ? String(d.emailTo).trim() : "",
        phoneTo: phoneTo.slice(0, 40)
      };
      return safe;
    }

    function restoreFromSession(){
      try{
        const raw = sessionStorage.getItem(STORAGE_KEY_WISH);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const d = sanitizeDraft(parsed);

        if (d.type) elType.value = d.type;
        if (d.radioId) elRadio.value = d.radioId;

        elTo.value = d.to || "";
        elFrom.value = d.from || "";
        elSong.value = d.artist || "";
        if (elText && d.wishText) elText.value = d.wishText;
        if (elEmailTo && d.emailTo) elEmailTo.value = d.emailTo;
        if (elPhoneTo && d.phoneTo) elPhoneTo.value = d.phoneTo;

        showHintForRadio();
        restoredOnce = true;
      }catch{}
    }

    let saveTimer = 0;
    function scheduleSave(){
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        try{
          const d = sanitizeDraft(getDraft());
          sessionStorage.setItem(STORAGE_KEY_WISH, JSON.stringify(d));
        }catch{}
      }, 200);
    }

    function setErr(el, on){
      if (!el) return;
      el.hidden = !on;
    }
    function setBlockErr(msg){
      if (!elErrors) return;
      if (!msg) {
        elErrors.hidden = true;
        elErrors.textContent = "";
        return;
      }
      elErrors.hidden = false;
      elErrors.textContent = msg;
    }
    function setStatus(msg){
      if (!elStatus) return;
      elStatus.textContent = msg || "";
    }

    function hardValidateSelected(showErrors){
      const toOk = !!String(elTo.value || "").trim();
      const fromOk = !!String(elFrom.value || "").trim();
      // optional: if selected, must exist in whitelist
      const songOk = !String(elSong.value || "") || artistsSet.has(String(elSong.value));
      if (showErrors){
        setErr(elToErr, !toOk);
        setErr(elFromErr, !fromOk);
      } else {
        setErr(elToErr, false);
        setErr(elFromErr, false);
      }
      return { toOk, fromOk, songOk };
    }

    function buildTexts(d){
      const radio = radiosById.get(d.radioId);
      const radioLabel = radio ? radio.label : "rádio";
      const typeLabelMap = {
        narozeniny: "narozeninám",
        svatek: "svátku",
        vyroci: "výročí",
        uspech: "úspěchu",
        jen_tak: "jen tak pro radost",
        jiny: "jiné příležitosti"
      };
      const typ = typeLabelMap[d.type] ?? String(d.type || "");
      const proKoho = d.to;
      const odKoho = d.from;
      const pisnickaClause = d.artist ? ` a případně písničku od ${d.artist}` : "";
      const pisnickaClause2 = d.artist ? ` a případně písničku od ${d.artist}` : "";
      const contactBits = [
        d.emailTo ? `email: ${d.emailTo}` : "",
        d.phoneTo ? `telefon: ${d.phoneTo}` : ""
      ].filter(Boolean);
      const contactClause = contactBits.length ? `, kontakt: ${contactBits.join(", ")}` : "";
      const wishTextClause = d.wishText ? `\n\nText přání:\n${d.wishText}` : "";

      const subjectRadio = `Písnička / přání – ${proKoho} – žádost z infoUzel.cz`;
      const typClause = typ ? (d.type === "jen_tak" ? typ : `k ${typ}`) : "";
      const bodyRadio =
`Dobrý den,
píšu přes infoUzel.cz jménem posluchače ${odKoho}. Rád/a by popřál/a ${proKoho}${typClause ? " " + typClause : ""}.
Pokud je to možné, prosím o pozdrav ve vysílání${pisnickaClause}.
Děkuji a přeji hezký den.
— infoUzel.cz (odeslal/a: ${odKoho}${contactClause})${wishTextClause}`;

      const subjectRec = `Máš rádiové přání od ${odKoho} 🙂`;
      const typClause2 = typ ? (d.type === "jen_tak" ? typ : `k ${typ}`) : "";
      const bodyRec =
`Ahoj ${proKoho},
${odKoho} právě požádal/a rádio ${radioLabel} o přání${typClause2 ? " " + typClause2 : ""}${pisnickaClause2}.
Rádia jsou vytížená, takže to nemusí vyjít vždy, ale snaha je opravdová 🙂
— infoUzel.cz`;

      return { subjectRadio, bodyRadio, subjectRec, bodyRec, radio };
    }

    function openMailto(to, subject, body){
      const href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = href;
    }

    function validateRequired(){
      const d = getDraft();
      const errs = [];
      if (!d.radioId) errs.push("Vyberte rádio.");
      const { toOk, fromOk, songOk } = hardValidateSelected(true);
      if (!toOk) errs.push("Vyplňte pole Pro koho.");
      if (!fromOk) errs.push("Vyplňte pole Od koho.");
      if (!songOk) errs.push("Vybraný interpret není platný.");
      if (d.emailTo && !isValidEmail(d.emailTo)) errs.push("Email komu přeji není platný.");
      return { ok: errs.length === 0, errs, d: sanitizeDraft(d) };
    }

    function buildAndSend(){
      const v = validateRequired();
      if (!v.ok) {
        setBlockErr(v.errs.join(" "));
        setStatus("");
        return;
      }
      setBlockErr("");
      const built = buildTexts(v.d);
      scheduleSave();
      const r = built.radio;
      if (!r) return;

      if (r.method === "email" && r.emailTo) {
        setStatus("Otevírám e-mail klient (mailto)…");
        openMailto(r.emailTo, built.subjectRadio, built.bodyRadio);
        return;
      }

      // form / form_or_sms
      if (r.url) {
        try { window.open(r.url, "_blank", "noopener,noreferrer"); } catch {}
      }
      setStatus("Otevírám stránku rádia…");
    }

    btnSendRadio.addEventListener("click", buildAndSend);
    elRadio.addEventListener("change", () => { showHintForRadio(); scheduleSave(); });
    elType.addEventListener("change", scheduleSave);
    elSong.addEventListener("change", scheduleSave);
    elTo.addEventListener("input", scheduleSave);
    elFrom.addEventListener("input", scheduleSave);
    elText?.addEventListener("input", scheduleSave);
    elEmailTo?.addEventListener("input", scheduleSave);
    elPhoneTo?.addEventListener("input", scheduleSave);

    setStatus("");

    // initial
    populateRadioSelect();
    populateArtistSelect();
    showHintForRadio();
    // Restore is intentionally delayed until after wish data is loaded via setData()
    // to guarantee whitelist-based safe restore (avoid races).
    hardValidateSelected(false);

    return { setData };
  }

  function initNavRouter(){
    const feedEl = document.getElementById('feed');
    const viewEl = document.getElementById('iuRadioView');
    if (!feedEl || !viewEl) return;

    ensureHomeView();
    renderRadioView(viewEl);
    buildHomeHexGrid();
    const wishCtl = initRadioWish(viewEl);
    // async load (no backend); fallback keeps UI usable even if fetch fails
    loadWishDataIntoState().then((d) => { try{ wishCtl.setData(d); }catch{} });

    // Start: derive from URL (?section=radio|media). Unknown -> media.
    // Ensure default is written into the URL (replaceState, no pushState).
    persistSection(getInitialSection());
    applySectionFromURL();

    // Delegated: any click in left rail routes to exactly one view + exactly one active item.
    document.addEventListener('click', (e) => {
      const item = e.target && e.target.closest ? e.target.closest('.iu-leftNavItem') : null;
      if (!item) return;
      const accent = (item.getAttribute('data-accent') || item.dataset?.accent || "").trim().toLowerCase();
      const section = normalizeSection(accent);
      persistSection(section);
      applySectionFromURL();
    });

    // Back/Forward navigation must update view according to ?section=... without reload.
    window.addEventListener('popstate', applySectionFromURL);
    // Fallback: left nav uses href="#" which may create hash-only history entries in some browsers.
    window.addEventListener('hashchange', applySectionFromURL);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initNavRouter);
  } else {
    initNavRouter();
  }
})();
