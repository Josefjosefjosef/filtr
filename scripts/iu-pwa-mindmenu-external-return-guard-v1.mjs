#!/usr/bin/env node
/**
 * PWA: MindMenu must survive return from an external page (Done / close Safari view).
 *
 * Root cause class (2026-09-16, post-#10863 device FAIL):
 *   Standalone PWA return often is NOT a same-session delayed popstate.
 *   iOS/Android may kill the PWA WebView while the external page is open.
 *   Cold resume then loses sessionStorage (armed/latch) and start_url has no #iu-mindmenu
 *   → Home. #10863 latch never runs. Prior guard false-PASSED by seeding sessionStorage
 *   and firing synthetic popstate under nosw=1 without simulating process death.
 *
 * Historical chain:
 *   #4958 (06886502466) arm+restore in app.js
 *   → 624545085bc feed-split deferred return hooks
 *   → #10795 / #10863 SyncGate/popstate/latch patches (wrong lifecycle for device kill)
 *
 * Contract:
 *   - Real arm path writes durable localStorage pending (survives session wipe)
 *   - Process-death resume (session cleared, pending kept) restores MindMenu+scroll
 *   - Late popstate after latch window must not force Home while pending/guard active
 *   - Post-restore shell/nav CloseForMainNav must NOT force Home while pending/guard active
 *     (device FAIL class: MindMenu OK → Home flash → MindMenu again)
 *   - Intentional tools close / Domů still reaches Home
 *   - ≥3 external-return cycles
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
const SCROLL_TARGET = 420;
const PENDING_KEY = "iuMindMenuReturnPendingV1";

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
  const requireDurable = process.env.IU_GUARD_REQUIRE_DURABLE === "1" || /iuMindMenuReturnPendingV1/.test(feed);

  must(
    /iuMindMenuEnsureHistoryEntry\(\)[\s\S]{0,500}removeItem\(IU_MINDMENU_RETURN_ARMED_KEY\)/.test(feed),
    "static:ensure_before_clear_armed"
  );
  must(/function iuMindMenuSyncGateFromHistory\s*\(\s*opts\s*\)/.test(feed), "static:sync_opts");
  must(/allowClose\s*===\s*true/.test(feed), "static:allow_close_gate");
  must(/iuMindMenuCapturePanelScrollY/.test(feed) && /iuMobileGatePanelTools/.test(feed), "static:panel_scroll_capture");
  must(
    /addEventListener\("popstate"[\s\S]{0,800}iuMindMenuSyncGateFromHistory\(\s*\{\s*allowClose:\s*true\s*\}\s*\)/.test(
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
  must(
    !/removeItem\(IU_MINDMENU_RETURN_ARMED_KEY\)[\s\S]{0,80}iuMindMenuEnsureHistoryEntry/.test(feed),
    "static:not_clear_before_ensure"
  );

  if (requireDurable) {
    must(/iuMindMenuReturnPendingV1/.test(feed), "static:durable_pending_key");
    must(/localStorage\.setItem\(\s*IU_MINDMENU_RETURN_PENDING_KEY/.test(feed), "static:write_pending");
    must(/localStorage\.getItem\(\s*IU_MINDMENU_RETURN_PENDING_KEY/.test(feed), "static:read_pending");
    must(/iu_mindmenu_overlay\s*===\s*true/.test(app), "static:router_mindmenu_state");
    must(/iuMindMenuReturnPendingV1/.test(app) || /mindPending/.test(app), "static:router_mindmenu_pending");
    must(/pwa-mindmenu-external-return-v1-20260916b/.test(app), "static:app_cache_bust");
    must(/iuMindMenuHasReturnGuard/.test(feed), "static:has_return_guard_export");
    must(/window\.iuMindMenuHasReturnGuard\s*=\s*iuMindMenuHasReturnGuard/.test(feed), "static:has_return_guard_window");
    must(
      /function iuMobileGateCloseForMainNav\s*\(\s*\)\s*\{[\s\S]{0,700}iuMindMenuHasReturnGuard/.test(feed),
      "static:close_for_main_nav_respects_return_guard"
    );
    const shell = read("assets/iu-mobile-bottom-nav-shell-v1.js");
    must(
      /iuMobileGateCloseForMainNav\s*=\s*function[\s\S]{0,500}iuMindMenuHasReturnGuard/.test(shell),
      "static:shell_close_respects_return_guard"
    );
  }
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

async function scrollMindMenuPanel(page, y) {
  return page.evaluate((targetY) => {
    const panel = document.getElementById("iuMobileGatePanelTools");
    if (!panel) return { ok: false, scrollTop: 0, max: 0 };
    panel.scrollTop = targetY;
    const max = Math.max(0, (panel.scrollHeight || 0) - (panel.clientHeight || 0));
    return { ok: true, scrollTop: panel.scrollTop || 0, max };
  }, y);
}

async function snap(page) {
  return page.evaluate((pendingKey) => {
    const wrap = document.getElementById("iuMobileGateWrap");
    const panel = document.getElementById("iuMobileGatePanelTools");
    const hash = String(location.hash || "").replace("#", "");
    let st = false;
    try {
      st = !!(history.state && history.state.iu_mindmenu_overlay === true);
    } catch (_) {}
    let armed = "";
    let latch = "";
    let pending = "";
    try {
      armed = sessionStorage.getItem("iuMindMenuReturnArmed") || "";
      latch = sessionStorage.getItem("iuMindMenuReturnLatchTs") || "";
      pending = localStorage.getItem(pendingKey) || "";
    } catch (_) {}
    return {
      gate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
      hash,
      overlayState: st,
      armed,
      latch,
      pending: pending ? "1" : "",
      panelScroll: panel ? panel.scrollTop || 0 : -1,
      bodyGate: document.body.classList.contains("iu-mobileGateOverlayOpen"),
    };
  }, PENDING_KEY);
}

/** Real arm path — must not manually seed sessionStorage. */
async function armViaRealApi(page, scrollY) {
  return page.evaluate((y) => {
    const panel = document.getElementById("iuMobileGatePanelTools");
    if (panel) {
      try {
        panel.scrollTop = y;
      } catch (_) {}
    }
    if (typeof window.iuMindMenuArmReturnState !== "function") {
      return { ok: false, reason: "no_arm_fn" };
    }
    window.iuMindMenuArmReturnState();
    let armed = "";
    let pending = "";
    try {
      armed = sessionStorage.getItem("iuMindMenuReturnArmed") || "";
      pending = localStorage.getItem("iuMindMenuReturnPendingV1") || "";
    } catch (_) {}
    return { ok: true, armed, pending: pending ? "1" : "" };
  }, scrollY);
}

