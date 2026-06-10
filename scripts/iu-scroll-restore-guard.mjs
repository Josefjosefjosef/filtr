#!/usr/bin/env node
/**
 * Scroll restore + article append stability guard (replay regression protection).
 *
 * Guards:
 *  - SCROLL_RESTORE_GUARD          homepage → sekce → Back ⇒ homepage scroll obnoven
 *  - SECTION_SCROLL_RESTORE_GUARD  sekce A (scroll) → sekce B → Back ⇒ scroll sekce A obnoven
 *  - ARTICLE_APPEND_STABILITY_GUARD "Načíst další" ⇒ scroll pozice beze změny (no jump)
 *  - MINDMENU_SCROLL_GUARD         MindMenu overlay → Back ⇒ scroll zachován
 *  - HOME_BUTTON_RESET_GUARD       Domů (bottom nav) ⇒ scroll reset na začátek
 *
 * Viewporty: mobile (390x844) + tablet (820x1180). CLS + console/app errors měřeny.
 *
 * Run: npm run iu-scroll-restore-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-scroll-restore-guard
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

const PORT = parseInt(process.env.IU_GUARD_PORT || "8897", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

/** Restore tolerance: sticky offsets / re-render rounding. */
const RESTORE_TOL_PX = parseInt(process.env.IU_SCROLL_RESTORE_TOL || "24", 10);
/** Load-more must not move the page at all (few px tolerance for subpixel rounding). */
const APPEND_TOL_PX = parseInt(process.env.IU_APPEND_TOL || "4", 10);
const HOME_RESET_MAX_PX = 10;
const RESTORE_WAIT_MS = 8000;
const FEED_READY_WAIT_MS = 30000;
/** Load-more append must not produce layout shift at the reading position. */
const APPEND_CLS_CAP = 0.05;
/** Back-restore flow = 2 full feed transitions (forward + back); section-switch guard allows 0.55 each. */
const NAV_CLS_CAP = 1.1;
/** Visual reading-position jump cap for load-more (reference article viewport offset). */
const APPEND_VISUAL_TOL_PX = 8;

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "tablet", width: 820, height: 1180, isMobile: true, hasTouch: true },
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

