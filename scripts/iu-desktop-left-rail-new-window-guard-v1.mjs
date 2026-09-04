#!/usr/bin/env node
/**
 * PC (â‰Ą1025px) left-rail â†’ new tab in same browser window + top bar shell guard.
 * Run: npm run iu-desktop-left-rail-new-window-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-desktop-left-rail-new-window-guard
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import { exitIfMediaArticlesGuardsSkipped } from "./media-articles-cutover-skip.mjs";
import {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  installLocalDataProtectionAccepted,
} from "./proofs/open_meteo_guard_stub.cjs";
import { ensureGuardLocalDataProtection } from "./guards/desktop-nav-targets.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8904", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const CYCLES_PER_BUTTON = parseInt(process.env.IU_LEFT_RAIL_WINDOW_CYCLES || "5", 10);
const SETTLE_MS = parseInt(process.env.IU_LEFT_RAIL_WINDOW_SETTLE_MS || "20000", 10);
const RESTORE_TOL_PX = parseInt(process.env.IU_LEFT_RAIL_WINDOW_SCROLL_TOL || "12", 10);

const STATIC_TOOLS = [
  { accent: "pocasi", label: "PoÄŤasĂ­" },
  { accent: "mapy", label: "Mapy", externalLink: 'a.iuRadioChip[href*="google.com/maps"]' },
  { accent: "jr", label: "JĂ­zdnĂ­ Ĺ™Ăˇdy" },
  { accent: "tvprogram", label: "TV program" },
  { accent: "tvonline", label: "TV online" },
  { accent: "radio", label: "RĂˇdia" },
];

function auditStaticOpenImplementation() {
  const srcPath = path.join(REPO, "assets", "iu-desktop-left-rail-new-window-v1.js");
  const shellPath = path.join(REPO, "assets", "iu-desktop-tool-window-shell-v1.css");
  const railPath = path.join(REPO, "assets", "iu-desktop-tool-window-left-rail-v1.js");
  const src = fs.readFileSync(srcPath, "utf8");
  const shell = fs.readFileSync(shellPath, "utf8");
  const rail = fs.readFileSync(railPath, "utf8");
  const fails = [];
  if (src.includes("popup=yes")) fails.push("popup=yes still present");
  if (/window\.open\([^)]*,[^,]+,[^)]*(width|height|left|top)/.test(src)) {
    fails.push("window.open with popup dimension features still present");
  }
  if (src.includes("openWindows")) fails.push("named window reuse map still present");
  if (!src.includes('window.open(targetUrl, "_blank"')) fails.push('expected window.open(..., "_blank", ...)');
  if (!shell.includes("#newsList > #iuLeftRail")) fails.push("tool shell must show left rail");
  if (!shell.includes("iuToolWindowRightReserve")) fails.push("tool shell must reserve right column");
  if (!rail.includes("iuToolWindowMindMenuBtn")) fails.push("tool rail must inject MindMenu button");
  if (!/min-width:\s*1025px[\s\S]*#topbarWrap\.topbar-new\.iuTopbar[\s\S]*--iuTopbarHeight/.test(shell)) {
    fails.push("tool shell must lock PC topbar height to --iuTopbarHeight");
  }
  if (/html\[data-iu-tool-window="1"\] #topbarWrap\.topbar-new\.iuTopbar[\s\S]{0,220}height:\s*auto\s*!important/.test(shell) &&
      !/@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]*height:\s*auto\s*!important/.test(shell)) {
    fails.push("tool shell must not leave height:auto on PC topbar outside max-width:1024");
  }
  if (/overflow-y:\s*auto/.test(shell) && /#newsList\s*>\s*#iuLeftRail[\s\S]*?overflow-y:\s*auto/.test(shell)) {
    fails.push("tool shell left rail must not use overflow-y auto");
  }
  if (/position:\s*sticky/.test(shell) && /#newsList\s*>\s*#iuLeftRail[\s\S]*?position:\s*sticky/.test(shell)) {
    fails.push("tool shell left rail must not use position sticky");
  }
  if (/max-height:\s*calc\(100vh/.test(shell) && /#newsList\s*>\s*#iuLeftRail[\s\S]*?max-height:\s*calc\(100vh/.test(shell)) {
    fails.push("tool shell left rail must not use viewport max-height");
  }
  return fails;
}

function isProdHost(base) {
  return /infouzel\.cz/i.test(base);
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      /* GET: some static servers answer slowly / oddly on HEAD under CI load. */
      const req = http.request({ host, port, path: "/projects/", method: "GET", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("timeout", () => {
        try { req.destroy(); } catch {}
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 200);
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 200);
      });
      req.end();
    };
    tryOnce();
  });
}

