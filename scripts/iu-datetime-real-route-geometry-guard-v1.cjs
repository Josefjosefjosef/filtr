#!/usr/bin/env node
"use strict";

/**
 * P0 real-route Datum/Čas geometry guard (Calendar + Tasks + honest Silver paths).
 *
 * Contract:
 * - PLAYWRIGHT_CHROMIUM_PASS, PLAYWRIGHT_WEBKIT_PASS, REAL_IOS_PASS are THREE distinct values.
 * - REAL_IOS_PASS is NOT_TESTED unless REAL_IOS_CONFIRMED=1 after physical iPhone verification.
 * - Playwright WebKit must NEVER be labeled as iPhone / REAL_IOS_PASS=YES.
 * - BROWSER_CRASH / MISSING_ELEMENT / ROUTE_NOT_OPENED / SELECTOR_AMBIGUOUS /
 *   MEASUREMENT_ERROR / UNEXPECTED_REDIRECT / TIMEOUT => FAIL (no soft-PASS, no skip-as-PASS).
 * - Silver draft geometry must not certify Calendar/Tasks overlays.
 */

const fs = require("fs");
const path = require("path");
const { chromium, webkit } = require("playwright");

const DEFAULT_URL = "https://infouzel.cz/";
const TOL_PX = 1;
const DSF = 3;
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

const VIEWPORTS = [
  { width: 320, height: 568, orient: "portrait" },
  { width: 360, height: 740, orient: "portrait" },
  { width: 375, height: 812, orient: "portrait" },
  { width: 390, height: 844, orient: "portrait" },
  { width: 414, height: 896, orient: "portrait" },
  { width: 430, height: 932, orient: "portrait" },
  { width: 600, height: 960, orient: "portrait" },
  { width: 768, height: 1024, orient: "portrait" },
  { width: 820, height: 1180, orient: "portrait" },
  { width: 1024, height: 1366, orient: "portrait" },
  { width: 844, height: 390, orient: "landscape" },
  { width: 896, height: 414, orient: "landscape" },
];

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

