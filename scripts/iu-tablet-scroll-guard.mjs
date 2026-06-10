#!/usr/bin/env node
/**
 * Tablet portrait scroll blocker guard (replay regression protection).
 *
 * Root cause covered: in the tablet-portrait media query #leftContent is height-clamped with
 * overflow:hidden and the intended #feed inner scroller never activated (#feed is not a direct
 * child of #leftContent), so feed sections had scroll range 0. The fix makes #leftContent the
 * scroller whenever the mobile main shell (body.iu-mobileMainVisible) is visible.
 *
 * Guards:
 *  - TABLET_SCROLL_GUARD        homepage → sekce → Back ⇒ effective scroll range > 0 everywhere
 *  - TABLET_SECTION_SCROLL_GUARD sekce ⇒ scroll až dolů (effective scroller reaches bottom)
 *  - TABLET_SCROLL_LOCK_GUARD   body/html/#leftContent nezůstávají overflow:hidden bez modalu
 *
 * Viewport: tablet portrait (820x1180). Console/app errors měřeny.
 *
 * Run: npm run iu-tablet-scroll-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-tablet-scroll-guard
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} from "./proofs/open_meteo_guard_stub.cjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8898", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const FEED_READY_WAIT_MS = 30000;
/** Effective scroll range (window or #leftContent) must exceed this in every checked state. */
const MIN_SCROLL_RANGE_PX = 300;

const VIEWPORT = { name: "tablet-portrait", width: 820, height: 1180, isMobile: true, hasTouch: true };

/* Known PRE-EXISTING app console errors (data/content pipeline; proven on a clean main worktree
   in iu-scroll-restore-guard — see KNOWN_PREEXISTING_CONSOLE_ERRORS there). */
const KNOWN_PREEXISTING_CONSOLE_ERRORS = [
  "[ERR] Invariant breach: builder returned falsy markup",
];

function isProdHost(base) {
  return /infouzel\.cz/i.test(base);
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

function buildUrl(params) {
  const isLocal = BASE.indexOf("127.0.0.1") >= 0 || BASE.indexOf("localhost") >= 0;
  const p = new URLSearchParams(params || {});
  if (isLocal) p.set("iuRobust", "1");
  if (isProdHost(BASE)) p.set("nosw", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
}

/** Effective scroller state: the document OR #leftContent (tablet portrait section shell). */
async function scrollerState(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const windowMax = Math.max(0, (se ? se.scrollHeight : 0) - (window.innerHeight || 0));
    const lc = document.getElementById("leftContent");
    const lcCs = lc ? getComputedStyle(lc) : null;
    const lcVisible = !!(lc && lcCs && lcCs.display !== "none" && lc.getBoundingClientRect().height > 0);
    const lcScrollable = !!(lcVisible && (lcCs.overflowY === "auto" || lcCs.overflowY === "scroll"));
    const lcMax = lc ? Math.max(0, lc.scrollHeight - lc.clientHeight) : 0;
    const effectiveMax = Math.max(windowMax, lcScrollable ? lcMax : 0);
    return {
      windowMax,
      windowY: Math.round(window.scrollY || se.scrollTop || 0),
      lcVisible,
      lcOverflowY: lcCs ? lcCs.overflowY : null,
      lcScrollable,
      lcMax,
      lcY: lc ? Math.round(lc.scrollTop) : 0,
      effectiveMax,
      bodyClasses: String(document.body.className || ""),
    };
  });
}

/** Scrolls the effective scroller to y and returns the settled position. */
async function effectiveScrollTo(page, y) {
  return page.evaluate((yv) => {
    const se = document.scrollingElement || document.documentElement;
    const windowMax = Math.max(0, (se ? se.scrollHeight : 0) - (window.innerHeight || 0));
    const lc = document.getElementById("leftContent");
    const lcCs = lc ? getComputedStyle(lc) : null;
    const lcScrollable = !!(
      lc &&
      lcCs &&
      lcCs.display !== "none" &&
      (lcCs.overflowY === "auto" || lcCs.overflowY === "scroll") &&
      lc.scrollHeight - lc.clientHeight > windowMax
    );
    if (lcScrollable) {
      lc.scrollTop = yv;
      return { scroller: "leftContent", y: Math.round(lc.scrollTop) };
    }
    window.scrollTo(0, yv);
    if (se) se.scrollTop = yv;
    return { scroller: "window", y: Math.round(Math.max(window.scrollY || 0, se ? se.scrollTop : 0)) };
  }, y);
}