function buildUrl(params) {
  const isLocal = BASE.indexOf("127.0.0.1") >= 0 || BASE.indexOf("localhost") >= 0;
  const p = new URLSearchParams(params || {});
  if (isLocal) p.set("iuRobust", "1");
  if (isProdHost(BASE)) p.set("nosw", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
}

async function readScrollY(page) {
  return page.evaluate(() => {
    try {
      if (typeof window.iuGetMainScrollTop === "function") return window.iuGetMainScrollTop();
    } catch (_) {}
    return Math.max(
      0,
      window.scrollY || 0,
      (document.documentElement && document.documentElement.scrollTop) || 0,
      (document.body && document.body.scrollTop) || 0
    );
  });
}

async function waitHubFeedReady(page, timeoutMs) {
  try {
    await page.waitForFunction(
      () => {
        const feed = document.getElementById("feed");
        if (!feed) return true;
        return String(feed.getAttribute("data-feed-ready") || "") === "true";
      },
      { timeout: timeoutMs }
    );
  } catch (_) {}
}

async function discoverLeftRailButtons(page) {
  await page.waitForSelector("#iuLeftRail .iu-leftNavItem[data-accent]", { timeout: 60000 });
  const accents = await page.evaluate(() => {
    var out = [];
    var nodes = document.querySelectorAll("#iuLeftRail .iu-leftNavItem[data-accent]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (String(el.getAttribute("data-media-topic") || "").trim()) continue;
      var ac = String(el.getAttribute("data-accent") || "").trim().toLowerCase();
      if (!ac) continue;
      var labelEl = el.querySelector(".iu-leftNavLabel");
      var label = labelEl ? String(labelEl.textContent || "").trim() : ac;
      out.push({ accent: ac, label: label });
    }
    return out;
  });
  if (!accents.length) throw new Error("no left-rail buttons discovered");
  return accents;
}

async function ensureParentReady(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector("#iuLeftRail .iu-leftNavItem", { timeout: 60000 });
  await ensureGuardLocalDataProtection(page);
  await waitHubFeedReady(page, 30000);
  await page.waitForTimeout(600);
}

async function scrollParentForCycle(page, cycleIndex) {
  const ratios = [0, 0.28, 0.52, 0.78, 0.12];
  const ratio = ratios[cycleIndex % ratios.length];
  await page.evaluate((r) => {
    var target = Math.max(0, Math.floor((document.body.scrollHeight || 0) * r));
    window.scrollTo(0, target);
    document.documentElement.scrollTop = target;
    if (document.body) document.body.scrollTop = target;
    try {
      if (typeof window.iuScrollRestoreSaveNow === "function") window.iuScrollRestoreSaveNow();
    } catch (_) {}
  }, ratio);
  await page.waitForTimeout(250);
}

async function readHomeNavMetrics(page) {
  return page.evaluate(() => {
    var mindHome = document.getElementById("iuMyInfoUzelOpenBtn");
    var firstItem = document.querySelector("#iuLeftRail .iu-leftNav .iu-leftNavItem[data-accent]");
    var itemRect = firstItem ? firstItem.getBoundingClientRect() : null;
    var itemStyle = firstItem ? getComputedStyle(firstItem) : null;
    var mindRect = mindHome ? mindHome.getBoundingClientRect() : null;
    var topbar = document.getElementById("topbarWrap");
    var topRect = topbar ? topbar.getBoundingClientRect() : null;
    var spacer = document.querySelector(".iuTopbarFlowSpacer");
    var spacerRect = spacer ? spacer.getBoundingClientRect() : null;
    var root = getComputedStyle(document.documentElement);
    var tokenH = parseInt(String(root.getPropertyValue("--iuTopbarHeight") || "72").trim(), 10);
    return {
      itemW: itemRect ? Math.round(itemRect.width) : 0,
      itemH: itemRect ? Math.round(itemRect.height) : 0,
      itemMinH: itemStyle ? String(itemStyle.minHeight || "") : "",
      railW: (function () {
        var rail = document.getElementById("iuLeftRail");
        return rail ? Math.round(rail.getBoundingClientRect().width) : 0;
      })(),
      mindHomeW: mindRect ? Math.round(mindRect.width) : 0,
      topbarH: topRect ? Math.round(topRect.height) : 0,
      spacerH: spacerRect ? Math.round(spacerRect.height) : 0,
      tokenH: Number.isFinite(tokenH) ? tokenH : 72,
    };
  });
}

async function readToolRailMetrics(toolTab) {
  return toolTab.evaluate(() => {
    var rail = document.getElementById("iuLeftRail");
    var railRect = rail ? rail.getBoundingClientRect() : null;
    var railStyle = rail ? getComputedStyle(rail) : null;
    var nav = rail ? rail.querySelector(".iu-leftNav") : null;
    var navStyle = nav ? getComputedStyle(nav) : null;
    var mindBtn = document.getElementById("iuToolWindowMindMenuBtn");
    var mindRect = mindBtn ? mindBtn.getBoundingClientRect() : null;
    var mindStyle = mindBtn ? getComputedStyle(mindBtn) : null;
    var firstItem = document.querySelector("#iuLeftRail .iu-leftNav .iu-leftNavItem[data-accent]");
    var itemRect = firstItem ? firstItem.getBoundingClientRect() : null;
    var itemStyle = firstItem ? getComputedStyle(firstItem) : null;
    var stage = document.getElementById("iuCenterStage");
    var contentTop = null;
    if (stage) {
      var kids = stage.querySelectorAll("[id$='View']:not([hidden])");
      for (var i = 0; i < kids.length; i++) {
        var view = kids[i];
        if (getComputedStyle(view).display === "none") continue;
        var probe = view.querySelector("h1, h2, .iuSectionHeader, .iuRadioChip, button, p, div");
        if (probe) {
          contentTop = Math.round(probe.getBoundingClientRect().top);
          break;
        }
        contentTop = Math.round(view.getBoundingClientRect().top);
        break;
      }
    }
    return {
      railW: railRect ? Math.round(railRect.width) : 0,
      railOverflowY: railStyle ? String(railStyle.overflowY || "") : "",
      railMaxHeight: railStyle ? String(railStyle.maxHeight || "") : "",
      railPosition: railStyle ? String(railStyle.position || "") : "",
      navOverflowY: navStyle ? String(navStyle.overflowY || "") : "",
      mindW: mindRect ? Math.round(mindRect.width) : 0,
      mindH: mindRect ? Math.round(mindRect.height) : 0,
      mindTop: mindRect ? Math.round(mindRect.top) : 0,
      mindMinH: mindStyle ? String(mindStyle.minHeight || "") : "",
      itemW: itemRect ? Math.round(itemRect.width) : 0,
      itemH: itemRect ? Math.round(itemRect.height) : 0,
      itemMinH: itemStyle ? String(itemStyle.minHeight || "") : "",
      contentTop: contentTop,
      docScrollH: Math.max(document.body.scrollHeight || 0, document.documentElement.scrollHeight || 0),
      viewportH: window.innerHeight || 0,
    };
  });
}

function assertNavParity(homeMetrics, toolMetrics, accent) {
  if (Math.abs(homeMetrics.itemW - toolMetrics.itemW) > 4) {
    throw new Error(`${accent}: nav item width mismatch home=${homeMetrics.itemW} tool=${toolMetrics.itemW}`);
  }
  if (Math.abs(homeMetrics.itemH - toolMetrics.itemH) > 8) {
    throw new Error(`${accent}: nav item height mismatch home=${homeMetrics.itemH} tool=${toolMetrics.itemH}`);
  }
  if (Math.abs(homeMetrics.railW - toolMetrics.railW) > 4) {
    throw new Error(`${accent}: rail width mismatch home=${homeMetrics.railW} tool=${toolMetrics.railW}`);
  }
  if (Math.abs(toolMetrics.mindW - toolMetrics.itemW) > 4) {
    throw new Error(`${accent}: MindMenu width mismatch mind=${toolMetrics.mindW} item=${toolMetrics.itemW}`);
  }
  if (toolMetrics.railOverflowY === "auto" || toolMetrics.railOverflowY === "scroll") {
    throw new Error(`${accent}: left rail has internal scroll overflow-y=${toolMetrics.railOverflowY}`);
  }
  if (toolMetrics.navOverflowY === "auto" || toolMetrics.navOverflowY === "scroll") {
    throw new Error(`${accent}: left nav has internal scroll overflow-y=${toolMetrics.navOverflowY}`);
  }
  if (toolMetrics.railPosition === "sticky" || toolMetrics.railPosition === "fixed") {
    throw new Error(`${accent}: left rail must not be sticky/fixed position=${toolMetrics.railPosition}`);
  }
  if (toolMetrics.railMaxHeight && toolMetrics.railMaxHeight !== "none" && !toolMetrics.railMaxHeight.includes("999999")) {
    throw new Error(`${accent}: left rail max-height limited maxHeight=${toolMetrics.railMaxHeight}`);
  }
  if (toolMetrics.mindTop > 0 && toolMetrics.contentTop != null) {
    if (Math.abs(toolMetrics.contentTop - toolMetrics.mindTop) > 12) {
      throw new Error(
        `${accent}: content top misaligned mindTop=${toolMetrics.mindTop} contentTop=${toolMetrics.contentTop}`
      );
    }
  }
}

async function assertToolTabLayout(toolTab, accent, homeMetrics) {
  await toolTab.waitForSelector("#topbarWrap.topbar-new.iuTopbar", { timeout: SETTLE_MS });
  await toolTab.waitForFunction(
    () => document.documentElement.getAttribute("data-iu-tool-window") === "1",
    { timeout: SETTLE_MS }
  );

  const layout = await toolTab.evaluate((ac) => {
    var topbar = document.getElementById("topbarWrap");
    var spacer = document.querySelector(".iuTopbarFlowSpacer");
    var leftRail = document.getElementById("iuLeftRail");
    var leftRailRect = leftRail ? leftRail.getBoundingClientRect() : null;
    var leftRailStyle = leftRail ? getComputedStyle(leftRail) : null;
    var mindBtn = document.getElementById("iuToolWindowMindMenuBtn");
    var reserve = document.getElementById("iuToolWindowRightReserve");
    var accordion = document.querySelector(".layout > aside.accordionCol");
    var sec = String(document.body?.dataset?.section || "").toLowerCase();
    var topRect = topbar ? topbar.getBoundingClientRect() : null;
    var spacerRect = spacer ? spacer.getBoundingClientRect() : null;
    var stage = document.getElementById("iuCenterStage");
    var stageRect = stage ? stage.getBoundingClientRect() : null;
    var stageStyle = stage ? getComputedStyle(stage) : null;
    var feed = document.getElementById("feed");
    var feedDisplay = feed ? getComputedStyle(feed).display : "";
    var closeCount = document.querySelectorAll("[data-iu-desktop-section-close]").length;
    var vw = window.innerWidth || 0;
    var railRight = leftRailRect ? Math.round(leftRailRect.right) : 0;
    var gap = stageRect ? Math.round(stageRect.left - railRight) : 0;
    return {
      sec: sec,
      topbarH: topRect ? Math.round(topRect.height) : 0,
      spacerH: spacerRect ? Math.round(spacerRect.height) : 0,
      leftRailHidden: leftRail ? leftRailStyle.display === "none" : true,
      leftRailW: leftRailRect ? Math.round(leftRailRect.width) : 0,
      mindBtnVisible: !!(mindBtn && getComputedStyle(mindBtn).display !== "none"),
      reservePresent: !!reserve,
      accordionHidden: accordion ? getComputedStyle(accordion).display === "none" : true,
      stageTop: stageRect ? Math.round(stageRect.top) : 0,
      stageWidth: stageRect ? Math.round(stageRect.width) : 0,
      stageLeft: stageRect ? Math.round(stageRect.left) : 0,
      stageRight: stageRect ? Math.round(vw - stageRect.right) : 0,
      railStageGap: gap,
      stageMaxWidth: stageStyle ? String(stageStyle.maxWidth || "") : "",
      closeCount: closeCount,
      feedHidden: feedDisplay === "none",
      href: location.href,
      expected: ac,
    };
  }, accent);

  if (layout.sec !== accent && !(accent.indexOf("aff-") === 0 && layout.sec === accent)) {
    throw new Error(`${accent}: tool tab section mismatch got=${layout.sec}`);
  }
  if (!layout.href.includes("iu_window=tool") || !layout.href.includes("section=" + encodeURIComponent(accent).replace(/%20/g, "+"))) {
    if (!layout.href.includes("section=" + accent)) {
      throw new Error(`${accent}: tool tab URL missing section/iu_window (${layout.href})`);
    }
  }
  if (layout.topbarH < 48) throw new Error(`${accent}: topbar too short h=${layout.topbarH}`);
  if (layout.spacerH < 48) throw new Error(`${accent}: topbar spacer too short h=${layout.spacerH}`);
  if (homeMetrics && homeMetrics.topbarH > 0) {
    if (Math.abs(layout.topbarH - homeMetrics.topbarH) > 1) {
      throw new Error(
        `${accent}: topbar height mismatch home=${homeMetrics.topbarH} tool=${layout.topbarH}`
      );
    }
    if (Math.abs(layout.spacerH - homeMetrics.spacerH) > 1) {
      throw new Error(
        `${accent}: topbar spacer mismatch home=${homeMetrics.spacerH} tool=${layout.spacerH}`
      );
    }
  } else if (homeMetrics && homeMetrics.tokenH > 0) {
    if (Math.abs(layout.topbarH - homeMetrics.tokenH) > 1) {
      throw new Error(
        `${accent}: topbar height mismatch token=${homeMetrics.tokenH} tool=${layout.topbarH}`
      );
    }
  }
  if (layout.leftRailHidden) throw new Error(`${accent}: left rail hidden in tool tab`);
  if (layout.leftRailW < 120 || layout.leftRailW > 150) {
    throw new Error(`${accent}: left rail width unexpected w=${layout.leftRailW}`);
  }
  if (!layout.mindBtnVisible) throw new Error(`${accent}: MindMenu button missing in tool tab left rail`);
  if (!layout.reservePresent) throw new Error(`${accent}: right reserve column missing`);
  if (!layout.accordionHidden) throw new Error(`${accent}: right rail visible in tool tab`);
  if (layout.stageTop < layout.spacerH - 4) {
    throw new Error(`${accent}: center stage under topbar overlap stageTop=${layout.stageTop} spacer=${layout.spacerH}`);
  }
  if (layout.closeCount > 0) {
    throw new Error(`${accent}: tool tab must not show ZavĹ™Ă­t controls count=${layout.closeCount}`);
  }
  if (layout.stageWidth > 600) {
    throw new Error(`${accent}: center stage wider than 600px w=${layout.stageWidth}`);
  }
  if (layout.railStageGap < 8 || layout.railStageGap > 40) {
    throw new Error(`${accent}: rail/stage gap unexpected gap=${layout.railStageGap}`);
  }
  if (layout.stageRight < 80) {
    throw new Error(`${accent}: missing free right reserve right=${layout.stageRight}`);
  }
  if (!layout.stageMaxWidth.includes("600")) {
    throw new Error(`${accent}: center stage max-width expected 600px got=${layout.stageMaxWidth}`);
  }

  const toolMetrics = await readToolRailMetrics(toolTab);
  if (homeMetrics) assertNavParity(homeMetrics, toolMetrics, accent);
  if (toolMetrics.docScrollH <= toolMetrics.viewportH + 40) {
    throw new Error(`${accent}: document should exceed viewport for scroll test h=${toolMetrics.docScrollH} vh=${toolMetrics.viewportH}`);
  }
}

async function openLeftRailToolTab(page, accent, homeMetrics) {
  const sel = `#iuLeftRail a[data-accent="${accent}"]`;
  await page.waitForSelector(sel, { timeout: 60000 });
  const tabPromise = page.context().waitForEvent("page", { timeout: SETTLE_MS });
  await page.locator(sel).click({ force: true, timeout: 60000 });
  const toolTab = await tabPromise;
  await toolTab.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => {});
  await assertToolTabLayout(toolTab, accent, homeMetrics);
  return toolTab;
}

