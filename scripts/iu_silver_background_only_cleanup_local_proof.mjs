/**
 * LOCAL_SILVER_BACKGROUND_ONLY_CLEANUP_PROOF
 * node scripts/iu_silver_background_only_cleanup_local_proof.mjs
 */
import { spawn } from "child_process";
import http from "http";
import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = parseInt(process.env.PORT || "8890", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const MODES = [
  { key: "morning", hour: 7 },
  { key: "lateMorning", hour: 10 },
  { key: "afternoon", hour: 14 },
  { key: "evening", hour: 20 }
];

function waitPortReady(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function tryOnce() {
      const req = http.request({ host, port, path: "/", method: "HEAD", timeout: 400 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not ready"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    }
    tryOnce();
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
  await page.waitForTimeout(220);
}

async function clsReset(page) {
  await page.evaluate(() => {
    window.__iuClsSum = 0;
  });
}

async function clsRead(page) {
  const v = await page.evaluate(() => Number(window.__iuClsSum || 0));
  return Number.isFinite(v) ? v : 0;
}

async function snapMetrics(page) {
  const overflowX = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth + 1;
  });
  const railShift = await page.evaluate(() => {
    const n = window.__iuRailShiftProbe;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  });
  const clsSum = await clsRead(page);
  return { overflowX, railShift, clsSum };
}

async function silverPremiumActive(page) {
  return page.evaluate(() => {
    const el = document.getElementById("iuSilverHeroPremium");
    if (!el) return false;
    const bg = getComputedStyle(el).backgroundImage || "";
    return bg.includes("radial-gradient") && bg.includes("linear-gradient") && bg.includes("110% 80%");
  });
}

async function fingerprintInputTwice(page) {
  const a = await page.evaluate(() => {
    const hero = document.getElementById("iuSilverHeroPremium");
    const inp = hero ? hero.querySelector("input") : null;
    if (!inp) return "";
    const cs = getComputedStyle(inp);
    return [cs.backgroundColor, cs.backgroundImage, cs.borderTopWidth, cs.borderColor, cs.filter, cs.backdropFilter].join("|");
  });
  await page.waitForTimeout(140);
  const b = await page.evaluate(() => {
    const hero = document.getElementById("iuSilverHeroPremium");
    const inp = hero ? hero.querySelector("input") : null;
    if (!inp) return "";
    const cs = getComputedStyle(inp);
    return [cs.backgroundColor, cs.backgroundImage, cs.borderTopWidth, cs.borderColor, cs.filter, cs.backdropFilter].join("|");
  });
  return a === b;
}

async function fingerprintImgTwice(page) {
  const a = await page.evaluate(() => {
    const img = document.querySelector("#iuSilverHeroPremium img");
    if (!img) return "";
    const cs = getComputedStyle(img);
    return [cs.filter, cs.opacity, cs.width, cs.height, cs.maxHeight].join("|");
  });
  await page.waitForTimeout(140);
  const b = await page.evaluate(() => {
    const img = document.querySelector("#iuSilverHeroPremium img");
    if (!img) return "";
    const cs = getComputedStyle(img);
    return [cs.filter, cs.opacity, cs.width, cs.height, cs.maxHeight].join("|");
  });
  return a === b;
}

async function fingerprintChildInnerTwice(page) {
  const a = await page.evaluate(() => {
    const inner = document.querySelector("#iuSilverHeroPremium .iu-hero-silver-premiumInner");
    if (!inner) return "";
    const cs = getComputedStyle(inner);
    return [cs.marginTop, cs.marginBottom, cs.paddingTop, cs.paddingBottom, cs.borderTopWidth, cs.gap, cs.display].join("|");
  });
  await page.waitForTimeout(140);
  const b = await page.evaluate(() => {
    const inner = document.querySelector("#iuSilverHeroPremium .iu-hero-silver-premiumInner");
    if (!inner) return "";
    const cs = getComputedStyle(inner);
    return [cs.marginTop, cs.marginBottom, cs.paddingTop, cs.paddingBottom, cs.borderTopWidth, cs.gap, cs.display].join("|");
  });
  return a === b && a !== "";
}

async function fingerprintLayoutTwice(page) {
  const a = await page.evaluate(() => {
    const el = document.getElementById("iuSilverHeroPremium");
    if (!el) return "";
    const r = el.getBoundingClientRect();
    return [r.width, r.height, r.top, r.left].map((n) => String(Math.round(n * 10) / 10)).join("|");
  });
  await page.waitForTimeout(140);
  const b = await page.evaluate(() => {
    const el = document.getElementById("iuSilverHeroPremium");
    if (!el) return "";
    const r = el.getBoundingClientRect();
    return [r.width, r.height, r.top, r.left].map((n) => String(Math.round(n * 10) / 10)).join("|");
  });
  return a === b && a !== "";
}

async function probeMode(page, mode, consoleErrors) {
  const err0 = consoleErrors.length;
  await clsReset(page);
  await page.evaluate((h) => {
    if (typeof window.iuSilverWelcomeRefresh === "function") window.iuSilverWelcomeRefresh({ hour: h });
  }, mode.hour);
  await page.waitForTimeout(480);
  const premium = await silverPremiumActive(page);
  const inpOk = await fingerprintInputTwice(page);
  const imgOk = await fingerprintImgTwice(page);
  const childOk = await fingerprintChildInnerTwice(page);
  const layOk = await fingerprintLayoutTwice(page);
  const snap = await snapMetrics(page);
  const ce = Math.max(0, consoleErrors.length - err0);
  return {
    silverBackgroundPremiumActive: premium,
    forbiddenInputChanged: !inpOk,
    forbiddenImgChanged: !imgOk,
    forbiddenChildStyleChanged: !childOk,
    heroLayoutStable: layOk,
    CLS: snap.clsSum,
    overflowX: snap.overflowX,
    railShift: snap.railShift,
    consoleErrorsCount: ce
  };
}

async function captureBrandFingerprint(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".iuBrand");
    if (!el) return "";
    const cs = getComputedStyle(el);
    return [cs.color, cs.fontSize, cs.fontWeight].join("|");
  });
}