async function waitFeedReady(page, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate(() => {
      const f = document.getElementById("feed");
      if (!f) return false;
      const ready = String(f.getAttribute("data-feed-ready") || "") === "true";
      const switching = String(f.getAttribute("data-feed-switching") || "") === "1";
      return ready && !switching && f.querySelectorAll("article.news-card").length > 0;
    });
    if (ok) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

async function waitBootSettled(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const settled = await page.evaluate(() => {
      const f = document.getElementById("feed");
      const ready = f ? String(f.getAttribute("data-feed-ready") || "") === "true" : true;
      return ready && !window.__iuSectionSwitchScrollArm;
    });
    if (settled) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);
}

async function openEntry(page, params) {
  await page.goto(buildUrl(params), { waitUntil: "domcontentloaded", timeout: 90000 });
  try {
    await page.waitForLoadState("networkidle", { timeout: 25000 });
  } catch (_) {}
  await page.waitForTimeout(isProdHost(BASE) ? 1200 : 600);
  await waitBootSettled(page);
}

async function spaNavigate(page, search) {
  await page.evaluate((qs) => {
    const u = new URL(window.location.href);
    u.search = qs;
    history.pushState(null, "", u.toString());
    try {
      if (typeof window.iuScrollMainSectionSwitchToTop === "function") window.iuScrollMainSectionSwitchToTop();
    } catch (_) {}
    try {
      if (typeof window.iuApplySectionFromURL === "function") window.iuApplySectionFromURL();
    } catch (_) {}
  }, search);
}

/** GUARD 1: homepage → sekce → Back ⇒ effective scroll range > 0 in every state. */
async function guardTabletScroll(page) {
  await openEntry(page, {});
  const home1 = await scrollerState(page);
  if (home1.effectiveMax < MIN_SCROLL_RANGE_PX) {
    return { name: "TABLET_SCROLL_GUARD", pass: false, homeMax: home1.effectiveMax, reason: "homepage not scrollable (max=" + home1.effectiveMax + ")" };
  }
  await spaNavigate(page, "?section=feed&topic=zpravy");
  await waitFeedReady(page, FEED_READY_WAIT_MS);
  await page.waitForTimeout(600);
  const section = await scrollerState(page);
  if (section.effectiveMax < MIN_SCROLL_RANGE_PX) {
    return { name: "TABLET_SCROLL_GUARD", pass: false, homeMax: home1.effectiveMax, sectionMax: section.effectiveMax, reason: "section not scrollable (max=" + section.effectiveMax + ")" };
  }
  await page.goBack();
  await page.waitForTimeout(2500);
  const home2 = await scrollerState(page);
  const pass = home2.effectiveMax >= MIN_SCROLL_RANGE_PX;
  return {
    name: "TABLET_SCROLL_GUARD",
    pass,
    homeMax: home1.effectiveMax,
    sectionMax: section.effectiveMax,
    sectionScroller: section.lcScrollable ? "leftContent" : "window",
    backHomeMax: home2.effectiveMax,
    maxYGtZero: home1.effectiveMax > 0 && section.effectiveMax > 0 && home2.effectiveMax > 0 ? "YES" : "NO",
    reason: pass ? "" : "home after back not scrollable (max=" + home2.effectiveMax + ")",
  };
}