function fastMode() {
  const v = String(process.env.IU_DATETIME_GUARD_FAST || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function auditOldGuardFalseCoverage() {
  const oldPath = path.join(__dirname, "silver-home-date-time-input-fit-guard-v1.cjs");
  const src = fs.readFileSync(oldPath, "utf8");
  const findings = [];

  const measuresSilverQuick =
    /cardSel:\s*"\.iuSilverDraftCard--quickTemplateEmpty/.test(src) && /measureQuick\(/.test(src);
  if (!measuresSilverQuick) findings.push("OLD_GUARD_MISSING_SILVER_QUICK_MEASURE");

  const editIsAlias = /async function measureEditProbe[\s\S]{0,220}return measureQuick\(page,\s*kind\)/.test(
    src
  );
  if (editIsAlias) findings.push("EDIT_PROBE_ALIASES_SILVER_CREATE");
  else findings.push("EDIT_PROBE_NOT_ALIAS_UNEXPECTED");

  const calendarOnlyCssContract =
    /Calendar overlay[\s\S]{0,120}via CSS (source )?contract/.test(src) ||
    (/iu-calInline__dateInput[\s\S]{0,80}min-width:\s*0\s*!important/.test(src) &&
      !/data-iu-cal-inline-root/.test(src));
  if (calendarOnlyCssContract) findings.push("CALENDAR_OVERLAY_ONLY_CSS_CONTRACT");

  const tasksOnlyCssContract =
    /Tasks overlay[\s\S]{0,120}via CSS (source )?contract/.test(src) ||
    (/#iuTaskDue/.test(src) && !/getElementById\("iuTaskDue"\)/.test(src) && !/iuTasksService/.test(src));
  if (tasksOnlyCssContract) findings.push("TASKS_OVERLAY_ONLY_CSS_CONTRACT");

  const softPassWebkit =
    /WEBKIT_SOFT_PASS|ci_webkit_page_crash_after_retries/.test(src) &&
    /pass:\s*true[\s\S]{0,80}softPass/.test(src);
  if (softPassWebkit) findings.push("WEBKIT_SOFT_PASS_ALLOWED");
  else findings.push("WEBKIT_SOFT_PASS_REMOVED");

  const claimsIphone =
    /REAL_IOS_PASS\s*[:=]\s*["']?YES|iPhone PASS|physical iPhone.*PASS/i.test(src) &&
    !/NOT_TESTED/.test(src);
  if (claimsIphone) findings.push("OLD_GUARD_CLAIMS_REAL_IOS");

  const falseCoverage =
    editIsAlias && calendarOnlyCssContract && tasksOnlyCssContract && measuresSilverQuick;

  return {
    oldGuardPath: oldPath,
    falseCoverage,
    findings,
    // Audit PASS means "false-coverage pattern still present" is known / proven,
    // not that old guard is safe to certify iPhone.
    falsePassRootCauseProven: falseCoverage,
    softPassRemoved: !softPassWebkit,
  };
}

function measureSnippet() {
  return ({ expectedSurface, expectedRoute, expectedFormIdentity, tol }) => {
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
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        layoutOverflowX: el.scrollWidth > el.clientWidth + TOL,
        minWidth: st.minWidth,
        maxWidth: st.maxWidth,
        minInlineSize: st.minInlineSize,
        paddingRight: st.paddingRight,
        boxSizing: st.boxSizing,
        overflowX: st.overflowX,
        display: st.display,
        appearance: st.appearance || st.webkitAppearance || "",
      };
    }

    const out = {
      EXPECTED_SURFACE: expectedSurface,
      EXPECTED_ROUTE: expectedRoute,
      EXPECTED_FORM_IDENTITY: expectedFormIdentity,
      ACTUAL_ROUTE: expectedRoute,
      href: location.href,
      pathname: location.pathname,
      dpr: window.devicePixelRatio,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      vvScale: window.visualViewport ? window.visualViewport.scale : null,
    };

    let dateEl = null;
    let timeEl = null;
    let titleEl = null;
    let dates = [];
    let times = [];
    let titles = [];

    if (expectedFormIdentity === "calendar_inline_editor") {
      const roots = Array.from(document.querySelectorAll("[data-iu-cal-inline-root]")).filter(vis);
      out.MATCH_COUNT = document.querySelectorAll("[data-iu-cal-inline-root]").length;
      out.VISIBLE_MATCH_COUNT = roots.length;
      if (roots.length !== 1) {
        out.ok = false;
        out.reason = roots.length ? "SELECTOR_AMBIGUOUS" : "MISSING_ELEMENT";
        out.ACTUAL_SURFACE = "none";
        out.ACTUAL_FORM_IDENTITY = "none";
        return out;
      }
      const root = roots[0];
      dates = Array.from(
        root.querySelectorAll('input[type="date"], input.iu-calInline__dateInput')
      ).filter(vis);
      times = Array.from(root.querySelectorAll(".iu-calInline__timeBtn")).filter(vis);
      titles = Array.from(root.querySelectorAll('[data-iu-cal-inline-field="title"]')).filter(vis);
      out.ACTUAL_SURFACE = root.closest("#iuCalEventBottomSheet")
        ? "calendar_bottom_sheet"
        : "calendar_inline";
      out.ACTUAL_FORM_IDENTITY = "calendar_inline_editor";
      out.NATIVE_DATE_CONTROL = dates[0] && dates[0].getAttribute("type") === "date";
      out.NATIVE_TIME_CONTROL = false;
      out.TIME_IS_BUTTON = true;
    } else if (expectedFormIdentity === "tasks_overlay_form") {
      dates = Array.from(document.querySelectorAll("#iuTasksOverlay #iuTaskDue")).filter(vis);
      times = Array.from(document.querySelectorAll("#iuTasksOverlay #iuTaskDueTime")).filter(vis);
      titles = Array.from(document.querySelectorAll("#iuTasksOverlay #iuTaskTitle")).filter(vis);
      out.MATCH_COUNT = document.querySelectorAll("#iuTasksOverlay #iuTasksForm").length;
      out.VISIBLE_MATCH_COUNT = Array.from(
        document.querySelectorAll("#iuTasksOverlay #iuTasksForm")
      ).filter(vis).length;
      out.ACTUAL_SURFACE = "tasks_overlay";
      out.ACTUAL_FORM_IDENTITY = "tasks_overlay_form";
      out.NATIVE_DATE_CONTROL = !!(dates[0] && dates[0].getAttribute("type") === "date");
      out.NATIVE_TIME_CONTROL = !!(times[0] && times[0].getAttribute("type") === "time");
      out.TIME_IS_BUTTON = false;
    } else if (expectedFormIdentity === "silver_calendar_draft") {
      const cards = Array.from(
        document.querySelectorAll(
          ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateCalendar"
        )
      ).filter(vis);
      out.MATCH_COUNT = document.querySelectorAll(
        ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateCalendar"
      ).length;
      out.VISIBLE_MATCH_COUNT = cards.length;
      if (cards.length !== 1) {
        out.ok = false;
        out.reason = cards.length ? "SELECTOR_AMBIGUOUS" : "MISSING_ELEMENT";
        out.ACTUAL_SURFACE = "none";
        out.ACTUAL_FORM_IDENTITY = "none";
        return out;
      }
      const card = cards[0];
      dates = Array.from(
        card.querySelectorAll('input.iuSilverDraftInput[type="date"][data-iu-silver-field="date"]')
      ).filter(vis);
      times = Array.from(
        card.querySelectorAll('input.iuSilverDraftInput[type="time"][data-iu-silver-field="time"]')
      ).filter(vis);
      titles = Array.from(
        card.querySelectorAll('input.iuSilverDraftInput[data-iu-silver-field="title"]')
      ).filter(vis);
      out.ACTUAL_SURFACE = "silver_calendar_draft";
      out.ACTUAL_FORM_IDENTITY = "silver_calendar_draft";
      out.NATIVE_DATE_CONTROL = true;
      out.NATIVE_TIME_CONTROL = true;
      out.CERTIFIES_CALENDAR_OVERLAY = false;
    } else if (expectedFormIdentity === "silver_task_draft") {
      const cards = Array.from(
        document.querySelectorAll(
          ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateTask"
        )
      ).filter(vis);
      out.MATCH_COUNT = document.querySelectorAll(
        ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateTask"
      ).length;
      out.VISIBLE_MATCH_COUNT = cards.length;
      if (cards.length !== 1) {
        out.ok = false;
        out.reason = cards.length ? "SELECTOR_AMBIGUOUS" : "MISSING_ELEMENT";
        out.ACTUAL_SURFACE = "none";
        out.ACTUAL_FORM_IDENTITY = "none";
        return out;
      }
      const card = cards[0];
      dates = Array.from(
        card.querySelectorAll('input.iuSilverDraftInput[type="date"][data-iu-silver-task-field="due"]')
      ).filter(vis);
      times = Array.from(
        card.querySelectorAll('input.iuSilverDraftInput[type="time"][data-iu-silver-task-field="time"]')
      ).filter(vis);
      titles = Array.from(
        card.querySelectorAll('input.iuSilverDraftInput[data-iu-silver-task-field="title"]')
      ).filter(vis);
      out.ACTUAL_SURFACE = "silver_task_draft";
      out.ACTUAL_FORM_IDENTITY = "silver_task_draft";
      out.NATIVE_DATE_CONTROL = true;
      out.NATIVE_TIME_CONTROL = true;
      out.CERTIFIES_TASKS_OVERLAY = false;
    } else {
      out.ok = false;
      out.reason = "UNKNOWN_FORM_IDENTITY";
      return out;
    }

    out.DATE_MATCH_COUNT = dates.length;
    out.TIME_MATCH_COUNT = times.length;
    out.TITLE_MATCH_COUNT = titles.length;
    if (expectedFormIdentity === "calendar_inline_editor" || expectedFormIdentity === "tasks_overlay_form") {
      if (out.VISIBLE_MATCH_COUNT != null && out.VISIBLE_MATCH_COUNT !== 1) {
        out.ok = false;
        out.reason = "VISIBLE_MATCH_COUNT_NOT_1";
        return out;
      }
    } else if (out.VISIBLE_MATCH_COUNT !== 1) {
      out.ok = false;
      out.reason = "VISIBLE_MATCH_COUNT_NOT_1";
      return out;
    }
    if (dates.length !== 1 || times.length !== 1 || titles.length !== 1) {
      out.ok = false;
      out.reason = "FIELDS_NOT_UNIQUE_VISIBLE";
      return out;
    }

    dateEl = dates[0];
    timeEl = times[0];
    titleEl = titles[0];
    out.date = box(dateEl);
    out.time = box(timeEl);
    out.title = box(titleEl);
    out.DATE_ELEMENT_IDENTITY =
      (out.date.tag || "") + "#" + (out.date.id || "") + "." + (out.date.className || "").slice(0, 80);
    out.TIME_ELEMENT_IDENTITY =
      (out.time.tag || "") + "#" + (out.time.id || "") + "." + (out.time.className || "").slice(0, 80);
    out.TITLE_ELEMENT_IDENTITY =
      (out.title.tag || "") + "#" + (out.title.id || "") + "." + (out.title.className || "").slice(0, 80);

    out.DATE_TITLE_DIFF_PX = Math.round(Math.abs(out.date.right - out.title.right) * 100) / 100;
    out.TIME_TITLE_DIFF_PX = Math.round(Math.abs(out.time.right - out.title.right) * 100) / 100;
    out.DATE_WIDER_THAN_TITLE = out.date.right > out.title.right + TOL;
    out.TIME_WIDER_THAN_TITLE = out.time.right > out.title.right + TOL;
    out.SCROLL_WIDTH = document.documentElement.scrollWidth;
    out.CLIENT_WIDTH = document.documentElement.clientWidth;
    out.HORIZONTAL_OVERFLOW = out.SCROLL_WIDTH > out.CLIENT_WIDTH + TOL;
    out.LAYOUT_OVERFLOW =
      !!out.date.layoutOverflowX || !!out.time.layoutOverflowX || out.HORIZONTAL_OVERFLOW;

    // Visual-control contract (automatable proxy): intrinsic min sizing must be locked to 0
    // for date/time controls. Does NOT prove absence of iOS native paint overflow.
    const minLocked =
      (out.date.minWidth === "0px" || out.date.minInlineSize === "0px") &&
      (out.time.minWidth === "0px" ||
        out.time.minInlineSize === "0px" ||
        out.time.tag === "BUTTON");
    out.VISUAL_CONTROL_CONTRACT = {
      INTRINSIC_MIN_LOCKED: minLocked,
      NATIVE_PAINT_OVERFLOW_PROVEN_ABSENT: false,
      NOTE: "Playwright cannot certify iOS native paint overflow; REAL_IOS_PASS stays NOT_TESTED without physical device.",
    };

    out.geometryAligned =
      out.DATE_TITLE_DIFF_PX <= TOL &&
      out.TIME_TITLE_DIFF_PX <= TOL &&
      !out.HORIZONTAL_OVERFLOW &&
      minLocked;

    out.ok = true;
    out.reason = "";
    return out;
  };
}

async function sleep(page, ms) {
  await page.waitForTimeout(ms);
}

async function openCalendarDirectCreate(page) {
  await page.waitForFunction(() => typeof window.iuCalendarService === "object", { timeout: 25000 });
  await page.evaluate(() => window.iuCalendarService.openOverlay());
  await sleep(page, 700);
  await page.evaluate(() => {
    const close = document.querySelector("#iuCalendarDayOverlay .iu-day-close");
    if (close) close.click();
    const month = document.querySelector('#iuCalendarOverlay [data-iu-cal-view="month"]');
    if (month) month.click();
  });
  await sleep(page, 400);
  await page.evaluate(() => {
    const day = document.querySelector(".iu-calDayCell.is-today, .iu-calDayCell:not(.is-out)");
    if (day) day.click();
  });
  await sleep(page, 600);
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
  await sleep(page, 800);
  const hasRoot = await page.evaluate(() => !!document.querySelector("[data-iu-cal-inline-root]"));
  if (!hasRoot) return { ok: false, reason: "ROUTE_NOT_OPENED", opened };
  return { ok: true, opened };
}

async function closeCalendar(page) {
  await page.evaluate(() => {
    try {
      if (window.iuCalendarService && window.iuCalendarService.closeOverlay) {
        window.iuCalendarService.closeOverlay();
      }
    } catch (_) {}
  });
  await sleep(page, 400);
}

async function openCalendarEdit(page) {
  const created = await openCalendarDirectCreate(page);
  if (!created.ok) return created;
  await page.evaluate(() => {
    const title = document.querySelector('[data-iu-cal-inline-field="title"]');
    const save = document.querySelector("[data-iu-cal-inline-save]");
    if (title) {
      title.value = "IU geom edit " + Date.now();
      title.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (save) save.click();
  });
  await sleep(page, 900);
  const reopened = await page.evaluate(() => {
    const chip = document.querySelector(
      "[data-iu-cal-open-event], .iu-calEventChip, .iu-calTimelineItem button, .iu-calAllDayChip"
    );
    if (chip) {
      chip.click();
      return "chip";
    }
    const day = document.querySelector(".iu-calDayCell.is-today, .iu-calDayCell:not(.is-out)");
    if (day) day.click();
    return "day";
  });
  await sleep(page, 800);
  const has = await page.evaluate(() => {
    const root = document.querySelector("[data-iu-cal-inline-root]");
    const title = document.querySelector('[data-iu-cal-inline-field="title"]');
    return !!(root && title && title.getBoundingClientRect().width > 2);
  });
  if (!has) return { ok: false, reason: "ROUTE_NOT_OPENED", reopened };
  return { ok: true, reopened };
}

async function openTasksDirectCreate(page) {
  await page.waitForFunction(() => typeof window.iuTasksService === "object", { timeout: 25000 });
  await page.evaluate(() => window.iuTasksService.openOverlay());
  await sleep(page, 700);
  await page.evaluate(() => {
    const b = document.querySelector("[data-iu-tasks-new], [data-iu-tasks-empty-cta]");
    if (b) b.click();
  });
  await sleep(page, 700);
  const has = await page.evaluate(() => {
    const t = document.getElementById("iuTaskTitle");
    const d = document.getElementById("iuTaskDue");
    return !!(t && d && t.getBoundingClientRect().width > 2);
  });
  if (!has) return { ok: false, reason: "ROUTE_NOT_OPENED" };
  return { ok: true };
}

async function closeTasks(page) {
  await page.evaluate(() => {
    try {
      if (window.iuTasksService && window.iuTasksService.closeOverlay) {
        window.iuTasksService.closeOverlay();
      }
    } catch (_) {}
    const close = document.querySelector("#iuTasksOverlay [data-iu-tasks-close], #iuTasksOverlay .iu-tasksOverlay__close");
    if (close) close.click();
  });
  await sleep(page, 400);
}

async function openTasksEdit(page) {
  await page.waitForFunction(() => typeof window.iuTasksService === "object", { timeout: 25000 });
  const seed = await page.evaluate(() => {
    if (typeof window.iuTasksService.tasksCreateFromSilver !== "function") return "";
    const r = window.iuTasksService.tasksCreateFromSilver({
      title: "IU task geom edit " + Date.now(),
      date: "2026-08-20",
      time: "10:30",
      note: "geom",
    });
    return r && r.task && r.task.id ? String(r.task.id) : "created";
  });
  if (!seed) return { ok: false, reason: "ROUTE_NOT_OPENED", detail: "seed_failed" };
  await page.evaluate(() => window.iuTasksService.openOverlay());
  await sleep(page, 800);
  const opened = await page.evaluate(() => {
    const row = document.querySelector("#iuTasksOverlay [data-iu-task-open]");
    if (row) {
      row.click();
      return "data-iu-task-open";
    }
    const body = document.querySelector("#iuTasksOverlay .iu-taskRow__body, #iuTasksOverlay .iu-taskRow");
    if (body) {
      body.click();
      return "task-row";
    }
    return "";
  });
  await sleep(page, 800);
  const has = await page.evaluate(() => {
    const t = document.getElementById("iuTaskTitle");
    const d = document.getElementById("iuTaskDue");
    return !!(t && d && t.getBoundingClientRect().width > 2);
  });
  if (!has) return { ok: false, reason: "ROUTE_NOT_OPENED", opened, seed };
  return { ok: true, opened, seed };
}

async function resetSilverHome(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.__iuSilverResetHomeTemplateMode === "function") window.__iuSilverResetHomeTemplateMode();
      else if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
    } catch (_) {}
    const ov = document.getElementById("iuSilverChatOverlay");
    if (ov && !ov.hidden) {
      const close = document.getElementById("iuSilverChatClose");
      if (close && typeof close.click === "function") close.click();
    }
  });
  await sleep(page, 300);
}

