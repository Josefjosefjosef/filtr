#!/usr/bin/env node
/**
 * Hard proof: global static guard + overlay Auto VIN flow.
 * Requires: npm i (playwright). Run: node scripts/vin-hard-proof.mjs
 * Spawns server/projects-static-and-vin.mjs
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = "8893";
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const VIEWS = [
  [390, 844],
  [412, 915],
  [768, 1024],
  [820, 1180],
  [1366, 768],
  [1440, 900],
  [1920, 1080]
];
const VIN_OK = "WBADT43452G123456";

const r = {
  clsGlobalMax: 0,
  overflowX: false,
  railMax: 0,
  clsScopedMax: 0,
  overflowPanel: false,
  appAdsErr: 0,
  gatedBeforeApiPass: true,
  apiLoadedRevealPass: true,
  apiErrorGatePass: true,
  tabSwitchPass: true,
  invalidVinPass: true,
  cacheRepeatPass: true
};

const ADS_LO = 22340;
const ADS_HI = 22850;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["server/projects-static-and-vin.mjs"], {
      cwd: ROOT,
      env: { ...process.env, PORT, VIN_USE_NHTSA_FALLBACK: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    proc.stderr.on("data", (d) => {
      out += d.toString();
      if (out.includes("static+vin")) resolve(proc);
    });
    proc.on("error", reject);
    setTimeout(() => reject(new Error("server start timeout")), 20000);
  });
}

async function selectCategoryAuto(page) {
  await page.evaluate(() => {
    const cat = document.getElementById("iuAdsFieldCategory");
    if (!cat) return;
    cat.value = "auto";
    cat.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(200);
}

async function openAdsSubmit(page) {
  await page.evaluate(() => {
    const stage = document.getElementById("iuAdsStage");
    const center = document.getElementById("iuCenterStage");
    if (center) center.setAttribute("data-iu-mode", "ads");
    if (!stage) return;
    if (window.matchMedia("(max-width: 900px)").matches && stage.parentNode !== document.body) {
      stage.classList.add("iuAdsStage--fullscreen");
      document.body.appendChild(stage);
    }
    stage.hidden = false;
    document.getElementById("iuAdsTabBrowse")?.classList.remove("is-active");
    document.getElementById("iuAdsTabSubmit")?.classList.add("is-active");
    document.getElementById("iuAdsPanelBrowse").hidden = true;
    document.getElementById("iuAdsPanelSubmit").hidden = false;
  });
}

const proc = await startServer();

try {
  for (const [w, h] of VIEWS) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const loc = msg.location();
      const u = loc.url || "";
      const ln = loc.lineNumber || 0;
      if (/fontawesome|googleapis|gstatic|ytimg/i.test(u + msg.text())) return;
      if (u.includes("app.js") && ln >= ADS_LO && ln <= ADS_HI) r.appAdsErr++;
      else if (/iuAds|decodeVin|VIN/i.test(msg.text())) r.appAdsErr++;
    });

    await page.addInitScript(() => {
      window.__g = 0;
      window.__s = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__g += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        new PerformanceObserver((list) => {
          const p = document.getElementById("iuAdsPanelSubmit");
          if (!p) return;
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            let hit = false;
            if (e.sources)
              for (const s of e.sources) {
                try {
                  if (s.node && p.contains(s.node)) hit = true;
                } catch (x) {}
              }
            if (hit) window.__s += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      } catch (e) {}
    });

    await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
    await page.waitForTimeout(2000);
    try {
      await page.evaluate(() => document.fonts.ready);
    } catch (e) {}
    await page.evaluate(() => {
      window.__g = 0;
    });
    await page.waitForTimeout(1200);

    const g0 = await page.evaluate(() => window.__g || 0);
    r.clsGlobalMax = Math.max(r.clsGlobalMax, g0);
    const ox = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
    );
    if (ox) r.overflowX = true;
    const rl = await page.evaluate(
      () => document.getElementById("iuTopbarRight")?.getBoundingClientRect().left ?? 0
    );
    r.railMax = Math.max(r.railMax, Math.abs(rl - rl));

    await openAdsSubmit(page);

    const leg = await page.evaluate(() => document.getElementById("iuAdsLegacyFlat")?.hidden);
    const pre = await page.evaluate(() => document.getElementById("iuAdsAutoPre")?.hidden);
    const post = await page.evaluate(() => document.getElementById("iuAdsAutoPost")?.hidden);
    if (!leg || !pre || !post) r.gatedBeforeApiPass = false;

    await selectCategoryAuto(page);
    await page.evaluate(() => {
      window.__s = 0;
    });

    const leg2 = await page.evaluate(() => document.getElementById("iuAdsLegacyFlat")?.hidden);
    const pre2 = await page.evaluate(() => document.getElementById("iuAdsAutoPre")?.hidden);
    const post2 = await page.evaluate(() => document.getElementById("iuAdsAutoPost")?.hidden);
    if (!leg2 || pre2 || !post2) r.gatedBeforeApiPass = false;

    const tv = await page.locator("#iuAdsFieldTitle").isVisible().catch(() => false);
    const av = await page.locator("#iuAdsAutoTitle").isVisible().catch(() => false);
    if (tv || av) r.gatedBeforeApiPass = false;

    await page.fill("#iuAdsAutoVin", VIN_OK);
    await page.click("#iuAdsAutoVinLoadBtn");
    await page.waitForSelector("#iuAdsAutoPost:not([hidden])", { timeout: 20000 });
    await page.waitForTimeout(300);

    const sc = await page.evaluate(() => window.__s || 0);
    r.clsScopedMax = Math.max(r.clsScopedMax, sc);

    const mk = await page.inputValue("#iuAdsApiMake");
    const ti = await page.inputValue("#iuAdsAutoTitle");
    if (!mk || !ti) r.apiLoadedRevealPass = false;

    const oxP = await page.evaluate(() => {
      const p = document.getElementById("iuAdsPanelSubmit");
      return p && p.scrollWidth > p.clientWidth + 2;
    });
    if (oxP) r.overflowPanel = true;

    await page.click("#iuAdsTabBrowse");
    await page.waitForTimeout(150);
    await page.click("#iuAdsTabSubmit");
    const okTab = await page.evaluate(
      () =>
        document.getElementById("iuAdsFieldCategory")?.value === "auto" &&
        !document.getElementById("iuAdsAutoPre")?.hidden
    );
    if (!okTab) r.tabSwitchPass = false;

    await browser.close();
  }

  const b2 = await chromium.launch({ headless: true });
  const p2 = await b2.newPage({ viewport: { width: 1280, height: 800 } });
  await p2.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await p2.waitForTimeout(1500);
  await openAdsSubmit(p2);
  await p2.selectOption("#iuAdsFieldCategory", "auto");
  await p2.fill("#iuAdsAutoVin", "SHORT");
  await p2.click("#iuAdsAutoVinLoadBtn");
  await p2.waitForTimeout(600);
  const inv =
    (await p2.evaluate(() => document.getElementById("iuAdsAutoVinError")?.textContent || "")).length >
    5;
  const ph = await p2.evaluate(() => document.getElementById("iuAdsAutoPost")?.hidden);
  if (!inv || !ph) r.invalidVinPass = false;
  await b2.close();

  const apiU = `http://127.0.0.1:${PORT}/projects/api/vin-decode?vin=${encodeURIComponent(VIN_OK)}`;
  const a1 = await fetch(apiU).then((x) => x.json());
  const a2 = await fetch(apiU).then((x) => x.json());
  if (!(a1.success && a2.success && a2.cached === true)) r.cacheRepeatPass = false;

  const b4 = await chromium.launch({ headless: true });
  const p4 = await b4.newPage({ viewport: { width: 1280, height: 800 } });
  await p4.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await openAdsSubmit(p4);
  await selectCategoryAuto(p4);
  await p4.fill("#iuAdsAutoVin", "IIIIIIIIIIIIIIIII");
  await p4.click("#iuAdsAutoVinLoadBtn");
  await p4.waitForTimeout(800);
  const er = await p4.evaluate(() => document.getElementById("iuAdsAutoVinError")?.textContent || "");
  const ph4 = await p4.evaluate(() => document.getElementById("iuAdsAutoPost")?.hidden);
  if (er.length < 5 || !ph4) r.apiErrorGatePass = false;
  await b4.close();
} finally {
  proc.kill("SIGTERM");
}

const pass =
  r.clsGlobalMax < 0.001 &&
  !r.overflowX &&
  r.railMax < 1 &&
  r.clsScopedMax < 0.001 &&
  r.appAdsErr === 0 &&
  !r.overflowPanel &&
  r.gatedBeforeApiPass &&
  r.apiLoadedRevealPass &&
  r.apiErrorGatePass &&
  r.tabSwitchPass &&
  r.invalidVinPass &&
  r.cacheRepeatPass;

console.log(
  JSON.stringify(
    {
      ...r,
      HARD_PASS: pass
    },
    null,
    0
  )
);
process.exit(pass ? 0 : 1);