/** GUARD 2: otevřená sekce ⇒ scroll až dolů funguje (effective scroller reaches bottom). */
async function guardTabletSectionScroll(page) {
  await openEntry(page, { section: "feed", topic: "sport" });
  await waitFeedReady(page, FEED_READY_WAIT_MS);
  await page.waitForTimeout(600);
  const st = await scrollerState(page);
  if (st.effectiveMax < MIN_SCROLL_RANGE_PX) {
    return { name: "TABLET_SECTION_SCROLL_GUARD", pass: false, sectionMax: st.effectiveMax, reason: "section not scrollable (max=" + st.effectiveMax + ")" };
  }
  /* lazy images / async batches change scrollHeight while scrolling — keep pushing to the
     bottom until the position stabilizes, then compare against the FINAL max */
  let down = { scroller: "?", y: 0 };
  let finalMax = st.effectiveMax;
  let reached = 0;
  for (let i = 0; i < 12; i++) {
    down = await effectiveScrollTo(page, 10 * 1000 * 1000);
    await page.waitForTimeout(350);
    const s = await scrollerState(page);
    finalMax = s.effectiveMax;
    const y = Math.max(s.lcY, s.windowY);
    if (y === reached && i > 0) break;
    reached = y;
  }
  const bottomOk = reached >= finalMax - 60;
  const up = await effectiveScrollTo(page, 0);
  await page.waitForTimeout(300);
  const atTop = await scrollerState(page);
  const topOk = Math.max(atTop.lcY, atTop.windowY) <= 10;
  const pass = bottomOk && topOk;
  return {
    name: "TABLET_SECTION_SCROLL_GUARD",
    pass,
    scroller: down.scroller,
    sectionMaxInitial: st.effectiveMax,
    sectionMaxFinal: finalMax,
    reachedBottomY: reached,
    backToTopY: Math.max(atTop.lcY, atTop.windowY),
    reason: pass ? "" : "scroll to bottom/top failed (reached=" + reached + "/" + finalMax + ", top=" + Math.max(atTop.lcY, atTop.windowY) + ")",
    upScroller: up.scroller,
  };
}

/** GUARD 3: body/html/#leftContent nezůstávají overflow:hidden bez aktivního modalu. */
async function guardTabletScrollLock(page) {
  const lockSnapshot = () =>
    page.evaluate(() => {
      /* deterministic modal markers only — generic [role=dialog] matches the always-mounted
         consent dialog and would vacuously skip every check */
      const modalOpen = !!(
        document.body.classList.contains("iu-mobileGateOverlayOpen") ||
        document.body.classList.contains("iu-calendarOverlay-open")
      );
      const ov = (el) => (el ? getComputedStyle(el).overflowY : null);
      const lc = document.getElementById("leftContent");
      const lcCs = lc ? getComputedStyle(lc) : null;
      const lcVisible = !!(lc && lcCs && lcCs.display !== "none" && lc.getBoundingClientRect().height > 0);
      const mainVisible = document.body.classList.contains("iu-mobileMainVisible");
      return {
        modalOpen,
        htmlOverflowY: ov(document.documentElement),
        bodyOverflowY: ov(document.body),
        lcOverflowY: lcVisible ? lcCs.overflowY : "n/a",
        mainVisible,
      };
    });

  const violations = [];
  const check = (label, s) => {
    if (s.modalOpen) return;
    if (s.htmlOverflowY === "hidden") violations.push(label + ": html overflow-y hidden");
    if (s.bodyOverflowY === "hidden") violations.push(label + ": body overflow-y hidden");
    /* #leftContent smí být hidden jen mimo section shell (home hub layout it clips decoratively) */
    if (s.mainVisible && s.lcOverflowY === "hidden") violations.push(label + ": #leftContent overflow-y hidden in section shell");
  };

  await openEntry(page, {});
  check("home", await lockSnapshot());

  await spaNavigate(page, "?section=feed&topic=zpravy");
  await waitFeedReady(page, FEED_READY_WAIT_MS);
  await page.waitForTimeout(500);
  check("section", await lockSnapshot());

  /* MindMenu open → close ⇒ no stuck lock (fresh home entry, same as MINDMENU_SCROLL_GUARD) */
  await openEntry(page, {});
  const mmVisible = await page.evaluate(() => {
    const b = document.querySelector('[data-iu-bottom-nav="mindmenu"]');
    return !!(b && b.offsetParent !== null);
  });
  let mindmenuChecked = false;
  if (mmVisible) {
    await page.click('[data-iu-bottom-nav="mindmenu"]');
    await page.waitForTimeout(900);
    /* same close path as MINDMENU_SCROLL_GUARD: history back */
    await page.goBack();
    await page.waitForTimeout(1200);
    const afterClose = await lockSnapshot();
    if (!afterClose.modalOpen) {
      check("after mindmenu close", afterClose);
      mindmenuChecked = true;
    }
  }

  const pass = violations.length === 0;
  return {
    name: "TABLET_SCROLL_LOCK_GUARD",
    pass,
    scrollLockStuck: pass ? "NO" : "YES",
    mindmenuChecked,
    violations,
    reason: pass ? "" : violations.join("; "),
  };
}

