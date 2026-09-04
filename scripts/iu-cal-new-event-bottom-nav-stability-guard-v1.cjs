#!/usr/bin/env node
"use strict";

/**
 * Calendar Nová událost (mobile/tablet): bottom nav must stay stable on open/close.
 *
 * Root cause (fixed): syncCalBottomSheet autofocused title → iu-keyboard-open grace
 * hid #iuMobileBottomNav and zeroed --bottom-nav-height → nav flash + sheet margin jump.
 * Secondary: documentElement.overflow=hidden while calendar overlay already locked body.
 *
 * Contract:
 *   - Source: no title autofocus in syncCalBottomSheet; skip html overflow when overlay open
 *   - Runtime: open sheet via + Přidat událost → nav geometry + --bottom-nav-height stable
 *     across grace window; no iu-keyboard-open; title not focused; close restores same nav
 */

const fs = require("fs");
const path = require("path");
const { chromium, webkit } = require("playwright");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
} = require("./proofs/open_meteo_guard_stub.cjs");

const REPO = path.join(__dirname, "..");
const DEFAULT_URL = process.env.IU_CAL_SHEET_NAV_GUARD_URL || process.env.SILVER_HOME_UX_GUARD_URL || "http://127.0.0.1:8099/";
const VIEWPORTS = [
  { w: 390, h: 844, label: "390p" },
  { w: 768, h: 1024, label: "768p" },
];
const TOL_PX = 2;

function assertSourceContract() {
  const cal = fs.readFileSync(path.join(REPO, "assets", "iu-calendar-overlay-v1.js"), "utf8");
  const syncStart = cal.indexOf("function syncCalBottomSheet");
  const syncEnd = cal.indexOf("function closeCalBottomSheet");
  const syncBody = syncStart >= 0 && syncEnd > syncStart ? cal.slice(syncStart, syncEnd) : "";
  const noAutofocus =
    syncBody.length > 0 &&
    !/data-iu-cal-inline-field=["']title["'][\s\S]{0,120}\.focus\s*\(/.test(syncBody) &&
    !/\.focus\s*\(\s*\{\s*preventScroll:\s*true\s*\}\s*\)/.test(syncBody);
  const hasNoAutofocusComment =
    /Do NOT autofocus title on mobile bottom sheet open/.test(syncBody) ||
    /iu-keyboard-open grace/.test(syncBody);
  const lockStart = cal.indexOf("function syncCalendarScrollLocks");
  const lockEnd = cal.indexOf("function openCalDeleteConfirm");
  const lockBody = lockStart >= 0 && lockEnd > lockStart ? cal.slice(lockStart, lockEnd) : "";
  const skipsHtmlOverflowWhenOverlay =
    /iu-calendarOverlay-open[\s\S]{0,220}documentElement\.style\.overflow\s*=\s*"hidden"/.test(
      lockBody
    ) &&
    /if\s*\(\s*!document\.body\.classList\.contains\(\s*"iu-calendarOverlay-open"\s*\)\s*\)/.test(
      lockBody
    );
  return {
    pass: noAutofocus && hasNoAutofocusComment && skipsHtmlOverflowWhenOverlay,
    noAutofocus,
    hasNoAutofocusComment,
    skipsHtmlOverflowWhenOverlay,
  };
}

async function dismiss(page) {
  await page.evaluate(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
    } catch (_) {}
    document.querySelectorAll(".iu-ldp-backdrop").forEach((el) => el.remove());
  });
}

async function waitCalendarReady(page) {
  await page.waitForFunction(
    () =>
      window.iuCalendarService &&
      !window.iuCalendarService.__iuCalendarLazyStub &&
      typeof window.iuCalendarService.openOverlay === "function",
    { timeout: 45000 }
  );
}

