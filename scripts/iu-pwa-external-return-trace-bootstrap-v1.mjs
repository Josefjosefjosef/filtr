#!/usr/bin/env node
/**
 * Local-only PWA external-return trace bootstrap (paste in Web Inspector console on device).
 * No network I/O. Enable with: ?iu_return_diag=1 on /projects/
 *
 * Usage (device):
 *   1) Open PWA with ?iu_return_diag=1
 *   2) Reproduce Menu / Home / MindMenu external open + return
 *   3) Copy window.__iuPwaReturnTraceExport() output
 */
console.log(`
(function iuPwaReturnTraceBootstrap(){
  if (window.__iuPwaReturnTrace) return;
  var ring = [];
  var MAX = 80;
  function push(ev, detail) {
    ring.push({ t: Date.now(), ev: ev, detail: detail || {} });
    if (ring.length > MAX) ring.shift();
  }
  function snap() {
    var wrap = document.getElementById("iuMobileGateWrap");
    var gate = wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "";
    var nav = document.getElementById("iuMobileGatePanelNav");
    var tools = document.getElementById("iuMobileGatePanelTools");
    return {
      gate: gate,
      hash: String(location.hash || ""),
      scrollY: typeof window.iuPwaGetMainScrollY === "function" ? window.iuPwaGetMainScrollY() : window.scrollY,
      navScroll: nav ? nav.scrollTop : null,
      toolsScroll: tools ? tools.scrollTop : null,
      build: window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId,
    };
  }
  ["visibilitychange","pageshow","pagehide","focus","blur","popstate","hashchange"].forEach(function(name){
    var target = name === "visibilitychange" ? document : window;
    target.addEventListener(name, function(ev){
      push(name, { persisted: !!(ev && ev.persisted), vis: document.visibilityState, snap: snap() });
    }, true);
  });
  var orig = window.iuNetwork && window.iuNetwork.restoreAppShellAfterReturn;
  if (orig && !window.__iuPwaReturnTracePatchedRestore) {
    window.__iuPwaReturnTracePatchedRestore = true;
    window.iuNetwork.restoreAppShellAfterReturn = function(){
      push("restoreAppShellAfterReturn:before", { snap: snap(), active: window.iuNetwork.isExternalReturnRestoreActive() });
      var r = orig.apply(this, arguments);
      push("restoreAppShellAfterReturn:after", { snap: snap(), active: window.iuNetwork.isExternalReturnRestoreActive() });
      return r;
    };
  }
  window.__iuPwaReturnTrace = ring;
  window.__iuPwaReturnTraceExport = function(){ return JSON.stringify(ring, null, 2); };
  push("trace:init", { snap: snap() });
})();
`);
