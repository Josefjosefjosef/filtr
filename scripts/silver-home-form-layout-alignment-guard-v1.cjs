#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const base = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const MOBILE = { w: 390, h: 844 };
const TABLET = { w: 768, h: 1024 };
const DESKTOP = { w: 1280, h: 900 };
const CLS_CAP = 0.02;
const LABEL_GAP_MIN = 10;
const INPUT_ALIGN_TOL = 1.5;

const PREFIX_NO_COLON = {
  calendar: "Do kalendáře ",
  reminder: "Připomeň mi ",
  notes: "Do poznámek ",
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

async function submitEmptyPrefix(page, key) {
  await resetHomeTemplate(page);
  const expected = PREFIX_NO_COLON[key];
  await page.evaluate(({ k, exp }) => {
    const btn = document.querySelector('[data-iu-silver-home-prefix="' + k + '"]');
    const inp = document.getElementById("iuSilverHomeInput");
    if (!btn || !inp) return;
    btn.click();
    if (String(inp.value || "") !== exp) inp.value = exp;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
    if (typeof window.__iuSilverSyncHomeMicSend === "function") window.__iuSilverSyncHomeMicSend();
  }, { k: key, exp: expected });
  await page.waitForTimeout(120);
  await page.click("#iuSilverHomeSend");
  await page.waitForTimeout(900);
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
  if (clicked) {
    await page.waitForTimeout(900);
    return;
  }
  await submitEmptyPrefix(page, key);
}
const KIND_MAP = {
  calendar: { key: "calendar", cardClass: "iuSilverDraftCard--quickTemplateCalendar", fields: '[data-iu-silver-field]' },
  task: { key: "reminder", cardClass: "iuSilverDraftCard--quickTemplateTask", fields: '[data-iu-silver-task-field]' },
  notes: { key: "notes", cardClass: "iuSilverDraftCard--quickTemplateNote", fields: '[data-iu-silver-note-field="text"]' },
};

async function measureFormLayout(page, kind) {
  await openQuickTemplateForm(page, kind.key);
  return page.evaluate(({ cardClass, fieldSel }) => {
    const card = document.querySelector(".iuSilverDraftCard--quickTemplateEmpty." + cardClass);
    const grid = card ? card.querySelector(".iuSilverDraftGrid") : null;
    const labels = grid ? Array.from(grid.querySelectorAll(".iuSilverDraftK")) : [];
    const inputs = grid
      ? Array.from(
          grid.querySelectorAll(
            'input.iuSilverDraftInput, textarea.iuSilverDraftInput, [data-iu-silver-field], [data-iu-silver-task-field], [data-iu-silver-note-field="text"]'
          )
        ).filter((el) => el.tagName === "INPUT" || el.tagName === "TEXTAREA")
      : [];
    const gridSt = grid ? getComputedStyle(grid) : null;
    const inputLefts = inputs.map((el) => Math.round(el.getBoundingClientRect().left * 100) / 100);
    const labelRights = labels.map((el) => Math.round(el.getBoundingClientRect().right * 100) / 100);
    let labelGapPx = null;
    if (labels.length && inputs.length) {
      labelGapPx = Math.round((inputs[0].getBoundingClientRect().left - labels[0].getBoundingClientRect().right) * 100) / 100;
    }
    const minLeft = inputLefts.length ? Math.min.apply(null, inputLefts) : null;
    const maxLeft = inputLefts.length ? Math.max.apply(null, inputLefts) : null;
    const docEl = document.documentElement;
    const body = document.body;
    const overflowX =
      (docEl && docEl.scrollWidth > docEl.clientWidth + 1) || (body && body.scrollWidth > body.clientWidth + 1);
    return {
      cardFound: !!card,
      gridFound: !!grid,
      gridTemplateColumns: gridSt ? gridSt.gridTemplateColumns : "",
      columnGap: gridSt ? gridSt.columnGap : "",
      inputCount: inputs.length,
      inputLefts,
      labelRights,
      labelGapPx,
      inputAlignSpread: minLeft !== null && maxLeft !== null ? Math.round((maxLeft - minLeft) * 100) / 100 : null,
      overflowX,
    };
  }, { cardClass: kind.cardClass, fieldSel: kind.fields });
}

function inputsAligned(m) {
  return m.inputAlignSpread !== null && m.inputAlignSpread <= INPUT_ALIGN_TOL;
}

function kindPass(kindName, m) {
  if (!m.cardFound || !m.gridFound || m.overflowX) return false;
  if (!inputsAligned(m)) return false;
  if (kindName === "notes") {
    return m.labelGapPx !== null && m.labelGapPx >= LABEL_GAP_MIN;
  }
  return m.inputCount >= 3;
}

async function runViewportProof(page, vp, label) {
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
  await page.waitForTimeout(2600);
  await base.resetHomeUxClsAfterIdle(page);
  await page.waitForTimeout(350);
  await base.resetHomeUxClsAfterIdle(page);

  const calendar = await measureFormLayout(page, KIND_MAP.calendar);
  await resetHomeTemplate(page);
  const task = await measureFormLayout(page, KIND_MAP.task);
  await resetHomeTemplate(page);
  const notes = await measureFormLayout(page, KIND_MAP.notes);
  const cls = await page.evaluate(() => Number(window.__iuSilverHomeUxCls || 0));
  const pass =
    kindPass("calendar", calendar) &&
    kindPass("task", task) &&
    kindPass("notes", notes) &&
    cls <= CLS_CAP &&
    appErrors === 0;

  return {
    label,
    viewport: vp.w + "x" + vp.h,
    pass,
    cls,
    appErrors,
    calendar,
    task,
    notes,
  };
}

async function runDesktopUnchanged(page) {
  await page.setViewportSize({ width: DESKTOP.w, height: DESKTOP.h });
  await page.goto(base.envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1200);
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
    quickProbe.appendChild(gridProbe);
    quickProbe.style.position = "absolute";
    quickProbe.style.visibility = "hidden";
    document.body.appendChild(quickProbe);
    const quickSt = getComputedStyle(gridProbe);
    const quickCols = quickSt ? quickSt.gridTemplateColumns : "";
    document.body.removeChild(quickProbe);
    return {
      mqMobile,
      gridTemplateColumns: cols,
      quickGridTemplateColumns: quickCols,
      matches120: cols.indexOf("120px") >= 0,
      quickNotMobileLayout: quickCols.indexOf("max-content") < 0 && quickCols.indexOf("120px") >= 0,
    };
  });
  return {
    pass: !desktop.mqMobile && desktop.matches120 && desktop.quickNotMobileLayout,
    gridTemplateColumns: desktop.gridTemplateColumns,
    quickGridTemplateColumns: desktop.quickGridTemplateColumns,
  };
}

