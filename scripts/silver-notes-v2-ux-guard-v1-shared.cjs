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

const DEFAULT_URL = "https://infouzel.cz/?section=media";
const STORE_KEY = "iu.notes.store.v1";
const MIN_DISTANCE_PX = 16;
const MIN_HEADER_GAP_PX = 14;
const MAX_SCROLL_JANK_FRAMES = 28;
const VIEWPORTS = [
  { w: 390, h: 844, label: "mobile" },
  { w: 768, h: 1024, label: "tablet" },
];

function envUrl() {
  const u = String(
    process.env.SILVER_NOTES_V2_UX_GUARD_URL ||
      process.env.SILVER_NOTES_UX_GUARD_URL ||
      process.env.SILVER_HOME_UX_GUARD_URL ||
      DEFAULT_URL
  ).trim();
  return u || DEFAULT_URL;
}

function seedNotesPayload(count, trashCount) {
  const notes = [];
  const now = Date.now();
  const variants = [
    "Krátký obsah.",
    "Střední obsah. " + "Slovo ".repeat(20),
    "Dlouhý obsah.\n" + "Řádek textu. ".repeat(14),
  ];
  for (let i = 0; i < count; i++) {
    notes.push({
      id: "v2_note_" + i,
      title: "V2 poznámka " + (i + 1),
      content: variants[i % variants.length],
      createdAt: now - i * 30000,
      updatedAt: now - i * 30000,
      pinned: i === 0,
      tags: [],
      deleted: false,
    });
  }
  for (let j = 0; j < trashCount; j++) {
    notes.push({
      id: "v2_trash_" + j,
      title: "Koš " + (j + 1),
      content: "Koš obsah",
      createdAt: now - 900000 - j * 5000,
      updatedAt: now - 900000 - j * 5000,
      pinned: false,
      tags: [],
      deleted: true,
    });
  }
  return { schemaVersion: 1, notes };
}

async function prepareNotesSeed(page, mainCount, trashCount) {
  const payload = seedNotesPayload(mainCount, trashCount);
  await page.addInitScript(({ key, pl }) => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:local-data-protection:notice-accepted-at:v1", String(Date.now()));
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
      localStorage.setItem(key, JSON.stringify(pl));
    } catch (_) {}
  }, { key: STORE_KEY, pl: payload });
}

async function installHeavyInfoEventsStubs(page) {
  /* Variant B: avoid multi‑MB feed.json main-thread stalls during Notes UX checks. */
  const heavy = await import("./smoke-heavy-data-stubs.mjs");
  const stats = await heavy.installSmokeHeavyDataRouteStubs(page);
  if (!stats.feedSchema.ok || !stats.trafficSchema.ok) {
    throw new Error(
      "NOTES_V2_HEAVY_STUB_SCHEMA_INVALID:" +
        JSON.stringify({ feed: stats.feedSchema.fails, traffic: stats.trafficSchema.fails })
    );
  }
}

async function loadNotesPage(page, mainCount) {
  await page.goto(envUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(mainCount >= 150 ? 3500 : 2200);
}

async function dismissNotesConfirm(page) {
  await page.evaluate(() => {
    const noBtn = document.querySelector(".iu-notesOverlay__confirmActions [data-iu-notes-confirm-no]");
    if (noBtn && typeof noBtn.click === "function") noBtn.click();
    const box = document.getElementById("iuNotesConfirm");
    if (box) box.hidden = true;
  });
  await page.waitForTimeout(150);
}

async function openNotesOverlay(page) {
  await page.evaluate(async () => {
    if (typeof window.__iuEnsureNotesOverlay === "function") {
      await window.__iuEnsureNotesOverlay();
    }
    if (window.iuNotesService && typeof window.iuNotesService.openOverlay === "function") {
      await window.iuNotesService.openOverlay();
    }
  });
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuNotesOverlay");
    return !!(ov && !ov.hidden);
  }, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(500);
}

async function measureScrollDistance(page) {
  await page.evaluate(() => {
    const ov = document.getElementById("iuNotesOverlay");
    const listScroll = ov ? ov.querySelector(".iu-notesOverlay__listScroll") : null;
    const dialog = ov ? ov.querySelector(".iu-notesOverlay__dialog") : null;
    if (listScroll) listScroll.scrollTop = listScroll.scrollHeight;
    if (dialog) dialog.scrollTop = dialog.scrollHeight;
    if (listScroll) listScroll.scrollTop = listScroll.scrollHeight;
  });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const bottomNav = document.getElementById("iuMobileBottomNav");
    const ov = document.getElementById("iuNotesOverlay");
    const lastItem = ov ? ov.querySelector(".iu-notesOverlay__items li:last-child .iu-notesOverlay__itemBtn") : null;
    const bottomNavTop = bottomNav ? bottomNav.getBoundingClientRect().top : window.innerHeight;
    const lastBottom = lastItem ? lastItem.getBoundingClientRect().bottom : 0;
    return Math.round((bottomNavTop - lastBottom) * 100) / 100;
  });
}