async function openCalendar(page) {
  await waitCalendarReady(page);
  await page.evaluate(() => window.iuCalendarService.openOverlay());
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuCalendarOverlay");
    return !!(ov && !ov.hidden);
  }, { timeout: 20000 });
  await page.waitForTimeout(400);
  // Ensure month view so FAB is present
  await page.evaluate(() => {
    const btn = document.querySelector('#iuCalendarOverlay [data-iu-cal-view="month"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(350);
}

function readNavSnap() {
  return {
    fn: () => {
      const nav = document.getElementById("iuMobileBottomNav");
      if (!nav) return { ok: false, reason: "missing_nav" };
      const r = nav.getBoundingClientRect();
      const st = getComputedStyle(nav);
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      const title = document.querySelector(
        '#iuCalEventBottomSheet [data-iu-cal-inline-field="title"]'
      );
      const sheet = document.getElementById("iuCalEventBottomSheet");
      return {
        ok: true,
        bottom: Math.round(r.bottom * 100) / 100,
        top: Math.round(r.top * 100) / 100,
        height: Math.round(r.height * 100) / 100,
        display: st.display,
        visibility: st.visibility,
        bottomNavHeightVar: String(cs.getPropertyValue("--bottom-nav-height") || "").trim(),
        kbOpen: root.classList.contains("iu-keyboard-open"),
        sheetOpen: !!(sheet && !sheet.hidden),
        titleFocused: !!(title && document.activeElement === title),
        htmlOverflow: String(root.style.overflow || ""),
        navConnected: nav.isConnected,
      };
    },
  };
}

function near(a, b, tol) {
  return Math.abs(Number(a) - Number(b)) <= tol;
}

async function sampleNavStability(page, baseline, durationMs) {
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < durationMs) {
    samples.push(await page.evaluate(readNavSnap().fn));
    await page.waitForTimeout(50);
  }
  const bad = samples.filter((s) => {
    if (!s.ok) return true;
    if (s.kbOpen) return true;
    if (s.display === "none" || s.visibility === "hidden") return true;
    if (!near(s.bottom, baseline.bottom, TOL_PX)) return true;
    if (!near(s.height, baseline.height, TOL_PX)) return true;
    if (!near(s.top, baseline.top, TOL_PX)) return true;
    if (s.bottomNavHeightVar !== baseline.bottomNavHeightVar) return true;
    if (!s.navConnected) return true;
    return false;
  });
  return { samples, badCount: bad.length, firstBad: bad[0] || null };
}

async function openNewEventSheet(page) {
  const clicked = await page.evaluate(() => {
    const fab = document.querySelector("#iuCalMonthActionBar [data-iu-cal-month-fab]");
    if (fab) {
      fab.click();
      return "fab";
    }
    return "";
  });
  if (!clicked) throw new Error("month_fab_missing");
  await page.waitForFunction(() => {
    const sheet = document.getElementById("iuCalEventBottomSheet");
    return !!(sheet && !sheet.hidden);
  }, { timeout: 10000 });
}

async function closeNewEventSheet(page) {
  await page.evaluate(() => {
    const cancel = document.querySelector(
      '#iuCalEventBottomSheet [data-iu-cal-inline-cancel], #iuCalEventBottomSheet [data-iu-cal-bs-close]'
    );
    if (cancel) cancel.click();
  });
  await page.waitForFunction(() => {
    const sheet = document.getElementById("iuCalEventBottomSheet");
    return !sheet || sheet.hidden;
  }, { timeout: 10000 });
  await page.waitForTimeout(200);
}

async function runViewport(page, vp) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.goto(DEFAULT_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1500);
  await dismiss(page);
  await openCalendar(page);

  const before = await page.evaluate(readNavSnap().fn);
  if (!before.ok || before.height < 40) {
    return { vp: vp.label, pass: false, stage: "before", before };
  }

  await openNewEventSheet(page);
  const immediately = await page.evaluate(readNavSnap().fn);
  const stability = await sampleNavStability(page, before, 520);
  const afterOpen = await page.evaluate(readNavSnap().fn);

  const openPass =
    immediately.ok &&
    afterOpen.ok &&
    afterOpen.sheetOpen === true &&
    afterOpen.titleFocused === false &&
    afterOpen.kbOpen === false &&
    afterOpen.htmlOverflow !== "hidden" &&
    near(afterOpen.bottom, before.bottom, TOL_PX) &&
    near(afterOpen.height, before.height, TOL_PX) &&
    afterOpen.bottomNavHeightVar === before.bottomNavHeightVar &&
    stability.badCount === 0;

  await closeNewEventSheet(page);
  const afterClose = await page.evaluate(readNavSnap().fn);
  const closePass =
    afterClose.ok &&
    afterClose.sheetOpen === false &&
    afterClose.kbOpen === false &&
    near(afterClose.bottom, before.bottom, TOL_PX) &&
    near(afterClose.height, before.height, TOL_PX) &&
    afterClose.bottomNavHeightVar === before.bottomNavHeightVar;

  return {
    vp: vp.label,
    pass: openPass && closePass,
    openPass,
    closePass,
    before,
    immediately,
    afterOpen,
    afterClose,
    stabilityBad: stability.badCount,
    firstBad: stability.firstBad,
  };
}

