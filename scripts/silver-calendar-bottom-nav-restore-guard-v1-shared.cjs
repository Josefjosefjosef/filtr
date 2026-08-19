#!/usr/bin/env node
"use strict";

const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const DEFAULT_URL = "http://127.0.0.1:8091/projects/?section=media";
const CLS_CAP = 0.02;
const VIEWPORTS = [
  { w: 390, h: 844, label: "mobile" },
  { w: 768, h: 1024, label: "tablet" },
];

function envUrl() {
  const u = String(
    process.env.SILVER_CALENDAR_BOTTOM_NAV_GUARD_URL ||
      process.env.SILVER_LAYOUT_GUARD_URL ||
      DEFAULT_URL
  ).trim();
  return u || DEFAULT_URL;
}

async function installClsObserver(context) {
  await context.addInitScript(() => {
    try {
      window.__iuCalBottomNavCls = 0;
      new PerformanceObserver(function (list) {
        const entries = list.getEntries();
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (!e.hadRecentInput && e.value) {
            window.__iuCalBottomNavCls = (window.__iuCalBottomNavCls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
}

async function readCls(page) {
  return page.evaluate(() => Number(window.__iuCalBottomNavCls || 0));
}

async function waitForCalendarReady(page) {
  await page.waitForFunction(
    () => window.iuCalendarService && typeof window.iuCalendarService.openOverlay === "function",
    null,
    { timeout: 90000 }
  );
  await page.waitForTimeout(800);
}

async function openCalendar(page) {
  await waitForCalendarReady(page);
  let opened = false;
  try {
    await page.locator("#iuHeroQuickCal").scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.click("#iuHeroQuickCal", { timeout: 15000, force: true });
    await page.waitForTimeout(500);
    opened = await page.evaluate(() => {
      const ov = document.getElementById("iuCalendarOverlay");
      return !!(ov && !ov.hidden && ov.getAttribute("aria-hidden") !== "true");
    });
  } catch (_) {}
  if (!opened) {
    await page.evaluate(() => {
      if (window.iuCalendarService && typeof window.iuCalendarService.openOverlay === "function") {
        window.iuCalendarService.openOverlay();
      }
    });
    await page.waitForTimeout(500);
  }
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuCalendarOverlay");
    return !!(ov && !ov.hidden && ov.getAttribute("aria-hidden") !== "true");
  }, null, { timeout: 15000 });
  await page.waitForTimeout(400);
}

async function setCalendarView(page, view) {
  await page.evaluate((v) => {
    const btn = document.querySelector('#iuCalendarOverlay [data-iu-cal-view="' + v + '"]');
    if (btn && typeof btn.click === "function") btn.click();
  }, view);
  await page.waitForFunction(
    (v) => {
      const root = document.getElementById("iuCalendarViewRoot");
      return !!(root && root.getAttribute("data-view") === v);
    },
    view,
    { timeout: 8000 }
  );
  await page.waitForTimeout(350);
}

function navLabels() {
  return ["Domů", "Menu", "MindMenu", "Zpět"];
}

async function auditCalendarView(page, viewLabel) {
  return page.evaluate(({ viewLabel, expectedLabels }) => {
    const ov = document.getElementById("iuCalendarOverlay");
    const bottomNav = document.getElementById("iuMobileBottomNav");
    const searchBtn = document.querySelector("#iuCalMonthActionBar .iu-calSearchFab");
    const addBtn = document.querySelector("#iuCalMonthActionBar .iu-calMonthFab");
    const docEl = document.documentElement;
    const body = document.body;
    const overflowX =
      (docEl && docEl.scrollWidth > docEl.clientWidth + 1) ||
      (body && body.scrollWidth > body.clientWidth + 1);

    function rect(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
    }

    function visible(el) {
      if (!el) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    function overlaps(a, b) {
      if (!a || !b) return false;
      return a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2;
    }

    const navSt = bottomNav ? getComputedStyle(bottomNav) : null;
    const ovSt = ov ? getComputedStyle(ov) : null;
    const navRect = rect(bottomNav);
    const searchRect = rect(searchBtn);
    const addRect = rect(addBtn);
    const btnBottom = Math.max(
      searchRect ? searchRect.bottom : 0,
      addRect ? addRect.bottom : 0
    );
    const gapToNavPx =
      navRect && btnBottom > 0
        ? Math.round((navRect.top - btnBottom) * 100) / 100
        : null;
    const gapOk = gapToNavPx != null && gapToNavPx >= 8 && gapToNavPx <= 12;
    const navButtons = bottomNav
      ? Array.from(bottomNav.querySelectorAll("[data-iu-bottom-nav]")).map((btn) => ({
          key: btn.getAttribute("data-iu-bottom-nav"),
          label: (btn.querySelector(".iu-mobileBottomNav__label") || {}).textContent || "",
          visible: visible(btn),
        }))
      : [];

    const labelsOk = expectedLabels.every((label) =>
      navButtons.some((b) => String(b.label || "").trim() === label && b.visible)
    );
    const silverOk = navButtons.some((b) => b.key === "silver" && b.visible);

    const navVisible = visible(bottomNav);
    const searchVisible = visible(searchBtn);
    const addVisible = visible(addBtn);
    const navAboveOverlay = navSt && ovSt ? Number(navSt.zIndex || 0) > Number(ovSt.zIndex || 0) : false;
    const navNotOverlappedByDialog =
      !navRect ||
      !searchRect ||
      !overlaps(navRect, searchRect);
    const addNotOverlapped =
      !navRect || !addRect || !overlaps(navRect, addRect);
    const searchNotOverlapped =
      !navRect || !searchRect || !overlaps(navRect, searchRect);

    return {
      viewLabel,
      overlayOpen: !!(ov && !ov.hidden),
      navVisible,
      navAboveOverlay,
      overlayZ: ovSt ? Number(ovSt.zIndex || 0) : null,
      navZ: navSt ? Number(navSt.zIndex || 0) : null,
      labelsOk,
      silverOk,
      searchVisible,
      addVisible,
      buttonsNotOverlapped: navNotOverlappedByDialog && addNotOverlapped && searchNotOverlapped,
      gapToNavPx,
      gapOk,
      overflowX,
      navButtonCount: navButtons.filter((b) => b.visible).length,
    };
  }, { viewLabel, expectedLabels: navLabels() });
}

async function openTasksForCompare(page) {
  await page.evaluate(() => {
    if (window.iuTasksService && typeof window.iuTasksService.openOverlay === "function") {
      window.iuTasksService.openOverlay();
      return;
    }
    const btn = document.getElementById("iuHeroQuickTasks");
    if (btn && typeof btn.click === "function") btn.click();
  });
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuTasksOverlay");
    return !!(ov && !ov.hidden);
  }, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(350);
}

async function openNotesForCompare(page) {
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureNotesOverlay === "function") {
      await window.__iuEnsureNotesOverlay();
    }
    if (window.iuNotesService && typeof window.iuNotesService.openOverlay === "function") {
      await window.iuNotesService.openOverlay();
      return;
    }
    const btn = document.getElementById("iuHeroQuickNotes");
    if (btn && typeof btn.click === "function") btn.click();
  });
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuNotesOverlay");
    return !!(ov && !ov.hidden);
  }, null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(350);
}

async function readNavSnapshot(page) {
  return page.evaluate(() => {
    const bottomNav = document.getElementById("iuMobileBottomNav");
    if (!bottomNav) return null;
    const st = getComputedStyle(bottomNav);
    const r = bottomNav.getBoundingClientRect();
    const btns = Array.from(bottomNav.querySelectorAll(".iu-mobileBottomNav__btn")).map((btn) => {
      const br = btn.getBoundingClientRect();
      const ls = getComputedStyle(btn);
      return {
        key: btn.getAttribute("data-iu-bottom-nav"),
        height: Math.round(br.height * 100) / 100,
        minHeight: ls.minHeight,
        fontSize: ls.fontSize,
      };
    });
    return {
      height: Math.round(r.height * 100) / 100,
      minHeight: st.minHeight,
      paddingBottom: st.paddingBottom,
      display: st.display,
      zIndex: Number(st.zIndex || 0),
      buttons: btns,
    };
  });
}

async function closeOverlay(page) {
  await page.evaluate(() => {
    if (window.iuCalendarService && typeof window.iuCalendarService.closeOverlay === "function") {
      window.iuCalendarService.closeOverlay();
    }
  });
  await page.waitForTimeout(250);
}

async function runViewport(page, vp) {
  await installProofGuardNetworkStubs(page);
  const ignorableTracker = createIgnorableResourceTracker();
  ignorableTracker.attachToPage(page);

  let consoleErrorsCount = 0;
  let appErrorsCount = 0;
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (isIgnorableGuardConsoleError(t, { hadRecentIgnorableFailure: ignorableTracker.hadRecentIgnorableFailure.bind(ignorableTracker) })) return;
      consoleErrorsCount += 1;
    }
  });
  page.on("pageerror", (err) => {
    try {
      const t = String(err && err.message ? err.message : err);
      if (isIgnorableGuardConsoleError(t)) return;
      appErrorsCount += 1;
    } catch (_) {}
  });

  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.goto(envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => !!document.getElementById("iuSilverTallScrollViewport"), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    window.__iuCalBottomNavCls = 0;
  });

  await openCalendar(page);
  const month = await auditCalendarView(page, "month");

  await setCalendarView(page, "year");
  const year = await auditCalendarView(page, "year");

  const calNavSnap = await readNavSnapshot(page);
  await closeOverlay(page);

  await openTasksForCompare(page);
  const tasksNavSnap = await readNavSnapshot(page);
  await page.evaluate(() => {
    if (window.iuTasksService && typeof window.iuTasksService.closeOverlay === "function") {
      window.iuTasksService.closeOverlay();
    }
  });
  await page.waitForTimeout(250);

  await openNotesForCompare(page);
  const notesNavSnap = await readNavSnapshot(page);

  const cls = await readCls(page);

  function sameNav(a, b) {
    if (!a || !b) return false;
    if (Math.abs(a.height - b.height) > 2) return false;
    if (a.display !== b.display) return false;
    if (a.buttons.length !== b.buttons.length) return false;
    for (let i = 0; i < a.buttons.length; i++) {
      const x = a.buttons[i];
      const y = b.buttons[i];
      if (x.key !== y.key) return false;
      if (Math.abs(x.height - y.height) > 2) return false;
    }
    return true;
  }

  return {
    label: vp.label,
    month,
    year,
    same_navigation_as_tasks: sameNav(calNavSnap, tasksNavSnap),
    same_navigation_as_notes: sameNav(calNavSnap, notesNavSnap),
    cls,
    overflowX: !!(month.overflowX || year.overflowX),
    consoleErrorsCount,
    appErrorsCount,
  };
}

