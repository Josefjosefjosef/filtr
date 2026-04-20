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

const ALL_VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1366, height: 768 },
];
const VP_FILTER = (process.env.HOME_AUDIT_VIEWPORT || "").trim().toLowerCase();
const VIEWPORTS = VP_FILTER
  ? ALL_VIEWPORTS.filter((v) => v.name === VP_FILTER)
  : ALL_VIEWPORTS;
if (!VIEWPORTS.length) {
  console.error("HOME_AUDIT_VIEWPORT must match one of: mobile, tablet, desktop");
  process.exit(1);
}

const RUNS = Math.max(1, parseInt(process.env.HOME_AUDIT_RUNS || "5", 10));

function stats(arr) {
  const a = arr.filter((x) => typeof x === "number" && Number.isFinite(x)).slice().sort((x, y) => x - y);
  if (!a.length) return { median: null, p95: null, max: null };
  const mid = Math.floor(a.length / 2);
  const median = a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  const p95i = Math.min(a.length - 1, Math.ceil(a.length * 0.95) - 1);
  return { median, p95: a[Math.max(0, p95i)], max: a[a.length - 1] };
}

function auditPick(rep) {
  if (!rep) return null;
  return {
    navigationType: rep.navigationType,
    timeToFirstRenderMs: rep.timeToFirstRenderMs,
    timeToFirstCardVisibleMs: rep.timeToFirstCardVisibleMs,
    timeToPreviewTitlesReadyMs: rep.timeToPreviewTitlesReadyMs,
    timeToWeatherReadyMs: rep.timeToWeatherReadyMs,
    timeToHomepageSettledMs: rep.timeToHomepageSettledMs,
    firstShellVisibleMs: rep.firstShellVisibleMs,
    firstUsableMs: rep.firstUsableMs,
    firstRightRailVisibleMs: rep.firstRightRailVisibleMs,
    firstViewportStableMs: rep.firstViewportStableMs,
    firstSuccessfulClickHandledMs: rep.firstSuccessfulClickHandledMs,
    clickHandledDelayMs: rep.clickHandledDelayMs,
    requestsDuringLoad: rep.requestsDuringLoad,
    domNodeCount: rep.domNodeCount,
    domMutationsFirst10s: rep.domMutationsFirst10s,
    longTaskCount: rep.longTaskCount,
    maxLongTaskMs: rep.maxLongTaskMs,
    totalBlockedMsDuringLoad: rep.totalBlockedMsDuringLoad,
    consoleErrorsCount: rep.consoleErrorsCount,
    appErrorsCount: rep.appErrorsCount,
    cls: rep.cls,
    overflowX: rep.overflowX,
    railShift: rep.railShift,
    responseBytesTotal: rep.responseBytesTotal,
    hookTimestamps: rep.hookTimestamps,
  };
}

