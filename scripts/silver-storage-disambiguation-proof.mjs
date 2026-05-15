/**
 * Playwright: Silver storage disambiguation UI (buttons, pending payload, flows).
 * Run: npm run silver-storage-disambiguation-proof
 */
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

function mime(p) {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let u = (req.url || "/").split("?")[0];
      if (u === "/" || u === "") u = "/projects/index.html";
      let rel = decodeURIComponent(u.replace(/^\//, "")).replace(/\\/g, "/");
      if (rel.endsWith("/")) rel += "index.html";
      const fp = path.resolve(ROOT, rel);
      if (!fp.startsWith(ROOT)) {
        res.statusCode = 403;
        res.end();
        return;
      }
      const buf = await fs.readFile(fp);
      res.setHeader("Content-Type", mime(fp));
      res.statusCode = 200;
      res.end(buf);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port, base: "http://127.0.0.1:" + addr.port });
    });
    server.on("error", reject);
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
  await page.waitForTimeout(200);
}

async function snapMetrics(page) {
  const overflowX = await page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth > el.clientWidth + 1;
  });
  const railShift = await page.evaluate(() =>
    typeof window.__iuRailShiftProbe === "number" ? window.__iuRailShiftProbe : 0
  );
  const clsSum = await page.evaluate(() => Number(window.__iuClsSum || 0));
  return { overflowX, railShift, clsSum };
}

async function openSilverWithPhrase(page, phrase) {
  await page.fill("#iuSilverHomeInput", phrase);
  await page.click("#iuSilverHomeSend");
  await page.waitForSelector("#iuSilverChatOverlay:not([hidden])", { timeout: 60000 });
  await page.waitForFunction(() => typeof window.iuSilverCalendarEngine !== "undefined", null, { timeout: 60000 });
}

async function main() {
  const { server, base } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: "block"
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(String(err && err.message ? err.message : err));
  });

  await page.goto(base + "/projects/", { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof window.iuSilverCalendarEngine !== "undefined", null, {
    timeout: 120000
  });
  await installClsHarness(page);
  await page.evaluate(() => {
    window.__iuClsSum = 0;
  });

  const phrase = "Ulož zítra v 11 schůzka zubař";

  await openSilverWithPhrase(page, phrase);

  const case1 = await page.evaluate(() => {
    const longClar = document.body.innerText.indexOf("Upřesni prosím, kam to chceš uložit —") >= 0;
    const card = document.querySelector("[data-iu-silver-storage-disambiguation=\"1\"]");
    const buttons = card ? card.querySelectorAll("[data-iu-silver-action]").length : 0;
    const leadOk =
      document.body.innerText.indexOf("Kam to chceš uložit?") >= 0 ||
      (document.querySelector(".iuSilverMsgLead") && /Kam to chceš uložit/.test(document.querySelector(".iuSilverMsgLead").textContent || ""));
    return { longClar, buttons, leadOk };
  });
  console.log(
    JSON.stringify({
      case: "1-disambiguation-ui",
      pass: !case1.longClar && case1.buttons === 3 && case1.leadOk,
      longClarificationTextShown: case1.longClar,
      buttonCount: case1.buttons,
      leadOk: case1.leadOk
    })
  );

  await page.click('[data-iu-silver-action="storage-calendar"]');
  await page.waitForSelector("[data-iu-silver-draft-card]", { timeout: 30000 });
  const case2 = await page.evaluate(() => {
    const card = document.querySelector("[data-iu-silver-draft-card]");
    const t = card ? card.innerText : "";
    return {
      hasZubar: /zubař/i.test(t),
      has1100: t.indexOf("11:00") >= 0 || t.indexOf("11:00") >= 0
    };
  });
  console.log(JSON.stringify({ case: "2-calendar-continue", pass: case2.hasZubar && case2.has1100, detail: case2 }));

  await page.reload({ waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof window.iuSilverCalendarEngine !== "undefined", null, { timeout: 120000 });
  await openSilverWithPhrase(page, phrase);
  await page.waitForSelector("[data-iu-silver-storage-disambiguation=\"1\"]", { timeout: 30000 });
  await page.click('[data-iu-silver-action="storage-tasks"]');
  await page.waitForFunction(
    () => document.body.innerText.indexOf("Úkol uložen:") >= 0,
    null,
    { timeout: 30000 }
  );
  const case3 = await page.evaluate(() => document.body.innerText.indexOf("Úkol uložen:") >= 0);
  console.log(JSON.stringify({ case: "3-tasks-create", pass: case3 }));

  await page.reload({ waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => typeof window.iuSilverCalendarEngine !== "undefined", null, { timeout: 120000 });
  await openSilverWithPhrase(page, phrase);
  await page.waitForSelector("[data-iu-silver-storage-disambiguation=\"1\"]", { timeout: 30000 });
  await page.click('[data-iu-silver-action="storage-notes"]');
  await page.waitForFunction(
    () => document.body.innerText.indexOf("Uloženo do poznámek:") >= 0,
    null,
    { timeout: 30000 }
  );
  const case4 = await page.evaluate(() => document.body.innerText.indexOf("Uloženo do poznámek:") >= 0);
  console.log(JSON.stringify({ case: "4-notes-create", pass: case4 }));

  const metrics = await snapMetrics(page);
  console.log(
    JSON.stringify({
      regression: {
        clsSum: metrics.clsSum,
        overflowX: metrics.overflowX,
        railShift: metrics.railShift,
        consoleErrorsCount: consoleErrors.length
      }
    })
  );

  const passAll =
    !case1.longClar &&
    case1.buttons === 3 &&
    case1.leadOk &&
    case2.hasZubar &&
    case2.has1100 &&
    case3 &&
    case4 &&
    metrics.clsSum === 0 &&
    !metrics.overflowX &&
    metrics.railShift === 0 &&
    consoleErrors.length === 0;

  console.log(JSON.stringify({ summary: { pass: passAll } }));

  await browser.close();
  server.close();
  process.exit(passAll ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