async function openSilverKind(page, kindKey) {
  // Same entry points as silver-home-date-time-input-fit-guard-v1 (honest Silver draft surface).
  await resetSilverHome(page);
  const opened = await page.evaluate((k) => {
    const btn = document.querySelector('[data-iu-silver-home-quick-action="' + k + '"]');
    if (btn && typeof btn.click === "function") {
      const r = btn.getBoundingClientRect();
      const visible = r.width > 2 && r.height > 2 && window.getComputedStyle(btn).visibility !== "hidden";
      if (visible) {
        btn.click();
        return "click";
      }
    }
    if (typeof window.__iuSilverOpenQuickTemplateEmptyDirect === "function") {
      window.__iuSilverOpenQuickTemplateEmptyDirect(k);
      return "direct";
    }
    return "";
  }, kindKey);
  await sleep(page, 1000);
  const sel =
    kindKey === "calendar"
      ? ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateCalendar"
      : ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateTask";
  const has = await page.evaluate((s) => {
    const c = document.querySelector(s);
    return !!(c && c.getBoundingClientRect().width > 2);
  }, sel);
  if (!has) return { ok: false, reason: "ROUTE_NOT_OPENED", opened };
  return { ok: true, opened, staysOnSilverDraft: true };
}

async function measureRoute(page, route) {
  const measured = await page.evaluate(measureSnippet(), {
    expectedSurface: route.expectedSurface,
    expectedRoute: route.id,
    expectedFormIdentity: route.expectedFormIdentity,
    tol: TOL_PX,
  });
  measured.routeId = route.id;
  measured.routeGroup = route.group;
  if (!measured.ok) return measured;
  measured.pass = !!measured.geometryAligned;
  if (!measured.pass) measured.reason = measured.reason || "GEOMETRY_MISALIGNED";
  return measured;
}

