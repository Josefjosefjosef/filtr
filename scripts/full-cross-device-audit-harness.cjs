/**
 * Shared helpers for full cross-device production audit (harness hardening v1).
 * AUDIT ONLY — no product changes.
 */
"use strict";

const NAV_TOOLS_HARDENED = [
  {
    id: "fincalc",
    label: "Finance kalkulačky",
    selector: '[data-iuq="fincalc"], [aria-label="Finanční kalkulačky"]',
    overlay: "#iuFinancialCalcPanel",
    openFn: null,
  },
  {
    id: "zasilky",
    label: "Zásilky",
    selector: '#iuParcelsBtn, [aria-label="Zásilky a sledování"], [data-iu-action="parcels"]',
    overlay: "#iuParcelsPopover",
    openFn: "iuParcelsOpenSurface",
  },
  {
    id: "kalendar",
    label: "Kalendář",
    selector: '#iuHeroQuickCal, [aria-label="Kalendář"], .iu-mmTopTool--cal.iuMindMenuButton',
    overlay: "#iuCalendarOverlay",
    openFn: "iuCalendarService.openOverlay",
  },
  {
    id: "ukoly",
    label: "Úkoly",
    selector: '#iuHeroQuickTasks, [aria-label="Úkoly"], .iuMindMenuTasksBtn',
    overlay: "#iuTasksOverlay",
    openFn: "iuTasksService.openOverlay",
  },
  {
    id: "poznamky",
    label: "Poznámky",
    selector: '#iuHeroQuickNotes, [aria-label="Poznámky"], .iu-mmTopTool--notes',
    overlay: "#iuNotesOverlay",
    openFn: "iuNotesService.openOverlay",
  },
  {
    id: "info_centrum",
    label: "Info centrum",
    selector: '#iuInfoCenterBtn, [data-iu-info-center], [aria-label="Info centrum"]',
    overlay: "#iuTopbarInfoOverlay, #iuInfoCenterOverlay",
    openFn: null,
  },
];

/** In-browser overlay visibility — aria-hidden, hidden, CSS, bounding rect, content. */
function overlayIsOpenInPage(selectors) {
  const list = (Array.isArray(selectors) ? selectors : String(selectors || "").split(",")).map((s) => s.trim()).filter(Boolean);

  function hasVisibleContent(el) {
    const title = el.querySelector("h3, h2, [role='dialog'], .iu-parcels-modal-title, .iu-calendarOverlay__title, .iu-notesOverlay__dialog, .iu-tasksOverlay__dialog");
    if (title) {
      const tr = title.getBoundingClientRect();
      if (tr.width > 0 && tr.height > 0) return true;
    }
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    return text.length > 8;
  }

  function elementOpen(el) {
    if (!el) return false;

    if (el.id === "iuParcelsPopover" || el.classList.contains("iu-parcels-modal")) {
      if (document.body.classList.contains("iu-parcels-overlay-open") && el.classList.contains("is-open")) {
        const pr = el.getBoundingClientRect();
        if (pr.width > 0 && pr.height > 0) return hasVisibleContent(el);
      }
    }

    const backdrop = document.querySelector(".iu-parcels-overlay.is-open");
    if (backdrop && el.id === "iuParcelsPopover" && el.classList.contains("is-open")) {
      const pr = el.getBoundingClientRect();
      if (pr.width > 0 && pr.height > 0) return hasVisibleContent(el);
    }

    if (el.hidden) return false;
    if (el.getAttribute("aria-hidden") === "true" && !el.classList.contains("is-open")) return false;
    const st = window.getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    if (Number(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    return hasVisibleContent(el);
  }

  for (const sel of list) {
    const el = document.querySelector(sel);
    if (elementOpen(el)) return { open: true, selector: sel };
  }

  if (document.body.classList.contains("iu-parcels-overlay-open")) {
    const pop = document.getElementById("iuParcelsPopover");
    if (pop && (pop.classList.contains("is-open") || elementOpen(pop))) {
      return { open: true, selector: "#iuParcelsPopover" };
    }
  }

  return { open: false, selector: null };
}

async function overlayIsOpen(page, selectors) {
  return page.evaluate(overlayIsOpenInPage, selectors);
}

async function ensureAuditPageReady(page, baseUrl, gotoMs) {
  const state = await page.evaluate(() => ({
    url: location.href,
    blank: location.href === "about:blank",
    dom: document.querySelectorAll("*").length,
  }));
  if (state.blank || state.dom < 100 || !String(state.url || "").includes("infouzel")) {
    await page.goto(baseUrl, { waitUntil: "load", timeout: gotoMs });
    await page.waitForFunction(() => document.querySelectorAll("*").length > 500, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    return { recovered: true, reason: state.blank ? "about_blank" : "weak_dom" };
  }
  return { recovered: false };
}

async function openMobileMindMenuTools(page) {
  await page.locator('#iuMobileBottomNav [data-iu-bottom-nav="mindmenu"]').first().click({ timeout: 8000, force: true }).catch(() => {});
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const tab = document.getElementById("iuMobileGateTabTools");
    const panel = document.getElementById("iuMobileGatePanelTools");
    if (tab && panel && panel.hidden) tab.click();
  });
  await page.waitForTimeout(600);
}

async function openMobileNavMenu(page) {
  const menu = page.locator('#iuMobileBottomNav [data-iu-bottom-nav="menu"]').first();
  if (await menu.isVisible().catch(() => false)) {
    await menu.click({ timeout: 8000, force: true }).catch(() => {});
    await page.waitForTimeout(600);
  }
}

async function invokeToolOpenFn(page, openFn) {
  if (!openFn) return false;
  await page.evaluate((fnPath) => {
    const parts = fnPath.split(".");
    let ctx = window;
    for (let i = 0; i < parts.length - 1; i++) ctx = ctx[parts[i]];
    const fn = ctx[parts[parts.length - 1]];
    if (typeof fn === "function") fn.call(ctx);
  }, openFn);
  return true;
}

async function clickMindMenuTool(page, tool, isMobile) {
  if (isMobile) {
    await openMobileMindMenuTools(page);
    await page.waitForSelector("#iuMobileGatePanelTools", { state: "attached", timeout: 8000 }).catch(() => {});
  }
  const btn = page.locator(tool.selector).first();
  if (await btn.isVisible().catch(() => false)) {
    if (!isMobile) await btn.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
    await btn.click({ timeout: 8000, force: true });
    return { path: "click" };
  }
  if (tool.openFn) {
    await invokeToolOpenFn(page, tool.openFn);
    return { path: "openFn" };
  }
  return { path: "none" };
}

function classifyFailureType(result) {
  const errText = (result.errors || []).join(" ");
  const url = result.after && result.after.url ? result.after.url : "";
  if (url === "about:blank" || /about:blank/.test(url)) return "AUDIT_FAILURE";
  if (/Timeout|locator\.click|waiting for locator|PAGE_CRASH|Target closed|Execution context was destroyed/i.test(errText)) {
    return "AUDIT_FAILURE";
  }
  if (result.click_success === false && /Timeout|locator|selector|waiting for/i.test(errText)) return "AUDIT_FAILURE";
  if (result.harness_degraded) return "AUDIT_FAILURE";
  if (result.overlay_open === false && result.click_success === true) return "PRODUCT_FAILURE";
  if (result.click_success === false && !/Timeout|locator|about:blank/i.test(errText)) return "PRODUCT_FAILURE";
  if (result.url_or_state_correct === false && result.click_success === true && !result.harness_degraded) {
    return "PRODUCT_FAILURE";
  }
  return result.failure_type || "PASS";
}

function isHomeState(a) {
  const sec = a.section || "";
  const url = a.url || "";
  return sec === "home" || sec === "feed" || sec === "" || /section=home|\/projects\/?$/.test(url);
}

async function verifyWeatherSectionOpen(page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const section = html.getAttribute("data-section") || body.getAttribute("data-section") || "";
    const view = document.getElementById("iuWeatherView");
    const viewVisible = !!(view && !view.hidden && view.getAttribute("aria-hidden") !== "true");
    const urlOk = /section=pocasi/.test(location.href) || section === "pocasi";
    return {
      ok: urlOk || viewVisible,
      section,
      url: location.href,
      weatherViewVisible: viewVisible,
    };
  });
}

