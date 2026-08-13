#!/usr/bin/env node
"use strict";

/**
 * P0 forensic + real-route geometry guard for Datum/Čas vs Název.
 *
 * Why this exists:
 * PR #9706 / silver-home-date-time-input-fit-guard-v1 claimed 72/72 PASS while
 * physical iPhone Calendar + Tasks overlays still show DATE/TIME wider than TITLE.
 *
 * This guard:
 * 1) Static-audits the old guard for false coverage (Silver-only geometry, fake edit probe,
 *    Calendar/Tasks "covered" only via CSS source contract).
 * 2) Opens REAL user routes (Calendar overlay create, Tasks overlay create) on
 *    https://infouzel.cz/ (or IU_DATETIME_GUARD_URL) with LDP pre-accepted BEFORE navigation
 *    (calendar init awaits ensureLocalDataProtectionBeforeSave during first writeStore).
 * 3) Requires unique visible elements (match count === 1) — never first querySelector win.
 * 4) Measures border-box geometry for Calendar + Tasks.
 * 5) Refuses overall PASS unless REAL_IOS_CONFIRMED=1 is explicitly set after a physical
 *    iPhone verification. Playwright WebKit ≠ real iOS WebKit for native date/time chrome.
 *
 * Default result on current main after #9706: FAIL (trust / real-iOS unverified and/or
 * false-coverage audit). Does not modify page CSS/DOM before measurement.
 */

const fs = require("fs");
const path = require("path");
const { chromium, webkit } = require("playwright");

const DEFAULT_URL = "https://infouzel.cz/";
const TOL_PX = 1;
const VIEWPORT = { width: 390, height: 844 };
const DSF = 3;
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

function envUrl() {
  const u = String(process.env.IU_DATETIME_GUARD_URL || process.env.SILVER_HOME_UX_GUARD_URL || DEFAULT_URL).trim();
  const resolved = u || DEFAULT_URL;
  if (/infouzel\.cz\/projects\/?/i.test(resolved) && !/\/projects\/data\//i.test(resolved)) {
    throw new Error("FORBIDDEN_PROD_HUB_URL:" + resolved + " use https://infouzel.cz/");
  }
  return resolved;
}

