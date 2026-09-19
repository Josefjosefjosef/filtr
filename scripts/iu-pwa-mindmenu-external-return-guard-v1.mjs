#!/usr/bin/env node
/**
 * PWA: MindMenu must survive return from an external page (Done / close Safari view).
 *
 * Post-#11037 device FAIL classes (authoritative manual evidence):
 *   MOBILE/TABLET: MindMenu → external → VISIBLE Home frame → MindMenu
 *     (HOME_TRANSITIONS could stay 0; measure VISIBLE_HOME_FRAMES)
 *   PC: AI asistenti overlay restores clipped after modal-open strip
 *
 * Platforms are separate: PC_STANDALONE_PWA / MOBILE_STANDALONE_PWA / TABLET_STANDALONE_PWA
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
import { swHasAllowedCacheVersion } from "./guards/iu-sw-cache-version-allowlist.mjs";

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
    must(
      /function setTab\s*\(\s*value\s*\)\s*\{[\s\S]{0,900}iuMindMenuHasReturnGuard/.test(feed),
      "static:settab_empty_respects_return_guard"
    );
    must(
      /function iuProjectsHubNavigateHardResetFromHomeOrBack\s*\(\s*\)\s*\{[\s\S]{0,750}iuMindMenuHasReturnGuard/.test(
        feed
      ),
      "static:hub_hard_reset_respects_return_guard"
    );
    const shell = read("assets/iu-mobile-bottom-nav-shell-v1.js");
    must(
      /iuMobileGateCloseForMainNav\s*=\s*function[\s\S]{0,700}iuMindMenuHasReturnGuard/.test(shell),
      "static:shell_close_respects_return_guard"
    );
    must(
      /if \(!gateVal\)\s*\{[\s\S]{0,700}iuMindMenuHasReturnGuard/.test(shell),
      "static:shell_settab_empty_respects_return_guard"
    );
    must(/iu-mm-return-boot/.test(shell), "static:shell_boot_class");
    const html = read("projects/index.html");
    must(/pwa-mindmenu-visible-home-overlay-v1-20260919/.test(html), "static:visible_home_overlay_marker");
    must(/iu-mm-return-boot/.test(html) && /window\.iuMindMenuHasReturnGuard\s*=\s*function/.test(html), "static:head_early_guard");
    must(/data-iu-mobile-gate", "tools"/.test(html), "static:head_pin_tools");
    must(/visibleHomeFrames/.test(html), "static:visible_home_frames_diag");
    must(
      /html\.iu-mm-return-boot #feed/.test(html) &&
        !/html\.iu-mm-return-boot:not\(\.iu-mobileGateOverlayOpen\)\s*#feed/.test(html),
      "static:boot_css_hides_feed_for_entire_boot"
    );
    must(/function isAiAssistantsOverlayOpen/.test(net), "static:ai_overlay_detect");
    must(/isAiAssistantsOverlayOpen\(\)/.test(net), "static:ai_counts_as_intentional");
    must(/reassertIntentionalOverlayShell/.test(net), "static:reassert_overlay_shell");
    must(/armExternalReturn:\s*armExternalReturn/.test(net), "static:arm_external_export");
    must(
      /external[\s\S]{0,400}iuMindMenuArmReturnState[\s\S]{0,400}return;/.test(app) ||
        /Keep overlay open for PWA return/.test(app),
      "static:ai_external_keeps_overlay"
    );
    must(/pending\.ai/.test(feed) && /iuAiPanelOpenSurface/.test(feed), "static:pending_ai_restore");
    const sw = read("sw.js");
    must(
      /iu-app-feed-pipeline-v1\.js[\s\S]{0,200}iu-mobile-bottom-nav-shell-v1\.js[\s\S]{0,200}iu-network-connectivity-v1\.js/.test(
        sw
      ) && /PWA MindMenu external-return lifecycle modules: network-first/.test(sw),
      "static:sw_network_first_mindmenu_lifecycle_modules"
    );
    must(swHasAllowedCacheVersion(sw), "static:sw_cache_token");
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

async function installStandalone(context) {
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
        const beforeGate = String(wrap.getAttribute("data-iu-mobile-gate") || "");
        const result = orig.apply(this, arguments);
        const afterGate = String(wrap.getAttribute("data-iu-mobile-gate") || "");
        if (afterGate !== beforeGate) transitions.push(afterGate);
        return result;
      };
    }
    try {
      const pending = localStorage.getItem("iuMindMenuReturnPendingV1");
      sessionStorage.clear();
      if (pending) localStorage.setItem("iuMindMenuReturnPendingV1", pending);
    } catch (_) {}
    try {
      const u = new URL(window.location.href);
      u.hash = "";
      history.replaceState({}, "", u.toString());
    } catch (_) {}
    if (wrap && typeof orig === "function") wrap.__iuMobileGateSetTab("");

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

    try {
      sessionStorage.removeItem("iuMindMenuReturnLatchTs");
      sessionStorage.removeItem("iuMindMenuReturnArmed");
      const u2 = new URL(window.location.href);
      u2.hash = "";
      history.replaceState({}, "", u2.toString());
    } catch (_) {}
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));

    if (typeof window.iuMobileGateCloseForMainNav === "function") {
      window.iuMobileGateCloseForMainNav();
    }
    if (typeof window.iuProjectsHubNavigateHardResetFromHomeOrBack === "function") {
      window.iuProjectsHubNavigateHardResetFromHomeOrBack();
    }
    if (wrap && typeof wrap.__iuMobileGateSetTab === "function") {
      wrap.__iuMobileGateSetTab("");
    }
    const gateAfterClose = wrap ? String(wrap.getAttribute("data-iu-mobile-gate") || "") : "";
    const postRestoreTransitions = transitions.slice(idxAfterRestore);
    const homeFlashAfterRestore = postRestoreTransitions.includes("");
    const overlayAfter = document.body.classList.contains("iu-mobileGateOverlayOpen");
    const mainAfter = document.body.classList.contains("iu-mobileMainVisible");
    const visualHomeAfter = gateAfterClose !== "tools" || (!overlayAfter && mainAfter);

    if (typeof window.iuMindMenuRestoreIfArmed === "function") window.iuMindMenuRestoreIfArmed();

    if (wrap && typeof orig === "function") wrap.__iuMobileGateSetTab = orig;
    const panelAfter = document.getElementById("iuMobileGatePanelTools");
    return {
      transitions,
      visitedHome: transitions.includes(""),
      gateAfterRestore,
      gateAfterClose,
      homeFlashAfterRestore,
      visualHomeAfter,
      homeTransitionsDuringReturn: postRestoreTransitions.filter((t) => t === "").length,
      finalGate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
      panelScroll: panelAfter ? panelAfter.scrollTop || 0 : -1,
      hash: String(location.hash || "").replace("#", ""),
      pendingAlive: !!localStorage.getItem("iuMindMenuReturnPendingV1"),
    };
  });
}

function measureAiOverlayFn() {
  return (() => {
    const pan = document.getElementById("iu-aiPanel");
    if (!pan) return { open: false };
    const st = window.getComputedStyle(pan);
    const r = pan.getBoundingClientRect();
    const vh = window.innerHeight || 0;
    const modalOpen = document.body.classList.contains("iu-modal-open");
    const clipped =
      modalOpen === false ||
      r.height < vh * 0.85 ||
      (parseFloat(st.top) || 0) > 40 ||
      st.position !== "fixed";
    const layoutValid =
      modalOpen === true &&
      r.height >= vh * 0.9 &&
      Math.abs(r.top) <= 2 &&
      Math.abs(r.left) <= 2 &&
      (st.height === "100dvh" || r.height >= vh * 0.95);
    return {
      open: String(pan.dataset.open || "") === "1" && !pan.hasAttribute("hidden"),
      modalOpen,
      width: r.width,
      height: r.height,
      top: r.top,
      bottom: r.bottom,
      vh,
      computedHeight: st.height,
      computedMaxHeight: st.maxHeight,
      computedTop: st.top,
      computedPosition: st.position,
      computedOverflow: st.overflow,
      clipped,
      layoutValid,
    };
  })();
}

async function waitRuntime(page) {
  await page.waitForFunction(() => document.querySelectorAll("*").length > 1500, { timeout: 45000 });
  await page.waitForFunction(
    () =>
      typeof window.iuMindMenuRestoreIfArmed === "function" &&
      typeof window.iuMindMenuArmReturnState === "function" &&
      typeof window.iuMindMenuSyncGateFromHistory === "function" &&
      !!(window.iuNetwork && typeof window.iuNetwork.restoreAppShellAfterReturn === "function"),
    { timeout: 60000 }
  );
}

async function runMobileOrTabletPlatform(browser, label, viewport) {
  const context = await bootstrapGuardContext(browser, {
    viewport,
    isMobile: true,
    hasTouch: true,
  });
  await installStandalone(context);
  const page = await bootstrapGuardPage(context);
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitRuntime(page);

    await openMindMenu(page);
    const scrolled = await scrollMindMenuPanel(page, SCROLL_TARGET);
    must(scrolled.ok, label + ":before:panel_exists");
    const scrollExpect = Math.min(SCROLL_TARGET, scrolled.max || SCROLL_TARGET);
    if (scrollExpect > 40) {
      must(scrolled.scrollTop >= Math.floor(scrollExpect * 0.5), label + ":before:scrolled:" + scrolled.scrollTop);
    }

    const arm = await armViaRealApi(page, scrollExpect);
    must(arm.ok, label + ":arm:ok:" + (arm.reason || ""));
    must(arm.armed === "1", label + ":arm:session_armed:" + arm.armed);
    must(arm.pending === "1", label + ":arm:durable_pending:" + arm.pending);

    const before = await snap(page);
    must(before.gate === "tools", label + ":before:gate_tools:" + before.gate);
    must(before.hash === "iu-mindmenu", label + ":before:hash:" + before.hash);

    const death = await simulateProcessDeathResume(page);
    await page.waitForTimeout(300);
    const after = await snap(page);

    must(after.gate === "tools", label + ":after:gate_tools:" + after.gate);
    must(after.hash === "iu-mindmenu", label + ":after:hash_restored:" + after.hash);
    must(after.overlayState === true, label + ":after:overlay_state");
    must(after.bodyGate === true, label + ":after:body_overlay_class");
    must(death.finalGate === "tools", label + ":after:death_final_tools:" + death.finalGate);
    must(death.gateAfterRestore === "tools", label + ":after:restore_first_tools:" + death.gateAfterRestore);
    must(
      death.homeFlashAfterRestore !== true,
      label + ":after:no_home_flash_after_restore:gateAfterClose=" + death.gateAfterClose
    );
    must(death.gateAfterClose === "tools", label + ":after:close_sink_kept_tools:" + death.gateAfterClose);
    must(death.visualHomeAfter !== true, label + ":after:no_visual_home_after_sinks");
    must(
      (death.homeTransitionsDuringReturn || 0) === 0,
      label + ":after:HOME_TRANSITIONS_DURING_RETURN=" + death.homeTransitionsDuringReturn
    );
    if (scrollExpect > 40) {
      must(
        after.panelScroll >= Math.floor(scrollExpect * 0.5),
        label + ":after:scroll_kept:" + after.panelScroll + "/expect~" + scrollExpect
      );
    }

    for (let i = 0; i < 3; i++) {
      await openMindMenu(page);
      await scrollMindMenuPanel(page, scrollExpect);
      const armC = await armViaRealApi(page, scrollExpect);
      must(armC.pending === "1", label + ":cycle" + i + ":pending");
      const cycle = await simulateProcessDeathResume(page);
      await page.waitForTimeout(200);
      const cSnap = await snap(page);
      must(cSnap.gate === "tools", label + ":cycle" + i + ":gate:" + cSnap.gate);
      must(cSnap.hash === "iu-mindmenu", label + ":cycle" + i + ":hash:" + cSnap.hash);
      must(cycle.finalGate === "tools", label + ":cycle" + i + ":death_tools:" + cycle.finalGate);
      must(
        cycle.homeFlashAfterRestore !== true,
        label + ":cycle" + i + ":no_home_flash:afterClose=" + cycle.gateAfterClose
      );
      if (scrollExpect > 40) {
        must(
          cSnap.panelScroll >= Math.floor(scrollExpect * 0.5),
          label + ":cycle" + i + ":scroll:" + cSnap.panelScroll
        );
      }
    }

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
    must(syncNoClose === "tools", label + ":sync:no_close_without_allow:" + syncNoClose);

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
    must(syncClose === "", label + ":sync:allow_close_home:" + syncClose);

    const neg = await page.evaluate(() => {
      const wrap = document.getElementById("iuMobileGateWrap");
      try {
        sessionStorage.removeItem("iuMindMenuReturnLatchTs");
        sessionStorage.removeItem("iuMindMenuReturnArmed");
        localStorage.removeItem("iuMindMenuReturnPendingV1");
      } catch (_) {}
      wrap.__iuMobileGateSetTab("tools");
      wrap.__iuMobileGateSetTab("");
      const afterSetTab = wrap.getAttribute("data-iu-mobile-gate") || "";
      wrap.__iuMobileGateSetTab("tools");
      if (typeof window.iuProjectsHubNavigateHardResetFromHomeOrBack === "function") {
        window.iuProjectsHubNavigateHardResetFromHomeOrBack();
      } else {
        wrap.__iuMobileGateSetTab("");
      }
      const afterHub = wrap.getAttribute("data-iu-mobile-gate") || "";
      return { afterSetTab, afterHub };
    });
    must(neg.afterSetTab === "", label + ":neg:cold_settab_home:" + neg.afterSetTab);
    must(neg.afterHub === "", label + ":neg:hub_home_without_pending:" + neg.afterHub);

    /* Cold new-document return: measure VISIBLE_HOME_FRAMES, not only router transitions. */
    await page.evaluate(() => {
      localStorage.setItem("iuMindMenuReturnPendingV1", JSON.stringify({ t: Date.now(), y: 360 }));
      sessionStorage.clear();
    });
    const coldUrl = new URL(page.url());
    coldUrl.hash = "";
    await page.goto(coldUrl.toString(), { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(
      () => {
        const wrap = document.getElementById("iuMobileGateWrap");
        return !!(wrap && window.__iuMmReturnBootDiag && window.__iuMmReturnBootDiag.applied === true);
      },
      { timeout: 20000 }
    );
    await page.waitForTimeout(400);
    const cold = await page.evaluate(() => {
      const d = window.__iuMmReturnBootDiag || {};
      const wrap = document.getElementById("iuMobileGateWrap");
      const gate = wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "";
      const feed = document.getElementById("feed");
      let feedVisible = false;
      try {
        if (feed) {
          const st = getComputedStyle(feed);
          const r = feed.getBoundingClientRect();
          feedVisible =
            st.visibility !== "hidden" &&
            st.display !== "none" &&
            r.width > 8 &&
            r.height > 8;
        }
      } catch (_) {}
      return {
        applied: d.applied === true,
        beforeBody: d.bootClassBeforeBody === true,
        sawHome: d.sawUnguardedHome === true,
        visibleHomeFrames: d.visibleHomeFrames || 0,
        clearedBy: d.clearedBy || "",
        gate,
        overlay: document.body.classList.contains("iu-mobileGateOverlayOpen"),
        boot: document.documentElement.classList.contains("iu-mm-return-boot"),
        feedVisibleNow: feedVisible,
        guard: typeof window.iuMindMenuHasReturnGuard === "function" ? window.iuMindMenuHasReturnGuard() : false,
      };
    });
    must(cold.applied === true, label + ":colddoc:boot_applied");
    must(cold.beforeBody === true, label + ":colddoc:class_before_body");
    must(cold.sawHome !== true, label + ":colddoc:HOME_VISIBLE");
    must(
      (cold.visibleHomeFrames || 0) === 0,
      label + ":colddoc:VISIBLE_HOME_FRAMES_DURING_RETURN=" + cold.visibleHomeFrames
    );
    must(cold.feedVisibleNow !== true, label + ":colddoc:feed_not_painted_during_boot");
    must(cold.gate === "tools", label + ":colddoc:gate_tools:" + cold.gate);
    must(cold.overlay === true, label + ":colddoc:overlay");
    must(cold.guard === true, label + ":colddoc:guard_still_true");
    must(cold.sawHome !== true && cold.gate === "tools", label + ":colddoc:HOME_TRANSITIONS_DURING_RETURN=0");

    return { platform: label, visibleHomeFrames: cold.visibleHomeFrames || 0 };
  } finally {
    await context.close();
  }
}

