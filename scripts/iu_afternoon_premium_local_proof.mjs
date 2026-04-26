/**
 * LOCAL_AFTERNOON_PREMIUM_PROOF — Playwright + local static server.
 * Repo root: node scripts/iu_afternoon_premium_local_proof.mjs
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
  await page.waitForTimeout(250);
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

async function collectAfternoonRow(page, consoleErrors, errStart) {
  await page.evaluate(() => {
    if (typeof window.iuSilverWelcomeRefresh === "function") {
      window.iuSilverWelcomeRefresh({ hour: 14 });
    }
  });
  await page.waitForTimeout(450);
  await clsReset(page);
  await page.waitForTimeout(200);

  const phrase = await page.evaluate(() =>
    typeof window.__iuSilverWelcomeLastPhrase === "string" ? window.__iuSilverWelcomeLastPhrase : ""
  );
  const hasClass = await page.evaluate(() => document.documentElement.classList.contains("iu-time-afternoon"));
  const timeTheme =
    hasClass && String(phrase).toLowerCase().includes("odpoledne") ? "afternoon" : String(phrase || "").trim();

  const hero = page.locator("#iuSilverHeroPremium");
  const silverPremiumActive = (await hero.count()) > 0;

  const cinematicBackground = await hero.evaluate((el) => {
    const bg = getComputedStyle(el).backgroundImage || "";
    return bg.includes("radial-gradient") && bg.includes("linear-gradient");
  });

  const lightCurvesPresent = await hero.evaluate((el) => {
    const st = getComputedStyle(el, "::before");
    const c = st.content || "";
    const op = parseFloat(st.opacity || "0");
    return c !== "none" && c !== "" && op > 0;
  });

  const robotGlowActive = await page.evaluate(() => {
    const img = document.querySelector("#iuSilverHeroPremium img");
    if (!img) return false;
    const f = getComputedStyle(img).filter || "";
    return f.includes("drop-shadow");
  });

  const snap = await snapMetrics(page);
  const consoleErrorsCount = Math.max(0, consoleErrors.length - errStart);

  return {
    timeTheme,
    silverPremiumActive,
    cinematicBackground,
    lightCurvesPresent,
    robotGlowActive,
    CLS: snap.clsSum,
    overflowX: snap.overflowX,
    railShift: snap.railShift,
    consoleErrorsCount,
  };
}

async function main() {
  const srv = spawn(process.execPath, ["server/projects-static-and-vin.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  try {
    await waitPortReady("127.0.0.1", PORT, 20000);
  } catch (e) {
    try {
      srv.kill();
    } catch (e2) {}
    throw e;
  }

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

  await page.setViewportSize({ width: 390, height: 844 });
  await installClsHarness(page);
  await clsReset(page);

  let errStart = consoleErrors.length;
  const v390 = await collectAfternoonRow(page, consoleErrors, errStart);

  errStart = consoleErrors.length;
  await page.evaluate(() => {
    if (typeof window.iuSilverWelcomeRefresh === "function") {
      window.iuSilverWelcomeRefresh({ hour: 7 });
    }
  });
  await page.waitForTimeout(250);
  const otherModesUnchanged = await page.evaluate(() => !document.documentElement.classList.contains("iu-time-afternoon"));
  v390.otherModesUnchanged = otherModesUnchanged;

  await page.setViewportSize({ width: 768, height: 900 });
  await installClsHarness(page);
  await clsReset(page);
  errStart = consoleErrors.length;
  const v768 = await collectAfternoonRow(page, consoleErrors, errStart);

  await browser.close();
  try {
    srv.kill();
  } catch (e) {}

  const lines = [
    "=== LOCAL_AFTERNOON_PREMIUM_PROOF ===",
    "viewport_390:",
    `  timeTheme: ${v390.timeTheme}`,
    `  silverPremiumActive: ${v390.silverPremiumActive}`,
    `  cinematicBackground: ${v390.cinematicBackground}`,
    `  lightCurvesPresent: ${v390.lightCurvesPresent}`,
    `  robotGlowActive: ${v390.robotGlowActive}`,
    `  otherModesUnchanged: ${v390.otherModesUnchanged}`,
    `  CLS: ${v390.CLS}`,
    `  overflowX: ${v390.overflowX}`,
    `  railShift: ${v390.railShift}`,
    `  consoleErrorsCount: ${v390.consoleErrorsCount}`,
    "viewport_768:",
    `  timeTheme: ${v768.timeTheme}`,
    `  silverPremiumActive: ${v768.silverPremiumActive}`,
    `  cinematicBackground: ${v768.cinematicBackground}`,
    `  lightCurvesPresent: ${v768.lightCurvesPresent}`,
    `  robotGlowActive: ${v768.robotGlowActive}`,
    `  CLS: ${v768.CLS}`,
    `  overflowX: ${v768.overflowX}`,
    `  railShift: ${v768.railShift}`,
    `  consoleErrorsCount: ${v768.consoleErrorsCount}`,
    "=== END_LOCAL_AFTERNOON_PREMIUM_PROOF ===",
  ];
  process.stdout.write(lines.join("\n") + "\n");

  const fail390 =
    v390.timeTheme !== "afternoon" ||
    !v390.silverPremiumActive ||
    !v390.cinematicBackground ||
    !v390.lightCurvesPresent ||
    !v390.robotGlowActive ||
    !v390.otherModesUnchanged ||
    v390.CLS > 0 ||
    v390.overflowX ||
    v390.railShift !== 0 ||
    v390.consoleErrorsCount > 0;

  const fail768 =
    v768.timeTheme !== "afternoon" ||
    !v768.silverPremiumActive ||
    !v768.cinematicBackground ||
    !v768.lightCurvesPresent ||
    !v768.robotGlowActive ||
    v768.CLS > 0 ||
    v768.overflowX ||
    v768.railShift !== 0 ||
    v768.consoleErrorsCount > 0;

  if (fail390 || fail768) process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(String(err && err.stack ? err.stack : err) + "\n");
  process.exitCode = 1;
});