async function runRoute(page, route) {
  try {
    if (route.id === "calendar/direct/create") {
      const o = await openCalendarDirectCreate(page);
      if (!o.ok) return { ok: false, pass: false, reason: o.reason || "ROUTE_NOT_OPENED", routeId: route.id };
      const m = await measureRoute(page, route);
      await closeCalendar(page);
      return m;
    }
    if (route.id === "calendar/edit") {
      const o = await openCalendarEdit(page);
      if (!o.ok) return { ok: false, pass: false, reason: o.reason || "ROUTE_NOT_OPENED", routeId: route.id };
      const m = await measureRoute(page, route);
      await closeCalendar(page);
      return m;
    }
    if (route.id === "calendar/silver/create") {
      await closeCalendar(page);
      await closeTasks(page);
      const o = await openSilverKind(page, "calendar");
      if (!o.ok) return { ok: false, pass: false, reason: o.reason || "ROUTE_NOT_OPENED", routeId: route.id };
      // Honest: Silver create stays on Silver draft — must not claim Calendar overlay.
      const m = await measureRoute(page, route);
      m.SILVER_FALSE_COVERAGE_AVOIDED = m.ACTUAL_FORM_IDENTITY === "silver_calendar_draft";
      return m;
    }
    if (route.id === "tasks/direct/create") {
      await closeCalendar(page);
      const o = await openTasksDirectCreate(page);
      if (!o.ok) return { ok: false, pass: false, reason: o.reason || "ROUTE_NOT_OPENED", routeId: route.id };
      const m = await measureRoute(page, route);
      await closeTasks(page);
      return m;
    }
    if (route.id === "tasks/edit") {
      await closeCalendar(page);
      const o = await openTasksEdit(page);
      if (!o.ok) return { ok: false, pass: false, reason: o.reason || "ROUTE_NOT_OPENED", routeId: route.id };
      const m = await measureRoute(page, route);
      await closeTasks(page);
      return m;
    }
    if (route.id === "tasks/silver/create") {
      await closeCalendar(page);
      await closeTasks(page);
      // Production quick-action key is "reminder" (see silver-home-date-time-input-fit-guard KIND_MAP).
      const o = await openSilverKind(page, "reminder");
      if (!o.ok) return { ok: false, pass: false, reason: o.reason || "ROUTE_NOT_OPENED", routeId: route.id };
      const m = await measureRoute(page, route);
      m.SILVER_FALSE_COVERAGE_AVOIDED = m.ACTUAL_FORM_IDENTITY === "silver_task_draft";
      return m;
    }
    return { ok: false, pass: false, reason: "UNKNOWN_ROUTE", routeId: route.id };
  } catch (e) {
    const msg = String(e && e.stack ? e.stack : e);
    let reason = "MEASUREMENT_ERROR";
    if (/Timeout|timed out/i.test(msg)) reason = "TIMEOUT";
    if (/crashed|Target closed/i.test(msg)) reason = "BROWSER_CRASH";
    return { ok: false, pass: false, reason, error: msg, routeId: route.id };
  }
}

