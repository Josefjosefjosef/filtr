/**
 * Homepage load audit proof (Playwright) — requires iu-home-load-audit.js + ?iuHomeAudit=1.
 *
 * Usage:
 *   node server/projects-static-and-vin.mjs
 *   node scripts/home-load-audit-proof.mjs
 *
 * Env:
 *   HOME_AUDIT_URL (default http://127.0.0.1:8890/projects/?iuHomeAudit=1&section=media)
 */
import { chromium } from "playwright";

const BASE =
  process.env.HOME_AUDIT_URL ||
  "http://127.0.0.1:8890/projects/?iuHomeAudit=1&section=media";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1366, height: 768 },
];

const RUNS = 5;

function stats(arr) {
  const a = arr.filter((x) => typeof x === "number" && Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return { median: null, p95: null, max: null };
  const mid = Math.floor(a.length / 2);
  const median = a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  const p95i = Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1);
  return { median, p95: a[Math.max(0, p95i)], max: a[a.length - 1] };
}

async function oneRun(browser, vw) {
  const page = await browser.newPage({ viewport: { width: vw.width, height: vw.height } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(28000);
  try {
    const hb = await page.$(".iuHamburger");
    if (hb) await hb.click({ timeout: 2000 });
  } catch (e) {}
  await page.waitForTimeout(400);
  const rep = await page.evaluate(() => {
    const r = window.__IU_HOME_LOAD_AUDIT_REPORT__;
    return r || null;
  });
  await page.close();
  if (!rep) {
    return { error: "no __IU_HOME_LOAD_AUDIT_REPORT__", consoleErrorsCount: consoleErrors.length };
  }
  return {
    viewport: vw.name,
    timeToFirstRenderMs: rep.timeToFirstRenderMs,
    timeToFirstCardVisibleMs: rep.timeToFirstCardVisibleMs,
    timeToPreviewTitlesReadyMs: rep.timeToPreviewTitlesReadyMs,
    timeToWeatherReadyMs: rep.timeToWeatherReadyMs,
    timeToHomepageSettledMs: rep.timeToHomepageSettledMs,
    firstSuccessfulClickHandledMs: rep.firstSuccessfulClickHandledMs,
    clickHandledDelayMs: rep.clickHandledDelayMs,
    requestsDuringLoad: rep.requestsDuringLoad,
    domNodeCount: rep.domNodeCount,
    domMutationsFirst10s: rep.domMutationsFirst10s,
    longTaskCount: rep.longTaskCount,
    maxLongTaskMs: rep.maxLongTaskMs,
    totalBlockedMsDuringLoad: rep.totalBlockedMsDuringLoad,
    consoleErrorsCount: rep.consoleErrorsCount + consoleErrors.length,
    appErrorsCount: rep.appErrorsCount,
    cls: rep.cls,
    overflowX: rep.overflowX,
    railShift: rep.railShift,
    responseBytesTotal: rep.responseBytesTotal,
    hookTimestamps: rep.hookTimestamps,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const all = [];
  for (const vw of VIEWPORTS) {
    for (let i = 0; i < RUNS; i++) {
      const row = await oneRun(browser, vw);
      row.run = i + 1;
      all.push(row);
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(row));
    }
  }
  await browser.close();

  const byVp = {};
  for (const vw of VIEWPORTS) {
    byVp[vw.name] = all.filter((r) => r.viewport === vw.name && !r.error);
  }
  const keys = [
    "timeToFirstRenderMs",
    "timeToFirstCardVisibleMs",
    "timeToPreviewTitlesReadyMs",
    "timeToWeatherReadyMs",
    "timeToHomepageSettledMs",
    "firstSuccessfulClickHandledMs",
    "clickHandledDelayMs",
    "requestsDuringLoad",
    "domNodeCount",
    "domMutationsFirst10s",
    "longTaskCount",
    "maxLongTaskMs",
    "totalBlockedMsDuringLoad",
    "consoleErrorsCount",
    "appErrorsCount",
    "cls",
    "responseBytesTotal",
  ];
  const agg = {};
  for (const vw of VIEWPORTS) {
    agg[vw.name] = {};
    const rows = byVp[vw.name];
    for (const k of keys) {
      agg[vw.name][k] = stats(rows.map((r) => r[k]));
    }
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ aggregate: agg, runs: all.length }));
  try {
    process.stdout.write("\x07");
  } catch (e) {}
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
