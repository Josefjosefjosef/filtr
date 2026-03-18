#!/usr/bin/env node
/**
 * VIN UX: loading button, duplicate block, error copy, sequence + regression.
 * Run: node scripts/vin-ux-proof.mjs
 */
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = "8896";
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const VIN_OK = "WBADT43452G123456";
const VIN_SUCCESS = "VR3KAHPY2SS059749";
const VIEWS = [
  [390, 844],
  [1366, 768],
  [1920, 1080]
];

const r = {
  uxSuccess: false,
  uxInvalid: false,
  uxNotFound: false,
  uxNetwork: false,
  uxDuplicate: false,
  sequence: false,
  clsGlobalMax: 0,
  overflowX: false,
  railMax: 0,
  appAdsErr: 0
};

const ADS_LO = 22340;
const ADS_HI = 23350;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ["server/projects-static-and-vin.mjs"], {
      cwd: ROOT,
      env: { ...process.env, PORT },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    proc.stderr.on("data", (d) => {
      out += d.toString();
      if (out.includes("static+vin")) resolve(proc);
    });
    proc.on("error", reject);
    setTimeout(() => reject(new Error("timeout")), 20000);
  });
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

async function selectAuto(page) {
  await page.evaluate(() => {
    const cat = document.getElementById("iuAdsFieldCategory");
    if (!cat) return;
    cat.value = "auto";
    cat.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(350);
}

const proc = await startServer();

try {
  for (const [w, h] of VIEWS) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const loc = msg.location() || {};
      const u = loc.url || "";
      const ln = loc.lineNumber || 0;
      if (/fontawesome|googleapis|gstatic|ytimg/i.test(u + msg.text())) return;
      if (u.includes("app.js") && ln >= ADS_LO && ln <= ADS_HI) r.appAdsErr++;
      else if (/iuAds|decodeVin|VIN/i.test(msg.text())) r.appAdsErr++;
    });
    await page.addInitScript(() => {
      window.__g = 0;
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__g += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      } catch (e) {}
    });
    await page.goto(BASE, { waitUntil: "load", timeout: 90000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      window.__g = 0;
    });
    await page.waitForTimeout(600);
    r.clsGlobalMax = Math.max(r.clsGlobalMax, await page.evaluate(() => window.__g || 0));
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
      )
    )
      r.overflowX = true;
    await browser.close();
  }

  const b1 = await chromium.launch({ headless: true });
  const p1 = await b1.newPage({ viewport: { width: 1280, height: 800 } });
  let uxW = 0;
  p1.on("request", (req) => {
    if (req.url().includes("workers.dev/vin")) uxW++;
  });
  await p1.goto(BASE, { waitUntil: "load", timeout: 90000 });
  await p1.waitForTimeout(1200);
  await openAdsSubmit(p1);
  await selectAuto(p1);

  await p1.route("**/josef-zmrhal.workers.dev/vin**", async (route) => {
    await new Promise((res) => setTimeout(res, 1600));
    await route.continue();
  });
  await p1.fill("#iuAdsAutoVin", VIN_SUCCESS);
  await p1.click("#iuAdsAutoVinLoadBtn");
  await p1.waitForFunction(
    () =>
      (document.getElementById("iuAdsAutoVinLoadBtn")?.textContent || "").indexOf("Načítám") >= 0,
    { timeout: 3000 }
  );
  const mid = await p1.evaluate(() => {
    const b = document.getElementById("iuAdsAutoVinLoadBtn");
    return {
      dis: b?.disabled === true,
      txt: (b?.textContent || "").trim(),
      loading: b?.classList.contains("is-loading")
    };
  });
  await p1.waitForFunction(
    () => (document.getElementById("iuAdsApiMake")?.value || "") === "PEUGEOT",
    { timeout: 60000 }
  );
  await p1.waitForTimeout(400);
  const after = await p1.evaluate(() => {
    const b = document.getElementById("iuAdsAutoVinLoadBtn");
    return {
      dis: b?.disabled === true,
      txt: (b?.textContent || "").trim(),
      loading: b?.classList.contains("is-loading"),
      mk: document.getElementById("iuAdsApiMake")?.value || "",
      errH: document.getElementById("iuAdsAutoVinError")?.hidden !== false,
      errT: document.getElementById("iuAdsAutoVinError")?.textContent || ""
    };
  });
  r.uxSuccess =
    mid.dis &&
    mid.txt === "Načítám…" &&
    mid.loading &&
    !after.dis &&
    after.txt === "Načíst údaje o vozidle" &&
    !after.loading &&
    after.mk === "PEUGEOT" &&
    after.errH &&
    after.errT === "";
  await p1.unroute("**/josef-zmrhal.workers.dev/vin**");
  await b1.close();

  const b2 = await chromium.launch({ headless: true });
  const p2 = await b2.newPage({ viewport: { width: 1280, height: 800 } });
  let w2 = 0;
  p2.on("request", (req) => {
    if (req.url().includes("workers.dev/vin")) w2++;
  });
  await p2.goto(BASE, { waitUntil: "load", timeout: 90000 });
  await p2.waitForTimeout(1200);
  await openAdsSubmit(p2);
  await selectAuto(p2);
  await p2.fill("#iuAdsAutoVin", "SHORT");
  await p2.click("#iuAdsAutoVinLoadBtn");
  await p2.waitForTimeout(700);
  const inv = await p2.evaluate(() => ({
    w: 0,
    err: document.getElementById("iuAdsAutoVinError")?.textContent || "",
    btnDis: document.getElementById("iuAdsAutoVinLoadBtn")?.disabled,
    btnTxt: (document.getElementById("iuAdsAutoVinLoadBtn")?.textContent || "").trim(),
    loadCls: document.getElementById("iuAdsAutoVinLoadBtn")?.classList.contains("is-loading")
  }));
  r.uxInvalid =
    w2 === 0 &&
    inv.err === "Zadejte platný VIN (17 znaků)." &&
    inv.btnDis === false &&
    inv.btnTxt === "Načíst údaje o vozidle" &&
    inv.loadCls === false;
  await b2.close();

  const b3 = await chromium.launch({ headless: true });
  const p3 = await b3.newPage({ viewport: { width: 1280, height: 800 } });
  let w3 = 0;
  p3.on("request", (req) => {
    if (req.url().includes("workers.dev/vin")) w3++;
  });
  await p3.goto(BASE, { waitUntil: "load", timeout: 90000 });
  await p3.waitForTimeout(1200);
  await openAdsSubmit(p3);
  await selectAuto(p3);
  await p3.fill("#iuAdsAutoVin", VIN_OK);
  await p3.click("#iuAdsAutoVinLoadBtn");
  await p3.waitForFunction(() => !document.getElementById("iuAdsAutoPost")?.hidden, { timeout: 40000 });
  await p3.waitForTimeout(500);
  const nf = await p3.evaluate(() => ({
    err: document.getElementById("iuAdsAutoVinError")?.textContent || "",
    ld: document.getElementById("iuAdsAutoVinLoading")?.hidden,
    btnDis: document.getElementById("iuAdsAutoVinLoadBtn")?.disabled,
    btnTxt: (document.getElementById("iuAdsAutoVinLoadBtn")?.textContent || "").trim(),
    loadCls: document.getElementById("iuAdsAutoVinLoadBtn")?.classList.contains("is-loading")
  }));
  r.uxNotFound =
    w3 >= 1 &&
    nf.err === "Vozidlo nebylo nalezeno." &&
    nf.ld !== false &&
    nf.btnDis === false &&
    nf.btnTxt === "Načíst údaje o vozidle" &&
    nf.loadCls === false;
  await b3.close();

  const b4 = await chromium.launch({ headless: true });
  const p4 = await b4.newPage({ viewport: { width: 1280, height: 800 } });
  await p4.goto(BASE, { waitUntil: "load", timeout: 90000 });
  await p4.waitForTimeout(1200);
  await p4.evaluate(() => {
    var orig = window.fetch;
    window.fetch = function () {
      var u = arguments[0];
      if (typeof u === "string" && u.indexOf("workers.dev/vin") >= 0) {
        return Promise.reject(new Error("Network fail"));
      }
      return orig.apply(window, arguments);
    };
  });
  await openAdsSubmit(p4);
  await selectAuto(p4);
  await p4.fill("#iuAdsAutoVin", VIN_SUCCESS);
  await p4.click("#iuAdsAutoVinLoadBtn");
  await p4.waitForTimeout(2500);
  const net = await p4.evaluate(() => ({
    err: document.getElementById("iuAdsAutoVinError")?.textContent || "",
    btnTxt: (document.getElementById("iuAdsAutoVinLoadBtn")?.textContent || "").trim(),
    loadCls: document.getElementById("iuAdsAutoVinLoadBtn")?.classList.contains("is-loading")
  }));
  r.uxNetwork =
    String(net.err).indexOf("Zkuste to znovu") >= 0 &&
    net.btnTxt === "Načíst údaje o vozidle" &&
    net.loadCls === false;
  await b4.close();

  const b5 = await chromium.launch({ headless: true });
  const p5 = await b5.newPage({ viewport: { width: 1280, height: 800 } });
  let w5 = 0;
  p5.on("request", (req) => {
    if (req.url().includes("workers.dev/vin")) w5++;
  });
  await p5.route("**/josef-zmrhal.workers.dev/vin**", async (route) => {
    await new Promise((res) => setTimeout(res, 2500));
    await route.continue();
  });
  await p5.goto(BASE, { waitUntil: "load", timeout: 90000 });
  await p5.waitForTimeout(1200);
  await openAdsSubmit(p5);
  await selectAuto(p5);
  await p5.fill("#iuAdsAutoVin", VIN_SUCCESS);
  for (let i = 0; i < 5; i++) {
    p5.click("#iuAdsAutoVinLoadBtn").catch(() => {});
  }
  await p5.waitForFunction(
    () => (document.getElementById("iuAdsApiMake")?.value || "") === "PEUGEOT",
    { timeout: 60000 }
  );
  await p5.waitForTimeout(600);
  r.uxDuplicate = w5 === 1;
  await b5.close();

  const b6 = await chromium.launch({ headless: true });
  const p6 = await b6.newPage({ viewport: { width: 1280, height: 800 } });
  await p6.goto(BASE, { waitUntil: "load", timeout: 90000 });
  await p6.waitForTimeout(1200);
  await openAdsSubmit(p6);
  await selectAuto(p6);
  await p6.fill("#iuAdsAutoVin", "SHORT");
  await p6.click("#iuAdsAutoVinLoadBtn");
  await p6.waitForTimeout(600);
  await p6.fill("#iuAdsAutoVin", VIN_OK);
  await p6.click("#iuAdsAutoVinLoadBtn");
  await p6.waitForFunction(() => !document.getElementById("iuAdsAutoPost")?.hidden, { timeout: 40000 });
  await p6.waitForTimeout(400);
  await p6.fill("#iuAdsAutoVin", VIN_SUCCESS);
  await p6.click("#iuAdsAutoVinLoadBtn");
  await p6.waitForFunction(
    () => (document.getElementById("iuAdsApiMake")?.value || "") === "PEUGEOT",
    { timeout: 60000 }
  );
  await p6.click("#iuAdsAutoVinLoadBtn");
  await p6.waitForTimeout(4500);
  const seqOk =
    (await p6.inputValue("#iuAdsApiMake")) === "PEUGEOT" &&
    String(await p6.inputValue("#iuAdsApiModel")).includes("3008");
  r.sequence = seqOk;
  await b6.close();
} finally {
  proc.kill("SIGTERM");
}

const pass =
  r.uxSuccess &&
  r.uxInvalid &&
  r.uxNotFound &&
  r.uxNetwork &&
  r.uxDuplicate &&
  r.sequence &&
  r.clsGlobalMax < 0.001 &&
  !r.overflowX &&
  r.appAdsErr === 0;

console.log(
  JSON.stringify(
    {
      ...r,
      consoleErrorsCount: r.appAdsErr,
      cls: r.clsGlobalMax,
      railShift: r.railMax,
      UX_PASS: pass
    },
    null,
    0
  )
);
process.exit(pass ? 0 : 1);
