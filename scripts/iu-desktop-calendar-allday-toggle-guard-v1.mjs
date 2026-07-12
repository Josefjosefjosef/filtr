#!/usr/bin/env node
/**
 * PC calendar: all-day toggle must keep inline event form open (day slot + month add).
 * Run: npm run iu-desktop-calendar-allday-toggle-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-desktop-calendar-allday-toggle-guard
 */
import { createRequire } from "module";
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

const PORT = parseInt(process.env.IU_GUARD_PORT || "8905", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const TOGGLE_CYCLES = parseInt(process.env.IU_CAL_ALLDAY_TOGGLE_CYCLES || "5", 10);

function isProdHost(base) {
  return /infouzel\.cz/i.test(base);
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
  if (isProdHost(BASE)) p.set("nosw", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
}

async function waitForCalendarReady(page) {
  await page.waitForFunction(
    () => window.iuCalendarService && typeof window.iuCalendarService.openOverlay === "function",
    { timeout: 90000 }
  );
}

async function openCalendarOverlay(page) {
  await waitForCalendarReady(page);
  await page.evaluate(() => {
    if (window.iuCalendarService && typeof window.iuCalendarService.openOverlay === "function") {
      window.iuCalendarService.openOverlay();
    }
  });
  await page.waitForFunction(() => {
    const ov = document.getElementById("iuCalendarOverlay");
    return !!(ov && !ov.hidden && ov.getAttribute("aria-hidden") !== "true");
  }, { timeout: 30000 });
  await page.waitForTimeout(400);
}

async function fillInlineTestFields(page, title, address) {
  await page.evaluate(
    ({ titleVal, addressVal }) => {
      const root = document.querySelector("[data-iu-cal-inline-root]");
      if (!root) throw new Error("inline root missing");
      const titleIn = root.querySelector('[data-iu-cal-inline-field="title"]');
      const addressIn = root.querySelector('[data-iu-cal-inline-field="address"]');
      if (!titleIn || !addressIn) throw new Error("inline fields missing");
      titleIn.value = titleVal;
      addressIn.value = addressVal;
      titleIn.dispatchEvent(new Event("input", { bubbles: true }));
      addressIn.dispatchEvent(new Event("input", { bubbles: true }));
    },
    { titleVal: title, addressVal: address }
  );
  await page.waitForTimeout(150);
}

async function readInlineFormState(page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-iu-cal-inline-root]");
    const title = root ? root.querySelector('[data-iu-cal-inline-field="title"]') : null;
    const address = root ? root.querySelector('[data-iu-cal-inline-field="address"]') : null;
    const toggle = root ? root.querySelector("[data-iu-cal-inline-all-day]") : null;
    const sideOpen = !!(document.getElementById("iuCalendarSidePanelScroll") && document.getElementById("iuCalendarSidePanelScroll").innerHTML.trim());
    return {
      hasRoot: !!root,
      title: title ? String(title.value || "") : "",
      address: address ? String(address.value || "") : "",
      allDayOn: !!(toggle && toggle.classList.contains("is-on")),
      sideOpen,
    };
  });
}

