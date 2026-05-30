#!/usr/bin/env node
"use strict";

const base = require("./silver-mobile-tablet-home-ux-v1-shared.cjs");
const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const PREFIX_KEYS = ["calendar", "reminder", "notes"];
const PREFIX_NO_COLON = {
  calendar: "Do kalendáře",
  reminder: "Připomeň mi",
  notes: "Do poznámek",
};
const REGRESSION_INPUTS = {
  calendar: "Do kalendáře zítra v 15 schůzka s mámou",
  reminder: "Připomeň mi v pátek zaplatit nájem",
  notes: "Do poznámek heslo k Wi-Fi je 1234",
};
const ACCENT_RGB = {
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

async function readQuickTemplateState(page) {
  return page.evaluate(() => {
    const ov = document.getElementById("iuSilverChatOverlay");
    const composer = document.querySelector(".iuSilverChatComposer");
    const composerSt = composer ? getComputedStyle(composer) : null;
    const card = document.querySelector("[data-iu-silver-quick-template-empty]");
    const clar = document.querySelector('[data-iu-silver-clarification="1"]');
    const lead = document.querySelector(".iuSilverMsg--assistant .iuSilverMsgLead");
    const leadText = lead ? String(lead.textContent || "").trim() : "";
    const saveBtn = document.querySelector('[data-iu-silver-action="save"]');
    const closeBtn = document.querySelector('[data-iu-silver-action="quick-template-close"]');
    const editBtn = document.querySelector('[data-iu-silver-action="edit"]');
    const titleInput =
      document.querySelector('[data-iu-silver-field="title"]') ||
      document.querySelector('[data-iu-silver-task-field="title"]') ||
      document.querySelector('[data-iu-silver-note-field="text"]');
    const primaryBtn = document.querySelector(".iuSilverDraftBtn--primary");
    const primarySt = primaryBtn ? getComputedStyle(primaryBtn) : null;
    const stripe = document.querySelector(".iuSilverDraftCard--quickTemplateEmpty::before");
    return {
      overlayOpen: !!(ov && !ov.hidden),
      quickMode: !!(ov && ov.classList.contains("iuSilverChatOverlay--quickTemplateEmpty")),
      quickCalendar: !!(ov && ov.classList.contains("iuSilverChatOverlay--quickTemplateCalendar")),
      quickTask: !!(ov && ov.classList.contains("iuSilverChatOverlay--quickTemplateTask")),
      quickNote: !!(ov && ov.classList.contains("iuSilverChatOverlay--quickTemplateNote")),
      cardFound: !!card,
      cardEditMode: card ? card.getAttribute("data-iu-silver-edit-mode") === "1" : false,
      composerHidden: composerSt ? composerSt.display === "none" : true,
      clarificationFound: !!clar,
      leadText,
      hasClarificationText: leadText.indexOf("Upřesni prosím") >= 0 || leadText.indexOf("Co si mám poznamenat") >= 0,
      titleInputFound: !!titleInput,
      titleInputDisabled: titleInput ? !!titleInput.disabled : true,
      saveBtnFound: !!saveBtn,
      closeBtnFound: !!closeBtn,
      editBtnFound: !!editBtn,
      cardTitle: card ? String((card.querySelector(".iuSilverDraftCardTitle") || {}).textContent || "").trim() : "",
      primaryBg: primarySt ? primarySt.backgroundColor || primarySt.background || "" : "",
      cardClass: card ? String(card.className || "") : "",
    };
  });
}

async function assertEmptySubmit(page, key) {
  await submitEmptyPrefix(page, key);
  const st = await readQuickTemplateState(page);
  const kindOk =
    key === "calendar"
      ? st.quickCalendar
      : key === "reminder"
        ? st.quickTask
        : st.quickNote;
  const titleOk =
    key === "calendar"
      ? st.cardTitle.indexOf("Nová událost") >= 0
      : key === "reminder"
        ? st.cardTitle.indexOf("Nová připomínka") >= 0
        : st.cardTitle.indexOf("Nová poznámka") >= 0;
  const pass =
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

async function assertNoChatInput(page, key) {
  const st = await assertEmptySubmit(page, key);
  return {
    pass: st.pass && st.composerHidden,
    key,
    composerHidden: st.composerHidden,
    quickMode: st.quickMode,
  };
}

const SUBTITLE_EXPECTED = {
  calendar: "Vyplň údaje události.",
  reminder: "Vyplň údaje připomínky.",
  notes: "Napiš svou poznámku.",
};
const ACTION_GAP_MIN_PX = 18;
const ACTION_GAP_MAX_PX = 30;

async function assertFormPolish(page, key) {
  await submitEmptyPrefix(page, key);
  const st = await page.evaluate(({ k, subtitles, gapMin, gapMax }) => {
    const card = document.querySelector("[data-iu-silver-quick-template-empty]");
    const actions = document.querySelector(".iuSilverDraftActions--quickTemplate");
    const subtitle = document.querySelector(".iuSilverDraftCardSubtitle--quickTemplate");
    const head = document.querySelector(".iuSilverDraftCardHead--quickTemplate");
    const saveBtn = document.querySelector(".iuSilverDraftBtn--primary");
    const saveSt = saveBtn ? getComputedStyle(saveBtn) : null;
    const headSt = head ? getComputedStyle(head) : null;
    const fields = card
      ? Array.from(
          card.querySelectorAll(
            '[data-iu-silver-field="title"], [data-iu-silver-field="note"], [data-iu-silver-field="location"], [data-iu-silver-task-field="note"], [data-iu-silver-note-field="text"]'
          )
        )
      : [];
    const lastField = fields.length ? fields[fields.length - 1] : null;
    let actionGapPx = null;
    if (lastField && actions) {
      const fieldRect = lastField.getBoundingClientRect();
      const actionsRect = actions.getBoundingClientRect();
      actionGapPx = Math.round((actionsRect.top - fieldRect.bottom) * 100) / 100;
    }
    const subtitleText = subtitle ? String(subtitle.textContent || "").trim() : "";
    const headBg = headSt ? String(headSt.backgroundImage || headSt.background || "") : "";
    const saveShadow = saveSt ? String(saveSt.boxShadow || "") : "";
    const saveBg = saveSt ? String(saveSt.backgroundImage || saveSt.background || "") : "";
    const cardClass = card ? String(card.className || "") : "";
    const savePrimaryOk =
      (saveShadow !== "none" && saveShadow.length > 0) ||
      saveBg.indexOf("gradient") >= 0 ||
      (saveBtn && !saveBtn.disabled && saveShadow !== "none");
    return {
      subtitleFound: !!subtitle,
      subtitleText,
      subtitleOk: subtitleText === subtitles[k],
      headFound: !!head,
      headTintOk: headBg.indexOf("gradient") >= 0 || headBg.indexOf("rgba") >= 0,
      actionGapPx,
      actionGapOk: actionGapPx !== null && actionGapPx >= gapMin && actionGapPx <= gapMax,
      savePrimaryOk,
      saveShadow,
      saveBg,
      cardClass,
    };
  }, { k: key, subtitles: SUBTITLE_EXPECTED, gapMin: ACTION_GAP_MIN_PX, gapMax: ACTION_GAP_MAX_PX });
  const pass =
    st.subtitleOk &&
    st.headFound &&
    st.headTintOk &&
    st.actionGapOk &&
    st.savePrimaryOk;
  return Object.assign({ pass, key }, st);
}

async function assertPremiumAccent(page, key) {
  await submitEmptyPrefix(page, key);
  const st = await page.evaluate((k) => {
    const ov = document.getElementById("iuSilverChatOverlay");
    const card = document.querySelector("[data-iu-silver-quick-template-empty]");
    const primaryBtn = document.querySelector(".iuSilverDraftBtn--primary");
    const closeBtn = document.querySelector(".iuSilverChatClose");
    const primarySt = primaryBtn ? getComputedStyle(primaryBtn) : null;
    const closeSt = closeBtn ? getComputedStyle(closeBtn) : null;
    const stripeSt = card ? getComputedStyle(card, "::before") : null;
    const stripeBg = stripeSt ? String(stripeSt.backgroundImage || stripeSt.background || stripeSt.backgroundColor || "") : "";
    const primaryBg = primarySt ? String(primarySt.backgroundImage || primarySt.background || primarySt.backgroundColor || "") : "";
    const closeColor = closeSt ? String(closeSt.color || "") : "";
    const cardClass = card ? String(card.className || "") : "";
    const quickMode = !!(ov && ov.classList.contains("iuSilverChatOverlay--quickTemplateEmpty"));
    const classOk =
      k === "calendar"
        ? cardClass.indexOf("quickTemplateCalendar") >= 0
        : k === "reminder"
          ? cardClass.indexOf("quickTemplateTask") >= 0
          : cardClass.indexOf("quickTemplateNote") >= 0;
    return {
      quickMode,
      classOk,
      stripeBg,
      primaryBg,
      closeColor,
      cardClass,
    };
  }, key);
  const target = ACCENT_RGB[key === "reminder" ? "reminder" : key];
  const stripeHasAccent =
    st.stripeBg.indexOf("linear-gradient") >= 0 ||
    rgbNear(parseRgb(st.stripeBg), target, 72);
  const primaryHasAccent =
    st.primaryBg.indexOf("linear-gradient") >= 0 || rgbNear(parseRgb(st.primaryBg), target, 72);
  const closeHasAccent = rgbNear(parseRgb(st.closeColor), target, 72);
  const accentOk = stripeHasAccent && (primaryHasAccent || closeHasAccent);
  return {
    pass: st.quickMode && st.classOk && accentOk,
    key,
    accentOk,
    classOk: st.classOk,
    stripeBg: st.stripeBg,
    primaryBg: st.primaryBg,
    closeColor: st.closeColor,
  };
}

async function assertNormalInputRegression(page, key) {
  await resetHomeTemplate(page);
  const text = REGRESSION_INPUTS[key];
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

async function assertCloseResetsTemplate(page, key) {
  await submitEmptyPrefix(page, key);
  await page.click('[data-iu-silver-action="quick-template-close"]');
  await page.waitForTimeout(500);
  const ok = await page.evaluate(() => {
    const inp = document.getElementById("iuSilverHomeInput");
    const field = document.querySelector(".iuSilverHomeInputFieldWrap[data-iu-silver-home-input-field]");
    const ux = document.getElementById("iuSilverHomeInputUx");
    const send = document.getElementById("iuSilverHomeSend");
    const row = document.querySelector(".iuSilverHomeInputSendRow");
    if (!inp || !field || !ux || !send || !row) return false;
    const uxSt = getComputedStyle(ux);
    const sendSt = getComputedStyle(send);
    const empty = !String(inp.value || "").length;
    const focused = document.activeElement === inp;
    const templateClass = field.classList.contains("iuSilverHomeInputFieldWrap--template");
    const rowTemplate = row.classList.contains("iuSilverHomeInputSendRow--templateMode");
    const sendHidden = sendSt.display === "none" || Number(sendSt.width) < 4 || sendSt.visibility === "hidden";
    const uxVisible = uxSt.display !== "none";
    const lead = ux.querySelector(".iuSilverHomeInputUxLead");
    const leadOk = !!(lead && String(lead.textContent || "").indexOf("Dej mi pokyn") >= 0);
    const ov = document.getElementById("iuSilverChatOverlay");
    return empty && !focused && templateClass && rowTemplate && sendHidden && uxVisible && leadOk && !!(ov && ov.hidden);
  });
  return { pass: ok, key, template_reset_ok: ok };
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

  if (replayMode === "calendar-empty-submit") {
    checks = Object.assign(checks, await assertEmptySubmit(page, "calendar"));
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "task-empty-submit") {
    checks = Object.assign(checks, await assertEmptySubmit(page, "reminder"));
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "note-empty-submit") {
    checks = Object.assign(checks, await assertEmptySubmit(page, "notes"));
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "no-chat-input") {
    const cal = await assertNoChatInput(page, "calendar");
    await resetHomeTemplate(page);
    const task = await assertNoChatInput(page, "reminder");
    await resetHomeTemplate(page);
    const note = await assertNoChatInput(page, "notes");
    checks = Object.assign(checks, {
      calendar_no_chat: cal.pass,
      task_no_chat: task.pass,
      note_no_chat: note.pass,
      pass: cal.pass && task.pass && note.pass,
    });
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "premium-accent") {
    const cal = await assertPremiumAccent(page, "calendar");
    await resetHomeTemplate(page);
    const task = await assertPremiumAccent(page, "reminder");
    await resetHomeTemplate(page);
    const note = await assertPremiumAccent(page, "notes");
    checks = Object.assign(checks, {
      calendar_accent_ok: cal.pass,
      task_accent_ok: task.pass,
      note_accent_ok: note.pass,
      pass: cal.pass && task.pass && note.pass,
    });
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "normal-input-regression") {
    const cal = await assertNormalInputRegression(page, "calendar");
    await resetHomeTemplate(page);
    const task = await assertNormalInputRegression(page, "reminder");
    await resetHomeTemplate(page);
    const note = await assertNormalInputRegression(page, "notes");
    checks = Object.assign(checks, {
      calendar_regression_ok: cal.pass,
      task_regression_ok: task.pass,
      note_regression_ok: note.pass,
      pass: cal.pass && task.pass && note.pass,
    });
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "close-reset") {
    const cal = await assertCloseResetsTemplate(page, "calendar");
    await resetHomeTemplate(page);
    const task = await assertCloseResetsTemplate(page, "reminder");
    await resetHomeTemplate(page);
    const note = await assertCloseResetsTemplate(page, "notes");
    checks = Object.assign(checks, {
      calendar_close_reset_ok: cal.pass,
      task_close_reset_ok: task.pass,
      note_close_reset_ok: note.pass,
      pass: cal.pass && task.pass && note.pass,
    });
    checks._pass = checks.pass && !checks.overflow_x && checks.cls_ok && checks.app_errors === 0;
  } else if (replayMode === "form-polish") {
    const cal = await assertFormPolish(page, "calendar");
    await resetHomeTemplate(page);
    const task = await assertFormPolish(page, "reminder");
    await resetHomeTemplate(page);
    const note = await assertFormPolish(page, "notes");
    checks = Object.assign(checks, {
      calendar_polish_ok: cal.pass,
      task_polish_ok: task.pass,
      note_polish_ok: note.pass,
      calendar_action_gap_px: cal.actionGapPx,
      task_action_gap_px: task.actionGapPx,
      note_action_gap_px: note.actionGapPx,
      pass: cal.pass && task.pass && note.pass,
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
  const replayMode = opts && opts.replayMode ? opts.replayMode : "calendar-empty-submit";
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
  PREFIX_NO_COLON,
  REGRESSION_INPUTS,
};