/**
 * Simulate standalone PWA process death while external page is open:
 * sessionStorage wiped, document cold (gate Home, no hash), localStorage pending kept.
 * Then foreground resume (visibility + pageshow + restore).
 */
async function simulateProcessDeathResume(page) {
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
    // Wipe session (process death) — keep localStorage.
    try {
      const pending = localStorage.getItem("iuMindMenuReturnPendingV1");
      sessionStorage.clear();
      if (pending) localStorage.setItem("iuMindMenuReturnPendingV1", pending);
    } catch (_) {}
    // Cold start_url: no MindMenu hash/state, gate Home.
    try {
      const u = new URL(window.location.href);
      u.hash = "";
      history.replaceState({}, "", u.toString());
    } catch (_) {}
    if (wrap && typeof orig === "function") wrap.__iuMobileGateSetTab("");

    // Foreground resume lifecycle (not a seeded latch popstate).
    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
    } catch (_) {}
    if (window.iuNetwork && typeof window.iuNetwork.restoreAppShellAfterReturn === "function") {
      window.iuNetwork.restoreAppShellAfterReturn();
    }
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    window.dispatchEvent(new FocusEvent("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    if (typeof window.iuMindMenuRestoreIfArmed === "function") window.iuMindMenuRestoreIfArmed();

    const gateAfterRestore = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "") : "";
    const idxAfterRestore = transitions.length;

    // Late synthetic popstate AFTER resume (OS history quirk), with latch expired.
    try {
      sessionStorage.removeItem("iuMindMenuReturnLatchTs");
      sessionStorage.removeItem("iuMindMenuReturnArmed");
      const u2 = new URL(window.location.href);
      u2.hash = "";
      history.replaceState({}, "", u2.toString());
    } catch (_) {}
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));

    /* Post-#10873 device FAIL class: restore already reopened MindMenu, then a late
       shell/nav CloseForMainNav (section chrome / hub apply) forced Home while durable
       pending was still live — second restore then jumped back to MindMenu. */
    if (typeof window.iuMobileGateCloseForMainNav === "function") {
      window.iuMobileGateCloseForMainNav();
    }
    const gateAfterClose = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "") : "";
    const postRestoreTransitions = transitions.slice(idxAfterRestore);
    const homeFlashAfterRestore = postRestoreTransitions.includes("");

    // Second restore tick (visibility/pageshow class) — must recover if sink misfired.
    if (typeof window.iuMindMenuRestoreIfArmed === "function") window.iuMindMenuRestoreIfArmed();

    if (wrap && typeof orig === "function") wrap.__iuMobileGateSetTab = orig;
    const panelAfter = document.getElementById("iuMobileGatePanelTools");
    return {
      transitions,
      visitedHome: transitions.includes(""),
      gateAfterRestore,
      gateAfterClose,
      homeFlashAfterRestore,
      finalGate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
      panelScroll: panelAfter ? panelAfter.scrollTop || 0 : -1,
      hash: String(location.hash || "").replace("#", ""),
      pendingAlive: !!localStorage.getItem("iuMindMenuReturnPendingV1"),
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
          typeof window.iuMindMenuArmReturnState === "function" &&
          typeof window.iuMindMenuSyncGateFromHistory === "function" &&
          !!(window.iuNetwork && typeof window.iuNetwork.restoreAppShellAfterReturn === "function"),
        { timeout: 60000 }
      );

      await openMindMenu(page);
      const scrolled = await scrollMindMenuPanel(page, SCROLL_TARGET);
      must(scrolled.ok, "before:panel_exists");
      const scrollExpect = Math.min(SCROLL_TARGET, scrolled.max || SCROLL_TARGET);
      if (scrollExpect > 40) {
        must(scrolled.scrollTop >= Math.floor(scrollExpect * 0.5), "before:scrolled:" + scrolled.scrollTop);
      }

      const arm = await armViaRealApi(page, scrollExpect);
      must(arm.ok, "arm:ok:" + (arm.reason || ""));
      must(arm.armed === "1", "arm:session_armed:" + arm.armed);
      must(arm.pending === "1", "arm:durable_pending:" + arm.pending);

      const before = await snap(page);
      must(before.gate === "tools", "before:gate_tools:" + before.gate);
      must(before.hash === "iu-mindmenu", "before:hash:" + before.hash);

      const death = await simulateProcessDeathResume(page);
      await page.waitForTimeout(300);
      const after = await snap(page);

      must(after.gate === "tools", "after:gate_tools:" + after.gate);
      must(after.hash === "iu-mindmenu", "after:hash_restored:" + after.hash);
      must(after.overlayState === true, "after:overlay_state");
      must(after.bodyGate === true, "after:body_overlay_class");
      must(death.finalGate === "tools", "after:death_final_tools:" + death.finalGate);
      must(death.gateAfterRestore === "tools", "after:restore_first_tools:" + death.gateAfterRestore);
      must(
        death.homeFlashAfterRestore !== true,
        "after:no_home_flash_after_restore:gateAfterClose=" + death.gateAfterClose
      );
      must(death.gateAfterClose === "tools", "after:close_sink_kept_tools:" + death.gateAfterClose);
      if (scrollExpect > 40) {
        must(
          after.panelScroll >= Math.floor(scrollExpect * 0.5),
          "after:scroll_kept:" + after.panelScroll + "/expect~" + scrollExpect
        );
      }

      for (let i = 0; i < 3; i++) {
        await openMindMenu(page);
        await scrollMindMenuPanel(page, scrollExpect);
        const armC = await armViaRealApi(page, scrollExpect);
        must(armC.pending === "1", "cycle" + i + ":pending");
        const cycle = await simulateProcessDeathResume(page);
        await page.waitForTimeout(200);
        const cSnap = await snap(page);
        must(cSnap.gate === "tools", "cycle" + i + ":gate:" + cSnap.gate);
        must(cSnap.hash === "iu-mindmenu", "cycle" + i + ":hash:" + cSnap.hash);
        must(cycle.finalGate === "tools", "cycle" + i + ":death_tools:" + cycle.finalGate);
        must(
          cycle.homeFlashAfterRestore !== true,
          "cycle" + i + ":no_home_flash:afterClose=" + cycle.gateAfterClose
        );
        if (scrollExpect > 40) {
          must(
            cSnap.panelScroll >= Math.floor(scrollExpect * 0.5),
            "cycle" + i + ":scroll:" + cSnap.panelScroll
          );
        }
      }

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

      // Intentional Back after clearing pending+armed+latch may close.
      const syncClose = await page.evaluate(() => {
        const wrap = document.getElementById("iuMobileGateWrap");
        wrap.__iuMobileGateSetTab("tools");
        try {
          sessionStorage.removeItem("iuMindMenuReturnLatchTs");
          sessionStorage.removeItem("iuMindMenuReturnArmed");
          localStorage.removeItem("iuMindMenuReturnPendingV1");
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