async function measureScrollPerformance(page) {
  return page.evaluate(async () => {
    const listScroll = document.querySelector(".iu-notesOverlay__listScroll");
    if (!listScroll) return { jankFrames: 99, steps: 0 };
    let jankFrames = 0;
    let last = performance.now();
    const steps = 24;
    const step = Math.max(40, Math.floor(listScroll.scrollHeight / steps));
    for (let i = 0; i < steps; i++) {
      listScroll.scrollTop += step;
      await new Promise(function (resolve) {
        requestAnimationFrame(resolve);
      });
      const now = performance.now();
      if (now - last > 34) jankFrames += 1;
      last = now;
    }
    listScroll.scrollTop = listScroll.scrollHeight;
    await new Promise(function (resolve) {
      requestAnimationFrame(resolve);
    });
    return { jankFrames, steps };
  });
}

async function runViewportChecks(page, vp, noteCount) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  await prepareNotesSeed(page, noteCount, 8);
  await loadNotesPage(page, noteCount);
  await openNotesOverlay(page);

  const layout = await page.evaluate(() => {
    const ov = document.getElementById("iuNotesOverlay");
    const newBtn = ov ? ov.querySelector("[data-iu-notes-new]") : null;
    const closeBtn = ov ? ov.querySelector(".iu-notesOverlay__close") : null;
    const leftBtn = ov ? ov.querySelector(".iu-notesOverlay__listHeaderLeft [data-iu-notes-view='main']") : null;
    const trashTab = ov ? ov.querySelector(".iu-notesOverlay__listHeaderRight [data-iu-notes-view='trash']") : null;
    const deleteTextBtn = ov ? ov.querySelector(".iu-notesOverlay__itemDelete") : null;
    const trashIcon = ov ? ov.querySelector(".iu-notesOverlay__itemTrash") : null;
    const pin = ov ? ov.querySelector(".iu-notesOverlay__pin") : null;
    const actions = ov ? ov.querySelector(".iu-notesOverlay__itemActions") : null;
    const card = ov ? ov.querySelector(".iu-notesOverlay__itemBtn") : null;
    let headerGap = null;
    if (newBtn && closeBtn) {
      headerGap = Math.round((closeBtn.getBoundingClientRect().left - newBtn.getBoundingClientRect().right) * 100) / 100;
    }
    let actionColumnOk = false;
    let trashFullyVisible = false;
    let equalActionButtons = false;
    let trashClickable = false;
    if (pin && trashIcon && actions && card) {
      const pr = pin.getBoundingClientRect();
      const tr = trashIcon.getBoundingClientRect();
      const cr = card.getBoundingClientRect();
      const ar = actions.getBoundingClientRect();
      actionColumnOk =
        Math.abs(pr.top - cr.top) <= 2 &&
        Math.abs(tr.bottom - cr.bottom) <= 2 &&
        Math.abs(ar.top - cr.top) <= 2 &&
        Math.abs(ar.bottom - cr.bottom) <= 2 &&
        pr.bottom <= tr.top + 1;
      trashFullyVisible =
        tr.width >= 28 &&
        tr.height >= 28 &&
        tr.top >= ar.top - 1 &&
        tr.bottom <= ar.bottom + 1 &&
        tr.left >= ar.left - 1 &&
        tr.right <= ar.right + 1;
      equalActionButtons =
        Math.abs(pr.width - tr.width) <= 1 &&
        Math.abs(pr.height - tr.height) <= 1;
      const cx = tr.left + tr.width / 2;
      const cy = tr.top + tr.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      trashClickable = !!(hit && (hit === trashIcon || trashIcon.contains(hit)));
    }
    let listHeaderOk = false;
    if (leftBtn && trashTab) {
      const lr = leftBtn.getBoundingClientRect();
      const trr = trashTab.getBoundingClientRect();
      listHeaderOk = lr.left < trr.left && trr.right > lr.right + 40;
    }
    const cardHeight = card ? Math.round(card.getBoundingClientRect().height * 100) / 100 : 0;
    return {
      headerGap,
      deleteTextBtn: !!deleteTextBtn,
      trashIcon: !!trashIcon,
      actionColumnOk,
      listHeaderOk,
      cardHeight,
      trashFullyVisible,
      equalActionButtons,
      trashClickable,
    };
  });

  const scrollPerf = await measureScrollPerformance(page);
  const distance = await measureScrollDistance(page);

  await page.locator(".iu-notesOverlay__itemTrash").first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => {
    const box = document.getElementById("iuNotesConfirm");
    return !!(box && !box.hidden);
  }, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  const trashConfirm = await page.evaluate(() => {
    const box = document.getElementById("iuNotesConfirm");
    const text = document.getElementById("iuNotesConfirmText");
    const okBtn = document.querySelector(".iu-notesOverlay__confirmActions [data-iu-notes-confirm-yes]");
    const cancelBtn = document.querySelector(".iu-notesOverlay__confirmActions [data-iu-notes-confirm-no]");
    return {
      visible: !!(box && !box.hidden),
      text: text ? String(text.textContent || "") : "",
      okLabel: okBtn ? String(okBtn.textContent || "").trim() : "",
      cancelLabel: cancelBtn ? String(cancelBtn.textContent || "").trim() : "",
    };
  });
  await dismissNotesConfirm(page);

  await page.locator(".iu-notesOverlay__itemTrash").first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(250);
  const detailAfterTrashClick = await page.evaluate(() => !!document.getElementById("iuNoteBody"));
  await dismissNotesConfirm(page);

  let emptyTrashConfirmText = "";
  let emptyTrashVisible = false;
  if (noteCount <= 100) {
    await page.evaluate(() => {
      const btn = document.querySelector(".iu-notesOverlay__listHeaderRight [data-iu-notes-view='trash']");
      if (btn && typeof btn.click === "function") btn.click();
    });
    await page.waitForTimeout(500);
    emptyTrashVisible = await page.evaluate(() => {
      const btn = document.querySelector("[data-iu-notes-empty-trash]");
      return !!(btn && !btn.hidden);
    });
    await page.locator("[data-iu-notes-empty-trash]").click({ timeout: 5000 }).catch(() => {});
    await page.waitForFunction(() => {
      const text = document.getElementById("iuNotesConfirmText");
      return !!(text && /trvale odstranit všechny poznámky v koši/i.test(String(text.textContent || "")));
    }, null, { timeout: 5000 }).catch(() => {});
    emptyTrashConfirmText = await page.evaluate(() => {
      const text = document.getElementById("iuNotesConfirmText");
      return text ? String(text.textContent || "") : "";
    });
    await dismissNotesConfirm(page);
  }

  const passChecks = {
    deleteTextRemoved: !layout.deleteTextBtn,
    trashIcon: !!layout.trashIcon,
    actionColumnOk: !!layout.actionColumnOk,
    trashFullyVisible: !!layout.trashFullyVisible,
    equalActionButtons: !!layout.equalActionButtons,
    trashClickable: !!layout.trashClickable,
    listHeaderOk: !!layout.listHeaderOk,
    headerGapOk: layout.headerGap !== null && layout.headerGap >= MIN_HEADER_GAP_PX,
    cardHeightOk: layout.cardHeight >= 68,
    scrollPerfOk: scrollPerf.jankFrames <= MAX_SCROLL_JANK_FRAMES,
    distanceOk: distance >= MIN_DISTANCE_PX,
    trashConfirmVisible: !!trashConfirm.visible,
    trashConfirmTextOk: /přesunout do koše/i.test(trashConfirm.text),
    trashConfirmOkLabel: trashConfirm.okLabel === "OK",
    trashConfirmCancelLabel: trashConfirm.cancelLabel === "Zrušit",
    deleteNoDetail: !detailAfterTrashClick,
    emptyTrashOk: noteCount > 100 || /trvale odstranit všechny poznámky v koši/i.test(emptyTrashConfirmText),
  };
  const pass = Object.keys(passChecks).every((k) => passChecks[k]);

  return {
    label: vp.label,
    viewport: vp.w + "x" + vp.h,
    noteCount,
    distanceAboveBottomNavPx: distance,
    scrollJankFrames: scrollPerf.jankFrames,
    headerGapPx: layout.headerGap,
    cardHeightPx: layout.cardHeight,
    actionColumnOk: layout.actionColumnOk,
    trashFullyVisible: layout.trashFullyVisible,
    equalActionButtons: layout.equalActionButtons,
    trashClickable: layout.trashClickable,
    listHeaderOk: layout.listHeaderOk,
    deleteTextRemoved: !layout.deleteTextBtn,
    trashIconPresent: layout.trashIcon,
    trashConfirmVisible: trashConfirm.visible,
    trashConfirmOkLabel: trashConfirm.okLabel,
    trashConfirmCancelLabel: trashConfirm.cancelLabel,
    emptyTrashConfirmOk: /trvale odstranit všechny poznámky v koši/i.test(emptyTrashConfirmText),
    deleteOpensDetail: detailAfterTrashClick,
    passChecks,
    pass,
  };
}

