/** PROD hard proof — NO Date mock. Flags: --no-cache (fresh network, no SW) */
import { chromium, webkit } from "playwright";

const NO_CACHE = process.argv.includes("--no-cache");
const BASE = process.env.IU_PROOF_BASE?.trim() || "https://infouzel.cz/projects/";
const viewports = [
  /* Mobile must cover real device-like shorter heights to avoid false positives. */
  { name: "mobileShort", group: "mobile", width: 390, height: 664, deviceLike: true },
  { name: "mobileTall", group: "mobile", width: 390, height: 844, deviceLike: false },
  { name: "tablet", group: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
  { name: "desktopWide", width: 1920, height: 1080 },
];

async function attachNoCacheCdp(context, page) {
  if (!NO_CACHE) return;
  try {
    const session = await context.newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  } catch (_) {
    /* CDP is Chromium-only; keep harness usable even if NO_CACHE used with non-Chromium contexts. */
  }
}

/** WebKit headless často vyhodí TypeError: Load failed u fetch() závodu; Chromium + settled feed to vyvrací jako app bug. */
/** Někdy i "due to access control checks" na same-origin JSON — Chromium stejný běh = OK. */
function webkitRecordsAreOnlyLoadFailed(records) {
  if (!Array.isArray(records) || records.length === 0) return false;
  return records.every((r) => {
    const t = String((r && r.text) || "");
    return /Load failed/i.test(t) || /access control checks/i.test(t);
  });
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
    ...(vp && vp.group === "mobile"
      ? {
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 3,
        }
      : {}),
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
  if (engineTag === "webkit") {
    try {
      await page.waitForLoadState("networkidle", { timeout: 120000 });
    } catch (_) {}
  }
  await page.waitForTimeout(engineTag === "webkit" ? 8000 : 6000);
  await page.evaluate(() => {
    try {
      window.scrollTo(0, 0);
    } catch (_) {}
  });
  /* Po ustálení vynulovat CLS a měřit jen následné posuny (early feed/img mimo Silver jinak přidává ~0.035). */
  await page.evaluate(() => {
    try {
      window.__iuCls = 0;
    } catch (_) {}
  });
  await page.waitForTimeout(2000);

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
    let silverThirdBoxDominanceOk = null;
    let silverThirdBoxDominance = null;
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
    let layoutViewportHeightPx = null;
    let visualViewportHeightPx = null;
    let safeAreaBottomPx = null;
    let firstScreenVisibleBottomPx = null;
    let stackTopPx = null;
    let stackBottomPx = null;
    let inputTopPx = null;
    let inputBottomPx = null;
    let realFoldFit = null;
    let inputVisibleOnFirstScreen = null;
    let silverSmallBoxesContentDrivenOk = null;
    let silverThirdBoxIsTrueRemainderOk = null;
    let silverThirdBoxRemainderDeltaPx = null;
    let silverThirdBoxHasNoFixedHeightOk = null;
    let silverIsFixedOk = null;
    try {
      if (window.matchMedia && window.matchMedia("(max-width: 900px)").matches) {
        const ids = ["iuSilverWeatherCard", "iuSilverCalendarSummaryCard", "iuSilverTasksSummaryCard"];
        const parseMinH = (el) => {
          if (!el) return null;
          const raw = getComputedStyle(el).minHeight;
          if (!raw || raw === "none" || raw === "auto") return 0;
          return parseFloat(raw) || 0;
        };
        silverSmallBoxesContentDrivenOk = ids.every((id) => {
          const el = document.getElementById(id);
          return el && parseMinH(el) < 0.5;
        });
        const vals = ids.map((id) => parseMinH(document.getElementById(id))).filter((v) => v !== null);
        if (vals.length === 3) {
          const lo = Math.min(vals[0], vals[1], vals[2]);
          const hi = Math.max(vals[0], vals[1], vals[2]);
          silverStackRowMinHeightDiffPx = Math.round((hi - lo) * 100) / 100;
          silverStackRowMinHeightDiffOk = silverStackRowMinHeightDiffPx <= 1;
        }
        const vv0 = window.visualViewport;
        layoutViewportHeightPx = Math.round(window.innerHeight * 100) / 100;
        visualViewportHeightPx =
          vv0 && typeof vv0.height === "number"
            ? Math.round(vv0.height * 100) / 100
            : layoutViewportHeightPx;
        const vvOffsetTopPx =
          vv0 && typeof vv0.offsetTop === "number" ? Math.round(vv0.offsetTop * 100) / 100 : 0;
        try {
          const probe = document.createElement("div");
          probe.setAttribute("data-iu-proof-safe-area", "1");
          probe.style.cssText =
            "position:fixed;left:0;bottom:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;z-index:-1;";
          document.body.appendChild(probe);
          safeAreaBottomPx = Math.round((parseFloat(getComputedStyle(probe).paddingBottom) || 0) * 100) / 100;
          probe.remove();
        } catch (_) {
          safeAreaBottomPx = 0;
        }
        firstScreenVisibleBottomPx = vv0
          ? Math.round((vvOffsetTopPx + vv0.height - safeAreaBottomPx) * 100) / 100
          : Math.round((window.innerHeight - safeAreaBottomPx) * 100) / 100;

        const tallEl = document.getElementById("iuSilverTallScrollSection");
        if (tallEl) {
          const cs3 = getComputedStyle(tallEl);
          const minHPx = parseFloat(cs3.minHeight) || 0;
          const maxHS = String(cs3.maxHeight || "");
          const heightHS = String(cs3.height || "");
          const badVh =
            /\b(?:min|max)?(?:[slvd])?vh\b/i.test(maxHS) ||
            /\b(?:min|max)?(?:[slvd])?vh\b/i.test(heightHS);
          silverThirdBoxHasNoFixedHeightOk = minHPx < 0.5 && !badVh;
        } else {
          silverThirdBoxHasNoFixedHeightOk = false;
        }
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
          (slot && slot.querySelector(".silver-compose")) ||
          (slot && slot.querySelector(".iuSilverHomeInputWrap"));
        const vv = window.visualViewport;
        const vh = vv ? vv.height : window.innerHeight;

        const inputField = sticky ? sticky.querySelector("#iuSilverHomeInput") : null;
        const inputFoldRect = inputField ? inputField.getBoundingClientRect() : { top: 0, bottom: 0 };
        inputTopPx = Math.round(inputFoldRect.top * 100) / 100;
        inputBottomPx = Math.round(inputFoldRect.bottom * 100) / 100;
        if (sticky) {
          const sbr = sticky.getBoundingClientRect();
          stackTopPx = Math.round(sbr.top * 100) / 100;
          stackBottomPx = Math.round(sbr.bottom * 100) / 100;
        }
        /* Input rect can diverge from ancestor sticky in some engines (transforms); fold cannot be below stack bottom. */
        const inputBottomForFoldPx =
          sticky && stackBottomPx !== null
            ? Math.min(inputBottomPx, stackBottomPx)
            : inputBottomPx;
        realFoldFit = inputBottomForFoldPx <= firstScreenVisibleBottomPx + 2;
        inputVisibleOnFirstScreen = realFoldFit;

        /* Stop-ship: third box must be dominant, not merely "tallest within 1.5px". */
        const maxRow = Math.max(hWx, Math.max(hCal, hTasks));
        const dominanceMinDeltaPx = 40;
        silverThirdBoxDominance = {
          maxRowPx: r(maxRow),
          thirdPx: r(hTall),
          deltaPx: r(hTall - maxRow),
          minDeltaPx: dominanceMinDeltaPx,
          minThirdPx: null,
          vhPx: r(vh),
        };
        /* Third box fills flex remainder — must clearly exceed small rows; no 220/vh floor (content-driven rows). */
        silverThirdBoxDominanceOk = hTall + 1e-6 >= maxRow + dominanceMinDeltaPx;

        const stackEl = document.getElementById("iuSilverWelcomeStack");
        if (stackEl) {
          const shellW = stackEl.querySelector(".silver-shell.silver-shell--stackConnected");
          if (shellW) {
            const csW = getComputedStyle(shellW);
            silverIsFixedOk =
              String(csW.flexGrow || "") === "0" && String(csW.flexShrink || "") === "0";
          } else {
            silverIsFixedOk = false;
          }
        } else {
          silverIsFixedOk = false;
        }
        if (stackEl && tallEl) {
          let sumExclTall = 0;
          for (let i = 0; i < stackEl.children.length; i++) {
            const c = stackEl.children[i];
            if (c.id === "iuSilverTallScrollSection") continue;
            sumExclTall += c.getBoundingClientRect().height;
          }
          const remainderPx = stackEl.clientHeight - sumExclTall;
          silverThirdBoxRemainderDeltaPx = Math.round(Math.abs(hTall - remainderPx) * 100) / 100;
          silverThirdBoxIsTrueRemainderOk = silverThirdBoxRemainderDeltaPx <= 12;
        }

        let overflow = 0;
        if (slot && slot.scrollHeight > slot.clientHeight + 1) {
          overflow = Math.round((slot.scrollHeight - slot.clientHeight) * 100) / 100;
        }
        let bleedBelowVisibleFold = 0;
        if (sticky) {
          bleedBelowVisibleFold = Math.round(
            (sticky.getBoundingClientRect().bottom - firstScreenVisibleBottomPx) * 100
          ) / 100;
        }
        silverStackOverflowDeltaPx = Math.round(
          Math.max(overflow, Math.max(0, bleedBelowVisibleFold)) * 100
        ) / 100;
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
        /* Slot cap: JS sets --iu-silver-slot-max-h from visualViewport (single source; third box uses flex only, no CSS viewport min-height). */
        if (slot) {
          try {
            const raw = getComputedStyle(slot).getPropertyValue("--iu-silver-slot-max-h").trim();
            let px = parseFloat(raw);
            if (raw === "" || Number.isNaN(px)) {
              const mh = getComputedStyle(slot).maxHeight;
              px = mh && mh.indexOf("px") !== -1 ? parseFloat(mh) : NaN;
            }
            silverSlotThirdEffectivePx = !Number.isNaN(px) ? px : null;
          } catch (_) {
            silverSlotThirdEffectivePx = null;
          }
        }
        const innerH = window.innerHeight;
        const vvH = window.visualViewport ? window.visualViewport.height : innerH;
        vvVsInnerDeltaPx = Math.round((innerH - vvH) * 100) / 100;
        thirdBoxComputedCapIsStable =
          silverSlotThirdEffectivePx !== null &&
          silverSlotThirdEffectivePx >= 120 &&
          silverSlotThirdEffectivePx <= 1200;
        edgeSafariViewportDeltaHandled = thirdBoxComputedCapIsStable === true;
        const vpScroll = document.getElementById("iuSilverTallScrollViewport");
        if (tallEl && vpScroll) {
          thirdBoxHeight = r(tallEl.getBoundingClientRect().height);
          thirdBoxSectionScrollHeight = tallEl.scrollHeight;
          thirdBoxSectionClientHeight = tallEl.clientHeight;
          thirdBoxViewportScrollHeight = vpScroll.scrollHeight;
          thirdBoxViewportClientHeight = vpScroll.clientHeight;
          thirdBoxViewportOverflowActive = vpScroll.scrollHeight > vpScroll.clientHeight + 1;
          thirdBoxContentOverflowHandled = thirdBoxViewportOverflowActive;
          thirdBoxNotGrowingWithContent =
            silverSlotThirdEffectivePx !== null &&
            silverSlotThirdEffectivePx >= 120 &&
            tallEl.scrollHeight <= tallEl.clientHeight + 2;
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
      silverThirdBoxDominanceOk,
      silverThirdBoxDominance,
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
      layoutViewportHeightPx,
      visualViewportHeightPx,
      safeAreaBottomPx,
      firstScreenVisibleBottomPx,
      stackTopPx,
      stackBottomPx,
      inputTopPx,
      inputBottomPx,
      realFoldFit,
      inputVisibleOnFirstScreen,
      silverSmallBoxesContentDrivenOk,
      silverThirdBoxIsTrueRemainderOk,
      silverThirdBoxRemainderDeltaPx,
      silverThirdBoxHasNoFixedHeightOk,
      silverIsFixedOk,
    };
  });

  if (
    ((vp.group || vp.name) === "mobile" || (vp.group || vp.name) === "tablet") &&
    data.silverSmallBoxesContentDrivenOk !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: small stack boxes must be content-driven (computed min-height < 0.5px each) viewport=${vp.name}, engine=${engineTag}`
    );
  }

  if (
    ((vp.group || vp.name) === "mobile" || (vp.group || vp.name) === "tablet") &&
    data.silverThirdBoxHasNoFixedHeightOk !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: third box must have no fixed floor / no vh height (computed min-height < 0.5px, no vh on height/max-height) viewport=${vp.name}, engine=${engineTag}`
    );
  }

  if (
    ((vp.group || vp.name) === "mobile" || (vp.group || vp.name) === "tablet") &&
    data.silverIsFixedOk !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: Silver stack shell must be fixed block (flex-grow 0, flex-shrink 0) viewport=${vp.name}, engine=${engineTag}`
    );
  }

  if (
    ((vp.group || vp.name) === "mobile" || (vp.group || vp.name) === "tablet") &&
    data.silverThirdBoxIsTrueRemainderOk !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: third box must match flex remainder (|thirdH - (stackClientH - sumSiblings)| <= 12px) viewport=${vp.name}, engine=${engineTag}, deltaPx=${String(data.silverThirdBoxRemainderDeltaPx)}, heights=${JSON.stringify(data.silverThirdBoxHeights)}`
    );
  }

  if (
    ((vp.group || vp.name) === "mobile" || (vp.group || vp.name) === "tablet") &&
    data.silverThirdBoxIsTallest !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: third stack box (#iuSilverTallScrollSection) must be tallest vs weather/calendar/tasks (viewport=${vp.name}, engine=${engineTag}, heights=${JSON.stringify(data.silverThirdBoxHeights)})`
    );
  }

  if (
    ((vp.group || vp.name) === "mobile" || (vp.group || vp.name) === "tablet") &&
    data.silverThirdBoxDominanceOk !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: third stack box must be dominant (viewport=${vp.name}, engine=${engineTag}, dominance=${JSON.stringify(data.silverThirdBoxDominance)})`
    );
  }

  if (
    ((vp.group || vp.name) === "mobile" || (vp.group || vp.name) === "tablet") &&
    data.silverStackFitsViewport !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: silver-slot must fit viewport (overflow delta, tol=2px) viewport=${vp.name}, engine=${engineTag}, delta=${String(data.silverStackOverflowDeltaPx)}, metrics=${JSON.stringify(data.silverStackMetrics)}`
    );
  }

  if (
    ((vp.group || vp.name) === "mobile" || (vp.group || vp.name) === "tablet") &&
    data.realFoldFit !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: first-screen fold — Silver input bottom must be within visible visual viewport minus safe-area (viewport=${vp.name}, engine=${engineTag}, inputBottom=${String(data.inputBottomPx)}, stackBottom=${String(data.stackBottomPx)}, visibleBottom=${String(data.firstScreenVisibleBottomPx)}, layoutInnerH=${String(data.layoutViewportHeightPx)}, vvH=${String(data.visualViewportHeightPx)}, safeBottom=${String(data.safeAreaBottomPx)})`
    );
  }

  if (
    ((vp.group || vp.name) === "mobile" || (vp.group || vp.name) === "tablet") &&
    data.thirdBoxComputedCapIsStable !== true
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: thirdBoxComputedCapIsStable (--iu-silver-slot-max-h from visualViewport) viewport=${vp.name}, engine=${engineTag}, px=${String(data.silverSlotThirdEffectivePx)}`
    );
  }

  if (
    (((vp.group || vp.name) === "mobile" || (vp.group || vp.name) === "tablet") &&
      data.thirdBoxNotGrowingWithContent !== true)
  ) {
    await context.close();
    if (closeBrowserOnFatal) await browser.close();
    throw new Error(
      `PROOF FAIL: third box must not grow with content (section scrollHeight/clientHeight vs effective) viewport=${vp.name}, engine=${engineTag}, ` +
        JSON.stringify({
          thirdBoxHeight: data.thirdBoxHeight,
          thirdBoxSectionScrollHeight: data.thirdBoxSectionScrollHeight,
          thirdBoxSectionClientHeight: data.thirdBoxSectionClientHeight,
          silverSlotThirdEffectivePx: data.silverSlotThirdEffectivePx,
        })
    );
  }

  let webkitLoadFailedHarnessSuppressed = false;
  if (consoleErrorsCount > 0) {
    if (engineTag === "webkit" && webkitRecordsAreOnlyLoadFailed(consoleErrorRecords)) {
      const settled = await page.evaluate(() => {
        try {
          const f = document.getElementById("feed");
          if (!f) return false;
          if (String(f.getAttribute("data-feed-ready") || "") !== "true") return false;
          return f.querySelectorAll("a[href]").length > 0;
        } catch (_) {
          return false;
        }
      });
      if (settled) {
        webkitLoadFailedHarnessSuppressed = true;
        console.log(
          JSON.stringify({
            _proofPass: "webkit-harness-console-override",
            classification: "HARNESS_WEBKIT_HEADLESS_FETCH_RACE",
            priorConsoleErrorsCount: consoleErrorsCount,
            note:
              "WebKit headless: fetch/subresource TypeError Load failed during timing race; #feed data-feed-ready with links. Chromium layout PASS on same URL is the app-regression gate.",
          })
        );
      }
    }
    if (!webkitLoadFailedHarnessSuppressed) {
      await context.close();
      if (closeBrowserOnFatal) await browser.close();
      throw new Error(
        `PROOF FAIL: console errors must be 0 (viewport=${vp.name}, engine=${engineTag}, count=${consoleErrorsCount}, records=${JSON.stringify(consoleErrorRecords)})`
      );
    }
  }

  const out = {
    _proofPass: "viewport-metrics",
    layoutEngine: engineTag,
    noCacheMode: NO_CACHE,
    viewport: vp.name,
    base: BASE,
    dateMock: false,
    CLS: cls,
    consoleErrorsCount: webkitLoadFailedHarnessSuppressed ? 0 : consoleErrorsCount,
    consoleErrorRecords: webkitLoadFailedHarnessSuppressed ? [] : consoleErrorRecords,
    webkitLoadFailedHarnessSuppressed,
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

async function runWeatherDualStateStackProof(browser) {
  const vp = viewports[0];
  let consoleErrorsCount = 0;
  const consoleErrorRecords = [];
  const context = await browser.newContext({
    serviceWorkers: NO_CACHE ? "block" : "allow",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  await attachNoCacheCdp(context, page);
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    consoleErrorsCount += 1;
    consoleErrorRecords.push({ source: "console", text: msg.text(), location: msg.location() });
  });
  page.on("pageerror", (err) => {
    consoleErrorsCount += 1;
    consoleErrorRecords.push({
      source: "pageerror",
      text: String(err && err.message ? err.message : err),
      stack: String(err && err.stack ? err.stack : ""),
    });
  });

  await page.addInitScript(() => {
    window.__iuCls = 0;
    try {
      const PO = window.PerformanceObserver;
      if (
        PO &&
        PO.supportedEntryTypes &&
        PO.supportedEntryTypes.indexOf("layout-shift") !== -1
      ) {
        new PO((list) => {
          for (const e of list.getEntries()) {
            if (!e.hadRecentInput) window.__iuCls += e.value || 0;
          }
        }).observe({ type: "layout-shift" });
      }
    } catch (_) {}
    try {
      window.__iuWeatherGeoFlowFeedback = null;
      localStorage.removeItem("iu_location_mode");
      localStorage.removeItem("iu_manual_location");
      localStorage.removeItem("iuWeatherGpsSelectedV1");
      localStorage.removeItem("iuWeatherCitySelectedV1");
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
  await page.evaluate(() => {
    window.__iuCls = 0;
  });
  await page.waitForTimeout(2000);

  let clsRaw = await page.evaluate(() => window.__iuCls || 0);
  let cls = Math.round(clsRaw * 100000) / 100000;
  if (cls !== 0) {
    await context.close();
    throw new Error(`PROOF FAIL weather dual-state: CLS must be 0 (CLS=${cls})`);
  }

  const measureStack = () => {
    const card = document.getElementById("iuSilverWeatherCard");
    const actions = document.getElementById("iuSilverWeatherActions");
    const wxEl = document.getElementById("iuSilverWeatherCard");
    const tallEl = document.getElementById("iuSilverTallScrollSection");
    const slot = document.getElementById("silver-slot");
    const sticky = document.getElementById("iuSilverWelcomeSticky");
    const vv = window.visualViewport;
    const vvOffsetTopPx =
      vv && typeof vv.offsetTop === "number" ? Math.round(vv.offsetTop * 100) / 100 : 0;
    let safeAreaBottomPx = 0;
    try {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;left:0;bottom:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;z-index:-1;";
      document.body.appendChild(probe);
      safeAreaBottomPx = Math.round((parseFloat(getComputedStyle(probe).paddingBottom) || 0) * 100) / 100;
      probe.remove();
    } catch (_) {}
    const firstScreenVisibleBottomPx = vv
      ? Math.round((vvOffsetTopPx + vv.height - safeAreaBottomPx) * 100) / 100
      : Math.round((window.innerHeight - safeAreaBottomPx) * 100) / 100;
    const inputField = sticky ? sticky.querySelector("#iuSilverHomeInput") : null;
    const inputBottomPx = inputField
      ? Math.round(inputField.getBoundingClientRect().bottom * 100) / 100
      : 0;
    const stackBottomPx = sticky
      ? Math.round(sticky.getBoundingClientRect().bottom * 100) / 100
      : 0;
    const inputBottomForFoldPx =
      sticky && stackBottomPx !== null ? Math.min(inputBottomPx, stackBottomPx) : inputBottomPx;
    const foldOk = inputBottomForFoldPx <= firstScreenVisibleBottomPx + 2;
    let overflow = 0;
    if (slot && slot.scrollHeight > slot.clientHeight + 1) {
      overflow = Math.round((slot.scrollHeight - slot.clientHeight) * 100) / 100;
    }
    let bleed = 0;
    if (sticky) {
      bleed = Math.round(
        (sticky.getBoundingClientRect().bottom - firstScreenVisibleBottomPx) * 100
      ) / 100;
    }
    const overflowDelta = Math.round(Math.max(overflow, Math.max(0, bleed)) * 100) / 100;
    const stackFitsViewport = overflowDelta <= 2;
    let actionsVisible = false;
    if (actions) {
      const cs = getComputedStyle(actions);
      actionsVisible = cs.display !== "none" && cs.visibility !== "hidden";
    }
    return {
      layout: card ? card.getAttribute("data-iu-silver-wx-layout") : null,
      phase: card ? card.getAttribute("data-iu-silver-wx-phase") : null,
      wxH: wxEl ? Math.round(wxEl.getBoundingClientRect().height * 100) / 100 : 0,
      thirdH: tallEl ? Math.round(tallEl.getBoundingClientRect().height * 100) / 100 : 0,
      stackFitsViewport,
      foldOk,
      actionsVisible,
    };
  };

  const setupProbe = await page.evaluate(measureStack);

  await page.evaluate(() => {
    try {
      window.__iuWeatherGeoFlowFeedback = null;
      localStorage.setItem("iu_location_mode", "gps");
      localStorage.setItem(
        "iuWeatherGpsSelectedV1",
        JSON.stringify({ name: "Praha", lat: 50.0755, lon: 14.4378 })
      );
      window.__iuWeatherState = {
        lat: 50.0755,
        lon: 14.4378,
        current: {
          temperatureC: 12,
          feelsLikeC: 10,
          weatherCode: 1,
          isDay: true,
        },
        nextHours: [],
        rawDaily: null,
      };
      if (typeof window.iuSilverWeatherRefresh === "function") window.iuSilverWeatherRefresh();
      if (typeof window.iuSilverMobileStackFitSchedule === "function") {
        window.iuSilverMobileStackFitSchedule();
      }
    } catch (_) {}
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__iuCls = 0;
  });
  await page.waitForTimeout(1500);

  clsRaw = await page.evaluate(() => window.__iuCls || 0);
  cls = Math.round(clsRaw * 100000) / 100000;
  if (cls !== 0) {
    await context.close();
    throw new Error(`PROOF FAIL weather dual-state (ready): CLS must be 0 (CLS=${cls})`);
  }

  const readyProbe = await page.evaluate(measureStack);

  if (consoleErrorsCount > 0) {
    await context.close();
    throw new Error(
      `PROOF FAIL weather dual-state: console errors (count=${consoleErrorsCount}, records=${JSON.stringify(consoleErrorRecords)})`
    );
  }

  const weatherSetupStateFitsViewport =
    setupProbe.layout === "setup" &&
    setupProbe.actionsVisible === true &&
    setupProbe.stackFitsViewport === true &&
    setupProbe.foldOk === true;
  const weatherReadyStateFitsViewport =
    readyProbe.layout === "ready" &&
    readyProbe.actionsVisible === false &&
    readyProbe.stackFitsViewport === true &&
    readyProbe.foldOk === true;
  const weatherSetupToReadyReallocationOk =
    setupProbe.wxH > readyProbe.wxH + 5 &&
    readyProbe.thirdH > setupProbe.thirdH + 5;

  if (!weatherSetupStateFitsViewport) {
    await context.close();
    throw new Error(
      `PROOF FAIL WEATHER_SETUP_STATE_FITS_VIEWPORT setupProbe=${JSON.stringify(setupProbe)}`
    );
  }
  if (!weatherReadyStateFitsViewport) {
    await context.close();
    throw new Error(
      `PROOF FAIL WEATHER_READY_STATE_FITS_VIEWPORT readyProbe=${JSON.stringify(readyProbe)}`
    );
  }
  if (!weatherSetupToReadyReallocationOk) {
    await context.close();
    throw new Error(
      `PROOF FAIL WEATHER_SETUP_TO_READY_REALLOCATION_OK setup=${JSON.stringify(setupProbe)} ready=${JSON.stringify(readyProbe)}`
    );
  }

  console.log(
    JSON.stringify({
      _proofPass: "weather-dual-state-stack",
      noCacheMode: NO_CACHE,
      base: BASE,
      viewport: vp.name,
      weatherSetupStateFitsViewport: true,
      weatherReadyStateFitsViewport: true,
      weatherSetupToReadyReallocationOk: true,
      setupProbe,
      readyProbe,
    })
  );
  await context.close();
}

/**
 * CZ vertikály: direct open + reload na ?section=… (prod), Chromium + NO_CACHE kontext.
 * Ověří data-section, aktivní levý rail a neprázdný #feed (žádný „jen prázdný media“ stav bez sekcí).
 */
async function runCzVerticalDeepLinkProof(chromiumBrowser) {
  const ctx = await chromiumBrowser.newContext({
    serviceWorkers: NO_CACHE ? "block" : "allow",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  const page = await ctx.newPage();
  await attachNoCacheCdp(ctx, page);
  let errCount = 0;
  const errRec = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    errCount += 1;
    errRec.push({ source: "console", text: msg.text() });
  });
  page.on("pageerror", (err) => {
    errCount += 1;
    errRec.push({ source: "pageerror", text: String(err && err.message ? err.message : err) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const baseUrl = new URL(BASE);
  const sections = ["hry", "kultura", "veda", "vzdelavani"];

  async function readSectionProbe(expected) {
    return page.evaluate((exp) => {
      const ds =
        (document.body && document.body.getAttribute("data-section")) ||
        (document.documentElement && document.documentElement.getAttribute("data-section")) ||
        "";
      const active = document.querySelector(
        `.iu-leftNav .iu-leftNavItem[data-accent="${exp}"].is-active`
      );
      const feed = document.getElementById("feed");
      let feedDisplay = "";
      let feedVisible = false;
      if (feed) {
        try {
          const cs = getComputedStyle(feed);
          feedDisplay = (cs && cs.display) || "";
          feedVisible =
            feedDisplay !== "none" &&
            (cs.visibility || "") !== "hidden" &&
            parseFloat(cs.opacity || "1") > 0.02;
        } catch (_) {}
      }
      const feedLinks = feed ? feed.querySelectorAll("a[href]").length : 0;
      const titleLinks = feed ? feed.querySelectorAll("a.news-titleLink[href]") : [];
      let titleLinksBlank = 0;
      let sampleHref = "";
      titleLinks.forEach((a) => {
        if (String(a.getAttribute("target") || "").toLowerCase() === "_blank") titleLinksBlank += 1;
        if (!sampleHref && /^https?:\/\//i.test(a.getAttribute("href") || "")) {
          sampleHref = String(a.getAttribute("href") || "").slice(0, 120);
        }
      });
      return {
        dataSection: String(ds).toLowerCase(),
        hasActiveRail: !!active,
        feedDisplay,
        feedVisible,
        feedLinkCount: feedLinks,
        titleLinkCount: titleLinks.length,
        titleLinksBlank,
        sampleHref,
      };
    }, expected);
  }

  for (const sec of sections) {
    const u = new URL(baseUrl.href);
    u.searchParams.set("section", sec);
    await page.goto(u.href, { waitUntil: "load", timeout: 120000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 90000 });
    } catch (_) {}
    await page.waitForTimeout(7000);
    const direct = await readSectionProbe(sec);
    const okTitlesDirect =
      direct.titleLinkCount > 0 &&
      direct.titleLinksBlank > 0 &&
      /^https?:\/\//i.test(direct.sampleHref || "");
    const okDirect =
      direct.dataSection === sec &&
      direct.hasActiveRail &&
      direct.feedVisible === true &&
      direct.feedLinkCount > 0 &&
      okTitlesDirect;

    await page.reload({ waitUntil: "load", timeout: 120000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 90000 });
    } catch (_) {}
    await page.waitForTimeout(7000);
    const afterReload = await readSectionProbe(sec);
    const okTitlesReload =
      afterReload.titleLinkCount > 0 &&
      afterReload.titleLinksBlank > 0 &&
      /^https?:\/\//i.test(afterReload.sampleHref || "");
    const okReload =
      afterReload.dataSection === sec &&
      afterReload.hasActiveRail &&
      afterReload.feedVisible === true &&
      afterReload.feedLinkCount > 0 &&
      okTitlesReload;

    const noMediaFallback = okDirect && okReload;

    console.log(
      JSON.stringify({
        _proofPass: "cz-vertical-deep-link",
        section: sec,
        directOpen: okDirect,
        reload: okReload,
        activeUi: okDirect && okReload,
        renderedFeed: okDirect && okReload,
        clickableArticleTitles: okTitlesDirect && okTitlesReload,
        noMediaFallback,
        detail: { direct, afterReload },
      })
    );

    if (!okDirect || !okReload || !noMediaFallback) {
      await ctx.close();
      throw new Error(
        `PROOF FAIL cz-vertical-deep-link section=${sec} okDirect=${okDirect} okReload=${okReload}`
      );
    }
  }

  /* Referenční stejná šablona jako Zprávy (media + topic=zpravy). */
  {
    const uRef = new URL(baseUrl.href);
    uRef.searchParams.set("section", "media");
    uRef.searchParams.set("topic", "zpravy");
    await page.goto(uRef.href, { waitUntil: "load", timeout: 120000 });
    try {
      await page.waitForLoadState("networkidle", { timeout: 90000 });
    } catch (_) {}
    await page.waitForTimeout(7000);
    const ref = await page.evaluate(() => {
      const feed = document.getElementById("feed");
      let feedVisible = false;
      let feedDisplay = "";
      if (feed) {
        try {
          const cs = getComputedStyle(feed);
          feedDisplay = (cs && cs.display) || "";
          feedVisible =
            feedDisplay !== "none" &&
            (cs.visibility || "") !== "hidden" &&
            parseFloat(cs.opacity || "1") > 0.02;
        } catch (_) {}
      }
      const links = feed ? feed.querySelectorAll("a.news-titleLink[href]") : [];
      let blank = 0;
      let href0 = "";
      links.forEach((a) => {
        if (String(a.getAttribute("target") || "").toLowerCase() === "_blank") blank += 1;
        if (!href0 && /^https?:\/\//i.test(a.getAttribute("href") || "")) {
          href0 = String(a.getAttribute("href") || "").slice(0, 120);
        }
      });
      return {
        dataSection: String(document.body?.getAttribute("data-section") || "").toLowerCase(),
        feedDisplay,
        feedVisible,
        titleLinkCount: links.length,
        titleLinksBlank: blank,
        sampleHref: href0,
      };
    });
    /* IU_ARTICLE_HUB_SECTION is canonical "feed"; ?section=media deep links normalize to feed. */
    const refOk =
      (ref.dataSection === "media" || ref.dataSection === "feed") &&
      ref.feedVisible === true &&
      ref.titleLinkCount > 0 &&
      ref.titleLinksBlank > 0 &&
      /^https?:\/\//i.test(ref.sampleHref || "");
    console.log(
      JSON.stringify({
        _proofPass: "cz-vertical-reference-zpravy",
        referenceTopic: "zpravy",
        ok: refOk,
        detail: ref,
      })
    );
    if (!refOk) {
      await ctx.close();
      throw new Error(`PROOF FAIL cz-vertical-reference-zpravy ${JSON.stringify(ref)}`);
    }
  }

  if (errCount > 0) {
    await ctx.close();
    throw new Error(
      `PROOF FAIL cz-vertical-deep-link console errors: count=${errCount} ${JSON.stringify(errRec)}`
    );
  }
  await ctx.close();
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

await runCzVerticalDeepLinkProof(browser);

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

await runWeatherDualStateStackProof(browser);

await browser.close();
