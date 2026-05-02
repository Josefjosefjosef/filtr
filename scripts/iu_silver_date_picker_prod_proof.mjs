#!/usr/bin/env node
/**
 * PROD_SILVER_DATE_PICKER — Silver „datum“ → nativní <input type="date">, bez mřížky gd-minical.
 *
 * Env: SILVER_PROD_URL (default https://infouzel.cz/projects/)
 *
 * Usage: npm run iu-silver-date-picker-prod-proof
 */
import { chromium } from "playwright";

const URL = (process.env.SILVER_PROD_URL || "https://infouzel.cz/projects/").trim();
const VIEWPORTS = [
  { label: "390x844", width: 390, height: 844 },
  { label: "768x1024", width: 768, height: 1024 },
];

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
  await page.waitForTimeout(250);
}

async function clsReset(page) {
  await page.evaluate(() => {
    window.__iuClsSum = 0;
  });
}

async function clsRead(page) {
  return page.evaluate(() => Number(window.__iuClsSum || 0));
}

async function snapLayout(page) {
  const overflowX = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth + 1;
  });
  const railShift = await page.evaluate(() =>
    typeof window.__iuRailShiftProbe === "number" ? window.__iuRailShiftProbe : 0
  );
  const clsSum = await clsRead(page);
  return { overflowX, railShift, clsSum };
}

async function runViewport(page, vp, consoleErrors, pageErrors) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForFunction(() => window.iuSilverCalendarEngine && window.iuCalendarService, null, { timeout: 60000 });
  await installClsHarness(page);
  await clsReset(page);
  await page.waitForTimeout(400);

  const heroCal = page.locator("#iuHeroQuickCal");
  try {
    await heroCal.scrollIntoViewIfNeeded({ timeout: 8000 });
  } catch (e) {}
  await heroCal.click({ timeout: 15000 });
  await page.waitForSelector('[data-iu-silver-guided="save"]', { state: "visible", timeout: 12000 });
  await page.click('[data-iu-silver-guided="save"]');
  await page.waitForSelector('[data-iu-silver-guided="gd-date"]', { state: "visible", timeout: 12000 });

  await clsReset(page);
  await page.click('[data-iu-silver-guided="gd-date"]');
  await page.waitForTimeout(300);

  const mid = await page.evaluate(() => {
    const picker = document.getElementById("iuSilverDatePicker");
    const gridCount = document.querySelectorAll('[data-iu-silver-guided="gd-minical"]').length;
    const proof = window.__iuSilverDatePickerProof || {};
    return {
      pickerExists: !!picker,
      gridCount,
      proof,
    };
  });

  await page.evaluate(() => {
    const el = document.getElementById("iuSilverDatePicker");
    if (!el) return;
    el.value = "2026-05-15";
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(250);

  const tail = await page.evaluate(() => {
    const inp = document.getElementById("iuSilverHomeInput");
    const proof = window.__iuSilverDatePickerProof || {};
    const v = inp ? String(inp.value || "").trim() : "";
    return { value: v, proof };
  });

  const layout = await snapLayout(page);

  return {
    vp: vp.label,
    mid,
    tail,
    layout,
    consoleErrors: consoleErrors.length,
    pageErrors: pageErrors.length,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const consoleErrors = [];
  const pageErrors = [];
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    pageErrors.push(String(err && err.message ? err.message : err));
  });

  const rounds = [];
  for (const vp of VIEWPORTS) {
    rounds.push(await runViewport(page, vp, consoleErrors, pageErrors));
  }

  await browser.close();

  const last = rounds[rounds.length - 1] || {};
  const lastProof = (last.tail && last.tail.proof) || {};
  const gridRemoved = rounds.every((r) => r.mid.gridCount === 0);
  const pickerOk = rounds.every((r) => r.mid.pickerExists);
  const valueOk = rounds.every((r) => {
    const v = r.tail.value || "";
    return v.indexOf("15.5.") >= 0 && v.indexOf("uložit do kalendáře") >= 0;
  });
  const maxCls = Math.max(...rounds.map((r) => r.layout.clsSum || 0), 0);
  const overflowBad = rounds.some((r) => r.layout.overflowX === true);
  const railBad = rounds.some((r) => Number(r.layout.railShift || 0) !== 0);

  const datePickerOpened = rounds.every((r) => !!(r.mid.proof && r.mid.proof.date_picker_opened));
  const nativePickerUsed = rounds.every((r) => !!(r.mid.proof && r.mid.proof.native_picker_used));
  const dateSelected = rounds.every((r) => !!(r.tail.proof && r.tail.proof.date_selected));
  const inputUpdated = rounds.every((r) => !!(r.tail.proof && r.tail.proof.input_updated));
  const valueExample = lastProof.value_example || (last.tail && last.tail.value) || "";

  const pass =
    datePickerOpened &&
    nativePickerUsed &&
    gridRemoved &&
    pickerOk &&
    dateSelected &&
    inputUpdated &&
    valueOk &&
    maxCls === 0 &&
    !overflowBad &&
    !railBad &&
    consoleErrors.length === 0 &&
    pageErrors.length === 0;

  const lines = [
    "=== PROD_SILVER_DATE_PICKER ===",
    "date_picker_opened: " + String(datePickerOpened),
    "native_picker_used: " + String(nativePickerUsed),
    "grid_removed: " + String(gridRemoved),
    "date_selected: " + String(dateSelected),
    "input_updated: " + String(inputUpdated),
    'value_example: "' + String(valueExample).replace(/"/g, '\\"') + '"',
    "cls: " + String(maxCls),
    "console_errors: " + String(consoleErrors.length),
    "app_errors: " + String(pageErrors.length),
    "=== END ===",
  ];
  process.stdout.write(lines.join("\n") + "\n");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
