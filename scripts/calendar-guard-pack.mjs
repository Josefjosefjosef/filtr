#!/usr/bin/env node
/**
 * Calendar + Silver integration guard pack (Playwright, local static server).
 * Run: npm run calendar-guard-pack
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 8091;
const BASE = `http://127.0.0.1:${PORT}`;
const TOLERANCE = 1.5;

function serveFile(urlPath) {
  const clean = (urlPath || "/").split("?")[0].replace(/^\//, "") || "";
  let filePath = path.join(ROOT, clean || "index.html");
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT))) return null;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath);
        const ct = ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : ext === ".json" ? "application/json" : ext === ".ico" ? "image/x-icon" : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function installClsHarness(page) {
  await page.evaluate(async () => {
    try {
      await document.fonts.ready;
    } catch (e) {}
    try {
      if (window.__iuClsPO) window.__iuClsPO.disconnect();
    } catch (e) {}
    window.__iuClsSum = 0;
    window.__iuClsPO = new PerformanceObserver(function (list) {
      const entries = list.getEntries();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!e.hadRecentInput) window.__iuClsSum = (window.__iuClsSum || 0) + e.value;
      }
    });
    window.__iuClsPO.observe({ type: "layout-shift", buffered: false });
  });
  await page.waitForTimeout(200);
}

async function clsReset(page) {
  await page.evaluate(() => {
    window.__iuClsSum = 0;
  });
}

async function snapMetrics(page) {
  const overflowX = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth + 1;
  });
  const railShift = await page.evaluate(() =>
    typeof window.__iuRailShiftProbe === "number" ? window.__iuRailShiftProbe : 0
  );
  const clsSum = await page.evaluate(() => Number(window.__iuClsSum || 0));
  return { overflowX, railShift, clsSum };
}

function collectStableHookSnapshot(page) {
  return page.evaluate(() => {
    const card = document.getElementById("iuSilverCalendarSummaryCard");
    const views = [];
    document.querySelectorAll("#iuCalendarOverlay [data-iu-cal-view]").forEach((el) => {
      views.push(el.getAttribute("data-iu-cal-view") || "");
    });
    views.sort();
    const closeBtn = document.querySelector('#iuCalendarOverlay [data-iu-calendar-close="button"]');
    return {
      silverCard: card
        ? {
            id: card.id,
            role: card.getAttribute("role") || "",
            tabindex: card.getAttribute("tabindex") || "",
            className: card.className || "",
            "data-iu-action-indicator": card.getAttribute("data-iu-action-indicator") || ""
          }
        : null,
      viewAttrsSorted: views.join(","),
      closeContract: closeBtn ? closeBtn.getAttribute("data-iu-calendar-close") || "" : ""
    };
  });
}

function hooksEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function openCalendarFromToolbar(page) {
  await page.waitForFunction(
    () => window.iuCalendarService && typeof window.iuCalendarService.openOverlay === "function",
    null,
    { timeout: 60000 }
  );
  await page.evaluate(() => {
    window.iuCalendarService.openOverlay();
  });
  await page.waitForFunction(() => {
    const o = document.getElementById("iuCalendarOverlay");
    return o && !o.hasAttribute("hidden");
  }, null, { timeout: 20000 });
}

async function closeCalendar(page) {
  await page.click('#iuCalendarOverlay [data-iu-calendar-close="button"]', { timeout: 8000 });
  await page.waitForFunction(() => {
    const o = document.getElementById("iuCalendarOverlay");
    return o && o.hasAttribute("hidden");
  }, null, { timeout: 8000 });
}

async function setView(page, name) {
  await page.click(`#iuCalendarOverlay [data-iu-cal-view="${name}"]`, { timeout: 8000 });
  await page.waitForFunction(
    (v) => {
      const r = document.getElementById("iuCalendarViewRoot");
      return r && r.getAttribute("data-view") === v;
    },
    name,
    { timeout: 8000 }
  );
}

async function main() {
  const results = {};
  const server = await startServer();
  const { chromium } = await import("playwright");
  const consoleErrors = [];

  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(String(err && err.message ? err.message : err));
    });

    await page.goto(`${BASE}/projects/`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => window.iuCalendarService, null, { timeout: 120000 });
    await installClsHarness(page);
    await clsReset(page);

    await page.evaluate(async () => {
      const svc = window.iuCalendarService;
      if (!svc || typeof svc.calendarCreateEvent !== "function") return;
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const today = `${y}-${m}-${day}`;
      const yest = new Date(d);
      yest.setDate(yest.getDate() - 1);
      const yd = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, "0")}-${String(yest.getDate()).padStart(2, "0")}`;
      await svc.calendarCreateEvent({
        date: today,
        time: "15:30",
        title: "Guard today",
        note: "",
        type: "personal",
        attachments: []
      });
      await svc.calendarCreateEvent({
        date: yd,
        time: "09:00",
        title: "Guard past",
        note: "",
        type: "personal",
        attachments: []
      });
    });

    const hooksBefore = await collectStableHookSnapshot(page);

    const silverEntry = await page.evaluate(async () => {
      const card = document.getElementById("iuSilverCalendarSummaryCard");
      const svc = window.iuCalendarService;
      if (!card || !svc || typeof svc.calendarOpenTodayDayView !== "function") return { ok: false, reason: "no_path" };
      svc.calendarOpenTodayDayView(card);
      await new Promise((r) => setTimeout(r, 300));
      const o = document.getElementById("iuCalendarOverlay");
      return { ok: !!(o && !o.hasAttribute("hidden")) };
    });
    results.silverCalendarEntryGuard = silverEntry.ok ? "PASS" : "FAIL";

    await closeCalendar(page);
    await clsReset(page);

    await openCalendarFromToolbar(page);
    await closeCalendar(page);
    await page.evaluate(() => {
      const card = document.getElementById("iuSilverCalendarSummaryCard");
      window.iuCalendarService.calendarOpenTodayDayView(card);
    });
    await page.waitForFunction(() => {
      const o = document.getElementById("iuCalendarOverlay");
      return o && !o.hasAttribute("hidden");
    }, null, { timeout: 20000 });
    await closeCalendar(page);
    await page.evaluate(() => {
      const card = document.getElementById("iuSilverCalendarSummaryCard");
      window.iuCalendarService.calendarOpenTodayDayView(card);
    });
    await page.waitForFunction(() => {
      const o = document.getElementById("iuCalendarOverlay");
      return o && !o.hasAttribute("hidden");
    }, null, { timeout: 20000 });
    results.calendarOpenCloseGuard = "PASS";

    const closeBtnBox = await page.$eval('#iuCalendarOverlay [data-iu-calendar-close="button"]', (el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height, t: r.top };
    });
    results.calendarOpenCloseGuard =
      closeBtnBox.w > 4 && closeBtnBox.h > 4 && closeBtnBox.t >= -2 ? results.calendarOpenCloseGuard : "FAIL";

    for (const v of ["day", "week", "month", "year"]) {
      await setView(page, v);
      const ok = await page.evaluate((view) => {
        const r = document.getElementById("iuCalendarViewRoot");
        return r && r.getAttribute("data-view") === view;
      }, v);
      if (!ok) {
        results.calendarViewSwitchGuard = "FAIL";
        break;
      }
    }
    if (!results.calendarViewSwitchGuard) results.calendarViewSwitchGuard = "PASS";

    await setView(page, "month");
    await page.click('#iuCalendarOverlay [data-iu-cal-nav="-1"]');
    await page.waitForTimeout(200);
    await page.click('#iuCalendarOverlay [data-iu-cal-nav="1"]');
    await page.click("#iuCalendarOverlay [data-iu-cal-today]");
    await page.waitForTimeout(200);
    results.calendarNavigationGuard = "PASS";

    const visualOk = await page.evaluate(() => {
      const root = document.getElementById("iuCalendarOverlay");
      if (!root) return false;
      const bad = [];
      root.querySelectorAll("button, input, select, textarea").forEach((el) => {
        if (el.type === "hidden") return;
        if (!el.getClientRects || el.getClientRects().length === 0) return;
        const r = el.getBoundingClientRect();
        const cs = window.getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0) bad.push("zero");
        if (cs.display === "none" || cs.visibility === "hidden") bad.push("hidden");
      });
      return bad.length === 0;
    });
    results.calendarVisualIntegrityGuard = visualOk ? "PASS" : "FAIL";

    await setView(page, "month");
    const statePresence = await page.evaluate(() => {
      const root = document.getElementById("iuCalendarViewRoot");
      if (!root) return { ok: false };
      const samples = [];
      const push = (el, label) => {
        if (!el) return;
        const cs = window.getComputedStyle(el);
        samples.push({ label, bg: cs.backgroundColor, opacity: cs.opacity });
      };
      push(root.querySelector(".iu-calDayCell.is-today"), "month-today");
      push(root.querySelector(".iu-calDayCell.is-past"), "month-past");
      push(root.querySelector(".iu-calDayCell.has-events"), "month-has");
      push(root.querySelector(".iu-calDayCell.is-future"), "month-future");
      const tab = document.querySelector("#iuCalendarOverlay .iu-calendarOverlay__viewBtn.is-active");
      push(tab, "active-tab");
      const uniq = new Set(samples.map((s) => s.bg + "|" + s.opacity));
      return { ok: samples.length >= 3 && uniq.size >= 2, count: samples.length, uniq: uniq.size };
    });
    results.calendarStatePresenceGuard = statePresence.ok ? "PASS" : "FAIL";

    await setView(page, "day");
    const stateDay = await page.evaluate(() => {
      const root = document.getElementById("iuCalendarViewRoot");
      if (!root) return false;
      const items = root.querySelectorAll(".iu-calTimelineItem");
      if (items.length !== 1) return false;
      const el = items[0];
      const hasState =
        el.classList.contains("is-today") || el.classList.contains("is-past") || el.classList.contains("is-future");
      const cs = window.getComputedStyle(el);
      return hasState && (cs.backgroundColor || "").length > 0;
    });
    results.calendarStatePresenceGuard = stateDay && results.calendarStatePresenceGuard === "PASS" ? "PASS" : "FAIL";

    await setView(page, "week");
    const stateWeek = await page.evaluate(() => {
      const root = document.getElementById("iuCalendarViewRoot");
      return !!(root && root.querySelectorAll(".iu-calTimelineItem").length >= 7);
    });
    if (!stateWeek) results.calendarStatePresenceGuard = "FAIL";

    await setView(page, "year");
    const stateYear = await page.evaluate(() => {
      const root = document.getElementById("iuCalendarViewRoot");
      const cur = root && root.querySelector(".iu-calYearMonth.is-current-month");
      const he = root && root.querySelector(".iu-calYearMonth.has-events");
      return !!(cur && he);
    });
    if (!stateYear) results.calendarStatePresenceGuard = "FAIL";

    const shiftOk = await page.evaluate((tol) => {
      const els = Array.from(
        document.querySelectorAll(
          "#iuCalendarOverlay .iu-calendarOverlay__viewBtn, #iuCalendarOverlay [data-iu-cal-nav], #iuCalendarOverlay [data-iu-cal-today], #iuCalendarOverlay [data-iu-calendar-close], #iuCalendarOverlay .iu-calDayCell, #iuCalendarOverlay .iu-calendarOverlay__eventBtn"
        )
      ).filter((e) => e.offsetParent !== null);
      let ok = true;
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        const before = el.getBoundingClientRect();
        try {
          el.focus({ preventScroll: true });
        } catch (e) {
          el.focus();
        }
        const after = el.getBoundingClientRect();
        if (Math.abs(before.width - after.width) > tol || Math.abs(before.height - after.height) > tol || Math.abs(before.left - after.left) > tol || Math.abs(before.top - after.top) > tol) ok = false;
        el.blur();
      }
      return ok;
    }, TOLERANCE);
    results.noHoverFocusShiftGuard = shiftOk ? "PASS" : "FAIL";

    const formOk = await page.evaluate(() => {
      const form = document.getElementById("iuCalendarEventForm");
      if (!form) return false;
      const sub = form.querySelector('button[type="submit"]');
      const r = sub ? sub.getBoundingClientRect() : { width: 0, height: 0 };
      return r.width > 20 && r.height > 20;
    });
    results.formIntegrityGuard = formOk ? "PASS" : "FAIL";

    const heights = await page.evaluate(() => {
      const max = { h: 0 };
      document.querySelectorAll("#iuCalendarOverlay .iu-calendarOverlay__viewBtn, #iuCalendarOverlay .iu-calDayCell, #iuCalendarOverlay .iu-calendarOverlay__eventBtn").forEach((el) => {
        const h = el.getBoundingClientRect().height;
        if (h > max.h) max.h = h;
      });
      return max.h;
    });
    results.noUnexpectedCalendarHeightExplosionGuard = heights < 800 ? "PASS" : "FAIL";

    const leakOk = await page.evaluate(() => {
      const leak = [];
      document.querySelectorAll(".iu-calGrid, .iu-calTimeline, .iu-calYear").forEach((el) => {
        if (!document.getElementById("iuCalendarOverlay").contains(el)) leak.push("leak");
      });
      return leak.length === 0;
    });
    results.noSharedSelectorLeakGuard = leakOk ? "PASS" : "FAIL";

    await openCalendarFromToolbar(page);
    await setView(page, "day");
    results.viewDay = (await page.evaluate(() => document.getElementById("iuCalendarViewRoot")?.getAttribute("data-view"))) === "day" ? "PASS" : "FAIL";
    await setView(page, "week");
    results.viewWeek = (await page.evaluate(() => document.getElementById("iuCalendarViewRoot")?.getAttribute("data-view"))) === "week" ? "PASS" : "FAIL";
    await setView(page, "month");
    results.viewMonth = (await page.evaluate(() => document.getElementById("iuCalendarViewRoot")?.getAttribute("data-view"))) === "month" ? "PASS" : "FAIL";
    await setView(page, "year");
    results.viewYear = (await page.evaluate(() => document.getElementById("iuCalendarViewRoot")?.getAttribute("data-view"))) === "year" ? "PASS" : "FAIL";
    await closeCalendar(page);

    await clsReset(page);
    await page.waitForTimeout(400);
    const m = await snapMetrics(page);
    results.clsGate = m.clsSum === 0 ? "PASS" : "FAIL";
    results.overflowXGate = m.overflowX === false ? "PASS" : "FAIL";
    results.railShiftGate = m.railShift === 0 ? "PASS" : "FAIL";
    results.consoleErrorsGate = consoleErrors.length === 0 ? "PASS" : "FAIL";

    const hooksFinal = await collectStableHookSnapshot(page);
    results.sharedHookStabilityGuard = hooksEqual(hooksBefore, hooksFinal) ? "PASS" : "FAIL";

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/projects/`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForFunction(() => window.iuCalendarService, null, { timeout: 120000 });
    await page.evaluate(() => {
      window.iuCalendarService.openOverlay();
    });
    await page.waitForFunction(() => {
      const o = document.getElementById("iuCalendarOverlay");
      return o && !o.hasAttribute("hidden");
    }, null, { timeout: 20000 });
    for (const v of ["day", "week", "month", "year"]) {
      await setView(page, v);
    }
    results.mobileCalendarViewSwitchGuard = (await page.evaluate(() => document.getElementById("iuCalendarViewRoot")?.getAttribute("data-view"))) === "year" ? "PASS" : "FAIL";
    await closeCalendar(page);

    await browser.close();

    const allKeys = [
      "clsGate",
      "overflowXGate",
      "railShiftGate",
      "consoleErrorsGate",
      "calendarOpenCloseGuard",
      "calendarViewSwitchGuard",
      "calendarNavigationGuard",
      "calendarVisualIntegrityGuard",
      "noHoverFocusShiftGuard",
      "calendarStatePresenceGuard",
      "formIntegrityGuard",
      "noUnexpectedCalendarHeightExplosionGuard",
      "sharedHookStabilityGuard",
      "silverCalendarEntryGuard",
      "noSharedSelectorLeakGuard",
      "mobileCalendarViewSwitchGuard"
    ];
    let allPass = true;
    for (let i = 0; i < allKeys.length; i++) {
      if (results[allKeys[i]] !== "PASS") allPass = false;
    }

    console.log(JSON.stringify({ ALL: allPass ? "PASS" : "FAIL", results, consoleErrorsCount: consoleErrors.length }, null, 2));
    if (allPass) {
      try {
        process.stdout.write("\x07");
      } catch (e) {}
    }
    process.exit(allPass ? 0 : 1);
  } catch (e) {
    console.error(String(e && e.message ? e.message : e));
    process.exit(1);
  } finally {
    server.close();
  }
}

main();