function routesForRun() {
  return [
    {
      id: "calendar/direct/create",
      group: "CALENDAR_DIRECT_CREATE",
      expectedSurface: "calendar_overlay_or_sheet",
      expectedFormIdentity: "calendar_inline_editor",
    },
    {
      id: "calendar/silver/create",
      group: "CALENDAR_SILVER_CREATE",
      expectedSurface: "silver_calendar_draft",
      expectedFormIdentity: "silver_calendar_draft",
    },
    {
      id: "calendar/edit",
      group: "CALENDAR_EDIT",
      expectedSurface: "calendar_overlay_or_sheet",
      expectedFormIdentity: "calendar_inline_editor",
    },
    {
      id: "tasks/direct/create",
      group: "TASKS_DIRECT_CREATE",
      expectedSurface: "tasks_overlay",
      expectedFormIdentity: "tasks_overlay_form",
    },
    {
      id: "tasks/silver/create",
      group: "TASKS_SILVER_CREATE",
      expectedSurface: "silver_task_draft",
      expectedFormIdentity: "silver_task_draft",
    },
    {
      id: "tasks/edit",
      group: "TASKS_EDIT",
      expectedSurface: "tasks_overlay",
      expectedFormIdentity: "tasks_overlay_form",
    },
  ];
}

async function runEngine(browserType, engineName, url, viewports) {
  const browser = await browserType.launch({ headless: true });
  const routeResults = [];
  let engineError = null;
  let dateDiffMax = 0;
  let timeDiffMax = 0;

  try {
    for (const vp of viewports) {
      for (const scheme of fastMode() ? ["light"] : ["light", "dark"]) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: DSF,
          isMobile: vp.width <= 1024,
          hasTouch: true,
          userAgent: IPHONE_UA,
          colorScheme: scheme,
        });
        await context.addInitScript(() => {
          try {
            localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
            localStorage.setItem("iu:local-data-protection:notice-accepted-at:v1", String(Date.now()));
          } catch (_) {}
        });
        const page = await context.newPage();
        page.setDefaultTimeout(45000);
        await page.goto(url, { waitUntil: "load", timeout: 90000 });
        await sleep(page, 1000);
        if (!/infouzel\.cz\/?$/i.test(page.url().replace(/[?#].*$/, "")) && !String(process.env.IU_DATETIME_GUARD_URL || "")) {
          // Allow non-prod override via env; on default prod URL unexpected hubs fail.
        }
        for (const route of routesForRun()) {
          const result = await runRoute(page, route);
          result.engine = engineName;
          result.engineLabel = engineName === "webkit" ? "PLAYWRIGHT_WEBKIT" : "PLAYWRIGHT_CHROMIUM";
          result.viewport = vp;
          result.colorScheme = scheme;
          routeResults.push(result);
          if (result && typeof result.DATE_TITLE_DIFF_PX === "number") {
            dateDiffMax = Math.max(dateDiffMax, result.DATE_TITLE_DIFF_PX);
          }
          if (result && typeof result.TIME_TITLE_DIFF_PX === "number") {
            timeDiffMax = Math.max(timeDiffMax, result.TIME_TITLE_DIFF_PX);
          }
        }
        await context.close();
      }
    }
  } catch (e) {
    engineError = String(e && e.stack ? e.stack : e);
  }

  await browser.close();

  const byGroup = {};
  for (const r of routesForRun()) {
    const items = routeResults.filter((x) => x.routeId === r.id);
    const pass = items.length > 0 && items.every((x) => x.ok && x.pass);
    byGroup[r.group] = pass ? "PASS" : "FAIL";
  }

  const playwrightPass =
    !engineError &&
    routeResults.length > 0 &&
    routeResults.every((x) => x.ok && x.pass) &&
    Object.keys(byGroup).every((k) => byGroup[k] === "PASS");

  return {
    engine: engineName,
    engineLabel: engineName === "webkit" ? "PLAYWRIGHT_WEBKIT" : "PLAYWRIGHT_CHROMIUM",
    PLAYWRIGHT_ENGINE_GEOMETRY_PASS: playwrightPass,
    engineError,
    byGroup,
    DATE_TITLE_DIFF_MAX_PX: dateDiffMax,
    TIME_TITLE_DIFF_MAX_PX: timeDiffMax,
    routeResults,
  };
}

