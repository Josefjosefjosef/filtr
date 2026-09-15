#!/usr/bin/env node
/**
 * PWA: MindMenu must survive return from an external page (Done / close Safari view).
 *
 * Root cause class (2026-09-15):
 *   iuMindMenuRestoreIfArmed() reopened tools then cleared iuMindMenuReturnArmed;
 *   iuMindMenuSyncGateFromHistory() then saw tools without #iu-mindmenu and closed → Home.
 *
 * Contract:
 *   - Restore re-asserts #iu-mindmenu history before clearing armed
 *   - Sync may close tools only on popstate (allowClose), never on pageshow/external return
 *   - Simulated PWA return: MindMenu stays open (not Domů)
 *
 * Run: npm run iu-pwa-mindmenu-external-return-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { bootstrapGuardContext, bootstrapGuardPage } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8941", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?section=media&iuInfoSystem=cutover&nosw=1`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const feed = read("assets/iu-app-feed-pipeline-v1.js");
  const net = read("assets/iu-network-connectivity-v1.js");
  const app = read("assets/app.js");

  must(/function iuMindMenuEnsureHistoryEntry\s*\(/.test(feed), "static:ensure_history_fn");
  must(/history\.replaceState/.test(feed) && /iu_mindmenu_overlay/.test(feed), "static:replaceState_overlay");
  must(
    /__iuMobileGateSetTab\("tools"\)[\s\S]{0,800}iuMindMenuEnsureHistoryEntry\(\)[\s\S]{0,500}removeItem\(IU_MINDMENU_RETURN_ARMED_KEY\)/.test(
      feed
    ),
    "static:ensure_before_clear_armed"
  );
  must(/function iuMindMenuSyncGateFromHistory\s*\(\s*opts\s*\)/.test(feed), "static:sync_opts");
  must(/allowClose\s*===\s*true/.test(feed), "static:allow_close_gate");
  must(
    /addEventListener\("popstate"[\s\S]{0,120}iuMindMenuSyncGateFromHistory\(\s*\{\s*allowClose:\s*true\s*\}\s*\)/.test(
      feed
    ),
    "static:popstate_allow_close"
  );
  must(
    /addEventListener\("pageshow"[\s\S]{0,200}iuMindMenuSyncGateFromHistory\(\)/.test(feed) &&
      !/addEventListener\("pageshow"[\s\S]{0,200}iuMindMenuSyncGateFromHistory\(\s*\{\s*allowClose:\s*true/.test(feed),
    "static:pageshow_no_allow_close"
  );
  must(/iuMindMenuRestoreIfArmed\(\)/.test(net) && /iuMindMenuSyncGateFromHistory\(\)/.test(net), "static:net_invoke_order");
  must(/pwa-mindmenu-external-return-v1-20260915/.test(app), "static:app_cache_bust");
  must(!/__iuMobileGateSetTab\("tools"\)[\s\S]{0,80}removeItem\(IU_MINDMENU_RETURN_ARMED_KEY\)[\s\S]{0,40}iuMindMenuEnsureHistoryEntry/.test(feed), "static:not_clear_before_ensure");
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function openMindMenu(page) {
  await page.waitForFunction(
    () =>
      !!(
        document.getElementById("iuMobileGateWrap") &&
        typeof document.getElementById("iuMobileGateWrap").__iuMobileGateSetTab === "function"
      ),
    { timeout: 60000 }
  );
  await page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    wrap.__iuMobileGateSetTab("tools");
    try {
      const u = new URL(window.location.href);
      u.hash = "iu-mindmenu";
      history.replaceState({ iu_mindmenu_overlay: true, iu_mindmenu_origin: "homepage" }, "", u.toString());
    } catch (_) {}
  });
  await page.waitForFunction(
    () => document.getElementById("iuMobileGateWrap")?.getAttribute("data-iu-mobile-gate") === "tools",
    { timeout: 10000 }
  );
}

async function snap(page) {
  return page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    const hash = String(location.hash || "").replace("#", "");
    let st = false;
    try {
      st = !!(history.state && history.state.iu_mindmenu_overlay === true);
    } catch (_) {}
    let armed = "";
    try {
      armed = sessionStorage.getItem("iuMindMenuReturnArmed") || "";
    } catch (_) {}
    return {
      gate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
      hash,
      overlayState: st,
      armed,
      bodyGate: document.body.classList.contains("iu-mobileGateOverlayOpen"),
    };
  });
}

/** Simulate PWA return: history marker lost, armed flag set, resume handlers fire. */
async function simulatePwaExternalReturn(page) {
  return page.evaluate(() => {
    const transitions = [];
    const wrap = document.getElementById("iuMobileGateWrap");
    const orig = wrap && wrap.__iuMobileGateSetTab;
    if (wrap && typeof orig === "function") {
      wrap.__iuMobileGateSetTab = function (tab) {
        transitions.push(String(tab || ""));
        return orig.apply(this, arguments);
      };
    }
    try {
      sessionStorage.setItem("iuMindMenuReturnArmed", "1");
      sessionStorage.setItem("iu_external_nav_armed", "1");
      sessionStorage.setItem("iuMindMenuReturnScrollY", String(window.scrollY || 120));
    } catch (_) {}
    // PWA often drops hash/state on return from system browser.
    try {
      const u = new URL(window.location.href);
      u.hash = "";
      history.replaceState({}, "", u.toString());
    } catch (_) {}

    if (window.iuNetwork && typeof window.iuNetwork.restoreAppShellAfterReturn === "function") {
      window.iuNetwork.restoreAppShellAfterReturn();
    }
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new FocusEvent("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    if (typeof window.iuMindMenuRestoreIfArmed === "function") window.iuMindMenuRestoreIfArmed();
    if (typeof window.iuMindMenuSyncGateFromHistory === "function") window.iuMindMenuSyncGateFromHistory();

    if (wrap && typeof orig === "function") wrap.__iuMobileGateSetTab = orig;
    return {
      transitions,
      visitedHome: transitions.includes(""),
      finalGate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
    };
  });
}

async function runPlaywright() {
  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
    cwd: REPO,
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT) },
  });
  try {
    await waitForPort("127.0.0.1", PORT, 30000);
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await bootstrapGuardContext(browser, {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      // Emulate standalone PWA display mode.
      await context.addInitScript(() => {
        try {
          Object.defineProperty(navigator, "standalone", { configurable: true, get: () => true });
        } catch (_) {}
        try {
          const orig = window.matchMedia.bind(window);
          window.matchMedia = (q) => {
            if (String(q).includes("display-mode: standalone")) {
              return {
                matches: true,
                media: q,
                onchange: null,
                addListener() {},
                removeListener() {},
                addEventListener() {},
                removeEventListener() {},
                dispatchEvent() {
                  return false;
                },
              };
            }
            return orig(q);
          };
        } catch (_) {}
      });
      const page = await bootstrapGuardPage(context);
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 45000 });
      await page.waitForFunction(
        () =>
          typeof window.iuMindMenuRestoreIfArmed === "function" &&
          typeof window.iuMindMenuSyncGateFromHistory === "function" &&
          !!(window.iuNetwork && typeof window.iuNetwork.restoreAppShellAfterReturn === "function"),
        { timeout: 60000 }
      );

      await openMindMenu(page);
      const before = await snap(page);
      must(before.gate === "tools", "before:gate_tools:" + before.gate);
      must(before.hash === "iu-mindmenu", "before:hash:" + before.hash);

      const sim = await simulatePwaExternalReturn(page);
      await page.waitForTimeout(250);
      const after = await snap(page);

      must(after.gate === "tools", "after:gate_tools:" + after.gate);
      must(after.hash === "iu-mindmenu", "after:hash_restored:" + after.hash);
      must(after.overlayState === true, "after:overlay_state");
      must(after.armed !== "1", "after:armed_cleared:" + after.armed);
      must(!sim.visitedHome, "after:no_home_transition:" + JSON.stringify(sim.transitions));
      must(sim.finalGate === "tools", "after:sim_final_tools:" + sim.finalGate);

      // Sync without allowClose must NOT close tools when hash is missing.
      const syncNoClose = await page.evaluate(() => {
        const wrap = document.getElementById("iuMobileGateWrap");
        wrap.__iuMobileGateSetTab("tools");
        try {
          const u = new URL(window.location.href);
          u.hash = "";
          history.replaceState({}, "", u.toString());
        } catch (_) {}
        window.iuMindMenuSyncGateFromHistory();
        return wrap.getAttribute("data-iu-mobile-gate") || "";
      });
      must(syncNoClose === "tools", "sync:no_close_without_allow:" + syncNoClose);

      // popstate allowClose may close when marker gone (Back semantics).
      const syncClose = await page.evaluate(() => {
        const wrap = document.getElementById("iuMobileGateWrap");
        wrap.__iuMobileGateSetTab("tools");
        try {
          const u = new URL(window.location.href);
          u.hash = "";
          history.replaceState({}, "", u.toString());
        } catch (_) {}
        window.iuMindMenuSyncGateFromHistory({ allowClose: true });
        return wrap.getAttribute("data-iu-mobile-gate") || "";
      });
      must(syncClose === "", "sync:allow_close_home:" + syncClose);
    } finally {
      await browser.close();
    }
  } finally {
    try {
      server.kill("SIGTERM");
    } catch (_) {}
  }
}

async function main() {
  staticGate();
  if (fails.length) {
    console.log("FAIL " + fails.join(" | "));
    process.exit(1);
  }
  await runPlaywright();
  if (fails.length) {
    console.log("FAIL " + fails.join(" | "));
    process.exit(1);
  }
  console.log("PASS iu-pwa-mindmenu-external-return-guard");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