function realIosConfirmed() {
  const v = String(process.env.REAL_IOS_CONFIRMED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function auditOldGuardFalseCoverage() {
  const oldPath = path.join(__dirname, "silver-home-date-time-input-fit-guard-v1.cjs");
  const src = fs.readFileSync(oldPath, "utf8");
  const findings = [];

  const measuresSilverQuick =
    /cardSel:\s*"\.iuSilverDraftCard--quickTemplateEmpty/.test(src) &&
    /measureQuick\(/.test(src);
  if (!measuresSilverQuick) findings.push("OLD_GUARD_MISSING_SILVER_QUICK_MEASURE");

  const editIsAlias = /async function measureEditProbe[\s\S]{0,220}return measureQuick\(page,\s*kind\)/.test(src);
  if (editIsAlias) {
    findings.push("EDIT_PROBE_ALIASES_SILVER_CREATE");
  } else {
    findings.push("EDIT_PROBE_NOT_ALIAS_UNEXPECTED");
  }

  const calendarGeomLive =
    /iu-calInline__dateInput/.test(src) &&
    /getBoundingClientRect/.test(src) &&
    /iuCalendarService|iu-cal-month-fab|data-iu-cal-inline-root/.test(src) &&
    !/via CSS contract/.test(src);
  // Old guard mentions calInline only inside CSS contract / surfaces_covered comments.
  const calendarOnlyCssContract =
    /Calendar overlay[\s\S]{0,80}via CSS contract/.test(src) ||
    (/iu-calInline__dateInput[\s\S]{0,80}min-width:\s*0\s*!important/.test(src) &&
      !/data-iu-cal-inline-root/.test(src));
  if (calendarOnlyCssContract) findings.push("CALENDAR_OVERLAY_ONLY_CSS_CONTRACT");

  const tasksOnlyCssContract =
    /Tasks overlay[\s\S]{0,80}via CSS contract/.test(src) ||
    (/#iuTaskDue/.test(src) && !/getElementById\("iuTaskDue"\)/.test(src) && !/iuTasksService/.test(src));
  if (tasksOnlyCssContract) findings.push("TASKS_OVERLAY_ONLY_CSS_CONTRACT");

  const softPassWebkit = /WEBKIT_SOFT_PASS|ci_webkit_page_crash_after_retries/.test(src);
  if (softPassWebkit) findings.push("WEBKIT_SOFT_PASS_ALLOWED");

  const falseCoverage =
    editIsAlias && calendarOnlyCssContract && tasksOnlyCssContract && measuresSilverQuick;

  return {
    oldGuardPath: oldPath,
    falseCoverage,
    findings,
    pass: !falseCoverage, // audit PASS only if old guard is NOT falsely covering
  };
}

function measureSnippet() {
  return ({ form, tol }) => {
    const TOL = Number(tol) || 1;
    function vis(el) {
      if (!el || !el.isConnected) return false;
      if (el.hidden) return false;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }
    function box(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return {
        tag: el.tagName,
        type: el.getAttribute("type") || "",
        id: el.id || "",
        className: String(el.className || "").slice(0, 160),
        left: Math.round(r.left * 100) / 100,
        right: Math.round(r.right * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
        minWidth: st.minWidth,
        maxWidth: st.maxWidth,
        paddingRight: st.paddingRight,
        boxSizing: st.boxSizing,
        overflowX: st.overflowX,
        appearance: st.appearance || st.webkitAppearance || "",
      };
    }

    const out = {
      form,
      href: location.href,
      pathname: location.pathname,
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    };

    if (form === "calendar") {
      const roots = Array.from(document.querySelectorAll("[data-iu-cal-inline-root]")).filter(vis);
      out.ROOT_MATCH_COUNT = document.querySelectorAll("[data-iu-cal-inline-root]").length;
      out.ROOT_VISIBLE_COUNT = roots.length;
      if (roots.length !== 1) {
        out.ok = false;
        out.reason = "CALENDAR_ROOT_NOT_UNIQUE_VISIBLE";
        return out;
      }
      const root = roots[0];
      const dates = Array.from(
        root.querySelectorAll('input[type="date"], input.iu-calInline__dateInput')
      ).filter(vis);
      const times = Array.from(root.querySelectorAll(".iu-calInline__timeBtn")).filter(vis);
      const titles = Array.from(root.querySelectorAll('[data-iu-cal-inline-field="title"]')).filter(
        vis
      );
      const addresses = Array.from(
        root.querySelectorAll('[data-iu-cal-inline-field="address"]')
      ).filter(vis);
      const notes = Array.from(root.querySelectorAll('[data-iu-cal-inline-field="note"]')).filter(
        vis
      );
      out.DATE_MATCH_COUNT = dates.length;
      out.TIME_MATCH_COUNT = times.length;
      out.TITLE_MATCH_COUNT = titles.length;
      if (dates.length !== 1 || times.length !== 1 || titles.length !== 1) {
        out.ok = false;
        out.reason = "CALENDAR_FIELDS_NOT_UNIQUE_VISIBLE";
        return out;
      }
      out.date = box(dates[0]);
      out.time = box(times[0]);
      out.title = box(titles[0]);
      out.address = box(addresses[0] || null);
      out.note = box(notes[0] || null);
      out.card = box(root);
      out.inSheet = !!root.closest("#iuCalEventBottomSheet");
      out.timeIsButton = out.time.tag === "BUTTON";
    } else if (form === "tasks") {
      const dates = Array.from(document.querySelectorAll("#iuTasksOverlay #iuTaskDue")).filter(vis);
      const times = Array.from(document.querySelectorAll("#iuTasksOverlay #iuTaskDueTime")).filter(
        vis
      );
      const titles = Array.from(document.querySelectorAll("#iuTasksOverlay #iuTaskTitle")).filter(
        vis
      );
      const notes = Array.from(document.querySelectorAll("#iuTasksOverlay #iuTaskNote")).filter(vis);
      const forms = Array.from(document.querySelectorAll("#iuTasksOverlay #iuTasksForm")).filter(vis);
      out.DATE_MATCH_COUNT = dates.length;
      out.TIME_MATCH_COUNT = times.length;
      out.TITLE_MATCH_COUNT = titles.length;
      if (dates.length !== 1 || times.length !== 1 || titles.length !== 1) {
        out.ok = false;
        out.reason = "TASKS_FIELDS_NOT_UNIQUE_VISIBLE";
        return out;
      }
      out.date = box(dates[0]);
      out.time = box(times[0]);
      out.title = box(titles[0]);
      out.note = box(notes[0] || null);
      out.card = box(forms[0] || null);
    } else {
      out.ok = false;
      out.reason = "UNKNOWN_FORM";
      return out;
    }

    out.DATE_TITLE_DIFF_PX = Math.round(Math.abs(out.date.right - out.title.right) * 100) / 100;
    out.TIME_TITLE_DIFF_PX = Math.round(Math.abs(out.time.right - out.title.right) * 100) / 100;
    out.DATE_WIDER_THAN_TITLE = out.date.right > out.title.right + TOL;
    out.TIME_WIDER_THAN_TITLE = out.time.right > out.title.right + TOL;
    out.SCROLL_WIDTH = document.documentElement.scrollWidth;
    out.CLIENT_WIDTH = document.documentElement.clientWidth;
    out.HORIZONTAL_OVERFLOW = out.SCROLL_WIDTH > out.CLIENT_WIDTH + TOL;
    out.geometryAligned =
      out.DATE_TITLE_DIFF_PX <= TOL &&
      out.TIME_TITLE_DIFF_PX <= TOL &&
      !out.HORIZONTAL_OVERFLOW;
    out.ok = true;
    return out;
  };
}

async function openCalendarCreate(page) {
  await page.waitForFunction(() => typeof window.iuCalendarService === "object", {
    timeout: 25000,
  });
  await page.evaluate(() => window.iuCalendarService.openOverlay());
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const close = document.querySelector("#iuCalendarDayOverlay .iu-day-close");
    if (close) close.click();
    const month = document.querySelector('#iuCalendarOverlay [data-iu-cal-view="month"]');
    if (month) month.click();
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const day = document.querySelector(".iu-calDayCell.is-today, .iu-calDayCell:not(.is-out)");
    if (day) day.click();
  });
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => {
    const pad = document.querySelector("[data-iu-cal-slot-empty], .iu-calSlotEmptyPad");
    if (pad) {
      pad.click();
      return "slot";
    }
    const fab = document.querySelector("[data-iu-cal-month-fab]");
    if (fab && !fab.hidden) {
      fab.click();
      return "fab";
    }
    return "";
  });
  await page.waitForTimeout(800);
  const hasRoot = await page.evaluate(() => !!document.querySelector("[data-iu-cal-inline-root]"));
  return { opened, hasRoot, route: "calendar/direct/create" };
}

async function openTasksCreate(page) {
  await page.waitForFunction(() => typeof window.iuTasksService === "object", { timeout: 25000 });
  await page.evaluate(() => window.iuTasksService.openOverlay());
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const b = document.querySelector("[data-iu-tasks-new], [data-iu-tasks-empty-cta]");
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  const has = await page.evaluate(() => {
    const t = document.getElementById("iuTaskTitle");
    const d = document.getElementById("iuTaskDue");
    return !!(t && d && t.getBoundingClientRect().width > 2);
  });
  return { hasRoot: has, route: "tasks/direct/create" };
}

async function runEngine(browserType, engineName, url) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DSF,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  });
  // CRITICAL: calendar init awaits LDP gate on first writeStore — accept before any document script runs.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:local-data-protection:notice-accepted-at:v1", String(Date.now()));
    } catch (_) {}
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(1200);

  const meta = {
    engine: engineName,
    browserVersion: await browser.version(),
    url,
    finalHref: page.url(),
    viewport: VIEWPORT,
    deviceScaleFactor: DSF,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  };

  const calOpen = await openCalendarCreate(page);
  const calendar = calOpen.hasRoot
    ? await page.evaluate(measureSnippet(), { form: "calendar", tol: TOL_PX })
    : { ok: false, reason: "CALENDAR_FORM_NOT_OPENED", open: calOpen };

  await page.evaluate(() => {
    try {
      if (window.iuCalendarService && window.iuCalendarService.closeOverlay) {
        window.iuCalendarService.closeOverlay();
      }
    } catch (_) {}
  });
  await page.waitForTimeout(400);

  const tasksOpen = await openTasksCreate(page);
  const tasks = tasksOpen.hasRoot
    ? await page.evaluate(measureSnippet(), { form: "tasks", tol: TOL_PX })
    : { ok: false, reason: "TASKS_FORM_NOT_OPENED", open: tasksOpen };

  await browser.close();

  const calGeomPass = !!(calendar.ok && calendar.geometryAligned);
  const tasksGeomPass = !!(tasks.ok && tasks.geometryAligned);

  return {
    meta,
    calOpen,
    tasksOpen,
    calendar,
    tasks,
    PLAYWRIGHT_CALENDAR_GEOMETRY_PASS: calGeomPass,
    PLAYWRIGHT_TASKS_GEOMETRY_PASS: tasksGeomPass,
    PLAYWRIGHT_ENGINE_GEOMETRY_PASS: calGeomPass && tasksGeomPass,
  };
}