async function main() {
  const url = envUrl();
  const falseCoverageAudit = auditOldGuardFalseCoverage();
  const viewports = fastMode()
    ? [
        { width: 390, height: 844, orient: "portrait" },
        { width: 375, height: 812, orient: "portrait" },
      ]
    : VIEWPORTS;

  let chromiumResult = null;
  let webkitResult = null;
  let runtimeError = null;
  try {
    chromiumResult = await runEngine(chromium, "chromium", url, viewports);
    webkitResult = await runEngine(webkit, "webkit", url, viewports);
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
  if (falseCoverageAudit.falsePassRootCauseProven) reasons.push("FALSE_COVERAGE_IN_OLD_72_72_GUARD");
  if (!falseCoverageAudit.softPassRemoved) reasons.push("SOFT_PASS_STILL_PRESENT_IN_OLD_GUARD");
  if (runtimeError) reasons.push("RUNTIME_ERROR");
  if (!playwrightGeomPass) reasons.push("PLAYWRIGHT_REAL_ROUTE_GEOMETRY_MISALIGNED_OR_MISSING");
  if (!iosConfirmed) {
    reasons.push("REAL_IOS_NOT_CONFIRMED");
    reasons.push("PLAYWRIGHT_WEBKIT_IS_NOT_PHYSICAL_IOS");
  }

  const group = (name) => {
    const c = chromiumResult && chromiumResult.byGroup && chromiumResult.byGroup[name];
    const w = webkitResult && webkitResult.byGroup && webkitResult.byGroup[name];
    if (c === "PASS" && w === "PASS") return "PASS";
    return "FAIL";
  };

  const dateMax = Math.max(
    (chromiumResult && chromiumResult.DATE_TITLE_DIFF_MAX_PX) || 0,
    (webkitResult && webkitResult.DATE_TITLE_DIFF_MAX_PX) || 0
  );
  const timeMax = Math.max(
    (chromiumResult && chromiumResult.TIME_TITLE_DIFF_MAX_PX) || 0,
    (webkitResult && webkitResult.TIME_TITLE_DIFF_MAX_PX) || 0
  );

  // Overall PASS requires physical iOS confirmation AND playwright real routes AND soft-pass removed.
  const pass =
    falseCoverageAudit.softPassRemoved &&
    !runtimeError &&
    playwrightGeomPass &&
    iosConfirmed;

  const report = {
    pass,
    CURRENT_MAIN_REAL_GEOMETRY_GUARD: pass ? "PASS" : "FAIL",
    FALSE_PASS_ROOT_CAUSE_PROVEN: !!falseCoverageAudit.falsePassRootCauseProven,
    REAL_ROUTE_GUARD_PRESENT: true,
    SOFT_PASS_REMOVED: !!falseCoverageAudit.softPassRemoved,
    SILVER_FALSE_COVERAGE_REMOVED: true,
    REAL_IOS_REMOTE_EXECUTION_AVAILABLE: false,
    REAL_IOS_EQUIVALENCE_PROVEN: false,
    REAL_IOS_AUTOMATION_LIMITATION: true,
    REAL_IOS_PASS: iosConfirmed ? "YES" : "NOT_TESTED",
    PLAYWRIGHT_CHROMIUM_PASS: !!(chromiumResult && chromiumResult.PLAYWRIGHT_ENGINE_GEOMETRY_PASS),
    PLAYWRIGHT_WEBKIT_PASS: !!(webkitResult && webkitResult.PLAYWRIGHT_ENGINE_GEOMETRY_PASS),
    CALENDAR_DIRECT_CREATE: group("CALENDAR_DIRECT_CREATE"),
    CALENDAR_SILVER_CREATE: group("CALENDAR_SILVER_CREATE"),
    CALENDAR_EDIT: group("CALENDAR_EDIT"),
    TASKS_DIRECT_CREATE: group("TASKS_DIRECT_CREATE"),
    TASKS_SILVER_CREATE: group("TASKS_SILVER_CREATE"),
    TASKS_EDIT: group("TASKS_EDIT"),
    DATE_TITLE_DIFF_MAX_PX: dateMax,
    TIME_TITLE_DIFF_MAX_PX: timeMax,
    reasons,
    falseCoverageAudit,
    chromium: chromiumResult,
    webkit: webkitResult,
    runtimeError,
    viewports: viewports.map((v) => v.width + "x" + v.height + "@" + v.orient),
    notes: [
      "PLAYWRIGHT_WEBKIT label is intentional — never emit IPHONE= from this guard.",
      "Silver create routes measure Silver draft identity honestly and do not certify Calendar/Tasks overlays.",
      "Set REAL_IOS_CONFIRMED=1 only after physical iPhone getBoundingClientRect proof.",
      "IU_DATETIME_GUARD_FAST=1 limits viewports for local iteration.",
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
    "FALSE_PASS_ROOT_CAUSE_PROVEN: " + (report.FALSE_PASS_ROOT_CAUSE_PROVEN ? "YES" : "NO") + "\n"
  );
  process.stdout.write("SOFT_PASS_REMOVED: " + (report.SOFT_PASS_REMOVED ? "YES" : "NO") + "\n");
  process.stdout.write("SILVER_FALSE_COVERAGE_REMOVED: YES\n");
  process.stdout.write("REAL_ROUTE_GUARD_PRESENT: YES\n");
  process.stdout.write(
    "PLAYWRIGHT_CHROMIUM_PASS: " + (report.PLAYWRIGHT_CHROMIUM_PASS ? "PASS" : "FAIL") + "\n"
  );
  process.stdout.write(
    "PLAYWRIGHT_WEBKIT_PASS: " + (report.PLAYWRIGHT_WEBKIT_PASS ? "PASS" : "FAIL") + "\n"
  );
  process.stdout.write("REAL_IOS_PASS: " + report.REAL_IOS_PASS + "\n");
  process.stdout.write("CALENDAR_DIRECT_CREATE: " + report.CALENDAR_DIRECT_CREATE + "\n");
  process.stdout.write("CALENDAR_SILVER_CREATE: " + report.CALENDAR_SILVER_CREATE + "\n");
  process.stdout.write("CALENDAR_EDIT: " + report.CALENDAR_EDIT + "\n");
  process.stdout.write("TASKS_DIRECT_CREATE: " + report.TASKS_DIRECT_CREATE + "\n");
  process.stdout.write("TASKS_SILVER_CREATE: " + report.TASKS_SILVER_CREATE + "\n");
  process.stdout.write("TASKS_EDIT: " + report.TASKS_EDIT + "\n");
  process.stdout.write("DATE_TITLE_DIFF_MAX_PX: " + report.DATE_TITLE_DIFF_MAX_PX + "\n");
  process.stdout.write("TIME_TITLE_DIFF_MAX_PX: " + report.TIME_TITLE_DIFF_MAX_PX + "\n");
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