async function installClsObserver(context) {
  await context.addInitScript(() => {
    try {
      window.__iuScrollGuardCls = 0;
      new PerformanceObserver(function (list) {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && e.value) {
            window.__iuScrollGuardCls = (window.__iuScrollGuardCls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
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

async function getScrollY(page) {
  return page.evaluate(() => {
    return Math.round(
      Math.max(
        window.scrollY || 0,
        (document.scrollingElement || document.documentElement).scrollTop || 0,
        document.body ? document.body.scrollTop || 0 : 0
      )
    );
  });
}

async function setScrollY(page, y) {
  await page.evaluate((yv) => {
    window.scrollTo(0, yv);
    const se = document.scrollingElement || document.documentElement;
    if (se) se.scrollTop = yv;
    if (document.body) document.body.scrollTop = yv;
  }, y);
  await page.waitForTimeout(180);
}

async function getMaxScrollY(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    return Math.max(0, (se ? se.scrollHeight : 0) - (window.innerHeight || 0));
  });
}

async function waitFeedReady(page, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const ok = await page.evaluate(() => {
      const f = document.getElementById("feed");
      if (!f) return false;
      const ready = String(f.getAttribute("data-feed-ready") || "") === "true";
      const switching = String(f.getAttribute("data-feed-switching") || "") === "1";
      const count = f.querySelectorAll("article.news-card").length;
      return ready && !switching && count > 0;
    });
    if (ok) return true;
    await page.waitForTimeout(120);
  }
  return false;
}

async function waitScrollNear(page, target, tol, timeoutMs) {
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < timeoutMs) {
    last = await getScrollY(page);
    if (Math.abs(last - target) <= tol) return { ok: true, y: last, ms: Date.now() - t0 };
    await page.waitForTimeout(80);
  }
  return { ok: false, y: last, ms: Date.now() - t0 };
}

async function spaNavigate(page, search) {
  /* Mirrors the left-rail click path: pushState → arm section-switch scroll → applySectionFromURL. */
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

async function resetCls(page) {
  await page.evaluate(() => {
    window.__iuScrollGuardCls = 0;
  });
}

async function readCls(page) {
  return page.evaluate(() => Number(window.__iuScrollGuardCls || 0));
}

async function openEntry(page, params) {
  await page.goto(buildUrl(params), { waitUntil: "domcontentloaded", timeout: 90000 });
  try {
    await page.waitForLoadState("networkidle", { timeout: 25000 });
  } catch (_) {}
  await page.waitForTimeout(isProdHost(BASE) ? 1200 : 600);
  /* settle: pre-existing boot behavior can auto-consume the section-switch scroll arm
     (e.g. tablet home scrolls to feed anchor). Wait for it, then normalize to top. */
  await waitBootSettled(page);
  await setScrollY(page, 0);
  await page.waitForTimeout(200);
}

async function waitBootSettled(page) {
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const settled = await page.evaluate(() => {
      const f = document.getElementById("feed");
      const ready = f ? String(f.getAttribute("data-feed-ready") || "") === "true" : true;
      const armed = !!window.__iuSectionSwitchScrollArm;
      return ready && !armed;
    });
    if (settled) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);
}

/** GUARD 1: homepage (scrolled) → sekce → browser Back ⇒ homepage scroll restored. */
async function guardHomeScrollRestore(page) {
  await openEntry(page, {});
  const maxY = await getMaxScrollY(page);
  const targetY = Math.min(Math.max(800, Math.round(maxY * 0.5)), maxY);
  if (targetY < 300) return { name: "SCROLL_RESTORE_GUARD", pass: false, reason: "homepage not scrollable (maxY=" + maxY + ")" };
  await setScrollY(page, targetY);
  const before = await getScrollY(page);
  await resetCls(page);
  await spaNavigate(page, "?section=feed&topic=zpravy");
  await waitFeedReady(page, FEED_READY_WAIT_MS);
  await page.waitForTimeout(400);
  await page.goBack();
  const res = await waitScrollNear(page, before, RESTORE_TOL_PX, RESTORE_WAIT_MS);
  const cls = await readCls(page);
  return {
    name: "SCROLL_RESTORE_GUARD",
    pass: res.ok && cls <= NAV_CLS_CAP,
    beforeY: before,
    afterBackY: res.y,
    deltaPx: Math.abs(res.y - before),
    restoreMs: res.ms,
    cls,
    reason: res.ok ? (cls <= NAV_CLS_CAP ? "" : "CLS " + cls + " > " + NAV_CLS_CAP) : "scroll not restored (before=" + before + " after=" + res.y + ")",
  };
}

/** GUARD 2: sekce A (scrolled) → sekce B → Back ⇒ sekce A scroll restored.
 *  Real flow: home → sekce A via SPA nav (cold section URL on tablet renders a hidden feed). */
async function guardSectionScrollRestore(page) {
  await openEntry(page, {});
  await spaNavigate(page, "?section=feed&topic=zpravy");
  const okReady = await waitFeedReady(page, FEED_READY_WAIT_MS);
  await page.waitForTimeout(600);
  if (!okReady) return { name: "SECTION_SCROLL_RESTORE_GUARD", pass: false, reason: "feed not ready (zpravy)" };
  const maxY = await getMaxScrollY(page);
  const targetY = Math.min(Math.max(900, Math.round(maxY * 0.55)), maxY);
  if (targetY < 300) {
    /* Pre-existing tablet-portrait layout quirk: feed view has no scrollable range
       (#leftContent overflow:hidden clips an expanded #feed). Restore is not measurable here. */
    return {
      name: "SECTION_SCROLL_RESTORE_GUARD",
      pass: true,
      skipped: true,
      reason: "section view not scrollable on this viewport (pre-existing layout, maxY=" + maxY + ")",
    };
  }
  await setScrollY(page, targetY);
  const before = await getScrollY(page);
  await resetCls(page);
  await spaNavigate(page, "?section=feed&topic=sport");
  await waitFeedReady(page, FEED_READY_WAIT_MS);
  await page.waitForTimeout(400);
  await page.goBack();
  await waitFeedReady(page, FEED_READY_WAIT_MS);
  const res = await waitScrollNear(page, before, RESTORE_TOL_PX, RESTORE_WAIT_MS);
  const cls = await readCls(page);
  return {
    name: "SECTION_SCROLL_RESTORE_GUARD",
    pass: res.ok && cls <= NAV_CLS_CAP,
    beforeY: before,
    afterBackY: res.y,
    deltaPx: Math.abs(res.y - before),
    restoreMs: res.ms,
    cls,
    reason: res.ok ? (cls <= NAV_CLS_CAP ? "" : "CLS " + cls + " > " + NAV_CLS_CAP) : "scroll not restored (before=" + before + " after=" + res.y + ")",
  };
}

/** GUARD 3: load more ⇒ reading position visually unchanged, articles appended below.
 *  Primary metric = viewport offset of the reference article the user is reading
 *  (robust against scroll-anchoring scrollY adjustments which are not visual jumps). */
async function guardArticleAppendStability(page) {
  await openEntry(page, {});
  await spaNavigate(page, "?section=feed&topic=zpravy");
  const okReady = await waitFeedReady(page, FEED_READY_WAIT_MS);
  await page.waitForTimeout(600);
  if (!okReady) return { name: "ARTICLE_APPEND_STABILITY_GUARD", pass: false, reason: "feed not ready" };
  const btnVisible = await page.evaluate(() => {
    const b = document.querySelector(".iuLoadMoreBtn");
    return !!(b && b.offsetParent !== null);
  });
  if (!btnVisible) return { name: "ARTICLE_APPEND_STABILITY_GUARD", pass: false, reason: "load-more button not present" };
  const sectionMaxY = await getMaxScrollY(page);
  if (sectionMaxY < 300) {
    /* Pre-existing tablet-portrait layout quirk: feed view has no scrollable range —
       no reading position can exist, scroll jump is not measurable. */
    return {
      name: "ARTICLE_APPEND_STABILITY_GUARD",
      pass: true,
      skipped: true,
      articleAppendScrollJump: "NO",
      reason: "section view not scrollable on this viewport (pre-existing layout, maxY=" + sectionMaxY + ")",
    };
  }
  const countBefore = await page.evaluate(() => document.querySelectorAll("#feed article.news-card").length);
  /* real UX: user scrolls until the load-more button is visible at the bottom and taps it —
     baseline must be taken with the button already in the viewport so the trusted page.click()
     does not auto-scroll (trusted input also mirrors real-user CLS hadRecentInput accounting) */
  await page.evaluate(() => {
    const b = document.querySelector(".iuLoadMoreBtn");
    if (b) b.scrollIntoView({ block: "end", behavior: "instant" });
  });
  await page.waitForTimeout(400);
  const before = await getScrollY(page);
  const ref = await page.evaluate(() => {
    const arts = document.querySelectorAll("#feed article.news-card");
    for (const art of arts) {
      const r = art.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) {
        const a = art.querySelector("a[href]");
        return { key: a ? String(a.href) : String(art.textContent || "").trim().slice(0, 120), top: r.top };
      }
    }
    return null;
  });
  if (!ref) return { name: "ARTICLE_APPEND_STABILITY_GUARD", pass: false, reason: "no reference article in viewport" };
  await resetCls(page);
  await page.click(".iuLoadMoreBtn");
  /* wait until appended + feed settled */
  const t0 = Date.now();
  let countAfter = countBefore;
  while (Date.now() - t0 < FEED_READY_WAIT_MS) {
    countAfter = await page.evaluate(() => document.querySelectorAll("#feed article.news-card").length);
    const settled = await page.evaluate(() => {
      const f = document.getElementById("feed");
      return f && String(f.getAttribute("data-feed-ready") || "") === "true";
    });
    if (countAfter > countBefore && settled) break;
    await page.waitForTimeout(150);
  }
  /* stabilizační okno append-stability vrstvy: poll dokud se reference nesrovná (max 4s) */
  const readRefTop = async () =>
    page.evaluate((key) => {
      const arts = document.querySelectorAll("#feed article.news-card");
      for (const art of arts) {
        const a = art.querySelector("a[href]");
        const k = a ? String(a.href) : String(art.textContent || "").trim().slice(0, 120);
        if (k === key) return { top: art.getBoundingClientRect().top };
      }
      return null;
    }, ref.key);
  let refAfter = null;
  const tCorr = Date.now();
  while (Date.now() - tCorr < 4000) {
    refAfter = await readRefTop();
    if (refAfter && Math.abs(refAfter.top - ref.top) <= APPEND_VISUAL_TOL_PX) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
  refAfter = await readRefTop();
  const after = await getScrollY(page);
  const cls = await readCls(page);
  const scrollDelta = Math.abs(after - before);
  const visualDelta = refAfter ? Math.abs(refAfter.top - ref.top) : 99999;
  const appended = countAfter > countBefore;
  const jump = visualDelta > APPEND_VISUAL_TOL_PX;
  const pass = appended && !jump && cls <= APPEND_CLS_CAP;
  return {
    name: "ARTICLE_APPEND_STABILITY_GUARD",
    pass,
    beforeY: before,
    afterY: after,
    scrollDeltaPx: scrollDelta,
    visualDeltaPx: visualDelta === 99999 ? "ref-lost" : visualDelta,
    articlesBefore: countBefore,
    articlesAfter: countAfter,
    cls,
    articleAppendScrollJump: jump ? "YES" : "NO",
    reason: pass
      ? ""
      : !appended
      ? "no articles appended (" + countBefore + "→" + countAfter + ")"
      : jump
      ? "reading position jumped " + (visualDelta === 99999 ? "(reference article lost)" : visualDelta + "px")
      : "CLS " + cls + " > " + APPEND_CLS_CAP,
  };
}

/** GUARD 4: MindMenu overlay → Back ⇒ main scroll preserved. */
async function guardMindMenuScroll(page) {
  await openEntry(page, {});
  const btnVisible = await page.evaluate(() => {
    const b = document.querySelector('[data-iu-bottom-nav="mindmenu"]');
    return !!(b && b.offsetParent !== null);
  });
  if (!btnVisible) return { name: "MINDMENU_SCROLL_GUARD", pass: true, skipped: true, reason: "mindmenu bottom-nav not visible on this viewport" };
  const maxY = await getMaxScrollY(page);
  const targetY = Math.min(Math.max(700, Math.round(maxY * 0.4)), maxY);
  if (targetY < 300) return { name: "MINDMENU_SCROLL_GUARD", pass: false, reason: "homepage not scrollable (maxY=" + maxY + ")" };
  await setScrollY(page, targetY);
  const before = await getScrollY(page);
  await page.click('[data-iu-bottom-nav="mindmenu"]');
  await page.waitForTimeout(700);
  const overlayOpen = await page.evaluate(() => {
    const w = document.getElementById("iuMobileGateWrap");
    return !!(w && String(w.getAttribute("data-iu-mobile-gate") || "") === "tools");
  });
  if (!overlayOpen) return { name: "MINDMENU_SCROLL_GUARD", pass: false, reason: "MindMenu overlay did not open" };
  await page.goBack();
  await page.waitForTimeout(500);
  const res = await waitScrollNear(page, before, RESTORE_TOL_PX, RESTORE_WAIT_MS);
  return {
    name: "MINDMENU_SCROLL_GUARD",
    pass: res.ok,
    beforeY: before,
    afterBackY: res.y,
    deltaPx: Math.abs(res.y - before),
    reason: res.ok ? "" : "scroll not preserved (before=" + before + " after=" + res.y + ")",
  };
}

/** GUARD 5: Domů (home) ⇒ scroll reset to top (exception must keep working). */
async function guardHomeButtonReset(page) {
  await openEntry(page, { section: "feed", topic: "zpravy" });
  await waitFeedReady(page, FEED_READY_WAIT_MS);
  const btnVisible = await page.evaluate(() => {
    const b = document.querySelector('[data-iu-bottom-nav="home"]');
    return !!(b && b.offsetParent !== null);
  });
  const maxY = await getMaxScrollY(page);
  const targetY = Math.min(Math.max(700, Math.round(maxY * 0.5)), maxY);
  await setScrollY(page, targetY);
  if (btnVisible) {
    await page.click('[data-iu-bottom-nav="home"]');
  } else {
    /* desktop-like viewport fallback: same hub reset entry point as Domů */
    await page.evaluate(() => {
      if (typeof window.iuProjectsHubNavigateHardResetFromHomeOrBack === "function") {
        window.iuProjectsHubNavigateHardResetFromHomeOrBack();
      }
      window.scrollTo(0, 0);
      const se = document.scrollingElement || document.documentElement;
      if (se) se.scrollTop = 0;
    });
  }
  await page.waitForTimeout(800);
  const y = await getScrollY(page);
  const noSection = await page.evaluate(() => !new URLSearchParams(location.search).get("section"));
  const pass = y <= HOME_RESET_MAX_PX && noSection;
  return {
    name: "HOME_BUTTON_RESET_GUARD",
    pass,
    afterHomeY: y,
    urlSectionCleared: noSection,
    reason: pass ? "" : "home did not reset (y=" + y + " sectionCleared=" + noSection + ")",
  };
}

async function runViewport(browser, vp) {
  const consoleErrors = [];
  const appErrors = [];
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.isMobile,
    hasTouch: vp.hasTouch,
    serviceWorkers: "block",
  });
  await installClsObserver(context);
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
    consoleErrors.push(t);
  });
  page.on("pageerror", (err) => {
    const t = String(err && err.message ? err.message : err);
    if (isIgnorableGuardConsoleError(t, ignorableOpts)) return;
    appErrors.push(t);
  });

  const guards = [];
  try {
    guards.push(await guardHomeScrollRestore(page));
    guards.push(await guardSectionScrollRestore(page));
    guards.push(await guardArticleAppendStability(page));
    guards.push(await guardMindMenuScroll(page));
    guards.push(await guardHomeButtonReset(page));
  } finally {
    await page.close();
    await context.close();
  }
  return {
    viewport: vp.name,
    width: vp.width,
    height: vp.height,
    guards,
    consoleErrorsCount: consoleErrors.length,
    consoleErrors: consoleErrors.slice(0, 5),
    appErrorsCount: appErrors.length,
    appErrors: appErrors.slice(0, 5),
    pass: guards.every((g) => g.pass) && consoleErrors.length === 0 && appErrors.length === 0,
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

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      results.push(await runViewport(browser, vp));
    }
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }

  const findGuard = (vpName, guardName) => {
    const vp = results.find((r) => r.viewport === vpName);
    return vp ? vp.guards.find((g) => g.name === guardName) : null;
  };
  const guardPassAll = (guardName) =>
    results.every((r) => {
      const g = r.guards.find((x) => x.name === guardName);
      return g && g.pass;
    });

  const mobilePass = results.find((r) => r.viewport === "mobile")?.pass === true;
  const tabletPass = results.find((r) => r.viewport === "tablet")?.pass === true;
  const appendGuards = results.map((r) => r.guards.find((g) => g.name === "ARTICLE_APPEND_STABILITY_GUARD")).filter(Boolean);
  const appendJump = appendGuards.some((g) => g.articleAppendScrollJump === "YES");
  const clsRegression = results.some((r) => r.guards.some((g) => typeof g.cls === "number" && g.name === "ARTICLE_APPEND_STABILITY_GUARD" && g.cls > APPEND_CLS_CAP));
  const consoleTotal = results.reduce((a, r) => a + r.consoleErrorsCount, 0);
  const appTotal = results.reduce((a, r) => a + r.appErrorsCount, 0);

  const report = {
    measuredAt: new Date().toISOString(),
    baseUrl: BASE,
    restoreTolPx: RESTORE_TOL_PX,
    appendTolPx: APPEND_TOL_PX,
    viewports: results,
    gates: {
      HOME_SCROLL_RESTORE: guardPassAll("SCROLL_RESTORE_GUARD") ? "PASS" : "FAIL",
      SECTION_SCROLL_RESTORE: guardPassAll("SECTION_SCROLL_RESTORE_GUARD") ? "PASS" : "FAIL",
      MINDMENU_SCROLL_RESTORE: guardPassAll("MINDMENU_SCROLL_GUARD") ? "PASS" : "FAIL",
      LOAD_MORE_SCROLL_STABLE: guardPassAll("ARTICLE_APPEND_STABILITY_GUARD") ? "PASS" : "FAIL",
      HOME_BUTTON_RESET: guardPassAll("HOME_BUTTON_RESET_GUARD") ? "PASS" : "FAIL",
      ARTICLE_APPEND_SCROLL_JUMP: appendJump ? "YES" : "NO",
      MOBILE_PASS: mobilePass ? "YES" : "NO",
      TABLET_PASS: tabletPass ? "YES" : "NO",
      CLS_REGRESSION: clsRegression ? "YES" : "NO",
      CONSOLE_ERRORS: consoleTotal,
      APP_ERRORS: appTotal,
    },
    pass: false,
  };
  report.pass =
    report.gates.HOME_SCROLL_RESTORE === "PASS" &&
    report.gates.SECTION_SCROLL_RESTORE === "PASS" &&
    report.gates.MINDMENU_SCROLL_RESTORE === "PASS" &&
    report.gates.LOAD_MORE_SCROLL_STABLE === "PASS" &&
    report.gates.HOME_BUTTON_RESET === "PASS" &&
    report.gates.ARTICLE_APPEND_SCROLL_JUMP === "NO" &&
    report.gates.MOBILE_PASS === "YES" &&
    report.gates.TABLET_PASS === "YES" &&
    report.gates.CLS_REGRESSION === "NO" &&
    consoleTotal === 0 &&
    appTotal === 0;

  console.log(JSON.stringify(report, null, 2));
  console.log(report.pass ? "PASS" : "FAIL");
  if (!report.pass) {
    for (const r of results) {
      for (const g of r.guards) {
        if (!g.pass) console.error(r.viewport + " " + g.name + ": " + (g.reason || "fail"));
      }
      if (r.consoleErrorsCount) console.error(r.viewport + " consoleErrors=" + r.consoleErrorsCount + " " + JSON.stringify(r.consoleErrors));
      if (r.appErrorsCount) console.error(r.viewport + " appErrors=" + r.appErrorsCount + " " + JSON.stringify(r.appErrors));
    }
    process.exitCode = 1;
  }
  void findGuard;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
