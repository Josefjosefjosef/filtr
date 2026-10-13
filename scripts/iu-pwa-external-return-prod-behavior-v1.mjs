#!/usr/bin/env node
/**
 * Production: delivery proof + external-return behavioral scenarios (home / menu / MindMenu).
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const ORIGIN = "https://infouzel.cz";

async function fetchText(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "cache-control": "no-cache" } });
  return { status: res.status, url: res.url, text: await res.text() };
}

async function simulateReturn(page) {
  await page.evaluate(() => {
    if (window.iuNetwork && typeof window.iuNetwork.restoreAppShellAfterReturn === "function") {
      window.iuNetwork.restoreAppShellAfterReturn();
    }
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    window.dispatchEvent(new FocusEvent("focus"));
  });
  await page.waitForTimeout(400);
}

async function runScenarioHome(page) {
  await page.goto(ORIGIN + "/?nosw=1", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  const HOME_Y = 480;
  const r = await page.evaluate(async (targetY) => {
    const samples = [];
    const record = () => {
      samples.push(typeof window.iuPwaGetMainScrollY === "function" ? window.iuPwaGetMainScrollY() : window.scrollY || 0);
    };
    try {
      const lc = document.getElementById("leftContent");
      if (lc && lc.scrollHeight <= lc.clientHeight + targetY + 20) {
        const pad = document.createElement("div");
        pad.setAttribute("data-iu-prod-home-pad", "1");
        pad.style.height = String(targetY + 400) + "px";
        lc.appendChild(pad);
      }
    } catch (_) {}
    if (typeof window.iuPwaApplyMainScrollY === "function") window.iuPwaApplyMainScrollY(targetY);
    record();
    window.iuNetwork.openExternalSync("https://example.com/iu-prod-pwa-home-return");
    record();
    return { yBefore: samples[0], samplesLen: samples.length };
  }, HOME_Y);
  await simulateReturn(page);
  const after = await page.evaluate(() => ({
    finalY: typeof window.iuPwaGetMainScrollY === "function" ? window.iuPwaGetMainScrollY() : window.scrollY || 0,
    gate: (function () {
      const w = document.getElementById("iuMobileGateWrap");
      return w ? w.getAttribute("data-iu-mobile-gate") || "" : "";
    })(),
  }));
  const pass =
    r.yBefore >= HOME_Y * 0.35 &&
    after.finalY >= HOME_Y * 0.35 &&
    after.gate === "";
  return { pass, yBefore: r.yBefore, finalY: after.finalY, gate: after.gate };
}

async function runScenarioMenu(page) {
  await page.goto(ORIGIN + "/?nosw=1", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3500);
  const NAV_Y = 280;
  const r = await page.evaluate(async (y) => {
    if (typeof window.__iuEnsureFeedPipeline === "function") {
      try {
        await window.__iuEnsureFeedPipeline();
      } catch (_) {}
    }
    const wrap = document.getElementById("iuMobileGateWrap");
    if (wrap && typeof wrap.__iuMobileGateSetTab === "function") wrap.__iuMobileGateSetTab("nav");
    const panel = document.getElementById("iuMobileGatePanelNav");
    if (panel) panel.scrollTop = y;
    let link = document.getElementById("iu-prod-ext-menu-link");
    if (!link && panel) {
      link = document.createElement("a");
      link.id = "iu-prod-ext-menu-link";
      link.href = "https://example.com/iu-prod-pwa-menu-return";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "prod ext";
      panel.appendChild(link);
    }
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return {
      ext: sessionStorage.getItem("iu_external_nav_armed") || "",
      gate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
      menuY: sessionStorage.getItem("iuMenuNavPanelScrollY") || "",
    };
  }, NAV_Y);
  await simulateReturn(page);
  const after = await page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    const panel = document.getElementById("iuMobileGatePanelNav");
    return {
      gate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
      panelScroll: panel ? panel.scrollTop || 0 : -1,
      overlay: document.body.classList.contains("iu-mobileGateOverlayOpen"),
    };
  });
  const pass =
    r.ext === "1" &&
    after.gate === "nav" &&
    after.overlay === true &&
    (NAV_Y <= 40 || after.panelScroll >= Math.floor(NAV_Y * 0.4));
  return { pass, armed: r.ext, gate: after.gate, scroll: after.panelScroll };
}

async function runScenarioMindMenu(page) {
  await page.goto(ORIGIN + "/?nosw=1", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3500);
  const SCROLL = 360;
  const r = await page.evaluate(async (y) => {
    if (typeof window.__iuEnsureFeedPipeline === "function") {
      try {
        await window.__iuEnsureFeedPipeline();
      } catch (_) {}
    }
    const wrap = document.getElementById("iuMobileGateWrap");
    if (wrap && typeof wrap.__iuMobileGateSetTab === "function") wrap.__iuMobileGateSetTab("tools");
    const panel = document.getElementById("iuMobileGatePanelTools");
    if (panel) panel.scrollTop = y;
    if (typeof window.iuMindMenuArmReturnState === "function") window.iuMindMenuArmReturnState();
    window.iuNetwork.openExternalSync("https://example.com/iu-prod-pwa-mindmenu-return");
    const transitions = [];
    const feed = document.getElementById("feed");
    let feedPeekBefore = false;
    try {
      if (feed) {
        const st = getComputedStyle(feed);
        const rect = feed.getBoundingClientRect();
        feedPeekBefore = st.display !== "none" && rect.height > 20 && rect.top < 100;
      }
    } catch (_) {}
    return {
      pending: localStorage.getItem("iuMindMenuReturnPendingV1") ? "1" : "",
      gate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
      feedPeekBefore,
      transitions,
    };
  }, SCROLL);
  await simulateReturn(page);
  const after = await page.evaluate(() => {
    const wrap = document.getElementById("iuMobileGateWrap");
    const panel = document.getElementById("iuMobileGatePanelTools");
    const feed = document.getElementById("feed");
    let feedPeek = false;
    try {
      if (feed) {
        const st = getComputedStyle(feed);
        const rect = feed.getBoundingClientRect();
        feedPeek = st.display !== "none" && rect.height > 20 && rect.top < 100;
      }
    } catch (_) {}
    return {
      gate: wrap ? wrap.getAttribute("data-iu-mobile-gate") || "" : "",
      panelScroll: panel ? panel.scrollTop || 0 : -1,
      overlay: document.body.classList.contains("iu-mobileGateOverlayOpen"),
      feedPeek,
      buildId: window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId,
    };
  });
  const pass =
    r.pending === "1" &&
    after.gate === "tools" &&
    after.overlay === true &&
    after.feedPeek !== true &&
    (SCROLL <= 40 || after.panelScroll >= Math.floor(SCROLL * 0.4));
  return { pass, gate: after.gate, scroll: after.panelScroll, feedPeek: after.feedPeek, buildId: after.buildId };
}

async function main() {
  const root = await fetchText(ORIGIN + "/");
  const expectedBuild = "pwa-external-return-unified-v10-20261013-menu-section-back-flash";
  const tokenV5 = root.text.includes(expectedBuild);
  const netMatch = root.text.match(/iu-network-connectivity-v1\.js\?v=([^"']+)/);
  const netUrl = netMatch
    ? new URL("/assets/iu-network-connectivity-v1.js?v=" + netMatch[1], ORIGIN).href
    : ORIGIN + "/assets/iu-network-connectivity-v1.js";
  const netJs = await fetchText(netUrl);
  const buildMatch = netJs.text.match(/PWA_EXTERNAL_RETURN_BUILD_ID\s*=\s*"([^"]+)"/);
  console.log("DELIVERY_ROOT_URL=" + root.url);
  console.log("DELIVERY_TOKEN_V5=" + (tokenV5 ? "found" : "missing"));
  console.log("DELIVERY_NET_BUILD=" + (buildMatch ? buildMatch[1] : "MISSING"));
  console.log("DELIVERY_HAS_DIAG_PANEL=" + (/enableExternalReturnDiagPanel/.test(netJs.text) ? "yes" : "no"));

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { tag: "MOBILE", width: 390, height: 844, mobile: true },
    { tag: "TABLET", width: 768, height: 900, mobile: true },
    { tag: "PC", width: 1280, height: 800, mobile: false },
  ];
  const scenarioResults = {};
  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
    });
    const page = await ctx.newPage();
    if (vp.mobile) {
      const home = await runScenarioHome(page);
      const menu = await runScenarioMenu(page);
      const mind = await runScenarioMindMenu(page);
      scenarioResults[vp.tag] = { home, menu, mind };
      console.log("SCENARIO_" + vp.tag + "_HOME=" + JSON.stringify(home));
      console.log("SCENARIO_" + vp.tag + "_MENU=" + JSON.stringify(menu));
      console.log("SCENARIO_" + vp.tag + "_MINDMENU=" + JSON.stringify(mind));
    } else {
      await page.goto(ORIGIN + "/?nosw=1", { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(2000);
      const snap = await page.evaluate(() => ({
        buildId: window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId,
        title: document.title,
      }));
      scenarioResults[vp.tag] = { webRegression: snap, pass: !!snap.buildId };
      console.log("SCENARIO_PC_WEB=" + JSON.stringify(snap));
    }
    const diagPage = await ctx.newPage();
    await diagPage.goto(ORIGIN + "/?nosw=1", { waitUntil: "domcontentloaded", timeout: 120000 });
    await diagPage.waitForTimeout(1500);
    await diagPage.evaluate(() => {
      if (window.iuNetwork && typeof window.iuNetwork.enableExternalReturnDiagPanel === "function") {
        window.iuNetwork.enableExternalReturnDiagPanel();
      }
    });
    const diag = await diagPage.evaluate(() => ({
      panel: !!document.getElementById("iuPwaExternalReturnDiag"),
      buildId: window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId,
    }));
    console.log("DIAG_GESTURE_API_" + vp.tag + "=" + JSON.stringify(diag));
    await ctx.close();
  }
  await browser.close();

  console.log("INSTALLED_PWA=unverified");
  const mobile = scenarioResults.MOBILE || {};
  const behPass =
    mobile.home &&
    mobile.home.pass &&
    mobile.menu &&
    mobile.menu.pass &&
    mobile.mind &&
    mobile.mind.pass;
  const delPass = tokenV5 && buildMatch && buildMatch[1] === expectedBuild;
  console.log("IU_PWA_PROD_DELIVERY_PASS=" + delPass);
  console.log("IU_PWA_PROD_RETURN_SCENARIOS_PASS=" + behPass);
  if (!delPass || !behPass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