async function runGuard() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await installClsObserver(context);

  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      const page = await context.newPage();
      try {
        results.push(await runViewport(page, vp));
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const monthNav = results.every((r) => r.month.navVisible && r.month.labelsOk && r.month.silverOk && r.month.navAboveOverlay);
  const yearNav = results.every((r) => r.year.navVisible && r.year.labelsOk && r.year.silverOk && r.year.navAboveOverlay);
  const buttonsOk = results.every((r) => r.month.buttonsNotOverlapped && r.year.buttonsNotOverlapped);
  const gapOk = results.every((r) => r.month.gapOk && r.year.gapOk);
  const mobileOk = results.some((r) => r.label === "mobile" && r.month.navVisible && r.year.navVisible);
  const tabletOk = results.some((r) => r.label === "tablet" && r.month.navVisible && r.year.navVisible);
  const overflowX = results.some((r) => r.overflowX);
  const cls = Math.max(...results.map((r) => r.cls));
  const consoleErrorsCount = results.reduce((s, r) => s + r.consoleErrorsCount, 0);
  const appErrorsCount = results.reduce((s, r) => s + r.appErrorsCount, 0);
  const sameTasks = results.every((r) => r.same_navigation_as_tasks);
  const sameNotes = results.every((r) => r.same_navigation_as_notes);

  const pass =
    monthNav &&
    yearNav &&
    buttonsOk &&
    gapOk &&
    mobileOk &&
    tabletOk &&
    !overflowX &&
    cls <= CLS_CAP &&
    consoleErrorsCount === 0 &&
    appErrorsCount === 0 &&
    sameTasks &&
    sameNotes;

  return {
    guard: "SILVER_CALENDAR_BOTTOM_NAV_RESTORE_PLAYWRIGHT_V1",
    pass,
    monthNav,
    yearNav,
    buttonsOk,
    gapOk,
    mobileOk,
    tabletOk,
    overflowX,
    cls,
    consoleErrorsCount,
    appErrorsCount,
    sameTasks,
    sameNotes,
    results,
    ts: new Date().toISOString(),
  };
}

async function main() {
  const out = await runGuard();
  process.stdout.write(JSON.stringify(out) + "\n");
  if (!out.pass) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
    process.exitCode = 1;
  });
}

module.exports = { runGuard, envUrl };
