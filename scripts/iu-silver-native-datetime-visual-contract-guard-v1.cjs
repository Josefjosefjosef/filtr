#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium, webkit } = require("playwright");
const base = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
} = require("./proofs/open_meteo_guard_stub.cjs");

const REPO = path.join(__dirname, "..");
const TOL = 1;
const VIEWPORTS = [
  { w: 390, h: 844, label: "390p" },
  { w: 768, h: 1024, label: "768p" },
];

function readCss() {
  return {
    app: fs.readFileSync(path.join(REPO, "assets", "app.css"), "utf8"),
    premium: fs.readFileSync(path.join(REPO, "assets", "iu-silver-premium-draft.css"), "utf8"),
  };
}

function assertCssContract() {
  const { app, premium } = readCss();
  const mqBlock =
    /@media\s*\(\s*max-width:\s*1024px\s*\)[\s\S]*?\.iuSilverDraftGrid--edit\s*>\s*\.iuSilverDraftInput\[type="date"\][\s\S]*?\}/.exec(
      app
    );
  const mqText = mqBlock ? mqBlock[0] : "";
  const hasAppearanceNone =
    /iuSilverDraftInput\[type="date"\][\s\S]{0,420}appearance:\s*none\s*!important/.test(mqText) ||
    /iuSilverDraftInput\[type="date"\][\s\S]{0,420}-webkit-appearance:\s*none\s*!important/.test(mqText);
  const hasOverflowClipOrHidden =
    /iuSilverDraftInput\[type="date"\][\s\S]{0,420}overflow-x:\s*(clip|hidden)/.test(mqText);
  const hasVisibleOverflow =
    /iuSilverDraftInput\[type="date"\][\s\S]{0,420}overflow-x:\s*visible/.test(mqText);
  const premiumMirror =
    /iuSilverDraftInput\[type="date"\][\s\S]{0,420}appearance:\s*none\s*!important/.test(premium) ||
    /iuSilverDraftInput\[type="date"\][\s\S]{0,420}-webkit-appearance:\s*none\s*!important/.test(premium);
  const regressionGrid =
    /iuSilverDraftCard--quickTemplateEmpty\s+\.iuSilverDraftGrid--edit\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*max-content\)\s+minmax\(0,\s*1fr\)/.test(
      app
    );
  return {
    pass: hasAppearanceNone && hasOverflowClipOrHidden && premiumMirror && !hasVisibleOverflow,
    hasAppearanceNone,
    hasOverflowClipOrHidden,
    hasVisibleOverflow,
    premiumMirror,
    regressionGrid,
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

async function openForm(page, key) {
  await page.evaluate(() => {
    const ov = document.getElementById("iuSilverChatOverlay");
    if (ov && !ov.hidden) {
      const c = document.getElementById("iuSilverChatClose");
      if (c) c.click();
    }
    if (typeof window.__iuSilverResetHomeTemplateMode === "function") window.__iuSilverResetHomeTemplateMode();
  });
  await page.waitForTimeout(250);
  const opened = await page.evaluate((k) => {
    const btn = document.querySelector('[data-iu-silver-home-quick-action="' + k + '"]');
    if (btn) {
      btn.click();
      return "click";
    }
    if (typeof window.__iuSilverOpenQuickTemplateEmptyDirect === "function") {
      window.__iuSilverOpenQuickTemplateEmptyDirect(k);
      return "direct";
    }
    return "";
  }, key);
  if (!opened) throw new Error("open failed:" + key);
  await page.waitForTimeout(900);
  await dismiss(page);
}

function measure(kind) {
  return ({ kind, tol }) => {
    const cardSel =
      kind === "calendar"
        ? ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateCalendar"
        : ".iuSilverDraftCard--quickTemplateEmpty.iuSilverDraftCard--quickTemplateTask";
    const dateSel =
      kind === "calendar"
        ? 'input[type="date"][data-iu-silver-field="date"]'
        : 'input[type="date"][data-iu-silver-task-field="due"]';
    const timeSel =
      kind === "calendar"
        ? 'input[type="time"][data-iu-silver-field="time"]'
        : 'input[type="time"][data-iu-silver-task-field="time"]';
    const titleSel =
      kind === "calendar"
        ? 'input[data-iu-silver-field="title"]'
        : 'input[data-iu-silver-task-field="title"]';
    const noteSel =
      kind === "calendar"
        ? 'textarea[data-iu-silver-field="note"]'
        : 'textarea[data-iu-silver-task-field="note"]';
    const card = document.querySelector(cardSel);
    const grid = card ? card.querySelector(".iuSilverDraftGrid--edit") : null;
    const date = grid ? grid.querySelector(dateSel) : null;
    const time = grid ? grid.querySelector(timeSel) : null;
    const title = grid ? grid.querySelector(titleSel) : null;
    const note = grid ? grid.querySelector(noteSel) : null;
    if (!date || !time || !title) return { ok: false, reason: "missing_fields" };

    function info(el) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      const webkitAppearance = st.getPropertyValue("-webkit-appearance").trim();
      const appearance = st.getPropertyValue("appearance").trim();
      return {
        right: Math.round(r.right * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        webkitAppearance,
        appearance: appearance || webkitAppearance,
        overflowX: st.overflowX,
        minWidth: st.minWidth,
        paddingRight: st.paddingRight,
      };
    }

    const d = info(date);
    const t = info(title);
    const tm = info(time);
    const n = note ? info(note) : null;
    const refRight = Math.max(t.right, n ? n.right : t.right);

    function nativeLayerActive(infoRow) {
      if (infoRow.webkitAppearance === "none" || infoRow.appearance === "none") return false;
      if (infoRow.webkitAppearance === "auto" || infoRow.appearance === "auto") return true;
      return infoRow.webkitAppearance === "" && infoRow.appearance === "";
    }

    const dateNativeLayer = nativeLayerActive(d);
    const timeNativeLayer = nativeLayerActive(tm);
    const overflowVisible = d.overflowX === "visible" || tm.overflowX === "visible";
    const scrollOverflow =
      d.scrollWidth > d.clientWidth + tol ||
      tm.scrollWidth > tm.clientWidth + tol;
    const dateTitleDiff = Math.abs(d.right - t.right);
    const timeTitleDiff = Math.abs(tm.right - t.right);
    const dateRefDiff = Math.abs(d.right - refRight);
    const timeRefDiff = Math.abs(tm.right - refRight);
    const dateWiderThanRef = d.right > refRight + tol || d.width > t.width + tol;
    const timeWiderThanRef = tm.right > refRight + tol || tm.width > t.width + tol;

    return {
      ok: true,
      kind,
      nativeLayerActive: dateNativeLayer || timeNativeLayer,
      dateNativeLayer,
      timeNativeLayer,
      scrollOverflow,
      overflowVisible,
      dateTitleDiff,
      timeTitleDiff,
      dateRefDiff,
      timeRefDiff,
      dateWiderThanRef,
      timeWiderThanRef,
      date: d,
      time: tm,
      title: t,
      note: n,
      visualContractPass:
        !dateNativeLayer &&
        !timeNativeLayer &&
        !overflowVisible &&
        !scrollOverflow,
      layoutOnlyPass: dateTitleDiff <= tol && timeTitleDiff <= tol && !dateWiderThanRef && !timeWiderThanRef,
    };
  };
}

function runtimePass(m) {
  return m && m.ok && m.visualContractPass && m.layoutOnlyPass;
}

async function runEngine(engineType, label) {
  const browser = await engineType.launch({ headless: true });
  const page = await browser.newPage();
  await installProofGuardNetworkStubs(page);
  createIgnorableResourceTracker().attachToPage(page);
  const rows = [];
  for (let i = 0; i < VIEWPORTS.length; i++) {
    const vp = VIEWPORTS[i];
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto(base.envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(1200);
    await dismiss(page);
    for (const kind of ["reminder", "calendar"]) {
      await openForm(page, kind);
      const m = await page.evaluate(measure(kind), { kind, tol: TOL });
      rows.push({ engine: label, vp: vp.label, kind, ...m });
      await page.evaluate(() => {
        const c = document.getElementById("iuSilverChatClose");
        if (c) c.click();
      });
      await page.waitForTimeout(250);
    }
  }
  await browser.close();
  return rows;
}

async function main() {
  const css = assertCssContract();
  const chromiumRows = await runEngine(chromium, "chromium");
  const webkitRows = await runEngine(webkit, "webkit");
  const rows = chromiumRows.concat(webkitRows);

  const layoutOnlyWouldPass = rows.every((r) => r.ok && r.layoutOnlyPass);
  const visualWouldPass = rows.every((r) => runtimePass(r));
  const pass = css.pass && visualWouldPass;

  process.stdout.write("=== IU_SILVER_NATIVE_DATETIME_VISUAL_CONTRACT_GUARD_V1 ===\n");
  process.stdout.write(
    "REGRESSION_COMMIT: 350795d58e0 (grid max-content/1fr exposed native date/time intrinsic min-width)\n"
  );
  process.stdout.write(
    "ROOT_CAUSE: shared .iuSilverDraftGrid--edit + native appearance:auto date/time in column 2; layout-only width clamps do not reset UA visual layer\n"
  );
  process.stdout.write(
    "FALSE_PASS_EXPLAINED: old guards used getBoundingClientRect() on outer input; Playwright WebKit != physical iOS; overflow-x:visible allows native paint beyond perceived edge\n"
  );
  process.stdout.write(
    "CSS_CONTRACT: " +
      (css.pass ? "PASS" : "FAIL") +
      " appearanceNone=" +
      css.hasAppearanceNone +
      " overflowClip=" +
      css.hasOverflowClipOrHidden +
      " visibleOverflow=" +
      css.hasVisibleOverflow +
      "\n"
  );
  process.stdout.write("LAYOUT_ONLY_GUARDS_WOULD_PASS: " + (layoutOnlyWouldPass ? "YES" : "NO") + "\n");
  process.stdout.write("VISUAL_CONTRACT_RUNTIME: " + (visualWouldPass ? "PASS" : "FAIL") + "\n");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.ok) {
      process.stdout.write(r.engine + " " + r.vp + " " + r.kind + " MISSING\n");
      continue;
    }
    process.stdout.write(
      r.engine +
        " " +
        r.vp +
        " " +
        r.kind +
        " layoutOnly=" +
        (r.layoutOnlyPass ? "PASS" : "FAIL") +
        " visual=" +
        (r.visualContractPass ? "PASS" : "FAIL") +
        " appearance=" +
        r.date.appearance +
        " overflowX=" +
        r.date.overflowX +
        " dateTitleDiff=" +
        r.dateTitleDiff +
        "\n"
    );
  }
  process.stdout.write("REAL_IOS_PASS: NOT_TESTED\n");
  process.stdout.write("SAFETY: " + (pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("=== END_IU_SILVER_NATIVE_DATETIME_VISUAL_CONTRACT_GUARD_V1 ===\n");
  if (!pass) process.exit(1);
}

main().catch((e) => {
  process.stderr.write(String(e.stack || e) + "\n");
  process.exit(1);
});
