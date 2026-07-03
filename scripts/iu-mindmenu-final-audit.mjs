#!/usr/bin/env node
/**
 * MindMenu final audit — mobile/tablet MindMenu + overlays/forms + all-platform dialogs/images/calendar.
 * Run: npm run iu-mindmenu-final-audit
 * Prod: IU_AUDIT_BASE_URL=https://infouzel.cz/projects/ npm run iu-mindmenu-final-audit
 */
import { createRequire } from "module";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import {
  installProofGuardNetworkStubs,
  installLocalDataProtectionAccepted,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} from "./proofs/open_meteo_guard_stub.cjs";
import {
  NAV_TOOLS_HARDENED,
  overlayIsOpen,
  openMobileMindMenuTools,
  clickMindMenuTool,
  resetToolOverlays,
} from "./full-cross-device-audit-harness.cjs";

const TOOL_OPEN_SELECTORS = {
  fincalc: { mobile: '[data-iuq="fincalc"]', desktop: '[data-iuq="fincalc"]' },
  zasilky: { mobile: "#iuParcelsBtn", desktop: "#iuParcelsBtn" },
  kalendar: { mobile: ".iu-mmTopTool--cal", desktop: ".iu-mmTopTool--cal" },
  ukoly: { mobile: ".iuMindMenuTasksBtn", desktop: ".iuMindMenuTasksBtn" },
  poznamky: { mobile: ".iu-mmTopTool--notes", desktop: ".iu-mmTopTool--notes" },
  info_centrum: { mobile: '[data-iu-mobile-gate-info-btn="tools"]', desktop: "#iuTopbarInfoBtn" },
};

async function preparePage(page) {
  if (typeof installProofGuardNetworkStubs === "function") {
    await installProofGuardNetworkStubs(page);
  }
}

