#!/usr/bin/env node
"use strict";

/**
 * Geometry + CSS-contract guard: Silver quick-template Datum/Čas inputs must stay inside
 * the form card on mobile + tablet (no horizontal overflow, positive card inset).
 * Also asserts computed min-width:0 on date/time (regression of the WebKit/iOS fix).
 * Desktop layout must remain unchanged (120px label column, no mobile max-content track).
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const base = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const VIEWPORTS = [
  { w: 320, h: 720, label: "320" },
  { w: 360, h: 740, label: "360" },
  { w: 375, h: 812, label: "375" },
  { w: 390, h: 844, label: "390" },
  { w: 414, h: 896, label: "414" },
  { w: 430, h: 932, label: "430" },
  { w: 600, h: 960, label: "600" },
  { w: 768, h: 1024, label: "768" },
  { w: 820, h: 1180, label: "820" },
  { w: 1024, h: 1366, label: "1024" },
];
const DESKTOP = { w: 1280, h: 900 };
const TOL_PX = 1.5;
const PAD_MIN_PX = 8;

const KIND_MAP = {
  calendar: {
    key: "calendar",
    cardClass: "iuSilverDraftCard--quickTemplateCalendar",
    dateSel: 'input.iuSilverDraftInput[type="date"][data-iu-silver-field="date"]',
    timeSel: 'input.iuSilverDraftInput[type="time"][data-iu-silver-field="time"]',
    titleSel: 'input.iuSilverDraftInput[data-iu-silver-field="title"]',
    dateLabelText: "Datum",
  },
  task: {
    key: "reminder",
    cardClass: "iuSilverDraftCard--quickTemplateTask",
    dateSel: 'input.iuSilverDraftInput[type="date"][data-iu-silver-task-field="due"]',
    timeSel: 'input.iuSilverDraftInput[type="time"][data-iu-silver-task-field="time"]',
    titleSel: 'input.iuSilverDraftInput[data-iu-silver-task-field="title"]',
    dateLabelText: "Datum",
  },
};

async function resetHomeTemplate(page) {
  await page.evaluate(() => {
    const inp = document.getElementById("iuSilverHomeInput");
    if (inp) inp.value = "";
    if (typeof window.__iuSilverResetHomeTemplateMode === "function") window.__iuSilverResetHomeTemplateMode();
    else if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
    const ov = document.getElementById("iuSilverChatOverlay");
    if (ov && !ov.hidden) {
      const close = document.getElementById("iuSilverChatClose");
      if (close && typeof close.click === "function") close.click();
    }
  });
  await page.waitForTimeout(350);
}

async function openQuickTemplateForm(page, key) {
  await resetHomeTemplate(page);
  const clicked = await page.evaluate((k) => {
    const btn = document.querySelector('[data-iu-silver-home-quick-action="' + k + '"]');
    if (btn && typeof btn.click === "function") {
      btn.click();
      return true;
    }
    return false;
  }, key);
  if (!clicked) throw new Error("quick-action missing: " + key);
  await page.waitForTimeout(900);
}

async function measureKind(page, kind) {
  await openQuickTemplateForm(page, kind.key);
  return page.evaluate(
    ({ cardClass, dateSel, timeSel, titleSel, dateLabelText, tol, padMin }) => {
      const card = document.querySelector(".iuSilverDraftCard--quickTemplateEmpty." + cardClass);
      const grid = card ? card.querySelector(".iuSilverDraftGrid--edit") : null;
      const dateInput = grid ? grid.querySelector(dateSel) : null;
      const timeInput = grid ? grid.querySelector(timeSel) : null;
      const titleInput = grid ? grid.querySelector(titleSel) : null;
      const labels = grid ? Array.from(grid.querySelectorAll(".iuSilverDraftK")) : [];
      const dateLabel = labels.find((el) => String(el.textContent || "").trim() === dateLabelText) || null;

      const cardRect = card ? card.getBoundingClientRect() : null;
      const dateRect = dateInput ? dateInput.getBoundingClientRect() : null;
      const timeRect = timeInput ? timeInput.getBoundingClientRect() : null;
      const titleRect = titleInput ? titleInput.getBoundingClientRect() : null;
      const labelRect = dateLabel ? dateLabel.getBoundingClientRect() : null;

      const cardCs = card ? getComputedStyle(card) : null;
      const cardPadRight = cardCs ? parseFloat(cardCs.paddingRight) || 0 : 0;
      const cardInnerRight = cardRect ? cardRect.right - cardPadRight : null;

      const dateSt = dateInput ? getComputedStyle(dateInput) : null;
      const timeSt = timeInput ? getComputedStyle(timeInput) : null;
      const dateMinWidth = dateSt ? String(dateSt.minWidth || "") : "";
      const timeMinWidth = timeSt ? String(timeSt.minWidth || "") : "";
      const minWidthOk = dateMinWidth === "0px" && timeMinWidth === "0px";

      const dateRightOk =
        !!dateRect && cardInnerRight !== null && dateRect.right <= cardInnerRight + tol;
      const timeRightOk =
        !!timeRect && cardInnerRight !== null && timeRect.right <= cardInnerRight + tol;
      const datePadOk =
        !!dateRect &&
        cardInnerRight !== null &&
        cardInnerRight - dateRect.right >= padMin - tol;
      const timePadOk =
        !!timeRect &&
        cardInnerRight !== null &&
        cardInnerRight - timeRect.right >= padMin - tol;
      const dateAfterLabel =
        !!dateRect && !!labelRect && dateRect.left > labelRect.right - tol;
      const alignsWithTitle =
        !!dateRect &&
        !!titleRect &&
        Math.abs(dateRect.right - titleRect.right) <= tol &&
        Math.abs(dateRect.left - titleRect.left) <= tol;

      const docEl = document.documentElement;
      const body = document.body;
      const scrollW = Math.max(docEl ? docEl.scrollWidth : 0, body ? body.scrollWidth : 0);
      const clientW = docEl ? docEl.clientWidth : 0;
      const overflowX = scrollW > clientW + tol;
      const cardOverflowX = !!card && card.scrollWidth > card.clientWidth + tol;

      return {
        cardFound: !!card,
        gridFound: !!grid,
        dateFound: !!dateInput,
        timeFound: !!timeInput,
        titleFound: !!titleInput,
        minWidthOk,
        dateMinWidth,
        timeMinWidth,
        dateRightOk,
        timeRightOk,
        datePadOk,
        timePadOk,
        dateAfterLabel,
        alignsWithTitle,
        overflowX,
        cardOverflowX,
        dateRight: dateRect ? Math.round(dateRect.right * 100) / 100 : null,
        timeRight: timeRect ? Math.round(timeRect.right * 100) / 100 : null,
        titleRight: titleRect ? Math.round(titleRect.right * 100) / 100 : null,
        cardInnerRight: cardInnerRight !== null ? Math.round(cardInnerRight * 100) / 100 : null,
        dateRightInset:
          dateRect && cardInnerRight !== null
            ? Math.round((cardInnerRight - dateRect.right) * 100) / 100
            : null,
        timeRightInset:
          timeRect && cardInnerRight !== null
            ? Math.round((cardInnerRight - timeRect.right) * 100) / 100
            : null,
        scrollWidth: scrollW,
        clientWidth: clientW,
      };
    },
    {
      cardClass: kind.cardClass,
      dateSel: kind.dateSel,
      timeSel: kind.timeSel,
      titleSel: kind.titleSel,
      dateLabelText: kind.dateLabelText,
      tol: TOL_PX,
      padMin: PAD_MIN_PX,
    }
  );
}

function kindPass(m) {
  return (
    m.cardFound &&
    m.gridFound &&
    m.dateFound &&
    m.timeFound &&
    m.titleFound &&
    m.minWidthOk &&
    m.dateRightOk &&
    m.timeRightOk &&
    m.datePadOk &&
    m.timePadOk &&
    m.dateAfterLabel &&
    m.alignsWithTitle &&
    !m.overflowX &&
    !m.cardOverflowX
  );
}

async function runViewport(page, vp) {
  await installProofGuardNetworkStubs(page);
  const ignorableTracker = createIgnorableResourceTracker();
  ignorableTracker.attachToPage(page);
  let appErrors = 0;
  page.on("pageerror", (err) => {
    try {
      const t = String(err && err.message ? err.message : err);
      if (isIgnorableGuardConsoleError(t)) return;
      appErrors += 1;
    } catch (_) {}
  });
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await page.goto(base.envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2200);

  const calendar = await measureKind(page, KIND_MAP.calendar);
  await resetHomeTemplate(page);
  const task = await measureKind(page, KIND_MAP.task);
  await resetHomeTemplate(page);

  const pass = kindPass(calendar) && kindPass(task) && appErrors === 0;
  return {
    label: vp.label,
    viewport: vp.w + "x" + vp.h,
    pass,
    appErrors,
    calendar,
    task,
  };
}

async function runDesktopUnchanged(page) {
  await page.setViewportSize({ width: DESKTOP.w, height: DESKTOP.h });
  await page.goto(base.envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1000);
  const desktop = await page.evaluate(() => {
    const mqMobile = window.matchMedia("(max-width: 1024px)").matches;
    const probe = document.createElement("div");
    probe.className = "iuSilverDraftGrid iuSilverDraftGrid--edit";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    document.body.appendChild(probe);
    const st = getComputedStyle(probe);
    const cols = st ? st.gridTemplateColumns : "";
    document.body.removeChild(probe);

    const quickProbe = document.createElement("div");
    quickProbe.className =
      "iuSilverDraftCard--quickTemplateEmpty iuSilverDraftCard--quickTemplateCalendar";
    const gridProbe = document.createElement("div");
    gridProbe.className = "iuSilverDraftGrid iuSilverDraftGrid--edit";
    const dateProbe = document.createElement("input");
    dateProbe.type = "date";
    dateProbe.className = "iuSilverDraftInput";
    quickProbe.appendChild(gridProbe);
    gridProbe.appendChild(dateProbe);
    quickProbe.style.position = "absolute";
    quickProbe.style.visibility = "hidden";
    document.body.appendChild(quickProbe);
    const quickSt = getComputedStyle(gridProbe);
    const quickCols = quickSt ? quickSt.gridTemplateColumns : "";
    const dateMin = getComputedStyle(dateProbe).minWidth;
    document.body.removeChild(quickProbe);

    return {
      mqMobile,
      gridTemplateColumns: cols,
      quickGridTemplateColumns: quickCols,
      matches120: cols.indexOf("120px") >= 0,
      quickNotMobileLayout: quickCols.indexOf("max-content") < 0 && quickCols.indexOf("120px") >= 0,
      dateMinWidthDesktop: dateMin,
      dateMinNotForcedZero: dateMin !== "0px",
    };
  });
  return {
    pass:
      !desktop.mqMobile &&
      desktop.matches120 &&
      desktop.quickNotMobileLayout &&
      desktop.dateMinNotForcedZero,
    ...desktop,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const results = [];
  for (let i = 0; i < VIEWPORTS.length; i++) {
    const r = await runViewport(page, VIEWPORTS[i]);
    results.push(r);
    await resetHomeTemplate(page);
  }
  const desktop = await runDesktopUnchanged(page);
  await browser.close();

  const overflowX = results.some(
    (r) => r.calendar.overflowX || r.task.overflowX || r.calendar.cardOverflowX || r.task.cardOverflowX
  );
  const pass = results.every((r) => r.pass) && desktop.pass && !overflowX;

  const report = {
    pass,
    overflow_x: overflowX,
    desktop,
    viewports: results,
    root_cause:
      "Native date/time inputs as CSS grid items default to min-width:auto (large intrinsic min size, esp. WebKit/iOS); without min-width:0 they overflow or clip against the quick-template card on mobile/tablet.",
  };

  const reportPath = path.join(
    process.env.TEMP || process.env.TMPDIR || "/tmp",
    "silver-home-date-time-input-fit-guard-v1-report.json"
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

  process.stdout.write("=== SILVER_HOME_DATE_TIME_INPUT_FIT_GUARD_V1 ===\n");
  process.stdout.write("ROOT_CAUSE: " + report.root_cause + "\n");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    process.stdout.write(
      r.viewport +
        " calendar=" +
        (kindPass(r.calendar) ? "PASS" : "FAIL") +
        " task=" +
        (kindPass(r.task) ? "PASS" : "FAIL") +
        " minW=" +
        r.calendar.dateMinWidth +
        "/" +
        r.task.dateMinWidth +
        " inset=" +
        r.calendar.dateRightInset +
        "/" +
        r.task.dateRightInset +
        " overflowX=" +
        (r.calendar.overflowX || r.task.overflowX || r.calendar.cardOverflowX || r.task.cardOverflowX) +
        "\n"
    );
  }
  process.stdout.write("DESKTOP: " + (desktop.pass ? "UNCHANGED" : "CHANGED") + "\n");
  process.stdout.write("OVERFLOW_X: " + (overflowX ? "TRUE" : "FALSE") + "\n");
  process.stdout.write("REPORT: " + reportPath + "\n");
  process.stdout.write("SAFETY: " + (pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_SILVER_HOME_DATE_TIME_INPUT_FIT_GUARD_V1 ===\n");

  if (!pass) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
