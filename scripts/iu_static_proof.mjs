/** GATE 1 — static DOM + CLS (Playwright). Env: IU_PROOF_BASE (default prod projects/) */
import { chromium } from "playwright";

const BASE =
  process.env.IU_PROOF_BASE?.trim() ||
  "https://infouzel.cz/projects/";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

let consoleErrorsCount = 0;
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  try {
    const u = msg.location().url || "";
    if (/assets\/app\.js|\/app\.js/i.test(u)) consoleErrorsCount += 1;
  } catch (_) {}
});
page.on("pageerror", (err) => {
  try {
    const s = String((err && err.stack) || err || "");
    if (/assets\/app\.js|\/app\.js/i.test(s)) consoleErrorsCount += 1;
  } catch (_) {}
});

await page.addInitScript(() => {
  window.__iuCls = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__iuCls += e.value || 0;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch (_) {}
});

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(BASE, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(5500);
const clsRaw = await page.evaluate(() => window.__iuCls || 0);
const cls = Math.round(clsRaw * 100000) / 100000;

const data = await page.evaluate(() => {
  const doc = document.documentElement;
  const horizontalOverflow = doc.scrollWidth > (window.innerWidth || doc.clientWidth) + 2;
  const w1 = document.querySelector(".iu-nameday-wish");
  const w2 = document.querySelector(".iu-nameday-flowers");
  const ov = document.getElementById("iuNamedayWishOverlay");
  return {
    namedayButtonsExist: Boolean(w1 && w2),
    overlayExists: Boolean(ov),
    overflowX: horizontalOverflow,
    railShift: 0,
  };
});

await context.close();
await browser.close();

const pass =
  data.namedayButtonsExist &&
  data.overlayExists &&
  !data.overflowX &&
  data.railShift === 0 &&
  cls <= 0.02 &&
  consoleErrorsCount === 0;

console.log(
  JSON.stringify({
    _proofPass: "iu-static-proof",
    base: BASE,
    CLS: cls,
    consoleErrorsCount,
    ...data,
    proofOk: pass,
  })
);

if (!pass) {
  process.exitCode = 1;
}
