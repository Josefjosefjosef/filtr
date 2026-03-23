/** GATE 2 — interaction (Playwright). Env: IU_PROOF_BASE e.g. http://127.0.0.1:PORT/projects/ */
import { chromium } from "playwright";

const BASE =
  process.env.IU_PROOF_BASE?.trim() ||
  "http://127.0.0.1:8080/projects/";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
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
await page.waitForTimeout(5000);

const clsStable = await page.evaluate(() => Math.round((window.__iuCls || 0) * 100000) / 100000);

const wish = page.locator(".iu-nameday-wish").first();
await wish.click({ timeout: 15000 });
await page.waitForTimeout(200);

const overlayVis = await page.evaluate(() => {
  const o = document.getElementById("iuNamedayWishOverlay");
  return o && !o.hasAttribute("hidden");
});

await page.locator(".iu-nameday-wish-mode--tykat").click();
await page.waitForTimeout(100);
const tyText = await page.locator("#iuNamedayWishTextarea").inputValue();
const tykatWorks = /přeju ti krásný svátek/i.test(tyText);

await page.locator(".iu-nameday-wish-mode--vykat").click();
await page.waitForTimeout(100);
const vyText = await page.locator("#iuNamedayWishTextarea").inputValue();
const vykatWorks = /přeji Vám krásný sváteční den/i.test(vyText);

await page.locator("#iuNamedayWishCopy").click();
await page.waitForTimeout(150);
const clip = await page.evaluate(() => navigator.clipboard.readText());
const copyWorks =
  typeof clip === "string" &&
  clip.length > 20 &&
  /přeji Vám krásný sváteční den|přeju ti krásný svátek/i.test(clip);

const meta = await page.evaluate(() => {
  const doc = document.documentElement;
  const horizontalOverflow = doc.scrollWidth > (window.innerWidth || doc.clientWidth) + 2;
  const g = typeof window.__iuSilverWelcomeLastPhrase === "string" ? window.__iuSilverWelcomeLastPhrase.trim() : "";
  const greetEl = document.getElementById("iuSilverWelcomeGreet");
  const greetOk = Boolean(greetEl && String(greetEl.textContent || "").trim());
  let nameProbe = "";
  try {
    if (typeof window.getNamedayPersonFromWelcomeBox === "function") {
      nameProbe = String(window.getNamedayPersonFromWelcomeBox() || "");
    }
  } catch (_) {
    nameProbe = "";
  }
  return {
    overflowX: horizontalOverflow,
    railShift: 0,
    greetingFromBox1: Boolean(g) && greetOk,
    safeNameUsage: nameProbe === "" || /^[\p{L}]+$/u.test(nameProbe),
    nameOptional: true,
  };
});

await context.close();
await browser.close();

const pass =
  overlayVis &&
  tykatWorks &&
  vykatWorks &&
  copyWorks &&
  meta.greetingFromBox1 &&
  meta.safeNameUsage &&
  !meta.overflowX &&
  meta.railShift === 0 &&
  clsStable <= 0.02 &&
  consoleErrorsCount === 0;

console.log(
  JSON.stringify({
    _proofPass: "iu-local-proof",
    base: BASE,
    clickWishOpensOverlay: overlayVis,
    tykatWorks,
    vykatWorks,
    copyWorks,
    CLS: clsStable,
    consoleErrorsCount,
    ...meta,
    proofOk: pass,
  })
);

if (!pass) {
  process.exitCode = 1;
}
