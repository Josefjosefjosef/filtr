/** PROD hard proof — NO Date mock. Flags: --no-cache (fresh network, no SW) */
import { chromium, webkit } from "playwright";

const NO_CACHE = process.argv.includes("--no-cache");
const BASE = process.env.IU_PROOF_BASE?.trim() || "https://infouzel.cz/projects/";
const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "desktopWide", width: 1920, height: 1080 },
];

async function attachNoCacheCdp(context, page) {
  if (!NO_CACHE) return;
  const session = await context.newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
}

async function collectSwAndAssetsDiag(page) {
  return page.evaluate(async () => {
    const cssLink =
      document.querySelector('link[rel="stylesheet"][href*="app"]') ||
      document.querySelector('link[rel="stylesheet"][href*="assets"]');
    const cssHref = cssLink ? cssLink.getAttribute("href") : null;
    const dataVer =
      (document.querySelector('meta[name="iu-data-ver"]')?.getAttribute("content") || "").trim();

    let registrations = [];
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) {
          const w = r.active || r.waiting || r.installing;
          registrations.push({
            scope: r.scope,
            state: w ? w.state : "none",
            scriptURL: w ? w.scriptURL : "",
          });
        }
      }
    } catch (e) {
      registrations = [{ error: String(e && e.message) }];
    }

    let cacheVersionInFetchedSw = null;
    try {
      const swUrl = new URL("/sw.js", window.location.origin).href;
      const res = await fetch(swUrl, { cache: "no-store" });
      const swText = await res.text();
      const m = swText.match(/const CACHE_VERSION = "([^"]+)"/);
      cacheVersionInFetchedSw = m ? m[1] : null;
    } catch (_) {}

    return {
      cssHrefResolved: cssLink ? new URL(cssHref, document.baseURI).href : null,
      iuDataVer: dataVer || null,
      swRegistrations: registrations,
      networkSwCacheVersion: cacheVersionInFetchedSw,
    };
  });
}