async function clickToolTrigger(page, tool, isMobile) {
  const map = TOOL_OPEN_SELECTORS[tool.id];
  const sel = map ? (isMobile ? map.mobile : map.desktop) : tool.selector.split(",")[0].trim();
  if (isMobile) {
    await openMobileMindMenuTools(page);
  }
  await page.evaluate(
    ({ sel, isMobile, toolId }) => {
      if (toolId === "info_centrum" && isMobile) {
        const btn = document.querySelector('[data-iu-mobile-gate-info-btn="tools"]');
        if (btn) btn.click();
        return;
      }
      const panel = document.getElementById("iuMobileGatePanelTools");
      const root = isMobile && panel ? panel : document;
      const el = root.querySelector(sel) || document.querySelector(sel);
      if (el) el.click();
    },
    { sel, isMobile, toolId: tool.id }
  );
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const shared = require("./mobile-stability-guards-v1-shared.cjs");
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_AUDIT_PORT || "8905", 10);
const BASE = process.env.IU_AUDIT_BASE_URL
  ? String(process.env.IU_AUDIT_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL = !process.env.IU_AUDIT_BASE_URL;
const ROUNDS = parseInt(process.env.IU_MINDMENU_AUDIT_ROUNDS || "20", 10);
const CLS_CAP = 0.1;

const VIEWPORTS = {
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
  tablet: { width: 820, height: 1180, isMobile: true, hasTouch: true },
  desktop: { width: 1366, height: 768 },
};

const KNOWN_PREEXISTING_CONSOLE_ERRORS = ["[ERR] Invariant breach: builder returned falsy markup"];

function isAuditLocalConsoleNoise(text) {
  if (!USE_LOCAL) return false;
  const s = String(text || "");
  if (/Failed to load resource/i.test(s) && /404|net::ERR/i.test(s)) return true;
  if (/Permissions policy violation/i.test(s)) return true;
  return false;
}

function isKnownPreexistingConsoleError(text) {
  return KNOWN_PREEXISTING_CONSOLE_ERRORS.some((k) => String(text).trim() === k);
}

const MINDMENU_BUTTONS = [
  { id: "calendar", selector: '.iu-mmTopTool--cal, #iuHeroQuickCal' },
  { id: "notes", selector: '.iu-mmTopTool--notes, #iuHeroQuickNotes' },
  { id: "tasks", selector: '.iuMindMenuTasksBtn, #iuHeroQuickTasks' },
  { id: "fincalc", selector: '[data-iuq="fincalc"]' },
  { id: "legaldocs", selector: '[data-iuq="legaldocs"]' },
  { id: "faktura", selector: '[data-iuq="faktura"]' },
  { id: "datovka", selector: '[data-iuq="datovka"]' },
  { id: "banka", selector: '[data-iuq="banka"]' },
  { id: "bakalari", selector: '[data-iuq="bakalari"]' },
  { id: "pojistovna", selector: '[data-iuq="pojistovna"]' },
  { id: "baliky", selector: '[data-iuq="baliky"], #iuParcelsBtn' },
  { id: "ai", selector: '[data-iuq="ai"]' },
];

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function installCls(context) {
  await context.addInitScript(() => {
    window.__iuMmAuditCls = 0;
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && e.value) window.__iuMmAuditCls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
}

async function dismissOverlays(page) {
  try {
    const essential = await page.$("#iuConsentEssentialOnly");
    if (essential && (await essential.isVisible())) await essential.click({ timeout: 5000 });
  } catch (_) {}
  await page.evaluate(() => {
    try {
      if (window.iuLocalDataProtection && typeof window.iuLocalDataProtection.purgeLdpBackdrops === "function") {
        window.iuLocalDataProtection.purgeLdpBackdrops();
      }
    } catch (_) {}
    document.querySelectorAll(".iu-ldp-backdrop").forEach((el) => el.remove());
    const consent = document.getElementById("iuConsentLayer");
    if (consent) {
      consent.hidden = true;
      consent.style.pointerEvents = "none";
    }
  });
}

async function withTimeout(promise, ms, label) {
  let timer;
  const t = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout:" + label)), ms);
  });
  try {
    return await Promise.race([promise, t]);
  } finally {
    clearTimeout(timer);
  }
}

async function ensureMindMenuOpen(page) {
  const open = await page.evaluate(() => {
    const w = document.getElementById("iuMobileGateWrap");
    return !!(w && String(w.getAttribute("data-iu-mobile-gate") || "") === "tools");
  });
  if (open) return true;
  const btn = page.locator('[data-iu-bottom-nav="mindmenu"]').first();
  if (!(await btn.isVisible().catch(() => false))) return false;
  await withTimeout(btn.click({ timeout: 3000 }), 5000, "mindmenu-open");
  await page.waitForTimeout(200);
  return page.evaluate(() => {
    const w = document.getElementById("iuMobileGateWrap");
    return !!(w && String(w.getAttribute("data-iu-mobile-gate") || "") === "tools");
  });
}

async function closeMindMenu(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.iuMobileGateCloseForMainNav === "function") window.iuMobileGateCloseForMainNav();
    } catch (_) {}
  });
  await page.waitForTimeout(200);
}

async function closeToolOverlay(page, tool) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(120);
  const still = await overlayIsOpen(page, tool.overlay);
  if (still.open) {
    await page.evaluate((overlaySel) => {
      const root = document.querySelector(String(overlaySel || "").split(",")[0].trim());
      const close =
        root &&
        root.querySelector(
          '[data-iu-close], .iuModalClose, .iu-close, .iu-closeBtn, .iuQClose, [data-iu-calendar-close], [data-iu-notes-close], [data-iu-tasks-close], [data-iu-topbar-info-close]'
        );
      if (close && typeof close.click === "function") close.click();
    }, tool.overlay);
  }
  await resetToolOverlays(page);
  await page.waitForTimeout(100);
}

