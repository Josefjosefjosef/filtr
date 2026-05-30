#!/usr/bin/env node
"use strict";

const base = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");
const emptyShared = require("./silver-home-quick-template-empty-submit-shared.cjs");
const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const MIN_TAP_PX = 44;
const PREFIX_COLORS = {
  calendar: { r: 31, g: 168, b: 90 },
  reminder: { r: 124, g: 77, b: 255 },
  notes: { r: 20, g: 184, b: 166 },
};

function parseRgb(str) {
  const m = String(str || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function rgbNear(a, b, tol) {
  if (!a || !b) return false;
  const t = tol || 48;
  return Math.abs(a.r - b.r) <= t && Math.abs(a.g - b.g) <= t && Math.abs(a.b - b.b) <= t;
}

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

async function readLayoutState(page) {
  return page.evaluate((minTap) => {
    const ux = document.getElementById("iuSilverHomeInputUx");
    const field = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
    const inp = document.getElementById("iuSilverHomeInput");
    if (!ux || !field || !inp) {
      return { layout_ok: false };
    }
    const fieldRect = field.getBoundingClientRect();
    const top = ux.querySelector(".iuSilverHomeInputUxTop");
    const divider = ux.querySelector(".iuSilverHomeInputUxDivider");
    const actions = ux.querySelector(".iuSilverHomeInputUxActions");
    const btns = actions ? Array.from(actions.querySelectorAll("[data-iu-silver-home-quick-action]")) : [];
    const taps = btns.map((btn) => {
      const r = btn.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    const insideBox = btns.every((btn) => {
      const r = btn.getBoundingClientRect();
      return r.left >= fieldRect.left - 1 && r.right <= fieldRect.right + 1 && r.top >= fieldRect.top - 1 && r.bottom <= fieldRect.bottom + 1;
    });
    const dividerSt = divider ? getComputedStyle(divider) : null;
    const dividerVisible = !!(divider && dividerSt && dividerSt.display !== "none" && parseFloat(dividerSt.height || "0") > 0);
    const prefixes = ["calendar", "reminder", "notes"].map((k) => {
      const el = ux.querySelector('[data-iu-silver-home-prefix="' + k + '"]');
      const st = el ? getComputedStyle(el) : null;
      return { key: k, color: st ? st.color || "" : "", found: !!el };
    });
    return {
      layout_ok: true,
      top_found: !!top,
      divider_found: !!divider,
      divider_visible: dividerVisible,
      actions_found: !!actions,
      action_count: btns.length,
      actions_inside_box: insideBox,
      tap_targets_ok: taps.length === 3 && taps.every((t) => t.w >= minTap && t.h >= minTap),
      tap_targets: taps,
      prefixes,
    };
  }, MIN_TAP_PX);
}

async function clickQuickAction(page, key) {
  await resetHomeTemplate(page);
  await page.click('[data-iu-silver-home-quick-action="' + key + '"]');
  await page.waitForTimeout(900);
}

async function assertQuickActionIcon(page, key) {
  await clickQuickAction(page, key);
  const st = await page.evaluate(() => {
    const inp = document.getElementById("iuSilverHomeInput");
    const ov = document.getElementById("iuSilverChatOverlay");
    const composer = document.querySelector(".iuSilverChatComposer");
    const composerSt = composer ? getComputedStyle(composer) : null;
    const card = document.querySelector("[data-iu-silver-quick-template-empty]");
    const clar = document.querySelector('[data-iu-silver-clarification="1"]');
    const lead = document.querySelector(".iuSilverMsg--assistant .iuSilverMsgLead");
    const leadText = lead ? String(lead.textContent || "").trim() : "";
    const titleInput =
      document.querySelector('[data-iu-silver-field="title"]') ||
      document.querySelector('[data-iu-silver-task-field="title"]') ||
      document.querySelector('[data-iu-silver-note-field="text"]');
    const saveBtn = document.querySelector('[data-iu-silver-action="save"]');
    const closeBtn = document.querySelector('[data-iu-silver-action="quick-template-close"]');
    const editBtn = document.querySelector('[data-iu-silver-action="edit"]');
    return {
      inputEmpty: inp ? !String(inp.value || "").length : false,
      overlayOpen: !!(ov && !ov.hidden),
      quickMode: !!(ov && ov.classList.contains("iuSilverChatOverlay--quickTemplateEmpty")),
      quickCalendar: !!(ov && ov.classList.contains("iuSilverChatOverlay--quickTemplateCalendar")),
      quickTask: !!(ov && ov.classList.contains("iuSilverChatOverlay--quickTemplateTask")),
      quickNote: !!(ov && ov.classList.contains("iuSilverChatOverlay--quickTemplateNote")),
      cardFound: !!card,
      cardEditMode: card ? card.getAttribute("data-iu-silver-edit-mode") === "1" : false,
      composerHidden: composerSt ? composerSt.display === "none" : true,
      clarificationFound: !!clar,
      hasClarificationText: leadText.indexOf("Upřesni prosím") >= 0 || leadText.indexOf("Co si mám poznamenat") >= 0,
      titleInputFound: !!titleInput,
      titleInputDisabled: titleInput ? !!titleInput.disabled : true,
      saveBtnFound: !!saveBtn,
      closeBtnFound: !!closeBtn,
      editBtnFound: !!editBtn,
      cardTitle: card ? String((card.querySelector(".iuSilverDraftCardTitle") || {}).textContent || "").trim() : "",
    };
  });
  const kindOk =
    key === "calendar" ? st.quickCalendar : key === "reminder" ? st.quickTask : st.quickNote;
  const titleOk =
    key === "calendar"
      ? st.cardTitle.indexOf("Nová událost") >= 0
      : key === "reminder"
        ? st.cardTitle.indexOf("Nová připomínka") >= 0
        : st.cardTitle.indexOf("Nová poznámka") >= 0;
  const pass =
    st.inputEmpty &&
    st.overlayOpen &&
    st.quickMode &&
    kindOk &&
    st.cardFound &&
    st.cardEditMode &&
    st.composerHidden &&
    !st.clarificationFound &&
    !st.hasClarificationText &&
    st.titleInputFound &&
    !st.titleInputDisabled &&
    st.saveBtnFound &&
    st.closeBtnFound &&
    !st.editBtnFound &&
    titleOk;
  return Object.assign({ pass, key }, st);
}

async function assertPrefixColors(page) {
  const st = await readLayoutState(page);
  let pass = true;
  const details = {};
  for (let i = 0; i < st.prefixes.length; i++) {
    const p = st.prefixes[i];
    const target = PREFIX_COLORS[p.key];
    const ok = p.found && rgbNear(parseRgb(p.color), target, 40);
    details[p.key] = { ok, color: p.color };
    if (!ok) pass = false;
  }
  return { pass, prefix_colors: details };
}

async function assertDivider(page) {
  const st = await readLayoutState(page);
  return {
    pass: st.layout_ok && st.divider_found && st.divider_visible,
    divider_found: st.divider_found,
    divider_visible: st.divider_visible,
  };
}

async function assertIconsLayout(page) {
  const st = await readLayoutState(page);
  const pass =
    st.layout_ok &&
    st.top_found &&
    st.actions_found &&
    st.action_count === 3 &&
    st.actions_inside_box &&
    st.tap_targets_ok;
  return Object.assign({ pass }, st);
}

async function assertNoColonInsert(page) {
  const results = {};
  let pass = true;
  const prefixKeys = Object.keys(emptyShared.PREFIX_NO_COLON);
  for (let i = 0; i < prefixKeys.length; i++) {
    const key = prefixKeys[i];
    const expected = emptyShared.PREFIX_NO_COLON[key];
    const ok = await page.evaluate(({ k, exp }) => {
      const btn = document.querySelector('[data-iu-silver-home-prefix="' + k + '"]');
      const inp = document.getElementById("iuSilverHomeInput");
      if (!btn || !inp) return false;
      btn.click();
      const val = String(inp.value || "");
      return val === exp && !val.endsWith(":") && val.indexOf(":") < 0;
    }, { k: key, exp: expected });
    results[key] = ok;
    if (!ok) pass = false;
    await resetHomeTemplate(page);
    await page.waitForTimeout(120);
  }
  return { pass, prefix_no_colon_results: results };
}

async function assertNormalRegression(page, key) {
  await resetHomeTemplate(page);
  const text = emptyShared.REGRESSION_INPUTS[key];
  await page.evaluate((t) => {
    const inp = document.getElementById("iuSilverHomeInput");
    if (!inp) return;
    inp.focus();
    inp.value = t;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    if (typeof window.__iuSilverSyncHomeUxEmptyState === "function") window.__iuSilverSyncHomeUxEmptyState();
    if (typeof window.__iuSilverSyncHomeMicSend === "function") window.__iuSilverSyncHomeMicSend();
  }, text);
  await page.waitForTimeout(120);
  await page.click("#iuSilverHomeSend");
  await page.waitForTimeout(1100);
  const st = await page.evaluate(() => {
    const ov = document.getElementById("iuSilverChatOverlay");
    const quickMode = !!(ov && ov.classList.contains("iuSilverChatOverlay--quickTemplateEmpty"));
    const userMsg = document.querySelector('.iuSilverMsg[data-iu-silver-msg="user"]');
    const draftCard = document.querySelector("[data-iu-silver-draft-card]");
    const clarLead = document.querySelector(".iuSilverMsgLead");
    const clarText = clarLead ? String(clarLead.textContent || "") : "";
    const emptyQuickCard = document.querySelector("[data-iu-silver-quick-template-empty]");
    return {
      overlayOpen: !!(ov && !ov.hidden),
      quickMode,
      userMsgFound: !!userMsg,
      draftCardFound: !!draftCard,
      emptyQuickCardFound: !!emptyQuickCard,
      hasBareClarification: clarText.indexOf("Upřesni prosím požadavek") >= 0 && !draftCard,
    };
  });
  const pass = st.overlayOpen && !st.quickMode && !st.emptyQuickCardFound && !st.hasBareClarification && (st.userMsgFound || st.draftCardFound);
  return Object.assign({ pass, key, input: text }, st);
}

async function runViewport(page, w, h, replayMode) {
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

  await page.setViewportSize({ width: w, height: h });
  await page.goto(base.envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2600);
  await base.resetHomeUxClsAfterIdle(page);
  await page.waitForTimeout(350);

  const overflowX = await page.evaluate(() => {
    const docEl = document.documentElement;
    const body = document.body;
    return (docEl && docEl.scrollWidth > docEl.clientWidth + 1) || (body && body.scrollWidth > body.clientWidth + 1);
  });
  const clsIdle = await page.evaluate(() => Number(window.__iuSilverHomeUxCls || 0));

  let checks = {
    overflow_x: overflowX,
    cls_idle: clsIdle,
    cls_ok: clsIdle <= base.CLS_CAP,
    app_errors: appErrors,
    viewport: w + "x" + h,
    mode: replayMode,
  };

  if (replayMode === "icons-layout") {
    checks = Object.assign(checks, await assertIconsLayout(page));
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "calendar-icon") {
    checks = Object.assign(checks, await assertQuickActionIcon(page, "calendar"));
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "task-icon") {
    checks = Object.assign(checks, await assertQuickActionIcon(page, "reminder"));
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "note-icon") {
    checks = Object.assign(checks, await assertQuickActionIcon(page, "notes"));
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "prefix-colors") {
    checks = Object.assign(checks, await assertPrefixColors(page));
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "divider") {
    checks = Object.assign(checks, await assertDivider(page));
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "template-regression") {
    const noColon = await assertNoColonInsert(page);
    await resetHomeTemplate(page);
    const cal = await assertNormalRegression(page, "calendar");
    await resetHomeTemplate(page);
    const task = await assertNormalRegression(page, "reminder");
    await resetHomeTemplate(page);
    const note = await assertNormalRegression(page, "notes");
    checks = Object.assign(checks, {
      no_colon_ok: noColon.pass,
      calendar_regression_ok: cal.pass,
      task_regression_ok: task.pass,
      note_regression_ok: note.pass,
      pass: noColon.pass && cal.pass && task.pass && note.pass,
    });
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "full") {
    const layout = await assertIconsLayout(page);
    await resetHomeTemplate(page);
    const divider = await assertDivider(page);
    await resetHomeTemplate(page);
    const colors = await assertPrefixColors(page);
    await resetHomeTemplate(page);
    const cal = await assertQuickActionIcon(page, "calendar");
    await resetHomeTemplate(page);
    const task = await assertQuickActionIcon(page, "reminder");
    await resetHomeTemplate(page);
    const note = await assertQuickActionIcon(page, "notes");
    await resetHomeTemplate(page);
    const reg = await assertNoColonInsert(page);
    checks = Object.assign(checks, {
      layout_ok: layout.pass,
      divider_ok: divider.pass,
      prefix_colors_ok: colors.pass,
      calendar_icon_ok: cal.pass,
      task_icon_ok: task.pass,
      note_icon_ok: note.pass,
      template_no_colon_ok: reg.pass,
      pass: layout.pass && divider.pass && colors.pass && cal.pass && task.pass && note.pass && reg.pass,
    });
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else {
    checks._pass = false;
  }

  return checks;
}

async function runGuard(opts) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await base.installClsObserver(ctx);
  const replayMode = opts && opts.replayMode ? opts.replayMode : "full";
  const viewports = (opts && opts.viewports) || [
    { w: 390, h: 844 },
    { w: 430, h: 844 },
    { w: 768, h: 1024 },
  ];
  const results = [];
  try {
    for (let i = 0; i < viewports.length; i++) {
      const vp = viewports[i];
      const p = await ctx.newPage();
      try {
        results.push(await runViewport(p, vp.w, vp.h, replayMode));
      } finally {
        await p.close();
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
  const pass = results.every((r) => r._pass);
  return { pass, results, url: base.envUrl() };
}

function emitGuardBanner(title, reportPath, out) {
  base.emitGuardBanner(title, reportPath, out);
}

module.exports = {
  runGuard,
  emitGuardBanner,
  MIN_TAP_PX,
  PREFIX_COLORS,
};