async function main() {
  const url = envUrl();
  const falseCoverageAudit = auditOldGuardFalseCoverage();

  let chromiumResult = null;
  let webkitResult = null;
  let runtimeError = null;
  try {
    chromiumResult = await runEngine(chromium, "chromium", url);
    webkitResult = await runEngine(webkit, "webkit", url);
  } catch (err) {
    runtimeError = String(err && err.stack ? err.stack : err);
  }

  const playwrightGeomPass = !!(
    chromiumResult &&
    webkitResult &&
    chromiumResult.PLAYWRIGHT_ENGINE_GEOMETRY_PASS &&
    webkitResult.PLAYWRIGHT_ENGINE_GEOMETRY_PASS
  );

  const iosConfirmed = realIosConfirmed();
  const reasons = [];

  if (!falseCoverageAudit.pass) {
    reasons.push("FALSE_COVERAGE_IN_OLD_72_72_GUARD");
  }
  if (runtimeError) reasons.push("RUNTIME_ERROR");
  if (!playwrightGeomPass) reasons.push("PLAYWRIGHT_REAL_ROUTE_GEOMETRY_MISALIGNED_OR_MISSING");
  if (!iosConfirmed) {
    reasons.push("REAL_IOS_NOT_CONFIRMED");
    reasons.push("PLAYWRIGHT_WEBKIT_IS_NOT_PHYSICAL_IOS");
  }

  // Overall PASS only when: old false-coverage fixed AND playwright real routes aligned AND human confirmed iPhone.
  const pass =
    falseCoverageAudit.pass &&
    !runtimeError &&
    playwrightGeomPass &&
    iosConfirmed;

  const report = {
    pass,
    CURRENT_MAIN_REAL_GEOMETRY_GUARD: pass ? "PASS" : "FAIL",
    FALSE_PASS_ROOT_CAUSE_PROVEN: !falseCoverageAudit.pass,
    REAL_IOS_EQUIVALENCE_PROVEN: false,
    REAL_IOS_AUTOMATION_LIMITATION: true,
    REAL_IOS_CONFIRMED_ENV: iosConfirmed,
    reasons,
    falseCoverageAudit,
    chromium: chromiumResult,
    webkit: webkitResult,
    runtimeError,
    notes: [
      "Old #9706 guard measured Silver quick-template geometry only; Calendar/Tasks were CSS-contract-only; measureEditProbe aliased measureQuick.",
      "Physical iPhone screenshots after #9706 still show DATE/TIME right edge beyond TITLE on Calendar + Tasks overlays.",
      "Playwright Chromium/WebKit border-box measurement on real overlays often reports diff=0 — cannot certify iPhone from that alone.",
      "Set REAL_IOS_CONFIRMED=1 only after physical iPhone verification of DATE_RIGHT≈TITLE_RIGHT (≤1 CSS px).",
    ],
  };

  const reportPath = path.join(
    process.env.TEMP || process.env.TMPDIR || "/tmp",
    "iu-datetime-real-route-geometry-guard-v1-report.json"
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

  process.stdout.write("=== IU_DATETIME_REAL_ROUTE_GEOMETRY_GUARD_V1 ===\n");
  process.stdout.write("URL: " + url + "\n");
  process.stdout.write(
    "FALSE_COVERAGE_AUDIT: " + (falseCoverageAudit.pass ? "PASS" : "FAIL") + "\n"
  );
  process.stdout.write("FALSE_COVERAGE_FINDINGS: " + falseCoverageAudit.findings.join(",") + "\n");
  if (chromiumResult) {
    process.stdout.write(
      "CHROMIUM_CAL: " +
        (chromiumResult.PLAYWRIGHT_CALENDAR_GEOMETRY_PASS ? "PASS" : "FAIL") +
        " dDiff=" +
        (chromiumResult.calendar && chromiumResult.calendar.DATE_TITLE_DIFF_PX) +
        " tDiff=" +
        (chromiumResult.calendar && chromiumResult.calendar.TIME_TITLE_DIFF_PX) +
        " timeTag=" +
        (chromiumResult.calendar && chromiumResult.calendar.time && chromiumResult.calendar.time.tag) +
        "\n"
    );
    process.stdout.write(
      "CHROMIUM_TASKS: " +
        (chromiumResult.PLAYWRIGHT_TASKS_GEOMETRY_PASS ? "PASS" : "FAIL") +
        " dDiff=" +
        (chromiumResult.tasks && chromiumResult.tasks.DATE_TITLE_DIFF_PX) +
        " tDiff=" +
        (chromiumResult.tasks && chromiumResult.tasks.TIME_TITLE_DIFF_PX) +
        "\n"
    );
  }
  if (webkitResult) {
    process.stdout.write(
      "WEBKIT_CAL: " +
        (webkitResult.PLAYWRIGHT_CALENDAR_GEOMETRY_PASS ? "PASS" : "FAIL") +
        " dDiff=" +
        (webkitResult.calendar && webkitResult.calendar.DATE_TITLE_DIFF_PX) +
        " tDiff=" +
        (webkitResult.calendar && webkitResult.calendar.TIME_TITLE_DIFF_PX) +
        "\n"
    );
    process.stdout.write(
      "WEBKIT_TASKS: " +
        (webkitResult.PLAYWRIGHT_TASKS_GEOMETRY_PASS ? "PASS" : "FAIL") +
        " dDiff=" +
        (webkitResult.tasks && webkitResult.tasks.DATE_TITLE_DIFF_PX) +
        " tDiff=" +
        (webkitResult.tasks && webkitResult.tasks.TIME_TITLE_DIFF_PX) +
        "\n"
    );
  }
  process.stdout.write("REAL_IOS_CONFIRMED: " + (iosConfirmed ? "YES" : "NO") + "\n");
  process.stdout.write("REAL_IOS_AUTOMATION_LIMITATION: YES\n");
  process.stdout.write("REASONS: " + reasons.join("|") + "\n");
  process.stdout.write("REPORT: " + reportPath + "\n");
  process.stdout.write("CURRENT_MAIN_REAL_GEOMETRY_GUARD: " + report.CURRENT_MAIN_REAL_GEOMETRY_GUARD + "\n");
  process.stdout.write("SAFETY: " + (pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_IU_DATETIME_REAL_ROUTE_GEOMETRY_GUARD_V1 ===\n");

  if (!pass) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
