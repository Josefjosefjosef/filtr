#!/usr/bin/env node
/**
 * Calendar: pinned all-day block + max 3 all-day events per day.
 * Run: npm run iu-calendar-allday-pinned-limit-guard
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  installLocalDataProtectionAccepted,
} from "./proofs/open_meteo_guard_stub.cjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8906", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const LIMIT_MSG = "Pro jeden den lze uložit maximálně 3 celodenní události.";

function readStaticChecks() {
  const appJs = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const indexHtml = fs.readFileSync(path.join(REPO, "projects", "index.html"), "utf8");
  const appCss = fs.readFileSync(path.join(REPO, "assets", "app.css"), "utf8");
  const checks = [
    { id: "max_per_date", pass: /CAL_ALL_DAY_MAX_PER_DATE\s*=\s*3/.test(appJs) },
    { id: "limit_msg", pass: appJs.includes(LIMIT_MSG) },
    { id: "pinned_block", pass: /renderDayPinnedBlockHTML/.test(appJs) && /data-iu-cal-day-pinned-host/.test(appJs) },
    { id: "can_add_helper", pass: /function canAddAllDayForDate/.test(appJs) },
    { id: "mobile_pinned_host", pass: indexHtml.includes('data-iu-cal-day-pinned-host="1"') },
    { id: "desktop_pinned_host", pass: indexHtml.includes("iuCalendarSidePanelPinned") },
    { id: "css_pinned", pass: appCss.includes(".iu-calendar-day-pinned") },
  ];
  const fails = checks.filter((c) => !c.pass).map((c) => c.id);
  return { pass: fails.length === 0, checks, fails };
}

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

function buildUrl(params) {
  const isLocal = BASE.indexOf("127.0.0.1") >= 0 || BASE.indexOf("localhost") >= 0;
  const p = new URLSearchParams(params || {});
  if (isLocal) p.set("iuRobust", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
}

function todayIso() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

async function testPinnedAndLimit(page) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("iu.calendar.store.v1");
    } catch (_) {}
    try {
      indexedDB.deleteDatabase("iu.calendar.idb");
    } catch (_) {}
  });
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => window.iuCalendarService && typeof window.iuCalendarService.calendarCreateEvent === "function",
    { timeout: 90000 }
  );
  const iso = todayIso();
  const seeded = await page.evaluate(async (dateIso) => {
    const svc = window.iuCalendarService;
    const results = [];
    for (let j = 0; j < 3; j++) {
      results.push(
        await svc.calendarCreateEvent({
          date: dateIso,
          time: "00:00",
          allDay: true,
          title: "Guard AD " + (j + 1),
          note: "",
          address: "",
          type: "personal",
        })
      );
    }
    const allDayCount = svc
      .calendarGetEventsSnapshot()
      .filter((ev) => ev.date === dateIso && ev.allDay).length;
    return { results, allDayCount, dateIso };
  }, iso);
  if (!seeded || seeded.allDayCount !== 3) {
    throw new Error("failed to seed 3 all-day events: " + JSON.stringify(seeded));
  }
  const fourth = await page.evaluate(async (dateIso) => {
    return window.iuCalendarService.calendarCreateEvent({
      date: dateIso,
      time: "00:00",
      allDay: true,
      title: "Guard AD 4",
      note: "",
      address: "",
      type: "personal",
    });
  }, iso);
  if (!fourth || fourth.ok !== false || fourth.reason !== "all_day_limit") {
    throw new Error("fourth all-day event was not rejected: " + JSON.stringify(fourth));
  }
  await page.evaluate(() => {
    window.iuCalendarService.calendarOpenTodayDayView();
  });
  await page.waitForFunction(() => {
    const pinned = document.getElementById("iuCalendarSidePanelPinned");
    const scroll = document.getElementById("iuCalendarSidePanelScroll");
    return !!(pinned && scroll && pinned.querySelector("[data-iu-cal-all-day-section]") && scroll.querySelector("[data-iu-cal-hour-anchor]"));
  }, { timeout: 30000 });
  const pinnedAfterScroll = await page.evaluate(() => {
    const scroll = document.getElementById("iuCalendarSidePanelScroll");
    const pinned = document.getElementById("iuCalendarSidePanelPinned");
    if (!scroll || !pinned) return { ok: false, reason: "hosts missing" };
    scroll.scrollTop = scroll.scrollHeight;
    const section = pinned.querySelector("[data-iu-cal-all-day-section]");
    if (!section) return { ok: false, reason: "all-day section missing in pinned host" };
    const pr = pinned.getBoundingClientRect();
    const sr = section.getBoundingClientRect();
    const scrollStillHasHours = !!scroll.querySelector("[data-iu-cal-hour-anchor=\"15\"]");
    const sectionInPinned = pinned.contains(section);
    const visible = sr.height > 8 && sr.top >= pr.top - 2 && sr.bottom <= pr.bottom + 2;
    return { ok: sectionInPinned && visible && scrollStillHasHours, sectionInPinned, visible, scrollStillHasHours };
  });
  if (!pinnedAfterScroll.ok) {
    throw new Error("pinned all-day block not stable after scroll: " + JSON.stringify(pinnedAfterScroll));
  }
  await page.locator("[data-iu-cal-slot-empty]").first().click({ force: true, timeout: 30000 });
  await page.waitForSelector("[data-iu-cal-inline-root]", { timeout: 30000 });
  await page.evaluate(() => {
    const root = document.querySelector("[data-iu-cal-inline-root]");
    const titleIn = root.querySelector('[data-iu-cal-inline-field="title"]');
    titleIn.value = "Guard AD form 4";
    titleIn.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("[data-iu-cal-inline-all-day]").click({ force: true });
  await page.waitForTimeout(150);
  const toggleOn = await page.evaluate(() => {
    const t = document.querySelector("[data-iu-cal-inline-all-day]");
    return !!(t && t.classList.contains("is-on"));
  });
  if (toggleOn) throw new Error("all-day toggle should stay off at limit");
  const notice = await page.evaluate((msg) => {
    const n = document.querySelector("[data-iu-cal-inline-notice]");
    return n ? String(n.textContent || "").trim() : "";
  }, LIMIT_MSG);
  if (notice !== LIMIT_MSG) throw new Error("limit notice missing in form: " + notice);
  const formKept = await page.evaluate(() => {
    const root = document.querySelector("[data-iu-cal-inline-root]");
    const titleIn = root ? root.querySelector('[data-iu-cal-inline-field="title"]') : null;
    return titleIn ? String(titleIn.value || "") : "";
  });
  if (formKept !== "Guard AD form 4") throw new Error("form title lost after limit rejection");
  return "pinned-and-limit";
}

async function main() {
  const staticResult = readStaticChecks();
  if (!staticResult.pass) {
    console.log(JSON.stringify({ pass: false, static: staticResult, playwright: null }, null, 2));
    process.exit(1);
  }

  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    serverProc = spawn("npx", ["serve", REPO, "-l", String(PORT)], {
      cwd: REPO,
      stdio: "ignore",
      shell: true,
    });
    await waitForPort("127.0.0.1", PORT, 45000);
  }

  const ignorable = createIgnorableResourceTracker();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await installProofGuardNetworkStubs(context, ignorable);
  await installLocalDataProtectionAccepted(context);
  const page = await context.newPage();

  let pwPass = null;
  let pwFail = null;
  try {
    pwPass = await testPinnedAndLimit(page);
  } catch (err) {
    pwFail = err && err.message ? err.message : String(err);
  } finally {
    await browser.close().catch(() => {});
    if (serverProc) serverProc.kill("SIGTERM");
  }

  const pass = !pwFail;
  console.log(
    JSON.stringify(
      {
        pass,
        static: staticResult,
        playwright: pwFail ? { pass: false, error: pwFail } : { pass: true, case: pwPass },
      },
      null,
      2
    )
  );
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