async function runViewport(page, vw, vh, consoleErrors) {
  await page.setViewportSize({ width: vw, height: vh });
  await installClsHarness(page);
  await clsReset(page);
  const out = {};
  const brand0 = await captureBrandFingerprint(page);
  for (let i = 0; i < MODES.length; i++) {
    out[MODES[i].key] = await probeMode(page, MODES[i], consoleErrors);
  }
  await page.evaluate((h) => {
    if (typeof window.iuSilverWelcomeRefresh === "function") window.iuSilverWelcomeRefresh({ hour: h });
  }, 7);
  await page.waitForTimeout(280);
  const brand1 = await captureBrandFingerprint(page);
  return { rows: out, otherBoxesChanged: brand0 !== brand1 };
}

async function desktopProbe(page, consoleErrors) {
  const err0 = consoleErrors.length;
  await page.setViewportSize({ width: 1440, height: 900 });
  await installClsHarness(page);
  await clsReset(page);
  await page.evaluate(() => {
    if (typeof window.iuSilverWelcomeRefresh === "function") window.iuSilverWelcomeRefresh({ hour: 14 });
  });
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => window.matchMedia("(min-width: 1025px)").matches);
  const premiumDesktop = await silverPremiumActive(page);
  const snap = await snapMetrics(page);
  const ce = Math.max(0, consoleErrors.length - err0);
  return {
    desktopChanged: Boolean(wide && premiumDesktop),
    CLS: snap.clsSum,
    overflowX: snap.overflowX,
    consoleErrorsCount: ce
  };
}

async function main() {
  const srv = spawn(process.execPath, ["server/projects-static-and-vin.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore"
  });
  await waitPortReady("127.0.0.1", PORT, 20000);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(String(err && err.message ? err.message : err));
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(900);

  const v390 = await runViewport(page, 390, 844, consoleErrors);
  const v768 = await runViewport(page, 768, 900, consoleErrors);
  const desk = await desktopProbe(page, consoleErrors);

  await browser.close();
  try {
    srv.kill();
  } catch (e) {}

  const layoutChanged =
    Object.values(v390.rows).some((r) => !r.heroLayoutStable) ||
    Object.values(v768.rows).some((r) => !r.heroLayoutStable);

  const lines = ["=== LOCAL_SILVER_BACKGROUND_ONLY_CLEANUP_PROOF ===", "viewport_390:"];
  for (let i = 0; i < MODES.length; i++) {
    const k = MODES[i].key;
    const r = v390.rows[k];
    lines.push(`  ${k}:`);
    lines.push(`    silverBackgroundPremiumActive: ${r.silverBackgroundPremiumActive}`);
    lines.push(`    forbiddenInputChanged: ${r.forbiddenInputChanged}`);
    lines.push(`    forbiddenImgChanged: ${r.forbiddenImgChanged}`);
    lines.push(`    forbiddenChildStyleChanged: ${r.forbiddenChildStyleChanged}`);
    lines.push(`    CLS: ${r.CLS}`);
    lines.push(`    overflowX: ${r.overflowX}`);
    lines.push(`    railShift: ${r.railShift}`);
    lines.push(`    consoleErrorsCount: ${r.consoleErrorsCount}`);
  }
  lines.push("");
  lines.push("viewport_768:");
  for (let j = 0; j < MODES.length; j++) {
    const k2 = MODES[j].key;
    const r2 = v768.rows[k2];
    lines.push(`  ${k2}:`);
    lines.push(`    silverBackgroundPremiumActive: ${r2.silverBackgroundPremiumActive}`);
    lines.push(`    forbiddenInputChanged: ${r2.forbiddenInputChanged}`);
    lines.push(`    forbiddenImgChanged: ${r2.forbiddenImgChanged}`);
    lines.push(`    forbiddenChildStyleChanged: ${r2.forbiddenChildStyleChanged}`);
    lines.push(`    CLS: ${r2.CLS}`);
    lines.push(`    overflowX: ${r2.overflowX}`);
    lines.push(`    railShift: ${r2.railShift}`);
    lines.push(`    consoleErrorsCount: ${r2.consoleErrorsCount}`);
  }
  lines.push("");
  lines.push(`desktopChanged: ${desk.desktopChanged}`);
  lines.push(`otherBoxesChanged: ${v390.otherBoxesChanged || v768.otherBoxesChanged}`);
  lines.push(`layoutChanged: ${layoutChanged}`);
  lines.push("=== END_LOCAL_SILVER_BACKGROUND_ONLY_CLEANUP_PROOF ===");
  process.stdout.write(lines.join("\n") + "\n");

  const badRow = (r) =>
    !r.silverBackgroundPremiumActive ||
    r.forbiddenInputChanged ||
    r.forbiddenImgChanged ||
    r.forbiddenChildStyleChanged ||
    !r.heroLayoutStable ||
    r.CLS > 0 ||
    r.overflowX ||
    r.railShift !== 0 ||
    r.consoleErrorsCount > 0;

  let fail = desk.desktopChanged || desk.CLS > 0 || desk.overflowX || desk.consoleErrorsCount > 0;
  for (let x = 0; x < MODES.length; x++) {
    if (badRow(v390.rows[MODES[x].key])) fail = true;
    if (badRow(v768.rows[MODES[x].key])) fail = true;
  }
  if (v390.otherBoxesChanged || v768.otherBoxesChanged) fail = true;
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exitCode = 1;
});