async function runEmptyTrashScope(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareNotesSeed(page, 6, 4);
  await loadNotesPage(page, 6);
  await openNotesOverlay(page);
  const mainBefore = await page.evaluate((key) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "{}");
      return (parsed.notes || []).filter((n) => !n.deleted).length;
    } catch (_) {
      return -1;
    }
  }, STORE_KEY);
  await page.evaluate(() => {
    const btn = document.querySelector(".iu-notesOverlay__listHeaderRight [data-iu-notes-view='trash']");
    if (btn && typeof btn.click === "function") btn.click();
  });
  await page.waitForFunction(() => {
    const btn = document.querySelector("[data-iu-notes-empty-trash]");
    return !!(btn && !btn.hidden);
  }, null, { timeout: 6000 }).catch(() => {});
  await page.locator("[data-iu-notes-empty-trash]").click({ timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => {
    const text = document.getElementById("iuNotesConfirmText");
    return !!(text && /trvale odstranit všechny poznámky v koši/i.test(String(text.textContent || "")));
  }, null, { timeout: 6000 }).catch(() => {});
  await page.locator("[data-iu-notes-confirm-yes]").click({ timeout: 5000 }).catch(() => {});
  await page
    .waitForFunction(
      ({ key }) => {
        try {
          const parsed = JSON.parse(localStorage.getItem(key) || "{}");
          const list = parsed.notes || [];
          return list.filter((n) => !!n.deleted).length === 0;
        } catch (_) {
          return false;
        }
      },
      { key: STORE_KEY },
      { timeout: 10000 }
    )
    .catch(() => {});
  const scope = await page.evaluate(({ key, mainBeforeVal }) => {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "{}");
      const list = parsed.notes || [];
      return {
        mainLeft: list.filter((n) => !n.deleted).length,
        trashLeft: list.filter((n) => !!n.deleted).length,
        mainBeforeVal,
      };
    } catch (_) {
      return { mainLeft: -1, trashLeft: -1, mainBeforeVal };
    }
  }, { key: STORE_KEY, mainBeforeVal: mainBefore });
  return {
    pass: scope.mainLeft === mainBefore && scope.trashLeft === 0 && mainBefore > 0,
    mainBefore,
    mainLeft: scope.mainLeft,
    trashLeft: scope.trashLeft,
  };
}

