#!/usr/bin/env node
/**
 * Two-phase external return: main scroll must survive first restore AND subsequent document load.
 * Coordinated restore (v13): stable 15s after boot, user scroll cancels re-apply.
 * MindMenu back: one click dismisses tools; external-return simulation after boot.
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8968", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?nosw=1&iuInfoSystem=cutover`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const net = read("assets/iu-network-connectivity-v1.js");
  const app = read("assets/app.js");
  const feed = read("assets/iu-app-feed-pipeline-v1.js");
  const rec = read("assets/iu-pwa-return-recorder-v1.js");
  must(/pwa-external-return-unified-v15-20261016-three-surface-return/.test(net), "static:v15_build");
  must(/startExternalMainScrollRestoreCoordinated/.test(net), "static:coordinated_restore");
  must(/main_scroll_restore_done/.test(net), "static:restore_done_trace");
  must(/iuPwaExternalReturnMainScrollPersistV1/.test(net), "static:main_scroll_persist_ls");
  must(/cancelExternalReturnRestoreForSectionApply/.test(net), "static:section_apply_preserve");
  must(/bootRestoreExternalMainScrollAfterDocumentLoad/.test(net), "static:boot_main_scroll");
  must(/iuPwaCoordinatedMainScrollRestore/.test(app), "static:app_coordinated_restore");
  must(/iuPwaExternalReturnMainScrollPersistV1/.test(app), "static:app_blocks_persist");
  must(/iuMindMenuReadPendingScrollY/.test(feed), "static:mm_pending_scroll_helper");
  must(/iuMindMenuClearAllReturnMarkers/.test(feed), "static:mm_back_clear_markers");
  must(/section:content_timeout/.test(rec), "static:recorder_content_timeout");
  must(!/if \(ready \|\| attempts >= 120\)/.test(rec), "static:no_fake_content_ready_on_cap");
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (urlPath.endsWith("/")) urlPath += "index.html";
        const filePath = path.join(REPO, urlPath.replace(/^\/+/, ""));
        if (!filePath.startsWith(REPO) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404);
          res.end("nf");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime =
          ext === ".html"
            ? "text/html; charset=utf-8"
            : ext === ".js"
              ? "text/javascript; charset=utf-8"
              : "application/octet-stream";
        res.writeHead(200, { "content-type": mime });
        res.end(fs.readFileSync(filePath));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function runTwoPhaseScroll(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.iuNetwork && window.iuPwaCoordinatedMainScrollRestore, null, {
    timeout: 90000,
  });
  const TARGET = 1991;
  const phase1 = await page.evaluate(async (targetY) => {
    const lc = document.getElementById("leftContent");
    if (lc) lc.scrollTop = targetY;
    window.iuPwaApplyMainScrollY(targetY);
    sessionStorage.setItem("iuPwaExternalReturnMainScrollY", String(targetY));
    localStorage.setItem(
      "iuPwaExternalReturnMainScrollPersistV1",
      JSON.stringify({ y: targetY, t: Date.now(), gen: 1, route: "home" })
    );
    if (window.iuNetwork && typeof window.iuNetwork.restoreAppShellAfterReturn === "function") {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      window.iuNetwork.restoreAppShellAfterReturn();
    }
    await new Promise((r) => setTimeout(r, 400));
    sessionStorage.removeItem("iuPwaExternalReturnMainScrollY");
    const y1 = window.iuPwaGetMainScrollY ? window.iuPwaGetMainScrollY() : 0;
    return { y1, persist: !!localStorage.getItem("iuPwaExternalReturnMainScrollPersistV1") };
  }, TARGET);
  must(phase1.y1 >= TARGET - 40, "rt:phase1_scroll:" + phase1.y1);
  must(phase1.persist === true, "rt:phase1_persist_kept");

  await page.goto(BASE + "&twophase=1", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.iuNetwork && window.iuPwaGetMainScrollY, null, { timeout: 90000 });
  await page.waitForTimeout(15000);
  const phase2 = await page.evaluate(() => {
    const y = window.iuPwaGetMainScrollY ? window.iuPwaGetMainScrollY() : 0;
    return { y, persist: !!localStorage.getItem("iuPwaExternalReturnMainScrollPersistV1") };
  });
  must(phase2.y >= TARGET - 80, "rt:phase2_after_boot_15s:" + phase2.y);

  const userCancel = await page.evaluate(async (targetY) => {
    localStorage.setItem(
      "iuPwaExternalReturnMainScrollPersistV1",
      JSON.stringify({ y: targetY, t: Date.now(), gen: 2, route: "home" })
    );
    sessionStorage.setItem("iuPwaExternalReturnMainScrollY", String(targetY));
    if (window.iuNetwork && window.iuNetwork.restoreAppShellAfterReturn) {
      window.iuNetwork.restoreAppShellAfterReturn();
    }
    await new Promise((r) => setTimeout(r, 300));
    const before = window.iuPwaGetMainScrollY ? window.iuPwaGetMainScrollY() : 0;
    window.dispatchEvent(new Event("touchstart", { bubbles: true }));
    const userY = 120;
    window.iuPwaApplyMainScrollY(userY);
    await new Promise((r) => setTimeout(r, 400));
    if (window.iuNetwork && window.iuNetwork.restoreAppShellAfterReturn) {
      window.iuNetwork.restoreAppShellAfterReturn();
    }
    await new Promise((r) => setTimeout(r, 400));
    const after = window.iuPwaGetMainScrollY ? window.iuPwaGetMainScrollY() : 0;
    return { before, after, userY };
  }, TARGET);
  must(Math.abs(userCancel.after - userCancel.userY) < 48, "rt:user_scroll_not_overwritten:" + JSON.stringify(userCancel));
}

async function runMindMenuBackOnce(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => window.__iuMobileGateTabInitDone === 1 && typeof window.iuMindMenuClearAllReturnMarkers === "function",
    null,
    { timeout: 120000 }
  );
  const back = await page.evaluate(async () => {
    const wrap = document.getElementById("iuMobileGateWrap");
    if (!wrap || typeof wrap.__iuMobileGateSetTab !== "function") return { ok: false, reason: "no_settab" };
    wrap.__iuMobileGateSetTab("tools");
    sessionStorage.setItem("iuMindMenuReturnLatchTs", String(Date.now()));
    localStorage.setItem("iuMindMenuReturnPendingV1", JSON.stringify({ t: Date.now(), y: 809, ai: 0, aiY: 0 }));
    history.pushState({ iu_mindmenu_overlay: true }, "", location.pathname + location.search + "#iu-mindmenu");
    const backBtn = document.getElementById("iuMobileGateBack");
    if (!backBtn) return { ok: false, reason: "no_back" };
    backBtn.click();
    await new Promise((r) => setTimeout(r, 900));
    const gate = wrap.getAttribute("data-iu-mobile-gate") || "";
    const overlay = document.body.classList.contains("iu-mobileGateOverlayOpen");
    return { ok: gate === "" && !overlay, gate, overlay };
  });
  must(back.ok === true, "rt:mm_back_once:" + JSON.stringify(back));
}

async function runMindMenuExternalReturnBack(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => window.__iuMobileGateTabInitDone === 1 && window.iuNetwork && window.iuMindMenuArmReturnState,
    null,
    { timeout: 120000 }
  );
  const result = await page.evaluate(async () => {
    const wrap = document.getElementById("iuMobileGateWrap");
    if (!wrap || typeof wrap.__iuMobileGateSetTab !== "function") return { ok: false, reason: "no_settab" };
    wrap.__iuMobileGateSetTab("tools");
    const tools = document.getElementById("iuMobileGatePanelTools");
    if (tools) tools.scrollTop = 809;
    if (typeof window.iuMindMenuArmReturnState === "function") window.iuMindMenuArmReturnState();
    sessionStorage.setItem("iu_external_nav_armed", "1");
    sessionStorage.setItem("iuPwaExternalReturnGateTab", "tools");
    localStorage.setItem("iuMindMenuReturnPendingV1", JSON.stringify({ t: Date.now(), y: 809, ai: 0, aiY: 0 }));
    history.pushState({ iu_mindmenu_overlay: true }, "", location.pathname + location.search + "#iu-mindmenu");
    if (window.iuNetwork && window.iuNetwork.restoreAppShellAfterReturn) {
      window.iuNetwork.restoreAppShellAfterReturn();
    }
    await new Promise((r) => setTimeout(r, 600));
    const backBtn = document.getElementById("iuMobileGateBack");
    if (!backBtn) return { ok: false, reason: "no_back" };
    backBtn.click();
    await new Promise((r) => setTimeout(r, 900));
    const gate = wrap.getAttribute("data-iu-mobile-gate") || "";
    const overlay = document.body.classList.contains("iu-mobileGateOverlayOpen");
    const hash = String(location.hash || "");
    return { ok: gate === "" && !overlay && hash.indexOf("iu-mindmenu") < 0, gate, overlay, hash };
  });
  must(result.ok === true, "rt:mm_external_return_back:" + JSON.stringify(result));
}

async function main() {
  staticGate();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await runTwoPhaseScroll(page);
    await runMindMenuBackOnce(page);
    await runMindMenuExternalReturnBack(page);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  if (fails.length) {
    console.log("IU_PWA_EXTERNAL_RETURN_TWO_PHASE_SCROLL_GUARD_PASS=false");
    console.log("FAILS=" + fails.join("|"));
    process.exit(1);
  }
  console.log("IU_PWA_EXTERNAL_RETURN_TWO_PHASE_SCROLL_GUARD_PASS=true");
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