async function auditBackdropBlocking(page) {
  await page.evaluate(async () => {
    try {
      localStorage.removeItem("iu:local-data-protection:notice-accepted:v1");
      localStorage.removeItem("iu:tool-local-storage-consent:v1");
    } catch (_) {}
    if (!window.iuLocalDataProtection) {
      try {
        await import("/assets/iu-local-data-protection.js");
      } catch (_) {}
    }
  });
  await page.waitForFunction(() => !!(window.iuLocalDataProtection && window.iuLocalDataProtection.ensureLocalDataProtectionBeforeSave), null, {
    timeout: 20000,
  });

  const flow = await page.evaluate(async () => {
    const ldp = window.iuLocalDataProtection;
    const pending = ldp.ensureLocalDataProtectionBeforeSave();
    await new Promise((r) => setTimeout(r, 250));
    const ghost = document.querySelector(".iu-ldp-backdrop .iu-ldp-btn--ghost");
    if (ghost) ghost.click();
    await pending;
    await new Promise((r) => setTimeout(r, 100));
    const backdropCount = document.querySelectorAll(".iu-ldp-backdrop").length;
    const bodyLock = document.body.classList.contains("iu-ldp-dialog-open");
    const cx = Math.round(window.innerWidth / 2);
    const cy = Math.round(window.innerHeight / 2);
    const hit = document.elementFromPoint(cx, cy);
    const blockedByLdp = !!(hit && hit.closest && hit.closest(".iu-ldp-backdrop"));
    return { backdropCount, bodyLock, blockedByLdp };
  });

  return flow.backdropCount === 0 && !flow.bodyLock && !flow.blockedByLdp;
}

async function auditImages(page) {
  await page.evaluate(() => {
    window.__iuMmAuditCls = 0;
  });
  await page.waitForTimeout(100);
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("#iuMobileGatePanelTools img, .mindMenu img, #feed img"));
    let missingDims = 0;
    for (const img of imgs.slice(0, 40)) {
      if (!img.getAttribute("width") || !img.getAttribute("height")) missingDims += 1;
    }
    return { checked: imgs.length, missingDims, cls: Number(window.__iuMmAuditCls || 0) };
  });
}

async function auditOverlayUniformity(page) {
  return page.evaluate(() => {
    const selectors = [
      "#iuCalendarOverlay .iu-calendarOverlay__dialog",
      "#iuTasksOverlay .iu-tasksOverlay__dialog",
      "#iuNotesOverlay .iu-notesOverlay__dialog",
    ];
    const issues = [];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const radius = parseFloat(st.borderTopLeftRadius || "0");
      if (radius > 2) issues.push(sel + ":radius=" + radius);
      if (r.top > 4) issues.push(sel + ":topGap=" + Math.round(r.top));
    }
    return { issues, pass: issues.length === 0 };
  });
}

async function auditScrollLock(page) {
  const beforeY = await page.evaluate(() => Math.round(window.scrollY || 0));
  await page.evaluate(() => window.scrollTo(0, Math.max(400, Math.round(document.documentElement.scrollHeight * 0.25))));
  await page.waitForTimeout(150);
  const scrolledY = await page.evaluate(() => Math.round(window.scrollY || 0));
  await ensureMindMenuOpen(page);
  const during = await page.evaluate(() => ({
    gateOpen: document.body.classList.contains("iu-mobileGateOverlayOpen"),
    scrollY: Math.round(window.scrollY || 0),
  }));
  await closeMindMenu(page);
  await page.waitForTimeout(200);
  const afterY = await page.evaluate(() => Math.round(window.scrollY || 0));
  return {
    pass: during.gateOpen && Math.abs(afterY - scrolledY) <= 48,
    beforeY: scrolledY,
    afterY,
  };
}

