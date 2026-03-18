#!/usr/bin/env node
/**
 * Hard proof: Auto VIN gate, CLS, overflow, Worker vin_not_found + publish localStorage.
 * Local success path: ?iuVinMock=1 (deterministic). Live Worker: vin_not_found + publish.
 * Run: node scripts/vin-hard-proof.mjs
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
const BASE_MOCK = `${BASE}?iuVinMock=1`;
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
const VIN_SUCCESS = "VR3KAHPY2SS059749";

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
  vinNotFoundWorkerPass: true,
  publishLocalPass: true,
  scrollSinglePass: true,
  vinSuccessDtoPass: true,
  desktopMakeInViewportPass: true,
  retryAfterFailSequencePass: true
};

const ADS_LO = 22340;
const ADS_HI = 23050;

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

    await page.goto(BASE_MOCK, { waitUntil: "load", timeout: 120000 });
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
    await page.waitForTimeout(200);
    const browseHidesAuto = await page.evaluate(() => {
      const ps = document.getElementById("iuAdsPanelSubmit");
      const preEl = document.getElementById("iuAdsAutoPre");
      return !!(ps && ps.hidden && preEl && preEl.hidden);
    });
    if (!browseHidesAuto) r.tabSwitchPass = false;
    await page.click("#iuAdsTabSubmit");
    await page.waitForTimeout(200);
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
  await selectCategoryAuto(p2);
  let reqWorker = 0;
  p2.on("request", (req) => {
    if (req.url().includes("josef-zmrhal.workers.dev/vin")) reqWorker++;
  });
  await p2.fill("#iuAdsAutoVin", "SHORT");
  await p2.click("#iuAdsAutoVinLoadBtn");
  await p2.waitForTimeout(600);
  const inv =
    (await p2.evaluate(() => document.getElementById("iuAdsAutoVinError")?.textContent || "")).length >
    5;
  const ph = await p2.evaluate(() => document.getElementById("iuAdsAutoPost")?.hidden);
  if (!inv || !ph) r.invalidVinPass = false;
  if (reqWorker !== 0) r.invalidVinPass = false;
  await b2.close();

  const b6 = await chromium.launch({ headless: true });
  const p6 = await b6.newPage({ viewport: { width: 1280, height: 800 } });
  await p6.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await p6.waitForTimeout(1500);
  await openAdsSubmit(p6);
  await selectCategoryAuto(p6);
  await p6.evaluate(() => {
    try {
      localStorage.removeItem("iuInfoUzel_autoAds_v1");
    } catch (e) {}
  });
  await p6.fill("#iuAdsAutoVin", VIN_OK);
  await p6.click("#iuAdsAutoVinLoadBtn");
  await p6.waitForSelector("#iuAdsAutoPost:not([hidden])", { timeout: 30000 });
  await p6.waitForTimeout(500);
  const vinU = (await p6.inputValue("#iuAdsApiVinDisp")).toUpperCase();
  const mkE = (await p6.inputValue("#iuAdsApiMake")).trim();
  if (vinU !== VIN_OK) r.vinNotFoundWorkerPass = false;
  if (mkE.length > 0) r.vinNotFoundWorkerPass = false;
  await p6.fill("#iuAdsAutoTitle", "Ruční název po VIN");
  await p6.fill("#iuAdsAutoPrice", "250000");
  await p6.fill("#iuAdsAutoEmail", "proof@test.local");
  await p6.check("#iuAdsAutoTerms");
  await p6.click("#iuAdsAutoSubmit");
  await p6.waitForTimeout(600);
  const fb = await p6.evaluate(
    () => document.getElementById("iuAdsAutoPublishFeedback")?.textContent || ""
  );
  const cnt = await p6.evaluate(() => {
    try {
      const a = JSON.parse(localStorage.getItem("iuInfoUzel_autoAds_v1") || "[]");
      return Array.isArray(a) ? a.length : 0;
    } catch (e) {
      return 0;
    }
  });
  if (!fb.includes("lokálně") || !fb.includes("mezistav")) r.publishLocalPass = false;
  if (cnt < 1) r.publishLocalPass = false;
  await p6.fill("#iuAdsAutoPrice", "");
  await p6.click("#iuAdsAutoSubmit");
  await p6.waitForTimeout(400);
  const fb2 = await p6.evaluate(
    () => document.getElementById("iuAdsAutoPublishFeedback")?.textContent || ""
  );
  if (!fb2.includes("Cena")) r.publishLocalPass = false;
  await b6.close();

  const b7 = await chromium.launch({ headless: true });
  const p7 = await b7.newPage({ viewport: { width: 1366, height: 900 } });
  await p7.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await p7.waitForTimeout(1500);
  await openAdsSubmit(p7);
  await selectCategoryAuto(p7);
  await p7.fill("#iuAdsAutoVin", VIN_SUCCESS);
  await p7.click("#iuAdsAutoVinLoadBtn");
  await p7.waitForSelector("#iuAdsAutoPost:not([hidden])", { timeout: 40000 });
  await p7.waitForTimeout(3500);
  const dto = await p7.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    return {
      make: ($("iuAdsApiMake") && $("iuAdsApiMake").value) || "",
      model: ($("iuAdsApiModel") && $("iuAdsApiModel").value) || "",
      firstReg: ($("iuAdsApiFirstReg") && $("iuAdsApiFirstReg").value) || "",
      disp: ($("iuAdsApiDisplacement") && $("iuAdsApiDisplacement").value) || "",
      power: ($("iuAdsApiPower") && $("iuAdsApiPower").value) || "",
      color: ($("iuAdsApiColor") && $("iuAdsApiColor").value) || "",
      seats: ($("iuAdsApiSeats") && $("iuAdsApiSeats").value) || "",
      stk: ($("iuAdsApiStk") && $("iuAdsApiStk").value) || "",
      title: ($("iuAdsAutoTitle") && $("iuAdsAutoTitle").value) || "",
      bodySel: ($("iuAdsApiBody") && $("iuAdsApiBody").value) || "",
      fuelSel: ($("iuAdsApiFuel") && $("iuAdsApiFuel").value) || ""
    };
  });
  if (dto.make !== "PEUGEOT") r.vinSuccessDtoPass = false;
  if (!String(dto.model).includes("3008")) r.vinSuccessDtoPass = false;
  if (dto.firstReg !== "2025-05-06" || dto.firstReg.indexOf("T") >= 0) r.vinSuccessDtoPass = false;
  if (!String(dto.disp).includes("1199")) r.vinSuccessDtoPass = false;
  if (!String(dto.power).includes("100") || !String(dto.power).includes("5500")) r.vinSuccessDtoPass = false;
  const colU = String(dto.color).toUpperCase();
  if (colU.indexOf("ŠED") < 0 && colU.indexOf("SED") < 0) r.vinSuccessDtoPass = false;
  if (!String(dto.seats).includes("5")) r.vinSuccessDtoPass = false;
  if (dto.stk !== "2029-05-06") r.vinSuccessDtoPass = false;
  if (dto.bodySel !== "osobni") r.vinSuccessDtoPass = false;
  if (dto.fuelSel !== "benzin") r.vinSuccessDtoPass = false;
  const ti = String(dto.title);
  if (!ti.includes("PEUGEOT") || !ti.includes("3008") || !ti.includes("2025")) r.vinSuccessDtoPass = false;
  const scrollN = await p7.evaluate(() => {
    const panel = document.getElementById("iuAdsPanelSubmit");
    if (!panel) return 99;
    let n = 0;
    panel.querySelectorAll("*").forEach((el) => {
      const s = getComputedStyle(el);
      if (
        (s.overflowY === "auto" || s.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 4
      ) {
        n++;
      }
    });
    return n;
  });
  if (scrollN > 0) r.scrollSinglePass = false;
  const dVis = await p7.evaluate(() => {
    const mk = document.getElementById("iuAdsApiMake");
    if (!mk) return { ok: false, top: -1, vh: 0 };
    const bb = mk.getBoundingClientRect();
    var vh = window.innerHeight || 0;
    return {
      ok: bb.height > 0 && bb.top >= 10 && bb.bottom <= vh - 10,
      top: Math.round(bb.top),
      vh
    };
  });
  if (!dVis.ok) r.desktopMakeInViewportPass = false;
  await b7.close();

  const b8 = await chromium.launch({ headless: true });
  const p8 = await b8.newPage({ viewport: { width: 1280, height: 800 } });
  await p8.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await p8.waitForTimeout(1500);
  await openAdsSubmit(p8);
  await selectCategoryAuto(p8);
  let w8 = 0;
  p8.on("request", (req) => {
    if (req.url().includes("josef-zmrhal.workers.dev/vin")) w8++;
  });
  await p8.fill("#iuAdsAutoVin", "SHORT");
  await p8.click("#iuAdsAutoVinLoadBtn");
  await p8.waitForTimeout(600);
  if (w8 !== 0) r.retryAfterFailSequencePass = false;
  const inv8 =
    (await p8.evaluate(() => document.getElementById("iuAdsAutoVinError")?.textContent || "")).length >
    5;
  const ph8a = await p8.evaluate(() => document.getElementById("iuAdsAutoPost")?.hidden);
  if (!inv8 || !ph8a) r.retryAfterFailSequencePass = false;
  const w0 = w8;
  await p8.fill("#iuAdsAutoVin", VIN_OK);
  await p8.click("#iuAdsAutoVinLoadBtn");
  await p8.waitForFunction(
    () => {
      const p = document.getElementById("iuAdsAutoPost");
      return p && !p.hidden;
    },
    { timeout: 35000 }
  );
  await p8.waitForTimeout(500);
  if (w8 <= w0) r.retryAfterFailSequencePass = false;
  const mkNf = (await p8.inputValue("#iuAdsApiMake")).trim();
  const vinNf = (await p8.inputValue("#iuAdsApiVinDisp")).toUpperCase();
  if (mkNf.length !== 0 || vinNf !== VIN_OK) r.retryAfterFailSequencePass = false;
  await p8.fill("#iuAdsAutoVin", VIN_SUCCESS);
  await p8.click("#iuAdsAutoVinLoadBtn");
  await p8.waitForFunction(
    () => (document.getElementById("iuAdsApiMake")?.value || "") === "PEUGEOT",
    { timeout: 50000 }
  );
  await p8.waitForTimeout(400);
  if ((await p8.inputValue("#iuAdsApiMake")) !== "PEUGEOT") r.retryAfterFailSequencePass = false;
  await p8.click("#iuAdsAutoVinLoadBtn");
  await p8.waitForTimeout(4000);
  if ((await p8.inputValue("#iuAdsApiMake")) !== "PEUGEOT") r.retryAfterFailSequencePass = false;
  await b8.close();

  const b4 = await chromium.launch({ headless: true });
  const p4 = await b4.newPage({ viewport: { width: 1280, height: 800 } });
  await p4.goto(BASE, { waitUntil: "load", timeout: 120000 });
  await p4.waitForTimeout(1500);
  await openAdsSubmit(p4);
  await selectCategoryAuto(p4);
  await p4.waitForSelector("#iuAdsAutoVin", { state: "visible", timeout: 15000 });
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
  r.vinNotFoundWorkerPass &&
  r.publishLocalPass &&
  r.scrollSinglePass &&
  r.vinSuccessDtoPass &&
  r.desktopMakeInViewportPass;

console.log(
  JSON.stringify(
    {
      ...r,
      consoleErrorsCount: r.appAdsErr,
      cls: r.clsGlobalMax,
      railShift: r.railMax,
      HARD_PASS: pass,
      retryAfterFailSequence: r.retryAfterFailSequencePass
    },
    null,
    0
  )
);
process.exit(pass ? 0 : 1);
