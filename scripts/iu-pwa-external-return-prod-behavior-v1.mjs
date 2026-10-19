#!/usr/bin/env node
/**
 * Production: delivery proof + external-return behavioral scenarios (home / menu / MindMenu).
 */
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateExternalReturnProdDelivery,
  aggregateReturnScenariosPass,
  formatDeliveryLogLines,
  buildNetworkScriptUrl,
} from "./iu-pwa-external-return-prod-delivery-v1.mjs";

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

async function runDesktopLayoutAudit(page) {
  await page.goto(ORIGIN + "/?nosw=1", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page
    .waitForFunction(
      () => {
        const feed = document.getElementById("feed");
        if (!feed) return false;
        if (feed.getAttribute("data-feed-ready") === "1") return true;
        return feed.querySelector("a[href]") != null;
      },
      null,
      { timeout: 90000 }
    )
    .catch(() => {});
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureFeedPipeline === "function") {
      try {
        await window.__iuEnsureFeedPipeline();
      } catch (_) {}
    }
  });
  await page.waitForTimeout(2500);
  return page.evaluate(async () => {
    const cls = { sum: 0 };
    try {
      if (window.PerformanceObserver) {
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (!e.hadRecentInput) cls.sum += e.value;
          }
        });
        if (po.supportedEntryTypes && po.supportedEntryTypes.indexOf("layout-shift") !== -1) {
          po.observe({ type: "layout-shift", buffered: true });
          await new Promise((r) => setTimeout(r, 1200));
          po.disconnect();
        }
      }
    } catch (_) {}
    const docEl = document.documentElement;
    const overflowX = docEl.scrollWidth > docEl.clientWidth + 2;
    const feed = document.getElementById("feed");
    const mainCol = document.querySelector(".layout .mainCol") || document.querySelector(".mainCol");
    const layout = document.querySelector(".layout");
    const asideCols = document.querySelectorAll(".layout > aside.accordionCol");
    const desktopMq = window.matchMedia && window.matchMedia("(min-width: 901px)").matches;
    const rightAside = asideCols[0] || null;
    const silverSticky = document.getElementById("iuSilverWelcomeSticky");
    const silverCard = document.getElementById("iuSilverWelcomeCard");
    const affButtons = document.querySelectorAll(
      "[data-iu-affiliate], .iuAffiliateBtn, a[data-iu-aff-href], .iuHomeAffiliateModule a[href]"
    );
    const affModule = document.querySelector(".iuHomeAffiliateModule, [data-iu-home-affiliate-module]");
    const title = document.title || "";
    const metaDesc = (document.querySelector('meta[name="description"]') || {}).content || "";
    return {
      buildId: window.iuNetwork && window.iuNetwork.pwaExternalReturnBuildId,
      overflowX,
      clsSum: Math.round(cls.sum * 10000) / 10000,
      desktopMq,
      mainColWidth: mainCol ? Math.round(mainCol.getBoundingClientRect().width) : 0,
      hasMainCol: !!(mainCol && mainCol.getBoundingClientRect().width > 280),
      hasRightAside: !!(rightAside && rightAside.getBoundingClientRect().width > 200),
      feedReady: feed ? feed.getAttribute("data-feed-ready") === "1" : false,
      feedLinkCount: feed ? feed.querySelectorAll("a[href]").length : 0,
      hasFeed: !!(
        feed &&
        feed.getBoundingClientRect().width > 120 &&
        (feed.getAttribute("data-feed-ready") === "1" || feed.querySelectorAll("a[href]").length > 0)
      ),
      layoutCols: asideCols.length,
      layoutWidth: layout ? layout.getBoundingClientRect().width : 0,
      silverVisible: !!(
        (silverSticky && silverSticky.getBoundingClientRect().height > 8) ||
        (silverCard && silverCard.getBoundingClientRect().height > 8)
      ),
      affiliateBtnCount: affButtons.length,
      hasAffiliateModule: !!affModule,
      titleLen: title.length,
      metaDescLen: metaDesc.length,
    };
  });
}