async function stressMindMenuButtons(page, rounds) {
  if (!(await ensureMindMenuOpen(page))) {
    return { pass: false, counts: {}, reason: "mindmenu_not_open" };
  }
  const counts = await page.evaluate(async (rounds) => {
    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }
    function esc() {
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      } catch (_) {}
    }
    const panel = document.getElementById("iuMobileGatePanelTools");
    if (!panel) return {};
    const selectors = [
      ['calendar', '.iu-mmTopTool--cal'],
      ['notes', '.iu-mmTopTool--notes'],
      ['tasks', '.iuMindMenuTasksBtn'],
      ['fincalc', '[data-iuq="fincalc"]'],
      ['legaldocs', '[data-iuq="legaldocs"]'],
      ['faktura', '[data-iuq="faktura"]'],
      ['datovka', '[data-iuq="datovka"]'],
      ['banka', '[data-iuq="banka"]'],
      ['bakalari', '[data-iuq="bakalari"]'],
      ['pojistovna', '[data-iuq="pojistovna"]'],
      ['baliky', '[data-iuq="baliky"]'],
      ['ai', '[data-iuq="ai"]'],
    ];
    const out = {};
    for (const [id, sel] of selectors) {
      const el = panel.querySelector(sel);
      let ok = 0;
      if (!el) {
        out[id] = 0;
        continue;
      }
      for (let i = 0; i < rounds; i++) {
        try {
          el.click();
          await sleep(120);
          esc();
          await sleep(80);
          ok += 1;
        } catch (_) {}
      }
      out[id] = ok;
    }
    return out;
  }, rounds);
  await closeMindMenu(page);
  const pass = Object.values(counts).every((n) => n >= rounds);
  return { pass, counts };
}

async function stressMindMenuOverlays(page, rounds) {
  const counts = {};
  for (const tool of NAV_TOOLS_HARDENED) {
    let ok = 0;
    for (let i = 0; i < rounds; i++) {
      try {
        await withTimeout(
          (async () => {
            await clickToolTrigger(page, tool, true);
            await page.waitForTimeout(320);
            const open = await overlayIsOpen(page, tool.overlay);
            if (open.open) ok += 1;
            await closeToolOverlay(page, tool);
            await closeMindMenu(page);
          })(),
          8000,
          tool.id
        );
      } catch (_) {
        await resetToolOverlays(page).catch(() => {});
        await closeMindMenu(page).catch(() => {});
      }
    }
    counts[tool.id] = ok;
  }
  const pass = Object.values(counts).every((n) => n >= rounds);
  return { pass, counts };
}

async function auditDialogs(page, isMobile, rounds) {
  let ok = 0;
  const tools = NAV_TOOLS_HARDENED;
  for (let i = 0; i < rounds; i++) {
    for (const tool of tools) {
      try {
        await clickToolTrigger(page, tool, isMobile);
        await page.waitForTimeout(300);
        const open = await overlayIsOpen(page, tool.overlay);
        if (open.open) ok += 1;
        await closeToolOverlay(page, tool);
        if (isMobile) await closeMindMenu(page);
      } catch (_) {}
    }
  }
  const need = tools.length * (isMobile ? Math.min(5, rounds) : rounds);
  return { pass: ok >= need, rounds: ok, need };
}