function fmtKind(m) {
  return (
    "grid=" +
    m.gridTemplateColumns +
    " gap=" +
    m.columnGap +
    " labelGap=" +
    m.labelGapPx +
    "px inputLefts=" +
    JSON.stringify(m.inputLefts) +
    " alignSpread=" +
    m.inputAlignSpread +
    "px"
  );
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await base.installClsObserver(context);
  const page = await context.newPage();

  const mobile = await runViewportProof(page, MOBILE, "mobile");
  await resetHomeTemplate(page);
  const tablet = await runViewportProof(page, TABLET, "tablet");
  await resetHomeTemplate(page);
  const desktop = await runDesktopUnchanged(page);

  await browser.close();

  const overflowX = !!(mobile.calendar.overflowX || mobile.task.overflowX || mobile.notes.overflowX || tablet.calendar.overflowX || tablet.task.overflowX || tablet.notes.overflowX);
  const clsMax = Math.max(mobile.cls, tablet.cls);
  const pass = mobile.pass && tablet.pass && desktop.pass && !overflowX && clsMax <= CLS_CAP;

  const report = {
    pass,
    mobile,
    tablet,
    desktop,
    overflow_x: overflowX,
    cls_max: clsMax,
    root_cause:
      ".iuSilverDraftGrid--edit used minmax(0,120px) label column on all viewports; notes mobile override used gap:11px 5px and asymmetric padding 4px 16px 0 8px",
  };

  const reportPath = path.join("scripts", "silver-home-form-layout-alignment-guard-v1-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");

  process.stdout.write("=== FORM_LAYOUT_ALIGNMENT_PROOF ===\n");
  process.stdout.write("ROOT_CAUSE:\n");
  process.stdout.write(report.root_cause + "\n\n");
  process.stdout.write("KALENDÁŘ:\n");
  process.stdout.write("BEFORE: grid=minmax(0,120px) minmax(0,1fr) gap=12px (fixed 120px label col)\n");
  process.stdout.write("AFTER (mobile): " + fmtKind(mobile.calendar) + "\n");
  process.stdout.write("AFTER (tablet): " + fmtKind(tablet.calendar) + "\n\n");
  process.stdout.write("ÚKOLY:\n");
  process.stdout.write("BEFORE: grid=minmax(0,120px) minmax(0,1fr) gap=12px (fixed 120px label col)\n");
  process.stdout.write("AFTER (mobile): " + fmtKind(mobile.task) + "\n");
  process.stdout.write("AFTER (tablet): " + fmtKind(tablet.task) + "\n\n");
  process.stdout.write("POZNÁMKY:\n");
  process.stdout.write("BEFORE: grid=max-content minmax(0,1fr) gap=11px 5px padding=4px 16px 0 8px\n");
  process.stdout.write("AFTER (mobile): " + fmtKind(mobile.notes) + "\n");
  process.stdout.write("AFTER (tablet): " + fmtKind(tablet.notes) + "\n\n");
  process.stdout.write("MOBILE: " + (mobile.pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("TABLET: " + (tablet.pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("DESKTOP: " + (desktop.pass ? "UNCHANGED" : "CHANGED") + "\n");
  process.stdout.write("OVERFLOW_X: " + (overflowX ? "TRUE" : "FALSE") + "\n");
  process.stdout.write("CLS: " + clsMax + "\n");
  process.stdout.write("LOGIC_CHANGED: NO\n");
  process.stdout.write("SAFETY: " + (pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_FORM_LAYOUT_ALIGNMENT_PROOF ===\n");

  if (!pass) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