async function testExternalLinkInToolTab(page, button, homeMetrics) {
  if (!button.externalLink) return;
  const toolTab = await openLeftRailToolTab(page, button.accent, homeMetrics);
  await toolTab.waitForSelector(button.externalLink, { timeout: SETTLE_MS });
  const extPromise = page.context().waitForEvent("page", { timeout: SETTLE_MS });
  await toolTab.locator(button.externalLink).first().click({ timeout: 60000 });
  const extTab = await extPromise;
  await extTab.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => {});
  const extUrl = extTab.url();
  if (!/google\.com\/maps/i.test(extUrl)) {
    throw new Error(`${button.accent}: external tab URL unexpected (${extUrl})`);
  }
  await extTab.close();
  await toolTab.close();
  await page.waitForTimeout(120);
}

async function testButtonCycle(page, button, cycleIndex, homeMetrics) {
  await scrollParentForCycle(page, cycleIndex);
  const before = await page.evaluate(() => ({
    href: location.href,
    sec: String(document.body?.dataset?.section || "").toLowerCase(),
    scrollY: (function () {
      try {
        if (typeof window.iuGetMainScrollTop === "function") return window.iuGetMainScrollTop();
      } catch (_) {}
      return Math.max(0, window.scrollY || 0, document.documentElement.scrollTop || 0);
    })(),
  }));
  const scrollBefore = before.scrollY;

  const sel = `#iuLeftRail a[data-accent="${button.accent}"]`;
  await page.waitForSelector(sel, { timeout: 60000 });

  const tabPromise = page.context().waitForEvent("page", { timeout: SETTLE_MS });
  await page.locator(sel).click({ force: true, timeout: 60000 });
  const toolTab = await tabPromise;

  await toolTab.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => {});
  await assertToolTabLayout(toolTab, button.accent, homeMetrics);

  if (cycleIndex === 2) {
    await toolTab.evaluate(() => {
      try {
        var btn = document.querySelector("#topbarWrap .iuBrand");
        if (btn) btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      } catch (_) {}
    });
  }

  await toolTab.close();
  await page.waitForTimeout(120);
  await page.evaluate((y) => {
    try {
      window.scrollTo(0, y);
      document.documentElement.scrollTop = y;
      if (document.body) document.body.scrollTop = y;
    } catch (_) {}
  }, scrollBefore);

  const after = await page.evaluate(() => ({
    href: location.href,
    sec: String(document.body?.dataset?.section || "").toLowerCase(),
  }));
  const scrollAfter = await readScrollY(page);

  if (after.href !== before.href) {
    throw new Error(`${button.accent} cycle ${cycleIndex + 1}: parent URL changed`);
  }
  if (after.sec !== before.sec) {
    throw new Error(`${button.accent} cycle ${cycleIndex + 1}: parent data-section changed ${before.sec}->${after.sec}`);
  }
  if (Math.abs(scrollAfter - scrollBefore) > RESTORE_TOL_PX) {
    throw new Error(
      `${button.accent} cycle ${cycleIndex + 1}: scroll drift ${scrollBefore}->${scrollAfter}`
    );
  }
}