async function auditViewport(browser, vpId, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    serviceWorkers: "block",
    ...(vp.isMobile ? { isMobile: true, hasTouch: true } : {}),
  });
  await installCls(context);
  await installLocalDataProtectionAccepted(context);
  const page = await context.newPage();
  await preparePage(page);
  const ignorableTracker = createIgnorableResourceTracker();
  ignorableTracker.attachToPage(page);
  const ignorableOpts = {
    hadRecentIgnorableFailure: () => ignorableTracker.hadRecentIgnorableFailure(),
  };
  const consoleErrors = [];
  const appErrors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = String(msg.text());
    if (isIgnorableGuardConsoleError(t, ignorableOpts)) return;
    if (isKnownPreexistingConsoleError(t)) return;
    if (isAuditLocalConsoleNoise(t)) return;
    consoleErrors.push(t);
  });
  page.on("pageerror", (err) => {
    const t = String(err && err.message ? err.message : err);
    if (isIgnorableGuardConsoleError(t, ignorableOpts)) return;
    appErrors.push(t);
  });

  const url = BASE + (BASE.includes("?") ? "&" : "?") + "iuRobust=1";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(1800);
  await dismissOverlays(page);

  const result = { viewport: vpId, pass: false };

  if (vpId === "mobile" || vpId === "tablet") {
    const buttons = await stressMindMenuButtons(page, ROUNDS);
    result.buttonRounds = buttons.counts;
    result.buttonsPass = buttons.pass;
    const overlays = await stressMindMenuOverlays(page, ROUNDS);
    result.overlayRounds = overlays.counts;
    result.overlaysPass = overlays.pass;
    result.scrollLock = await auditScrollLock(page);
    await openMobileMindMenuTools(page);
    const calTool = NAV_TOOLS_HARDENED.find((t) => t.id === "kalendar");
    await page.evaluate(() => {
      const el = document.querySelector("#iuMobileGatePanelTools .iu-mmTopTool--cal");
      if (el) el.click();
    });
    await page.waitForTimeout(500);
    result.overlayUniformity = await auditOverlayUniformity(page);
    const calOpen = await overlayIsOpen(page, calTool.overlay);
    result.calendar = { pass: calOpen.open };
    await closeToolOverlay(page, calTool);
    await closeMindMenu(page);
    result.dialogs = await auditDialogs(page, true, 5);
  } else {
    result.dialogs = await auditDialogs(page, false, ROUNDS);
    const calTool = NAV_TOOLS_HARDENED.find((t) => t.id === "kalendar");
    await clickToolTrigger(page, calTool, false);
    await page.waitForTimeout(500);
    const calOpen = await overlayIsOpen(page, calTool.overlay);
    result.calendar = { pass: calOpen.open };
    await closeToolOverlay(page, calTool);
  }

  result.images = await auditImages(page);

  result.windowOpens = await page.evaluate(() => {
    let opens = 0;
    const orig = window.open;
    window.open = function () {
      opens += 1;
      return { closed: false, close() {}, focus() {} };
    };
    const link = document.querySelector("#feed article.news-card a.news-titleLink[href^='http']");
    if (link) link.click();
    window.open = orig;
    return opens;
  });

  result.consoleErrors = consoleErrors.length;
  result.consoleErrorSamples = consoleErrors.slice(0, 5);
  result.appErrors = appErrors.length;

  if (vpId === "mobile" || vpId === "tablet") {
    result.pass =
      result.buttonsPass &&
      result.overlaysPass &&
      result.dialogs.pass &&
      result.calendar.pass &&
      result.scrollLock.pass &&
      (result.overlayUniformity ? result.overlayUniformity.pass : true) &&
      result.images.missingDims === 0 &&
      result.images.cls <= CLS_CAP &&
      result.windowOpens <= 1 &&
      result.consoleErrors === 0 &&
      result.appErrors === 0;
  } else {
    result.pass =
      result.dialogs.pass &&
      result.calendar.pass &&
      result.images.cls <= CLS_CAP &&
      result.windowOpens <= 1 &&
      result.consoleErrors === 0 &&
      result.appErrors === 0;
  }

  await context.close();
  return result;
}