async function main() {
  let server = null;
  if (USE_LOCAL_SERVER) {
    server = spawn(process.execPath, [path.join(REPO, "server", "projects-static-and-vin.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await waitForPort("127.0.0.1", PORT, 30000);
  }

  const consoleErrors = [];
  const knownPreexistingErrors = [];
  const appErrors = [];
  const browser = await chromium.launch({ headless: true });
  let guards = [];
  try {
    const context = await browser.newContext({
      viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
      isMobile: VIEWPORT.isMobile,
      hasTouch: VIEWPORT.hasTouch,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await installProofGuardNetworkStubs(page);
    const ignorableTracker = createIgnorableResourceTracker();
    ignorableTracker.attachToPage(page);
    const ignorableOpts = {
      hadRecentIgnorableFailure: () => ignorableTracker.hadRecentIgnorableFailure(),
    };
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const t = String(msg.text());
      if (isIgnorableGuardConsoleError(t, ignorableOpts)) return;
      if (KNOWN_PREEXISTING_CONSOLE_ERRORS.some((k) => t.trim() === k)) {
        knownPreexistingErrors.push(t);
        return;
      }
      consoleErrors.push(t);
    });
    page.on("pageerror", (err) => {
      const t = String(err && err.message ? err.message : err);
      if (isIgnorableGuardConsoleError(t, ignorableOpts)) return;
      appErrors.push(t);
    });

    guards.push(await guardTabletScroll(page));
    guards.push(await guardTabletSectionScroll(page));
    guards.push(await guardTabletScrollLock(page));
    await page.close();
    await context.close();
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }

  const guardPass = (n) => {
    const g = guards.find((x) => x.name === n);
    return g && g.pass;
  };
  const scrollGuard = guards.find((g) => g.name === "TABLET_SCROLL_GUARD") || {};
  const lockGuard = guards.find((g) => g.name === "TABLET_SCROLL_LOCK_GUARD") || {};

  const report = {
    measuredAt: new Date().toISOString(),
    baseUrl: BASE,
    viewport: VIEWPORT,
    minScrollRangePx: MIN_SCROLL_RANGE_PX,
    guards,
    consoleErrorsCount: consoleErrors.length,
    consoleErrors: consoleErrors.slice(0, 5),
    knownPreexistingConsoleErrorsCount: knownPreexistingErrors.length,
    knownPreexistingConsoleErrors: knownPreexistingErrors.slice(0, 5),
    appErrorsCount: appErrors.length,
    appErrors: appErrors.slice(0, 5),
    gates: {
      TABLET_SCROLL: guardPass("TABLET_SCROLL_GUARD") ? "PASS" : "FAIL",
      TABLET_SECTION_SCROLL: guardPass("TABLET_SECTION_SCROLL_GUARD") ? "PASS" : "FAIL",
      TABLET_SCROLL_LOCK: guardPass("TABLET_SCROLL_LOCK_GUARD") ? "PASS" : "FAIL",
      TABLET_MAXY_GT_ZERO: scrollGuard.maxYGtZero === "YES" ? "YES" : "NO",
      TABLET_SCROLL_LOCK_STUCK: lockGuard.scrollLockStuck === "NO" ? "NO" : "YES",
      CONSOLE_ERRORS: consoleErrors.length,
      APP_ERRORS: appErrors.length,
    },
    pass: false,
  };
  report.pass =
    report.gates.TABLET_SCROLL === "PASS" &&
    report.gates.TABLET_SECTION_SCROLL === "PASS" &&
    report.gates.TABLET_SCROLL_LOCK === "PASS" &&
    report.gates.TABLET_MAXY_GT_ZERO === "YES" &&
    report.gates.TABLET_SCROLL_LOCK_STUCK === "NO" &&
    consoleErrors.length === 0 &&
    appErrors.length === 0;

  console.log(JSON.stringify(report, null, 2));
  console.log(report.pass ? "PASS" : "FAIL");
  if (!report.pass) {
    for (const g of guards) {
      if (!g.pass) console.error(g.name + ": " + (g.reason || "fail"));
    }
    if (consoleErrors.length) console.error("consoleErrors=" + consoleErrors.length + " " + JSON.stringify(consoleErrors.slice(0, 5)));
    if (appErrors.length) console.error("appErrors=" + appErrors.length + " " + JSON.stringify(appErrors.slice(0, 5)));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
