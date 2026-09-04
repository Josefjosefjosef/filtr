#!/usr/bin/env node
"use strict";

/**
 * Silver Nová událost (quick-action) — Save must enable from form input events.
 *
 * Root cause (fixed): syncDraftFromCardInputs called iuSilverSanitizeDraftTitle on
 * manually typed titles. That chat/NLP pipeline can wipe a valid title while the
 * input still shows text → isDraftSaveable false → Uložit stays disabled.
 *
 * Contract:
 *   A) date+time+title via input (no blur) → Save enabled → submit creates event
 *   B) all-day ON + date+title (no time required) → Save enabled → submit allDay
 *   C) title that NLP sanitize would reject (e.g. contains "to") still enables Save
 *   D) fresh form after save starts with Save disabled (no stale enable)
 */

const fs = require("fs");
const path = require("path");
const { chromium, webkit } = require("playwright");
const base = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
} = require("./proofs/open_meteo_guard_stub.cjs");

const REPO = path.join(__dirname, "..");
const VIEWPORTS = [
  { w: 390, h: 844, label: "390p" },
  { w: 768, h: 1024, label: "768p" },
];

function assertSourceContract() {
  const eng = fs.readFileSync(path.join(REPO, "assets", "iu-silver-p0-engine.js"), "utf8");
  const syncStart = eng.indexOf("function syncDraftFromCardInputs");
  const syncEnd = eng.indexOf("function refreshLastDraftCard");
  const syncBody =
    syncStart >= 0 && syncEnd > syncStart ? eng.slice(syncStart, syncEnd) : "";
  const calendarTitleBlock = syncBody.includes('[data-iu-silver-field="title"]');
  const noSanitizeInSync = !/iuSilverSanitizeDraftTitle\s*\(/.test(syncBody);
  const usesNormalize =
    /normalizeSilverTitleV1\s*\(\s*tt0\s*,\s*\{\s*kind:\s*"calendar"\s*\}/.test(syncBody) ||
    /normalizeSilverTitleV1\s*\([\s\S]{0,80}kind:\s*"calendar"/.test(syncBody);
  const saveableContract =
    /function isDraftSaveable\s*\([\s\S]{0,220}allDay[\s\S]{0,120}meta\.title\s*===\s*"certain"/.test(
      eng
    );
  return {
    pass: calendarTitleBlock && noSanitizeInSync && usesNormalize && saveableContract,
    calendarTitleBlock,
    noSanitizeInSync,
    usesNormalize,
    saveableContract,
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

async function openCalendarForm(page) {
  await page.evaluate(() => {
    const ov = document.getElementById("iuSilverChatOverlay");
    if (ov && !ov.hidden) {
      const c = document.getElementById("iuSilverChatClose");
      if (c) c.click();
    }
    if (typeof window.__iuSilverResetHomeTemplateMode === "function") {
      window.__iuSilverResetHomeTemplateMode();
    }
  });
  await page.waitForTimeout(200);
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('[data-iu-silver-home-quick-action="calendar"]');
    if (btn) {
      btn.click();
      return "click";
    }
    if (typeof window.__iuSilverOpenQuickTemplateEmptyDirect === "function") {
      window.__iuSilverOpenQuickTemplateEmptyDirect("calendar");
      return "direct";
    }
    return "";
  });
  if (!opened) throw new Error("open_calendar_failed");
  await page.waitForSelector(
    ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateCalendar",
    { timeout: 15000 }
  );
  await dismiss(page);
}

async function readSaveState(page) {
  return page.evaluate(() => {
    const card = document.querySelector(
      ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateCalendar"
    );
    const save = card ? card.querySelector('[data-iu-silver-action="save"]') : null;
    const date = card ? card.querySelector('[data-iu-silver-field="date"]') : null;
    const time = card ? card.querySelector('[data-iu-silver-field="time"]') : null;
    const title = card ? card.querySelector('[data-iu-silver-field="title"]') : null;
    const toggle = card ? card.querySelector("[data-iu-silver-field-all-day]") : null;
    return {
      ok: !!(card && save),
      saveDisabled: save ? !!save.disabled : true,
      date: date ? String(date.value || "") : "",
      time: time ? String(time.value || "") : "",
      title: title ? String(title.value || "") : "",
      timeDisabled: !!(time && time.disabled),
      allDayOn: !!(toggle && toggle.classList.contains("is-on")),
    };
  });
}

async function fillTimedEvent(page, titleText) {
  return page.evaluate((title) => {
    const card = document.querySelector(
      ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateCalendar"
    );
    const date = card.querySelector('[data-iu-silver-field="date"]');
    const time = card.querySelector('[data-iu-silver-field="time"]');
    const titleEl = card.querySelector('[data-iu-silver-field="title"]');
    const toggle = card.querySelector("[data-iu-silver-field-all-day]");
    if (toggle && toggle.classList.contains("is-on")) toggle.click();
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    date.value = y + "-" + m + "-" + d;
    date.dispatchEvent(new Event("input", { bubbles: true }));
    time.disabled = false;
    time.value = "15:45";
    time.dispatchEvent(new Event("input", { bubbles: true }));
    titleEl.value = "";
    titleEl.dispatchEvent(new Event("input", { bubbles: true }));
    titleEl.value = title;
    titleEl.dispatchEvent(new Event("input", { bubbles: true }));
    /* Intentionally no blur / change on title — contract is input-driven. */
    const save = card.querySelector('[data-iu-silver-action="save"]');
    return { saveDisabled: !!save.disabled, titleDom: titleEl.value };
  }, titleText);
}

async function fillAllDayEvent(page, titleText) {
  return page.evaluate((title) => {
    const card = document.querySelector(
      ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateCalendar"
    );
    const date = card.querySelector('[data-iu-silver-field="date"]');
    const titleEl = card.querySelector('[data-iu-silver-field="title"]');
    const toggle = card.querySelector("[data-iu-silver-field-all-day]");
    if (toggle && !toggle.classList.contains("is-on")) toggle.click();
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    date.value = y + "-" + m + "-" + d;
    date.dispatchEvent(new Event("input", { bubbles: true }));
    titleEl.value = title;
    titleEl.dispatchEvent(new Event("input", { bubbles: true }));
    const save = card.querySelector('[data-iu-silver-action="save"]');
    const time = card.querySelector('[data-iu-silver-field="time"]');
    return {
      saveDisabled: !!save.disabled,
      timeDisabled: !!(time && time.disabled),
      allDayOn: !!(toggle && toggle.classList.contains("is-on")),
    };
  }, titleText);
}

async function submitAndCapture(page) {
  return page.evaluate(async () => {
    const payload = { calls: [] };
    const svc = window.iuCalendarService || {};
    const prev =
      typeof svc.calendarCreateEvent === "function" ? svc.calendarCreateEvent.bind(svc) : null;
    window.iuCalendarService = svc;
    svc.calendarCreateEvent = async function (arg) {
      payload.calls.push(arg ? JSON.parse(JSON.stringify(arg)) : null);
      return {
        ok: true,
        event: {
          id: "guard-save-enable-" + Date.now(),
          date: arg && arg.date,
          time: arg && arg.time,
          allDay: !!(arg && arg.allDay),
          title: arg && arg.title,
        },
      };
    };
    const save = document.querySelector(
      '.iuSilverDraftCard--quickTemplateEmpty [data-iu-silver-action="save"]'
    );
    const wasDisabled = !!(save && save.disabled);
    if (save && !save.disabled) save.click();
    await new Promise((r) => setTimeout(r, 450));
    if (prev) svc.calendarCreateEvent = prev;
    const last = payload.calls.length ? payload.calls[payload.calls.length - 1] : null;
    return {
      wasDisabled,
      callCount: payload.calls.length,
      allDay: !!(last && last.allDay),
      time: last ? String(last.time || "") : "",
      title: last ? String(last.title || "") : "",
      date: last ? String(last.date || "") : "",
      saveResult: window.__iuSilverLastSaveResult || null,
    };
  });
}

async function runViewport(page, vp) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.goto(base.envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1200);
  await dismiss(page);
  await openCalendarForm(page);

  const empty = await readSaveState(page);
  const emptyOk = empty.ok && empty.saveDisabled === true;

  /* A + C: timed event with NLP-hostile title containing "to" */
  const filledA = await fillTimedEvent(page, "Naplanuj to guard " + Date.now());
  const enableA = filledA.saveDisabled === false;
  const capA = enableA ? await submitAndCapture(page) : { callCount: 0, wasDisabled: true };
  const submitA =
    enableA &&
    capA.wasDisabled === false &&
    capA.callCount >= 1 &&
    capA.allDay === false &&
    /^\d{2}:\d{2}$/.test(capA.time) &&
    String(capA.title || "").indexOf("Naplanuj to guard") === 0;

  /* D: reopen fresh form — Save must start disabled */
  await openCalendarForm(page);
  const fresh = await readSaveState(page);
  const freshOk = fresh.ok && fresh.saveDisabled === true;

  /* B: all-day */
  const filledB = await fillAllDayEvent(page, "IU all-day save-enable " + Date.now());
  const enableB =
    filledB.saveDisabled === false && filledB.allDayOn === true && filledB.timeDisabled === true;
  const capB = enableB ? await submitAndCapture(page) : { callCount: 0, wasDisabled: true };
  const submitB =
    enableB &&
    capB.wasDisabled === false &&
    capB.callCount >= 1 &&
    capB.allDay === true &&
    capB.time === "00:00" &&
    String(capB.title || "").indexOf("IU all-day save-enable") === 0;

  return {
    vp: vp.label,
    pass: emptyOk && enableA && submitA && freshOk && enableB && submitB,
    emptyOk,
    enableA,
    submitA,
    freshOk,
    enableB,
    submitB,
    filledA,
    filledB,
    capA,
    capB,
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
    String(process.env.IU_SILVER_CAL_SAVE_ENABLE_SKIP_WEBKIT || "").trim() === "1" ||
    String(process.env.IU_SILVER_CAL_SAVE_ENABLE_SKIP_WEBKIT || "").toLowerCase() === "true";

  const chromiumRows = await runEngine(chromium, "chromium");
  let webkitRows = [];
  if (skipWebkit) {
    process.stdout.write(
      "WEBKIT_SKIPPED reason=IU_SILVER_CAL_SAVE_ENABLE_SKIP_WEBKIT chromium_only_ci_contract\n"
    );
  } else {
    webkitRows = await runEngine(webkit, "webkit");
  }
  const rows = chromiumRows.concat(webkitRows);
  const runtimePass = rows.every((r) => r.pass);
  const pass = src.pass && runtimePass;

  process.stdout.write("=== IU_SILVER_CALENDAR_SAVE_ENABLE_GUARD_V1 ===\n");
  process.stdout.write(
    "ROOT_CAUSE: syncDraftFromCardInputs applied iuSilverSanitizeDraftTitle to manual form titles; NLP wipe left DOM filled + Save disabled\n"
  );
  process.stdout.write(
    "SOURCE: " +
      (src.pass ? "PASS" : "FAIL") +
      " noSanitizeInSync=" +
      src.noSanitizeInSync +
      " usesNormalize=" +
      src.usesNormalize +
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
        " empty=" +
        (r.emptyOk ? "PASS" : "FAIL") +
        " timedEnable=" +
        (r.enableA ? "PASS" : "FAIL") +
        " timedSubmit=" +
        (r.submitA ? "PASS" : "FAIL") +
        " fresh=" +
        (r.freshOk ? "PASS" : "FAIL") +
        " allDayEnable=" +
        (r.enableB ? "PASS" : "FAIL") +
        " allDaySubmit=" +
        (r.submitB ? "PASS" : "FAIL") +
        "\n"
    );
  }
  process.stdout.write("SAFETY: " + (pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_IU_SILVER_CALENDAR_SAVE_ENABLE_GUARD_V1 ===\n");
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