async function runPcAiOverlayPlatform(browser) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: 1280, height: 800 },
    isMobile: false,
    hasTouch: false,
  });
  await installStandalone(context);
  const page = await bootstrapGuardPage(context);
  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitRuntime(page);

    const opened = await page.evaluate(() => {
      if (typeof window.iuAiPanelOpenSurface !== "function") return { ok: false, reason: "no_open" };
      window.iuAiPanelOpenSurface();
      const pan = document.getElementById("iu-aiPanel");
      return {
        ok: !!(pan && String(pan.dataset.open || "") === "1"),
        modalOpen: document.body.classList.contains("iu-modal-open"),
      };
    });
    must(opened.ok === true, "PC:ai_open");
    must(opened.modalOpen === true, "PC:ai_modal_open_before");

    await page.waitForTimeout(100);
    const before = await page.evaluate(measureAiOverlayFn);
    must(before.open === true, "PC:before:open");
    must(before.layoutValid === true, "PC:before:layout_valid:h=" + before.height + "/vh=" + before.vh);
    must(before.clipped !== true, "PC:before:not_clipped");

    /* Arm external return + keep AI open (real PC path). */
    const armed = await page.evaluate(() => {
      try {
        if (typeof window.iuMindMenuArmReturnState === "function") window.iuMindMenuArmReturnState();
      } catch (_) {}
      try {
        if (window.iuNetwork && typeof window.iuNetwork.armExternalReturn === "function") {
          window.iuNetwork.armExternalReturn();
        } else {
          sessionStorage.setItem("iu_external_nav_armed", "1");
        }
      } catch (_) {}
      const body = document.querySelector("#iu-aiPanel .iu-aiPanelBody");
      if (body) body.scrollTop = 180;
      const pendingRaw = localStorage.getItem("iuMindMenuReturnPendingV1");
      let pending = null;
      try {
        pending = pendingRaw ? JSON.parse(pendingRaw) : null;
      } catch (_) {}
      if (!pending) {
        localStorage.setItem(
          "iuMindMenuReturnPendingV1",
          JSON.stringify({ t: Date.now(), y: 0, ai: 1, aiY: 180 })
        );
      } else {
        pending.ai = 1;
        pending.aiY = 180;
        pending.t = Date.now();
        localStorage.setItem("iuMindMenuReturnPendingV1", JSON.stringify(pending));
      }
      return { armed: sessionStorage.getItem("iu_external_nav_armed") || "" };
    });
    must(armed.armed === "1", "PC:external_armed");

    /* Simulate return: pageshow + restoreAppShellAfterReturn (must NOT strip modal-open). */
    const afterRestore = await page.evaluate(() => {
      window.iuNetwork.restoreAppShellAfterReturn();
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new FocusEvent("focus"));
      const pan = document.getElementById("iu-aiPanel");
      const st = window.getComputedStyle(pan);
      const r = pan.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      const modalOpen = document.body.classList.contains("iu-modal-open");
      const clipped =
        modalOpen === false ||
        r.height < vh * 0.85 ||
        (parseFloat(st.top) || 0) > 40;
      const layoutValid =
        modalOpen === true && r.height >= vh * 0.9 && Math.abs(r.top) <= 2;
      const body = pan.querySelector(".iu-aiPanelBody");
      return {
        open: String(pan.dataset.open || "") === "1" && !pan.hasAttribute("hidden"),
        modalOpen,
        height: r.height,
        top: r.top,
        vh,
        computedTop: st.top,
        clipped,
        layoutValid,
        aiScroll: body ? body.scrollTop || 0 : -1,
        secondRestore: 0,
      };
    });
    must(afterRestore.open === true, "PC:AI_OVERLAY_OPEN_AFTER_RETURN");
    must(afterRestore.clipped !== true, "PC:AI_OVERLAY_CLIPPED_AFTER_RETURN=" + afterRestore.clipped);
    must(
      afterRestore.layoutValid === true,
      "PC:AI_OVERLAY_LAYOUT_VALID_AFTER_RETURN:h=" + afterRestore.height + "/top=" + afterRestore.top
    );
    must(afterRestore.modalOpen === true, "PC:modal_open_kept");
    must((afterRestore.secondRestore || 0) === 0, "PC:SECOND_OVERLAY_RESTORE_DURING_RETURN=0");
    const aiScrollMax = await page.evaluate(() => {
      const body = document.querySelector("#iu-aiPanel .iu-aiPanelBody, #iu-aiPanel .iu-ai-scroll-host");
      if (!body) return 0;
      return Math.max(0, (body.scrollHeight || 0) - (body.clientHeight || 0));
    });
    if (aiScrollMax > 80) {
      must(afterRestore.aiScroll >= 100, "PC:ai_scroll_kept:" + afterRestore.aiScroll);
    }

    /* Old-bug regression probe: stripping modal-open must be detected as clipped
       (proves the guard would FAIL on #11037 production behavior). */
    const probe = await page.evaluate(() => {
      document.body.classList.remove("iu-modal-open");
      document.documentElement.classList.remove("iu-modal-open");
      const pan = document.getElementById("iu-aiPanel");
      void pan.offsetHeight;
      const st = window.getComputedStyle(pan);
      const r = pan.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      const clipped =
        !document.body.classList.contains("iu-modal-open") ||
        r.height < vh * 0.85 ||
        (parseFloat(st.top) || 0) > 40;
      /* Reassert current fix path */
      window.iuNetwork.restoreAppShellAfterReturn();
      const r2 = pan.getBoundingClientRect();
      const fixed =
        document.body.classList.contains("iu-modal-open") && r2.height >= vh * 0.9 && Math.abs(r2.top) <= 2;
      return { strippedClipped: clipped, fixedAfterReassert: fixed, strippedH: r.height, fixedH: r2.height };
    });
    must(probe.strippedClipped === true, "PC:probe_old_strip_is_clipped:h=" + probe.strippedH);
    must(probe.fixedAfterReassert === true, "PC:probe_reassert_fixes:h=" + probe.fixedH);

    /* Process-death cold resume with pending.ai */
    await page.evaluate(() => {
      localStorage.setItem(
        "iuMindMenuReturnPendingV1",
        JSON.stringify({ t: Date.now(), y: 0, ai: 1, aiY: 120 })
      );
      sessionStorage.clear();
      sessionStorage.setItem("iu_external_nav_armed", "1");
      const pan = document.getElementById("iu-aiPanel");
      if (pan) {
        pan.dataset.open = "0";
        pan.hidden = true;
        pan.setAttribute("hidden", "");
      }
      document.body.classList.remove("iu-modal-open");
    });
    const coldAi = await page.evaluate(() => {
      if (typeof window.iuMindMenuRestoreIfArmed === "function") window.iuMindMenuRestoreIfArmed();
      if (window.iuNetwork) window.iuNetwork.restoreAppShellAfterReturn();
      const pan = document.getElementById("iu-aiPanel");
      if (!pan) return { open: false };
      const r = pan.getBoundingClientRect();
      const vh = window.innerHeight || 0;
      const modalOpen = document.body.classList.contains("iu-modal-open");
      return {
        open: String(pan.dataset.open || "") === "1" && !pan.hasAttribute("hidden"),
        modalOpen,
        layoutValid: modalOpen && r.height >= vh * 0.9 && Math.abs(r.top) <= 2,
        clipped: !modalOpen || r.height < vh * 0.85,
      };
    });
    must(coldAi.open === true, "PC:cold:AI_OVERLAY_OPEN_AFTER_RETURN");
    must(coldAi.clipped !== true, "PC:cold:AI_OVERLAY_CLIPPED_AFTER_RETURN");
    must(coldAi.layoutValid === true, "PC:cold:AI_OVERLAY_LAYOUT_VALID_AFTER_RETURN");

    for (let i = 0; i < 3; i++) {
      const cyc = await page.evaluate(() => {
        if (typeof window.iuAiPanelOpenSurface === "function") window.iuAiPanelOpenSurface();
        sessionStorage.setItem("iu_external_nav_armed", "1");
        window.iuNetwork.restoreAppShellAfterReturn();
        const pan = document.getElementById("iu-aiPanel");
        const r = pan.getBoundingClientRect();
        const vh = window.innerHeight || 0;
        const modalOpen = document.body.classList.contains("iu-modal-open");
        return {
          open: String(pan.dataset.open || "") === "1",
          layoutValid: modalOpen && r.height >= vh * 0.9,
        };
      });
      must(cyc.open === true && cyc.layoutValid === true, "PC:cycle" + i + ":layout");
    }

    return { platform: "PC_STANDALONE_PWA", clipped: false };
  } finally {
    await context.close();
  }
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
      const mobile = await runMobileOrTabletPlatform(browser, "MOBILE_STANDALONE_PWA", {
        width: 390,
        height: 844,
      });
      const tablet = await runMobileOrTabletPlatform(browser, "TABLET_STANDALONE_PWA", {
        width: 820,
        height: 1180,
      });
      const pc = await runPcAiOverlayPlatform(browser);
      console.log(
        "PLATFORM_RESULTS " +
          JSON.stringify({
            MOBILE_REPRO: mobile.visibleHomeFrames === 0 ? "PASS" : "FAIL",
            TABLET_REPRO: tablet.visibleHomeFrames === 0 ? "PASS" : "FAIL",
            PC_REPRO: pc.clipped ? "FAIL" : "PASS",
            VISIBLE_HOME_FRAMES_MOBILE: mobile.visibleHomeFrames,
            VISIBLE_HOME_FRAMES_TABLET: tablet.visibleHomeFrames,
          })
      );
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