async function runEngine(engineType, label) {
  const browser = await engineType.launch({ headless: true });
  const context = await browser.newContext({ hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await installProofGuardNetworkStubs(page);
  createIgnorableResourceTracker().attachToPage(page);
  const rows = [];
  for (let i = 0; i < VIEWPORTS.length; i++) {
    rows.push(await runViewport(page, VIEWPORTS[i]));
  }
  await browser.close();
  return rows.map((r) => Object.assign({ engine: label }, r));
}

async function main() {
  const src = assertSourceContract();
  const skipWebkit =
    String(process.env.IU_CAL_SHEET_NAV_SKIP_WEBKIT || "").trim() === "1" ||
    String(process.env.IU_CAL_SHEET_NAV_SKIP_WEBKIT || "").toLowerCase() === "true";

  const chromiumRows = await runEngine(chromium, "chromium");
  let webkitRows = [];
  if (skipWebkit) {
    process.stdout.write("WEBKIT_SKIPPED reason=IU_CAL_SHEET_NAV_SKIP_WEBKIT\n");
  } else {
    webkitRows = await runEngine(webkit, "webkit");
  }
  const rows = chromiumRows.concat(webkitRows);
  const runtimePass = rows.every((r) => r.pass);
  const pass = src.pass && runtimePass;

  process.stdout.write("=== IU_CAL_NEW_EVENT_BOTTOM_NAV_STABILITY_GUARD_V1 ===\n");
  process.stdout.write(
    "ROOT_CAUSE: sheet title autofocus → keyboard-open grace hides bottom nav / zeros --bottom-nav-height; html overflow lock reflow\n"
  );
  process.stdout.write(
    "SOURCE: " +
      (src.pass ? "PASS" : "FAIL") +
      " noAutofocus=" +
      src.noAutofocus +
      " skipHtmlOverflow=" +
      src.skipsHtmlOverflowWhenOverlay +
      "\n"
  );
  process.stdout.write("RUNTIME: " + (runtimePass ? "PASS" : "FAIL") + "\n");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    process.stdout.write(
      r.engine +
        " " +
        r.vp +
        " pass=" +
        (r.pass ? "PASS" : "FAIL") +
        " open=" +
        (r.openPass ? "PASS" : "FAIL") +
        " close=" +
        (r.closePass ? "PASS" : "FAIL") +
        " stabilityBad=" +
        (r.stabilityBad || 0) +
        " titleFocused=" +
        !!(r.afterOpen && r.afterOpen.titleFocused) +
        " kbOpen=" +
        !!(r.afterOpen && r.afterOpen.kbOpen) +
        "\n"
    );
  }
  process.stdout.write("REAL_IOS_PHYSICAL_TEST: NOT_TESTED\n");
  process.stdout.write("SAFETY: " + (pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_IU_CAL_NEW_EVENT_BOTTOM_NAV_STABILITY_GUARD_V1 ===\n");
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