async function assertHomepageUnchanged(page) {
  const home = await page.evaluate(() => {
    var mindInRail = !!document.querySelector("#iuLeftRail #iuToolWindowMindMenuBtn");
    var centerMindBtn = !!document.getElementById("iuMyInfoUzelOpenBtn");
    var rail = document.getElementById("iuLeftRail");
    var railRect = rail ? rail.getBoundingClientRect() : null;
    return {
      mindInRail: mindInRail,
      centerMindBtn: centerMindBtn,
      leftRailW: railRect ? Math.round(railRect.width) : 0,
      toolWindowFlag: document.documentElement.getAttribute("data-iu-tool-window") === "1",
    };
  });
  if (home.toolWindowFlag) throw new Error("homepage must not be tool window");
  if (home.mindInRail) throw new Error("homepage left rail must not contain tool MindMenu button");
  if (home.leftRailW < 120 || home.leftRailW > 150) {
    throw new Error(`homepage left rail width unexpected w=${home.leftRailW}`);
  }
}

async function testChainTabsFromToolWindow(page, homeMetrics) {
  const pocasiTab = await openLeftRailToolTab(page, "pocasi", homeMetrics);
  const tvPromise = pocasiTab.context().waitForEvent("page", { timeout: SETTLE_MS });
  await pocasiTab.locator('#iuLeftRail a[data-accent="tvprogram"]').click({ force: true, timeout: 60000 });
  const tvTab = await tvPromise;
  await tvTab.waitForLoadState("domcontentloaded", { timeout: SETTLE_MS }).catch(() => {});
  await assertToolTabLayout(tvTab, "tvprogram", homeMetrics);
  await tvTab.close();
  await pocasiTab.close();
  await page.waitForTimeout(120);
}