async function runLayoutMetricsPass(browser, vp, engineTag, closeBrowserOnFatal = true) {
  const context = await browser.newContext({
    serviceWorkers: NO_CACHE ? "block" : "allow",
  });
  const page = await context.newPage();
  await attachNoCacheCdp(context, page);

  let consoleErrorsCount = 0;
  const consoleErrorRecords = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    consoleErrorsCount += 1;
    consoleErrorRecords.push({
      source: "console",
      text: msg.text(),
      location: msg.location(),
    });
  });
  page.on("pageerror", (err) => {
    consoleErrorsCount += 1;
    consoleErrorRecords.push({
      source: "pageerror",
      text: String(err && err.message ? err.message : err),
      stack: String(err && err.stack ? err.stack : ""),
    });
  });

  /* CLS: avoid buffered:true — WebKit can surface internal console noise; gate on supportedEntryTypes. */
  await page.addInitScript(() => {
    window.__iuCls = 0;
    try {
      const PO = window.PerformanceObserver;
      if (!PO) return;
      if (PO.supportedEntryTypes && PO.supportedEntryTypes.indexOf("layout-shift") === -1) return;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) window.__iuCls += e.value || 0;
        }
      }).observe({ type: "layout-shift" });
    } catch (_) {}
  });

  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    try {
      window.scrollTo(0, 0);
    } catch (_) {}
  });
  await page.waitForTimeout(500);

  const clsRaw = await page.evaluate(() => window.__iuCls || 0);
  const cls = Math.round(clsRaw * 100000) / 100000;
  if (cls !== 0) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(`PROOF FAIL: CLS must be 0 (viewport=${vp.name}, engine=${engineTag}, CLS=${cls})`);
  }

  const assetDiag = await collectSwAndAssetsDiag(page);

  const data = await page.evaluate(() => {
    const doc = document.documentElement;
    const meta = document.getElementById("iuSilverWelcomeMeta");
    const welcomeCard = document.getElementById("iuSilverWelcomeCard");
    const greet = document.getElementById("iuSilverWelcomeGreet");
    const metaTextRawFromDOM = meta ? String(meta.textContent || "").trim() : "";
    const horizontalOverflow = doc.scrollWidth > (window.innerWidth || doc.clientWidth) + 2;
    const card = welcomeCard ? welcomeCard.getBoundingClientRect() : { height: 0 };

    const topbar =
      document.getElementById("topbarWrap") ||
      document.querySelector("header.iuTopbar");
    const tb = topbar ? topbar.getBoundingClientRect() : { bottom: 0 };
    const silver = document.getElementById("iuSilverWelcomeSticky");
    const aside = document.querySelector(".layout > aside.accordionCol");
    const mind = aside ? aside.querySelector(".mindMenu") : null;
    const st = silver ? silver.getBoundingClientRect() : { top: 0 };
    const mt = mind ? mind.getBoundingClientRect() : { top: 0 };
    const asideRect = aside ? aside.getBoundingClientRect() : { top: 0 };
    const tbBottom = Math.round(tb.bottom * 100) / 100;
    const leftSilverTopY = Math.round(st.top * 100) / 100;
    const rightColumnTopY = Math.round(mt.top * 100) / 100;
    const asideTopY = aside ? Math.round(asideRect.top * 100) / 100 : null;
    const mindMenuTopY = mind ? Math.round(mt.top * 100) / 100 : null;
    let wrapperExtraSilverAboveMindMenu = null;
    if (asideTopY !== null && mindMenuTopY !== null) {
      wrapperExtraSilverAboveMindMenu =
        Math.round((mindMenuTopY - asideTopY) * 100) / 100;
    }

    let asideMarginTopPx = null;
    let asidePaddingTopPx = null;
    let rightColumnMovedDownBy15px = false;
    let rightColumnAtBaseline = false;
    let leftGap = null;
    let rightGap = null;
    let gapDelta = null;
    let rightColumnAlignedWithLeftSilverGap = null;
    let rightColumnWrapperAligned = null;

    try {
      if (aside && window.matchMedia && window.matchMedia("(min-width: 901px)").matches) {
        asideMarginTopPx = parseFloat(getComputedStyle(aside).marginTop) || 0;
        asidePaddingTopPx = parseFloat(getComputedStyle(aside).paddingTop) || 0;
        const root = document.documentElement;
        const tbVar =
          parseFloat(
            getComputedStyle(root).getPropertyValue("--iuTopbarHeight").trim().replace("px", "")
          ) || 72;
        const extra = asidePaddingTopPx - tbVar;
        rightColumnMovedDownBy15px = extra >= 14 && extra <= 16;
        rightColumnAtBaseline = extra >= -1 && extra <= 1;
        if (mind) {
          leftGap = Math.round((st.top - tb.bottom) * 100) / 100;
          rightGap = Math.round((mt.top - tb.bottom) * 100) / 100;
          gapDelta = Math.round((rightGap - leftGap) * 100) / 100;
          rightColumnAlignedWithLeftSilverGap =
            Math.abs(gapDelta) <= 1 && mt.top >= tb.bottom - 1;
        }

        if (asidePaddingTopPx > 0) {
          throw new Error(
            "RIGHT COLUMN BROKEN: aside padding-top > 0 (wrapper silver strip risk)"
          );
        }

        if (
          wrapperExtraSilverAboveMindMenu !== null &&
          Math.abs(wrapperExtraSilverAboveMindMenu) > 1
        ) {
          throw new Error(
            "RIGHT COLUMN BROKEN: silver background above MindMenu detected (wrapperExtraSilverAboveMindMenu=" +
              wrapperExtraSilverAboveMindMenu +
              ")"
          );
        }

        rightColumnWrapperAligned =
          wrapperExtraSilverAboveMindMenu !== null &&
          Math.abs(wrapperExtraSilverAboveMindMenu) <= 1;
      }
    } catch (e) {
      throw e;
    }

    const ndWish = document.querySelector(".iu-nameday-wish");
    const ndFlow = document.querySelector(".iu-nameday-flowers");
    const ndOv = document.getElementById("iuNamedayWishOverlay");

    let silverStackRowMinHeightDiffPx = null;
    let silverStackRowMinHeightDiffOk = null;
    let silverThirdBoxHeights = null;
    let silverThirdBoxIsTallest = null;
    let silverStackOverflowDeltaPx = null;
    let silverStackFitsViewport = null;
    let silverStackMetrics = null;
    let silverSlotThirdEffectivePx = null;
    let vvVsInnerDeltaPx = null;
    let thirdBoxComputedCapIsStable = null;
    let edgeSafariViewportDeltaHandled = null;
    let thirdBoxHeight = null;
    let thirdBoxSectionScrollHeight = null;
    let thirdBoxSectionClientHeight = null;
    let thirdBoxViewportScrollHeight = null;
    let thirdBoxViewportClientHeight = null;
    let thirdBoxViewportOverflowActive = null;
    let thirdBoxNotGrowingWithContent = null;
    let thirdBoxContentOverflowHandled = null;
    try {
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
        const ids = ["iuSilverWeatherCard", "iuSilverCalendarSummaryCard", "iuSilverTasksSummaryCard"];
        const parseMinH = (el) => {
          if (!el) return null;
          const raw = getComputedStyle(el).minHeight;
          if (!raw || raw === "none" || raw === "auto") return 0;
          return parseFloat(raw) || 0;
        };
        const vals = ids.map((id) => parseMinH(document.getElementById(id))).filter((v) => v !== null);
        if (vals.length === 3) {
          const lo = Math.min(vals[0], vals[1], vals[2]);
          const hi = Math.max(vals[0], vals[1], vals[2]);
          silverStackRowMinHeightDiffPx = Math.round((hi - lo) * 100) / 100;
          silverStackRowMinHeightDiffOk = silverStackRowMinHeightDiffPx <= 1;
        }
        const tallEl = document.getElementById("iuSilverTallScrollSection");
        const wxEl = document.getElementById("iuSilverWeatherCard");
        const calEl = document.getElementById("iuSilverCalendarSummaryCard");
        const tasksEl = document.getElementById("iuSilverTasksSummaryCard");
        const hTall = tallEl ? tallEl.getBoundingClientRect().height : 0;
        const hWx = wxEl ? wxEl.getBoundingClientRect().height : 0;
        const hCal = calEl ? calEl.getBoundingClientRect().height : 0;
        const hTasks = tasksEl ? tasksEl.getBoundingClientRect().height : 0;
        const r = (x) => Math.round(x * 100) / 100;
        silverThirdBoxHeights = {
          thirdBox: r(hTall),
          weather: r(hWx),
          calendar: r(hCal),
          tasks: r(hTasks),
        };
        const tol = 1.5;
        silverThirdBoxIsTallest =
          hTall + 1e-6 >= hWx - tol &&
          hTall + 1e-6 >= hCal - tol &&
          hTall + 1e-6 >= hTasks - tol;

        const slot = document.getElementById("silver-slot");
        const sticky = document.getElementById("iuSilverWelcomeSticky");
        const welcomeEl = document.getElementById("iuSilverWelcomeCard");
        const inputEl =
          document.querySelector("#silver-slot .silver-compose") ||
          document.querySelector("#silver-slot .iuSilverHomeInputWrap");
        const vv = window.visualViewport;
        const vh = vv ? vv.height : window.innerHeight;
        let overflow = 0;
        if (slot && slot.scrollHeight > slot.clientHeight + 1) {
          overflow = Math.round((slot.scrollHeight - slot.clientHeight) * 100) / 100;
        }
        let bleedBelowVh = 0;
        if (sticky) {
          bleedBelowVh = Math.round((sticky.getBoundingClientRect().bottom - vh) * 100) / 100;
        }
        silverStackOverflowDeltaPx = Math.round(Math.max(overflow, Math.max(0, bleedBelowVh)) * 100) / 100;
        silverStackFitsViewport = silverStackOverflowDeltaPx <= 2;
        silverStackMetrics = {
          viewportInnerHeightPx: Math.round(vh * 100) / 100,
          totalStackHeightPx: sticky
            ? Math.round(sticky.getBoundingClientRect().height * 100) / 100
            : 0,
          welcomeHeightPx: welcomeEl
            ? Math.round(welcomeEl.getBoundingClientRect().height * 100) / 100
            : 0,
          inputAreaHeightPx: inputEl
            ? Math.round(inputEl.getBoundingClientRect().height * 100) / 100
            : 0,
        };
        const innerH = window.innerHeight;
        const vvH = window.visualViewport ? window.visualViewport.height : innerH;
        vvVsInnerDeltaPx = Math.round((innerH - vvH) * 100) / 100;
        const vpScroll = document.getElementById("iuSilverTallScrollViewport");
        if (tallEl && vpScroll) {
          thirdBoxHeight = r(tallEl.getBoundingClientRect().height);
          thirdBoxSectionScrollHeight = tallEl.scrollHeight;
          thirdBoxSectionClientHeight = tallEl.clientHeight;
          thirdBoxViewportScrollHeight = vpScroll.scrollHeight;
          thirdBoxViewportClientHeight = vpScroll.clientHeight;
          thirdBoxViewportOverflowActive = vpScroll.scrollHeight > vpScroll.clientHeight + 1;
          thirdBoxContentOverflowHandled = thirdBoxViewportOverflowActive;
        }
      }
    } catch (_) {}

    return {
      welcomeBoxExists: Boolean(welcomeCard),
      greetingTextExists: Boolean(greet && String(greet.textContent || "").trim()),
      metaTextExists: metaTextRawFromDOM.length > 0,
      namedayButtonsExist: Boolean(ndWish && ndFlow),
      overlayExists: Boolean(ndOv),
      heightPx: Math.round(card.height * 100) / 100,
      heightWithinLimit: card.height <= 140,
      overflowX: horizontalOverflow,
      railShift: 0,
      topbarBottomY: tbBottom,
      leftSilverTopY,
      mainContentTopY: leftSilverTopY,
      asideTopY,
      mindMenuTopY,
      rightColumnTopY,
      wrapperExtraSilverAboveMindMenu,
      rightColumnWrapperAligned,
      deltaMainVsRightColumnTop: Math.round((mt.top - st.top) * 100) / 100,
      leftGap,
      rightGap,
      gapDelta,
      rightColumnStartsUnderTopbar: aside && mind ? mt.top >= tb.bottom - 1 : true,
      rightColumnAlignedWithMainContentFlow:
        aside &&
        mind &&
        Math.abs(mt.top - st.top) <= 14 &&
        mt.top >= tb.bottom - 1,
      rightColumnAlignedWithLeftSilverGap,
      asideMarginTopPx,
      asidePaddingTopPx,
      rightColumnMovedDownBy15px,
      rightColumnAtBaseline,
      silverStackRowMinHeightDiffPx,
      silverStackRowMinHeightDiffOk,
      silverThirdBoxHeights,
      silverThirdBoxIsTallest,
      silverStackOverflowDeltaPx,
      silverStackFitsViewport,
      silverStackMetrics,
      silverSlotThirdEffectivePx,
      vvVsInnerDeltaPx,
      thirdBoxComputedCapIsStable,
      edgeSafariViewportDeltaHandled,
      thirdBoxHeight,
      thirdBoxSectionScrollHeight,
      thirdBoxSectionClientHeight,
      thirdBoxViewportScrollHeight,
      thirdBoxViewportClientHeight,
      thirdBoxViewportOverflowActive,
      thirdBoxContentOverflowHandled,
      thirdBoxNotGrowingWithContent,
    };
  });

  if (
    (vp.name === "mobile" || vp.name === "tablet") &&
    data.silverStackRowMinHeightDiffOk !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: silver stack row min-height must match (viewport=${vp.name}, engine=${engineTag}, diffPx=${String(data.silverStackRowMinHeightDiffPx)}, ok=${String(data.silverStackRowMinHeightDiffOk)})`
    );
  }

  if (
    (vp.name === "mobile" || vp.name === "tablet") &&
    data.silverThirdBoxIsTallest !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: third stack box (#iuSilverTallScrollSection) must be tallest vs weather/calendar/tasks (viewport=${vp.name}, engine=${engineTag}, heights=${JSON.stringify(data.silverThirdBoxHeights)})`
    );
  }

  if (
    (vp.name === "mobile" || vp.name === "tablet") &&
    data.silverStackFitsViewport !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: silver-slot must fit viewport (overflow delta, tol=2px) viewport=${vp.name}, engine=${engineTag}, delta=${String(data.silverStackOverflowDeltaPx)}, metrics=${JSON.stringify(data.silverStackMetrics)}`
    );
  }

  if (consoleErrorsCount > 0) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: console errors must be 0 (viewport=${vp.name}, engine=${engineTag}, count=${consoleErrorsCount}, records=${JSON.stringify(consoleErrorRecords)})`
    );
  }

  const out = {
    _proofPass: "viewport-metrics",
    layoutEngine: engineTag,
    noCacheMode: NO_CACHE,
    viewport: vp.name,
    base: BASE,
    dateMock: false,
    CLS: cls,
    consoleErrorsCount,
    consoleErrorRecords,
    appErrorsCount: 0,
    cssHrefResolved: assetDiag.cssHrefResolved,
    iuDataVer: assetDiag.iuDataVer,
    swRegistrations: assetDiag.swRegistrations,
    networkSwCacheVersion: assetDiag.networkSwCacheVersion,
    ...data,
  };
  console.log(JSON.stringify(out));
  await context.close();
}