async function testDaySlotAllDayToggle(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await openCalendarOverlay(page);
  await page.evaluate(() => {
    if (window.iuCalendarService && typeof window.iuCalendarService.calendarOpenTodayDayView === "function") {
      window.iuCalendarService.calendarOpenTodayDayView();
    }
  });
  await page.waitForFunction(() => {
    const scroll = document.getElementById("iuCalendarSidePanelScroll");
    return !!(scroll && scroll.querySelector("[data-iu-cal-slot-empty]"));
  }, { timeout: 30000 });
  const slot = page.locator("[data-iu-cal-slot-empty]").first();
  await slot.click({ force: true, timeout: 30000 });
  await page.waitForSelector("[data-iu-cal-inline-root]", { timeout: 30000 });
  await fillInlineTestFields(page, "Test celodenni A", "Praha 1");
  for (let i = 0; i < TOGGLE_CYCLES; i++) {
    await page.locator("[data-iu-cal-inline-all-day]").click({ force: true, timeout: 10000 });
    await page.waitForTimeout(120);
    const st = await readInlineFormState(page);
    if (!st.hasRoot) throw new Error(`day-slot cycle ${i + 1}: inline form disappeared`);
    if (!st.sideOpen) throw new Error(`day-slot cycle ${i + 1}: side panel empty`);
    if (st.title !== "Test celodenni A") throw new Error(`day-slot cycle ${i + 1}: title lost (${st.title})`);
    if (st.address !== "Praha 1") throw new Error(`day-slot cycle ${i + 1}: address lost (${st.address})`);
  }
  const final = await readInlineFormState(page);
  if (!final.allDayOn) {
    await page.locator("[data-iu-cal-inline-all-day]").click({ force: true });
    await page.waitForTimeout(120);
  }
  await page.locator("[data-iu-cal-inline-save]").click({ force: true, timeout: 10000 });
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => {
    const chips = document.querySelectorAll("[data-iu-cal-all-day-section] .iu-calAllDayChip, [data-iu-cal-all-day-draft] + .iu-calAllDaySection .iu-calAllDayChip");
    let found = false;
    document.querySelectorAll(".iu-calAllDayChip__title, [data-iu-cal-ev-wrap] .iu-calEvCard__title").forEach((el) => {
      if (String(el.textContent || "").trim() === "Test celodenni A") found = true;
    });
    return { found, inlineGone: !document.querySelector("[data-iu-cal-inline-root]") };
  });
  if (!saved.found) throw new Error("day-slot: saved all-day event not visible");
  return "day-slot";
}

async function testMonthFabAllDayToggle(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await openCalendarOverlay(page);
  await page.evaluate(() => {
    const btn = document.querySelector('#iuCalendarOverlay [data-iu-cal-view="month"]');
    if (btn && typeof btn.click === "function") btn.click();
  });
  await page.waitForFunction(() => {
    const bar = document.getElementById("iuCalMonthActionBar");
    const fab = bar ? bar.querySelector("[data-iu-cal-month-fab]") : null;
    return !!(bar && !bar.hidden && fab && !fab.hidden);
  }, { timeout: 30000 });
  await page.locator("#iuCalMonthActionBar [data-iu-cal-month-fab]").click({ force: true, timeout: 10000 });
  await page.waitForSelector("[data-iu-cal-inline-root]", { timeout: 30000 });
  await fillInlineTestFields(page, "Test celodenni B", "Brno 2");
  for (let i = 0; i < TOGGLE_CYCLES; i++) {
    await page.locator("[data-iu-cal-inline-all-day]").click({ force: true, timeout: 10000 });
    await page.waitForTimeout(120);
    const st = await readInlineFormState(page);
    if (!st.hasRoot) throw new Error(`month-fab cycle ${i + 1}: inline form disappeared`);
    if (!st.sideOpen) throw new Error(`month-fab cycle ${i + 1}: side panel empty`);
    if (st.title !== "Test celodenni B") throw new Error(`month-fab cycle ${i + 1}: title lost (${st.title})`);
    if (st.address !== "Brno 2") throw new Error(`month-fab cycle ${i + 1}: address lost (${st.address})`);
  }
  return "month-fab";
}

async function main() {
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

  const passes = [];
  const failures = [];

  try {
    try {
      passes.push(await testDaySlotAllDayToggle(page));
    } catch (err) {
      failures.push(`day-slot: ${err && err.message ? err.message : String(err)}`);
    }
    try {
      passes.push(await testMonthFabAllDayToggle(page));
    } catch (err) {
      failures.push(`month-fab: ${err && err.message ? err.message : String(err)}`);
    }
  } finally {
    await browser.close().catch(() => {});
    if (serverProc) serverProc.kill("SIGTERM");
  }

  console.log(
    JSON.stringify(
      {
        pass: failures.length === 0,
        base: BASE,
        toggleCycles: TOGGLE_CYCLES,
        passes,
        failures,
      },
      null,
      2
    )
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