async function testMindMenuInToolWindow(page, homeMetrics) {
  const toolTab = await openLeftRailToolTab(page, "mapy", homeMetrics);
  await toolTab.waitForSelector("#iuToolWindowMindMenuBtn", { timeout: SETTLE_MS });
  await toolTab.locator("#iuToolWindowMindMenuBtn").click({ force: true, timeout: 60000 });
  await toolTab.waitForFunction(
    () => {
      var overlay = document.getElementById("iuMyInfoUzelOverlay");
      return !!overlay && overlay.hidden === false && document.body.classList.contains("iu-myinfouzel-open");
    },
    { timeout: SETTLE_MS }
  );
  await toolTab.locator(".iuMyInfoUzelOverlay__close").click({ force: true, timeout: 60000 });
  await toolTab.waitForFunction(
    () => {
      var overlay = document.getElementById("iuMyInfoUzelOverlay");
      return !overlay || overlay.hidden === true;
    },
    { timeout: SETTLE_MS }
  );
  await toolTab.close();
  await page.waitForTimeout(120);
}

async function main() {
  exitIfMediaArticlesGuardsSkipped("iu-desktop-left-rail-new-window-guard-v1");
  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    const serverScript = path.join(REPO, "server", "projects-static.mjs");
    serverProc = spawn(process.execPath, [serverScript], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let serverErr = "";
    serverProc.stderr.on("data", (c) => {
      serverErr += String(c);
    });
    serverProc.on("exit", (code) => {
      if (code && code !== 0 && !serverErr) serverErr = `static server exit ${code}`;
    });
    try {
      await waitForPort("127.0.0.1", PORT, 90000);
    } catch (err) {
      if (serverErr) console.error(serverErr.trim());
      throw err;
    }
  }

  const ignorable = createIgnorableResourceTracker();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await installProofGuardNetworkStubs(context, ignorable);
  await installLocalDataProtectionAccepted(context);
  const page = await context.newPage();

  const failures = [];
  const passes = [];
  let inventory = [];
  const staticFails = auditStaticOpenImplementation();
  if (staticFails.length) failures.push(...staticFails.map((f) => "static: " + f));

  try {
    await ensureParentReady(page);
    await assertHomepageUnchanged(page);
    passes.push("homepage unchanged");
    const homeMetrics = await readHomeNavMetrics(page);
    passes.push("home nav metrics");
    inventory = await discoverLeftRailButtons(page);

    for (const button of inventory) {
      for (let c = 0; c < CYCLES_PER_BUTTON; c++) {
        const tag = `${button.accent} cycle ${c + 1}/${CYCLES_PER_BUTTON}`;
        try {
          await testButtonCycle(page, button, c, homeMetrics);
          passes.push(tag);
        } catch (err) {
          failures.push(`${tag}: ${err && err.message ? err.message : String(err)}`);
        }
      }
    }

    const mapyBtn = inventory.find((b) => b.accent === "mapy") || { accent: "mapy", externalLink: STATIC_TOOLS.find((t) => t.accent === "mapy")?.externalLink };
    if (mapyBtn) {
      try {
        await testExternalLinkInToolTab(page, {
          accent: "mapy",
          externalLink: 'a.iuRadioChip[href*="google.com/maps"]',
        }, homeMetrics);
        passes.push("mapy external link tab");
      } catch (err) {
        failures.push(`mapy external link tab: ${err && err.message ? err.message : String(err)}`);
      }
    }

    try {
      await testChainTabsFromToolWindow(page, homeMetrics);
      passes.push("chain tabs from tool window");
    } catch (err) {
      failures.push(`chain tabs from tool window: ${err && err.message ? err.message : String(err)}`);
    }

    try {
      await testMindMenuInToolWindow(page, homeMetrics);
      passes.push("mindmenu in tool window");
    } catch (err) {
      failures.push(`mindmenu in tool window: ${err && err.message ? err.message : String(err)}`);
    }
  } finally {
    await browser.close().catch(() => {});
    if (serverProc) serverProc.kill("SIGTERM");
  }

  const staticOk = STATIC_TOOLS.every((t) => inventory.some((b) => b.accent === t.accent));
  console.log(
    JSON.stringify(
      {
        pass: failures.length === 0 && staticOk,
        base: BASE,
        inventoryCount: inventory.length,
        inventory: inventory.map((b) => ({ accent: b.accent, label: b.label })),
        staticToolsPresent: staticOk,
        cyclesPerButton: CYCLES_PER_BUTTON,
        passes: passes.length,
        failures,
      },
      null,
      2
    )
  );
  process.exit(failures.length === 0 && staticOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