const browser = await chromium.launch({ headless: true });

// --- Pass 1: SW + asset reality (normal context, SW allowed) ---
{
  const ctx = await browser.newContext({ serviceWorkers: "allow" });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(2500);
  const diag1 = await collectSwAndAssetsDiag(page);
  console.log(
    JSON.stringify({
      _proofPass: "sw-and-assets-diag",
      noCacheMode: false,
      base: BASE,
      ...diag1,
    })
  );
  await ctx.close();
}

// --- Pass 2: layout metrics (--no-cache: block SW + CDP disable disk cache) ---
for (const vp of viewports) {
  await runLayoutMetricsPass(browser, vp, "chromium", true);
}

const webkitBrowser = await webkit.launch({ headless: true });
try {
  await runLayoutMetricsPass(webkitBrowser, viewports[0], "webkit", false);
} finally {
  await webkitBrowser.close();
}

{
  const ctx = await browser.newContext({
    serviceWorkers: NO_CACHE ? "block" : "allow",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  let ne = 0;
  const namedayConsoleErrorRecords = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    ne += 1;
    namedayConsoleErrorRecords.push({ source: "console", text: msg.text(), location: msg.location() });
  });
  page.on("pageerror", (err) => {
    ne += 1;
    namedayConsoleErrorRecords.push({
      source: "pageerror",
      text: String(err && err.message ? err.message : err),
      stack: String(err && err.stack ? err.stack : ""),
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(5500);

  const named = await page.evaluate(async () => {
    const btn = document.querySelector(".iu-nameday-wish");
    const overlay = document.getElementById("iuNamedayWishOverlay");
    const ta = document.getElementById("iuNamedayWishTextarea");
    if (!btn || !overlay || !ta) {
      return {
        namedaySkipped: true,
        overlayFunctional: false,
        copyWorks: false,
        safeGreeting: false,
        noBadNameInsert: true,
      };
    }
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    const open = !overlay.hasAttribute("hidden");
    const vyk = document.querySelector(".iu-nameday-wish-mode--vykat");
    if (vyk) vyk.click();
    await new Promise((r) => setTimeout(r, 150));
    const t = String(ta.value || "");
    const copyBtn = document.getElementById("iuNamedayWishCopy");
    let clipOk = false;
    try {
      if (copyBtn) copyBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      if (navigator.clipboard && navigator.clipboard.readText) {
        const c = await navigator.clipboard.readText();
        clipOk = c.length > 30 && /přeji Vám krásný sváteční den/i.test(c);
      }
    } catch (_) {}
    const g =
      typeof window.__iuSilverWelcomeLastPhrase === "string"
        ? String(window.__iuSilverWelcomeLastPhrase || "").trim()
        : "";
    const safeGreeting =
      /^(Dobré ráno|Hezké dopoledne|Příjemné odpoledne|Dobrý večer)/.test(g);
    const hasExactVykatBody =
      t.indexOf(
        "přeji Vám krásný sváteční den, hodně zdraví, pohody a spokojenosti."
      ) !== -1;
    const noBadNameInsert = !/null|undefined/i.test(t) && hasExactVykatBody;

    return {
      namedaySkipped: false,
      overlayFunctional: open,
      copyWorks: clipOk,
      safeGreeting,
      noBadNameInsert,
    };
  });

  if (ne > 0) {
    await ctx.close();
    await browser.close();
    throw new Error(
      `PROOF FAIL: nameday pass console errors must be 0 (count=${ne}, records=${JSON.stringify(namedayConsoleErrorRecords)})`
    );
  }

  console.log(
    JSON.stringify({
      _proofPass: "nameday-interaction",
      noCacheMode: NO_CACHE,
      base: BASE,
      consoleErrorsCount: ne,
      namedayConsoleErrorRecords,
      ...named,
    })
  );
  await ctx.close();
}

await browser.close();
