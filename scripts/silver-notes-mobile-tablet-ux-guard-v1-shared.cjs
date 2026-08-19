#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} = require("./proofs/open_meteo_guard_stub.cjs");

const DEFAULT_URL = "http://127.0.0.1:8080/projects/?section=media";
const CLS_CAP = 0.02;
const STORE_KEY = "iu.notes.store.v1";
const VIEWPORTS = [
  { w: 390, h: 844, label: "mobile" },
  { w: 768, h: 1024, label: "tablet" },
];

function envUrl() {
  const u = String(
    process.env.SILVER_NOTES_UX_GUARD_URL ||
      process.env.SILVER_HOME_UX_GUARD_URL ||
      process.env.SILVER_LAYOUT_GUARD_URL ||
      DEFAULT_URL
  ).trim();
  return u || DEFAULT_URL;
}

async function installClsObserver(context) {
  await context.addInitScript(() => {
    try {
      window.__iuNotesUxCls = 0;
      new PerformanceObserver(function (list) {
        const entries = list.getEntries();
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (!e.hadRecentInput && e.value) {
            window.__iuNotesUxCls = (window.__iuNotesUxCls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
}

async function readCls(page) {
  return page.evaluate(() => Number(window.__iuNotesUxCls || 0));
}

function seedNotesPayload(count) {
  const notes = [];
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    notes.push({
      id: "guard_note_" + i,
      title: "Guard poznámka " + (i + 1),
      content: "Obsah testovací poznámky číslo " + (i + 1) + " pro scroll guard.",
      createdAt: now - i * 60000,
      updatedAt: now - i * 60000,
      pinned: i === 0,
      tags: [],
      deleted: false,
    });
  }
  notes.push({
    id: "guard_note_trash_1",
    title: "Koš test",
    content: "Položka v koši",
    createdAt: now - 999999,
    updatedAt: now - 999999,
    pinned: false,
    tags: [],
    deleted: true,
  });
  return { schemaVersion: 1, notes };
}

async function clickNotesTrashTab(page) {
  await page.evaluate(() => {
    const ov = document.getElementById("iuNotesOverlay");
    const btn = ov ? ov.querySelector(".iu-notesOverlay__listHeaderRight [data-iu-notes-view=\"trash\"]") : null;
    if (btn && typeof btn.click === "function") btn.click();
  });
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuNotesOverlay");
    return !!(ov && ov.getAttribute("data-iu-notes-list-tab") === "trash");
  }, null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function clickNotesMainTab(page) {
  await page.evaluate(() => {
    const ov = document.getElementById("iuNotesOverlay");
    const btn = ov ? ov.querySelector('[data-iu-notes-view="main"]') : null;
    if (btn && typeof btn.click === "function") btn.click();
  });
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuNotesOverlay");
    return !!(ov && ov.getAttribute("data-iu-notes-list-tab") === "main");
  }, null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function openFirstNoteDetail(page) {
  await page.evaluate(() => {
    const btn = document.querySelector(".iu-notesOverlay__itemBtn[data-iu-note-id]");
    if (btn && typeof btn.click === "function") btn.click();
  });
  await page.waitForFunction(() => !!document.getElementById("iuNoteBody"), null, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function openNotesOverlay(page) {
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureNotesOverlay === "function") {
      await window.__iuEnsureNotesOverlay();
    }
    if (window.iuNotesService && typeof window.iuNotesService.openOverlay === "function") {
      await window.iuNotesService.openOverlay();
      return;
    }
    const btn = document.querySelector(".iu-mmTopTool--notes");
    if (btn && typeof btn.click === "function") btn.click();
  });
  await page.waitForTimeout(700);
}

async function runViewport(page, vp) {
  await installProofGuardNetworkStubs(page);
  const ignorableTracker = createIgnorableResourceTracker();
  ignorableTracker.attachToPage(page);
  await page.setViewportSize({ width: vp.w, height: vp.h });

  let appErrors = 0;
  page.on("pageerror", (err) => {
    try {
      const t = String(err && err.message ? err.message : err);
      if (isIgnorableGuardConsoleError(t)) return;
      appErrors += 1;
    } catch (_) {}
  });

  await page.goto(envUrl(), { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1200);

  await page.evaluate(({ key, payload }) => {
    try {
      localStorage.setItem(key, JSON.stringify(payload));
    } catch (_) {}
  }, { key: STORE_KEY, payload: seedNotesPayload(14) });

  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2200);

  await openNotesOverlay(page);
  await page.evaluate(() => {
    window.__iuNotesUxCls = 0;
  });
  await page.waitForTimeout(250);

  const base = await page.evaluate(() => {
    const ov = document.getElementById("iuNotesOverlay");
    const dialog = ov ? ov.querySelector(".iu-notesOverlay__dialog") : null;
    const sub = ov ? ov.querySelector(".iu-notesOverlay__sub") : null;
    const newBtn = ov ? ov.querySelector("[data-iu-notes-new]") : null;
    const closeBtn = ov ? ov.querySelector(".iu-notesOverlay__close") : null;
    const trashBtn = ov ? ov.querySelector('[data-iu-notes-view="trash"]') : null;
    const listScroll = ov ? ov.querySelector(".iu-notesOverlay__listScroll") : null;
    const items = ov ? ov.querySelector(".iu-notesOverlay__items") : null;
    const lastItem = ov ? ov.querySelector(".iu-notesOverlay__items li:last-child .iu-notesOverlay__itemBtn") : null;
    const bottomNav = document.getElementById("iuMobileBottomNav");
    const docEl = document.documentElement;
    const body = document.body;
    const overflowX =
      (docEl && docEl.scrollWidth > docEl.clientWidth + 1) ||
      (body && body.scrollWidth > body.clientWidth + 1);

    function rectBottom(el) {
      if (!el) return null;
      return Math.round(el.getBoundingClientRect().bottom * 100) / 100;
    }

    function rectTop(el) {
      if (!el) return null;
      return Math.round(el.getBoundingClientRect().top * 100) / 100;
    }

    const listScrollSt = listScroll ? getComputedStyle(listScroll) : null;
    const itemsSt = items ? getComputedStyle(items) : null;
    const listPadBottom = listScrollSt ? parseFloat(listScrollSt.paddingBottom) || 0 : 0;
    const itemsPadBottom = itemsSt ? parseFloat(itemsSt.paddingBottom) || 0 : 0;
    const bottomNavTop = rectTop(bottomNav);
    const lastItemBottom = rectBottom(lastItem);

    if (listScroll) {
      listScroll.scrollTop = listScroll.scrollHeight;
    }
    if (dialog && listScroll && listScroll.scrollHeight <= listScroll.clientHeight + 2) {
      dialog.scrollTop = dialog.scrollHeight;
    }

    const lastItemBottomAfterScroll = rectBottom(lastItem);
    const lastAboveNav =
      bottomNavTop == null ||
      lastItemBottomAfterScroll == null ||
      lastItemBottomAfterScroll <= bottomNavTop - 2;

    let headerOrderOk = false;
    if (newBtn && closeBtn) {
      const nr = newBtn.getBoundingClientRect();
      const cr = closeBtn.getBoundingClientRect();
      const sameRow = Math.abs(nr.top - cr.top) <= 24;
      headerOrderOk = sameRow && nr.left < cr.left && nr.width > 0 && cr.width > 0;
    }

    const quickDeleteBtn = ov ? ov.querySelector(".iu-notesOverlay__itemTrash[data-iu-note-quick-delete]") : null;

    return {
      overlayOpen: !!(ov && !ov.hidden),
      subtitleRemoved: !sub,
      headerOrderOk,
      trashBtnFound: !!trashBtn,
      listScrollPadBottom: listPadBottom,
      itemsPadBottom: itemsPadBottom,
      scrollPadOk: listPadBottom >= 56 || itemsPadBottom >= 56,
      lastAboveNav,
      quickDeleteFound: !!quickDeleteBtn,
      overflowX,
    };
  });

  await page.locator(".iu-notesOverlay__itemTrash[data-iu-note-quick-delete]").first().click({ timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => {
    const box = document.getElementById("iuNotesConfirm");
    return !!(box && !box.hidden);
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);

  const confirm = await page.evaluate(() => {
    const box = document.getElementById("iuNotesConfirm");
    const textEl = document.getElementById("iuNotesConfirmText");
    const yesBtn = document.querySelector(".iu-notesOverlay__confirmActions [data-iu-notes-confirm-yes]");
    const noBtn = document.querySelector(".iu-notesOverlay__confirmActions [data-iu-notes-confirm-no]");
    return {
      confirmVisible: !!(box && !box.hidden),
      confirmText: textEl ? String(textEl.textContent || "") : "",
      hasYesNo: !!(yesBtn && noBtn),
      okLabel: yesBtn ? String(yesBtn.textContent || "").trim() : "",
      cancelLabel: noBtn ? String(noBtn.textContent || "").trim() : "",
    };
  });

  await page.click("[data-iu-notes-confirm-no]", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    window.__iuNotesUxCls = 0;
  });

  await clickNotesTrashTab(page);

  const trash = await page.evaluate(() => {
    const emptyTrashBtn = document.querySelector("[data-iu-notes-empty-trash]");
    const trashItem = document.querySelector('.iu-notesOverlay__itemBtn[data-iu-note-id="guard_note_trash_1"]');
    return {
      trashViewActive: !!document.querySelector('#iuNotesOverlay[data-iu-notes-list-tab="trash"]'),
      emptyTrashVisible: !!(emptyTrashBtn && !emptyTrashBtn.hidden),
      trashItemFound: !!trashItem,
    };
  });

  await clickNotesMainTab(page);
  await openFirstNoteDetail(page);
  await page.waitForTimeout(450);
  await page.evaluate(() => {
    window.__iuNotesUxCls = 0;
  });
  await page.waitForTimeout(300);

  const detail = await page.evaluate(() => {
    const ta = document.getElementById("iuNoteBody");
    const st = ta ? getComputedStyle(ta) : null;
    const minH = st ? parseFloat(st.minHeight) || 0 : 0;
    return {
      detailOpen: !!ta,
      textareaMinHeight: minH,
      editorHeightOk: minH > 0 && minH <= 135,
    };
  });

  const cls = await readCls(page);

  const checks = {
    overlay_open: base.overlayOpen,
    subtitle_removed: base.subtitleRemoved,
    header_layout_ok: base.headerOrderOk,
    scroll_pad_ok: base.scrollPadOk,
    last_item_above_nav: base.lastAboveNav,
    quick_delete_found: base.quickDeleteFound,
    delete_confirm_visible: confirm.confirmVisible,
    delete_confirm_text_ok: /přesunout do koše/i.test(confirm.confirmText),
    delete_confirm_yes_no: confirm.hasYesNo && confirm.okLabel === "OK" && confirm.cancelLabel === "Zrušit",
    trash_access_ok: base.trashBtnFound && trash.trashViewActive,
    trash_item_found: trash.trashItemFound,
    empty_trash_visible: trash.emptyTrashVisible,
    detail_open_ok: detail.detailOpen,
    editor_height_ok: detail.editorHeightOk,
    overflow_x: base.overflowX,
    cls: cls,
    cls_ok: cls <= CLS_CAP,
    app_errors: appErrors,
  };

  checks._pass =
    checks.overlay_open &&
    checks.subtitle_removed &&
    checks.header_layout_ok &&
    checks.scroll_pad_ok &&
    checks.last_item_above_nav &&
    checks.quick_delete_found &&
    checks.delete_confirm_visible &&
    checks.delete_confirm_text_ok &&
    checks.delete_confirm_yes_no &&
    checks.trash_access_ok &&
    checks.empty_trash_visible &&
    checks.detail_open_ok &&
    checks.editor_height_ok &&
    !checks.overflow_x &&
    checks.cls_ok &&
    checks.app_errors === 0;

  checks.viewport = vp.w + "x" + vp.h;
  checks.label = vp.label;
  return checks;
}

async function runGuard() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  await installClsObserver(ctx);
  const results = [];
  try {
    for (let i = 0; i < VIEWPORTS.length; i++) {
      const p = await ctx.newPage();
      try {
        results.push(await runViewport(p, VIEWPORTS[i]));
      } finally {
        await p.close();
      }
    }
  } finally {
    await ctx.close();
    await browser.close();
  }
  const pass = results.every((r) => r._pass);
  return { pass, results, url: envUrl() };
}

function writeReport(reportPath, payload) {
  try {
    fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch (_) {}
}

function emitGuardBanner(title, reportPath, out) {
  const pass = out.pass;
  process.stdout.write("=== " + title + " ===\n\n");
  for (let i = 0; i < out.results.length; i++) {
    const r = out.results[i];
    const copy = Object.assign({}, r);
    delete copy._pass;
    process.stdout.write(JSON.stringify(copy, null, 2) + "\n\n");
  }
  process.stdout.write("PASS_FAIL=" + (pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("report=" + reportPath + "\n");
  process.stdout.write("=== END_" + title + " ===\n");
  writeReport(reportPath, {
    pass,
    url: out.url,
    results: out.results.map((r) => {
      const c = Object.assign({}, r);
      delete c._pass;
      return c;
    }),
  });
  if (!pass) process.exitCode = 1;
}

module.exports = {
  runGuard,
  emitGuardBanner,
  envUrl,
};