async function oneRun(browser, vw) {
  const page = await browser.newPage({ viewport: { width: vw.width, height: vw.height } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  try {
    await page.route("**/sw.js", (route) => route.abort());
  } catch (e) {}
  await page.addInitScript(() => {
    window.__IU_HOME_LOAD_AUDIT__ = true;
  });
  await page.setExtraHTTPHeaders({ "Cache-Control": "no-cache" });
  await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(24000);
  let repCold = await page.evaluate(() => window.__IU_HOME_LOAD_AUDIT_REPORT__ || null);
  try {
    const hb = await page.$(".iuHamburger");
    if (hb) await hb.click({ timeout: 2000 });
  } catch (e) {}
  await page.waitForTimeout(400);
  repCold = await page.evaluate(() => window.__IU_HOME_LOAD_AUDIT_REPORT__ || null);

  await page.reload({ waitUntil: "load", timeout: 120000 });
  await page.waitForTimeout(18000);
  const repReload = await page.evaluate(() => window.__IU_HOME_LOAD_AUDIT_REPORT__ || null);

  const fixProbe = await page.evaluate(() => ({
    retentionDeferred: typeof window.__iuSilverRetentionDeferredScheduled !== "undefined" ? window.__iuSilverRetentionDeferredScheduled : null,
  }));
  const dbg =
    repCold == null
      ? await page.evaluate(() => ({
          flag: window.__IU_HOME_LOAD_AUDIT__,
          href: location.href,
          pathname: location.pathname,
          auditScripts: Array.from(document.querySelectorAll("script[src]"))
            .map((s) => s.getAttribute("src"))
            .filter((x) => x && x.indexOf("iu-home-load-audit") !== -1),
        }))
      : null;
  await page.close();
  if (!repCold) {
    return {
      error: "no __IU_HOME_LOAD_AUDIT_REPORT__ (cold)",
      consoleErrorsCount: consoleErrors.length,
      debug: dbg,
    };
  }
  const cold = auditPick(repCold);
  const reload = auditPick(repReload);
  const consErr = Math.max(cold.consoleErrorsCount || 0, reload ? reload.consoleErrorsCount || 0 : 0);
  const pwCons = consoleErrors.length;
  return {
    viewport: vw.name,
    timeToFirstRenderMs: cold.timeToFirstRenderMs,
    timeToFirstCardVisibleMs: cold.timeToFirstCardVisibleMs,
    timeToPreviewTitlesReadyMs: cold.timeToPreviewTitlesReadyMs,
    timeToWeatherReadyMs: cold.timeToWeatherReadyMs,
    timeToHomepageSettledMs: cold.timeToHomepageSettledMs,
    firstShellVisibleMs: cold.firstShellVisibleMs,
    firstUsableMs: cold.firstUsableMs,
    firstRightRailVisibleMs: cold.firstRightRailVisibleMs,
    firstViewportStableMs: cold.firstViewportStableMs,
    firstSuccessfulClickHandledMs: cold.firstSuccessfulClickHandledMs,
    clickHandledDelayMs: cold.clickHandledDelayMs,
    requestsDuringLoad: cold.requestsDuringLoad,
    domNodeCount: cold.domNodeCount,
    domMutationsFirst10s: cold.domMutationsFirst10s,
    longTaskCount: cold.longTaskCount,
    maxLongTaskMs: cold.maxLongTaskMs,
    totalBlockedMsDuringLoad: cold.totalBlockedMsDuringLoad,
    consoleErrorsCount: consErr,
    playwrightConsoleErrorsCount: pwCons,
    appErrorsCount: (cold.appErrorsCount || 0) + (reload ? reload.appErrorsCount || 0 : 0),
    cls: Math.max(cold.cls || 0, reload ? reload.cls || 0 : 0),
    overflowX: cold.overflowX === true || (reload && reload.overflowX === true),
    railShift: Math.max(cold.railShift || 0, reload ? reload.railShift || 0 : 0),
    responseBytesTotal: cold.responseBytesTotal,
    hookTimestamps: cold.hookTimestamps,
    reloadFirstShellVisibleMs: reload ? reload.firstShellVisibleMs : null,
    reloadFirstUsableMs: reload ? reload.firstUsableMs : null,
    reloadFirstRightRailVisibleMs: reload ? reload.firstRightRailVisibleMs : null,
    reloadFirstViewportStableMs: reload ? reload.firstViewportStableMs : null,
    reloadTimeToFirstCardVisibleMs: reload ? reload.timeToFirstCardVisibleMs : null,
    reloadNavigationType: reload ? reload.navigationType : null,
    fixProbe,
    coldAudit: cold,
    reloadAudit: reload,
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
    "firstShellVisibleMs",
    "firstUsableMs",
    "firstRightRailVisibleMs",
    "firstViewportStableMs",
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
    "reloadFirstShellVisibleMs",
    "reloadFirstUsableMs",
    "reloadFirstRightRailVisibleMs",
    "reloadFirstViewportStableMs",
    "reloadTimeToFirstCardVisibleMs",
  ];
  const agg = {};
  for (const vw of VIEWPORTS) {
    agg[vw.name] = {};
    const rows = byVp[vw.name];
    for (const k of keys) {
      agg[vw.name][k] = stats(rows.map((r) => r[k]));
    }
  }
  console.log(JSON.stringify({ aggregate: agg, runs: all.length }));
  try {
    process.stdout.write("\x07");
  } catch (e) {}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
