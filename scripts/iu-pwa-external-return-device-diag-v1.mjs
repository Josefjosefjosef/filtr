#!/usr/bin/env node
/**
 * PWA external-return — device / Web Inspector checklist (no remote telemetry).
 *
 * Run locally (prints steps + optional localhost probe):
 *   npm run iu-pwa-external-return-device-diag
 *
 * On installed PWA (Safari Web Inspector → Console), paste the SNIPPET block below.
 */
import path from "path";
import { fileURLToPath } from "url";
import { pickGuardPort, startGuardStaticServer, stopGuardProcess } from "./guards/guard-playwright-lifecycle.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNIPPET = `(function iuPwaReturnDiag(){
  var o = {
    buildId: (window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId) || "",
    href: location.href,
    hash: location.hash,
    section: (function(){ try { return new URL(location.href).searchParams.get("section"); } catch(e){ return null; } })(),
    gate: (function(){ var w=document.getElementById("iuMobileGateWrap"); return w ? w.getAttribute("data-iu-mobile-gate")||"" : ""; })(),
    scrollY: (window.iuPwaGetMainScrollY ? window.iuPwaGetMainScrollY() : (window.scrollY||0)),
    session: {
      ext: sessionStorage.getItem("iu_external_nav_armed")||"",
      restoring: sessionStorage.getItem("iuPwaExternalReturnRestoringV1")||"",
      mainY: sessionStorage.getItem("iuPwaExternalReturnMainScrollY")||"",
      navArm: sessionStorage.getItem("iuMobileWebNavReturnArmed")||"",
    },
    restoreActive: !!(window.iuNetwork && window.iuNetwork.isExternalReturnRestoreActive && window.iuNetwork.isExternalReturnRestoreActive()),
    standalone: !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches),
  };
  try { console.log("IU_PWA_RETURN_DIAG=" + JSON.stringify(o)); } catch(e) {}
  return o;
})();`;

async function main() {
  console.log("=== PWA external return — device verification ===");
  console.log("");
  console.log("Expected build id: pwa-external-return-unified-v4-20261011");
  console.log("Production #11803 only (b6a9ed2): no iuNetwork.pwaExternalReturnBuildId; HTML cache token ends coalesce-v1-20261009");
  console.log("");
  console.log("Equipment: iPhone/iPad with installed PWA + USB + Mac Safari Develop menu, OR Android Chrome remote debugging.");
  console.log("");
  console.log("10x each scenario (A Menu external, B Home external, C MindMenu external):");
  console.log("  1) Scroll/open overlay to a non-top position");
  console.log("  2) Tap external link (affiliate / https, not mailto)");
  console.log("  3) Close the external tab/window (Done)");
  console.log("  4) PASS if gate/scroll/section unchanged — no flash to home, no scroll jump");
  console.log("");
  console.log("Web Inspector → Console — paste:");
  console.log(SNIPPET);
  console.log("");

  const started = await startGuardStaticServer(pickGuardPort(8955, 400));
  try {
    const u = `http://127.0.0.1:${started.port}/projects/?nosw=1`;
    const res = await fetch(u);
    const html = await res.text();
    const netMatch = html.match(/iu-network-connectivity-v1\.js\?v=([^"']+)/);
    const appMatch = html.match(/\/assets\/app\.js\?v=([^"']+)/);
    console.log("Localhost HTML probe (" + u + "):");
    console.log("  network_script_query_token=" + (netMatch ? netMatch[1].slice(-80) : "MISSING"));
    console.log("  app_js_query_token_tail=" + (appMatch ? appMatch[1].slice(-80) : "MISSING"));
    console.log("(Tokens are cache-bust hints only — runtime build id comes from loaded iu-network-connectivity-v1.js.)");
  } catch (err) {
    console.log("Localhost probe skipped: " + String(err && err.message ? err.message : err));
  } finally {
    await stopGuardProcess(started);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