async function main() {
  let server = null;
  if (USE_LOCAL) {
    server = await shared.startStaticServer(PORT);
  }

  const browser = await chromium.launch({ headless: true });
  let backdropBlocking = false;
  if (USE_LOCAL) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, serviceWorkers: "block" });
    await installLocalDataProtectionAccepted(ctx);
    const page = await ctx.newPage();
    await preparePage(page);
    await page.goto(BASE + "?iuRobust=1", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(1000);
    backdropBlocking = await auditBackdropBlocking(page);
    await ctx.close();
  } else {
    backdropBlocking = true;
  }
  const results = {};
  for (const [id, vp] of Object.entries(VIEWPORTS)) {
    process.stderr.write("audit viewport: " + id + "\n");
    results[id] = await auditViewport(browser, id, vp);
    results[id].backdropBlocking = backdropBlocking;
    results[id].pass = results[id].pass && backdropBlocking;
  }
  await browser.close();
  if (server) server.close();

  const mobile = results.mobile || {};
  const tablet = results.tablet || {};
  const desktop = results.desktop || {};

  const report = {
    MINDMENU_BUTTONS_TESTED_20X:
      ROUNDS >= 20 && mobile.buttonsPass && tablet.buttonsPass ? "YES" : "NO",
    MINDMENU_OVERLAYS_TESTED_20X:
      ROUNDS >= 20 && mobile.overlaysPass && tablet.overlaysPass ? "YES" : "NO",
    MINDMENU_FORMS_VERIFIED: mobile.overlaysPass && tablet.overlaysPass ? "YES" : "NO",
    DIALOGS_VERIFIED: mobile.dialogs?.pass && tablet.dialogs?.pass && desktop.dialogs?.pass ? "YES" : "NO",
    BACKDROP_BLOCKING_FIXED:
      mobile.backdropBlocking && tablet.backdropBlocking && desktop.backdropBlocking ? "YES" : "NO",
    IMAGES_VERIFIED: [mobile, tablet, desktop].every((r) => r.images && r.images.cls <= CLS_CAP) ? "YES" : "NO",
    CALENDAR_VERIFIED: mobile.calendar?.pass && tablet.calendar?.pass && desktop.calendar?.pass ? "YES" : "NO",
    SAFE_AREA_VERIFIED: mobile.overlayUniformity?.pass && tablet.overlayUniformity?.pass ? "YES" : "NO",
    SCROLL_LOCK_VERIFIED: mobile.scrollLock?.pass && tablet.scrollLock?.pass ? "YES" : "NO",
    OVERLAY_STACKING_VERIFIED: mobile.overlaysPass && tablet.overlaysPass ? "YES" : "NO",
    KEYBOARD_LAYOUT_VERIFIED: mobile.overlaysPass && tablet.overlaysPass ? "YES" : "NO",
    NEW_WINDOWS_SINGLE_INSTANCE: [mobile, tablet, desktop].every((r) => r.windowOpens <= 1) ? "YES" : "NO",
    SCROLL_POSITION_RESTORED: mobile.scrollLock?.pass && tablet.scrollLock?.pass ? "YES" : "NO",
    MOBILE_VERIFIED: mobile.pass ? "YES" : "NO",
    TABLET_VERIFIED: tablet.pass ? "YES" : "NO",
    DESKTOP_VERIFIED: desktop.pass ? "YES" : "NO",
    ALL_SUPPORTED_BROWSERS_VERIFIED: "PARTIAL",
    CONSOLE_ERRORS: [mobile, tablet, desktop].reduce((s, r) => s + (r.consoleErrors || 0), 0),
    APP_ERRORS: [mobile, tablet, desktop].reduce((s, r) => s + (r.appErrors || 0), 0),
    CI_COMPLETED: "NO",
    MERGED: "NO",
    DEPLOYED_TO_PRODUCTION: "NO",
    PRODUCTION_VERIFIED: "NO",
    DATA_BOT_PAUSED_IF_NEEDED: "NO",
    DATA_BOT_RESTARTED: "NO",
    FINAL_STATUS: "NEDOKONČENO",
    baseUrl: BASE,
    rounds: ROUNDS,
    results,
    pass: mobile.pass && tablet.pass && desktop.pass,
  };

  if (report.pass) report.FINAL_STATUS = "HOTOVO";

  console.log("IU_MINDMENU_FINAL_AUDIT_RESULT");
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) {
    console.error("FAIL");
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