async function runGuard() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("iu:local-data-protection:notice-accepted:v1", "1");
      localStorage.setItem("iu:local-data-protection:notice-accepted-at:v1", String(Date.now()));
      localStorage.setItem("iu:tool-local-storage-consent:v1", "granted");
    } catch (_) {}
  });
  const errState = { appErrors: 0 };
  const results = [];

  for (let v = 0; v < VIEWPORTS.length; v++) {
    for (let c = 0; c < [50, 100, 200].length; c++) {
      const count = [50, 100, 200][c];
      const page = await ctx.newPage();
      attachPageErrors(page, errState);
      await installProofGuardNetworkStubs(page);
      await installHeavyInfoEventsStubs(page);
      createIgnorableResourceTracker().attachToPage(page);
      results.push(await runViewportChecks(page, VIEWPORTS[v], count));
      await page.close();
    }
  }

  const scopePage = await ctx.newPage();
  attachPageErrors(scopePage, errState);
  await installProofGuardNetworkStubs(scopePage);
  await installHeavyInfoEventsStubs(scopePage);
  createIgnorableResourceTracker().attachToPage(scopePage);
  const emptyTrashScope = await runEmptyTrashScope(scopePage);
  await scopePage.close();
  await browser.close();

  const pass = results.every((r) => r.pass) && emptyTrashScope.pass && errState.appErrors === 0;
  return { pass, results, emptyTrashScope, url: envUrl(), appErrors: errState.appErrors };
}

function attachPageErrors(page, errState) {
  page.on("pageerror", (err) => {
    try {
      const t = String(err && err.message ? err.message : err);
      if (isIgnorableGuardConsoleError(t)) return;
      errState.appErrors += 1;
    } catch (_) {}
  });
}

function emitGuardBanner(title, reportPath, out) {
  process.stdout.write("=== " + title + " ===\n\n");
  process.stdout.write("PASS_FAIL=" + (out.pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("url=" + out.url + "\n\n");
  for (let i = 0; i < out.results.length; i++) {
    process.stdout.write(JSON.stringify(out.results[i], null, 2) + "\n\n");
  }
  process.stdout.write("empty_trash_scope=" + JSON.stringify(out.emptyTrashScope) + "\n");
  process.stdout.write("report=" + reportPath + "\n");
  process.stdout.write("=== END_" + title + " ===\n");
  try {
    fs.writeFileSync(reportPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  } catch (_) {}
  if (!out.pass) process.exitCode = 1;
}

module.exports = { runGuard, emitGuardBanner, envUrl };