async function resetToolOverlays(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.iuParcelsCloseSurface === "function") window.iuParcelsCloseSurface();
    } catch (_) {}
    try {
      if (window.iuCalendarService && typeof window.iuCalendarService.closeOverlay === "function") window.iuCalendarService.closeOverlay();
    } catch (_) {}
    try {
      if (window.iuTasksService && typeof window.iuTasksService.closeOverlay === "function") window.iuTasksService.closeOverlay();
    } catch (_) {}
    try {
      if (window.iuNotesService && typeof window.iuNotesService.closeOverlay === "function") window.iuNotesService.closeOverlay();
    } catch (_) {}
    document.body.classList.remove("iu-parcels-overlay-open");
  });
  await page.waitForTimeout(400);
}

async function runMobileToolReplay(page, tool, baseUrl, gotoMs) {
  await ensureAuditPageReady(page, baseUrl, gotoMs);
  await resetToolOverlays(page);
  let clickMeta = await clickMindMenuTool(page, tool, true);
  await page.waitForTimeout(1500);
  let overlay = await overlayIsOpen(page, tool.overlay);
  if (!overlay.open && tool.openFn) {
    await invokeToolOpenFn(page, tool.openFn);
    await page.waitForTimeout(1500);
    overlay = await overlayIsOpen(page, tool.overlay);
    clickMeta = { path: clickMeta.path + "+openFn" };
  }
  const pass = overlay.open;
  return {
    pass,
    clickPath: clickMeta.path,
    overlay,
    classification: pass ? "PASS" : classifyFailureType({ click_success: clickMeta.path !== "none", overlay_open: overlay.open, errors: [] }),
  };
}

function scopeAllowsAuditFiles(gitLines) {
  if (!gitLines.length) return true;
  return gitLines.every((l) => /^(\?\?|[ MADRCU?!]{1,2})\s+scripts\/(full-cross-device|full-cross-device-audit-harness)/.test(l.trim()));
}

module.exports = {
  NAV_TOOLS_HARDENED,
  overlayIsOpenInPage,
  overlayIsOpen,
  ensureAuditPageReady,
  openMobileMindMenuTools,
  openMobileNavMenu,
  clickMindMenuTool,
  invokeToolOpenFn,
  classifyFailureType,
  isHomeState,
  verifyWeatherSectionOpen,
  runMobileToolReplay,
  resetToolOverlays,
  scopeAllowsAuditFiles,
};