async function main() {
  const pinBuildId = (process.env.IU_PWA_DELIVERY_PIN_BUILD_ID || "").trim();
  const root = await fetchText(ORIGIN + "/");
  const netMatch = root.text.match(/iu-network-connectivity-v1\.js\?v=([^"']+)/);
  const netUrl = buildNetworkScriptUrl(ORIGIN, netMatch ? netMatch[1] : "");
  const netJs = await fetchText(netUrl);
  let deliveryEval = evaluateExternalReturnProdDelivery({
    rootStatus: root.status,
    rootHtml: root.text,
    netJsStatus: netJs.status,
    netJsText: netJs.text,
    options: pinBuildId ? { pinBuildId } : {},
  });
  for (const line of formatDeliveryLogLines(deliveryEval, { rootUrl: root.url, netUrl })) {
    console.log(line);
  }
  console.log("DELIVERY_HAS_DIAG_PANEL=" + (/enableExternalReturnDiagPanel/.test(netJs.text) ? "yes" : "no"));

  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const viewports = [
    { tag: "MOBILE", width: 390, height: 844, mobile: true },
    { tag: "TABLET", width: 768, height: 900, mobile: true },
    { tag: "PC", width: 1440, height: 900, mobile: false },
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
      const desk = await runDesktopLayoutAudit(page);
      const deskPass =
        !!desk.buildId &&
        desk.desktopMq === true &&
        desk.hasRightAside &&
        desk.layoutWidth >= 900 &&
        desk.silverVisible &&
        !desk.overflowX &&
        desk.clsSum === 0 &&
        desk.titleLen > 5;
      console.log(
        "DESKTOP_FEED_IN_HARNESS=" + (desk.hasFeed ? "verified" : "unverified_feed_pipeline_not_settled_in_headless")
      );
      console.log(
        "DESKTOP_AFFILIATE_IN_HARNESS=" +
          (desk.affiliateBtnCount > 0 || desk.hasAffiliateModule ? "verified" : "unverified_lazy_or_below_fold")
      );
      scenarioResults[vp.tag] = { desktop: desk, pass: deskPass };
      console.log("SCENARIO_PC_DESKTOP=" + JSON.stringify(desk));
      console.log("SCENARIO_PC_DESKTOP_PASS=" + deskPass);
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
  console.log(
    "INSTALLED_PWA_REASON=headless_chromium_cannot_install_standalone_pwa_manifest_on_windows_ci_agent"
  );
  const mobile = scenarioResults.MOBILE || {};
  const behPass = aggregateReturnScenariosPass(mobile);
  const tablet = scenarioResults.TABLET || {};
  const tabletPass = aggregateReturnScenariosPass(tablet);
  const pc = scenarioResults.PC || {};
  const runtimeBoot =
    (mobile.mind && mobile.mind.buildId) ||
    (pc.desktop && pc.desktop.buildId) ||
    "";
  if (runtimeBoot) {
    deliveryEval = evaluateExternalReturnProdDelivery({
      rootStatus: root.status,
      rootHtml: root.text,
      netJsStatus: netJs.status,
      netJsText: netJs.text,
      runtimeBootBuildId: runtimeBoot,
      options: pinBuildId ? { pinBuildId } : {},
    });
    console.log("DELIVERY_RUNTIME_BOOT_BUILD=" + runtimeBoot);
    console.log("DELIVERY_RUNTIME_ALIGNED=" + (deliveryEval.pass ? "yes" : "no"));
  }
  const delPass = deliveryEval.pass;
  const desktopPass = pc.pass === true;
  console.log("IU_PWA_PROD_TABLET_RETURN_SCENARIOS_PASS=" + tabletPass);
  console.log("IU_PWA_PROD_DESKTOP_LAYOUT_PASS=" + desktopPass);
  console.log("IU_PWA_PROD_DELIVERY_PASS=" + delPass);
  console.log("IU_PWA_PROD_RETURN_SCENARIOS_PASS=" + behPass);
  if (!delPass || !behPass || !tabletPass || !desktopPass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
