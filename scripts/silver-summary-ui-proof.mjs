/**
 * Playwright: loads local repo /projects/ via tiny static server, then
 * window.__iuGetTodayCalendarSummaryState (must match current assets/app.js).
 *
 * Run: node scripts/silver-summary-ui-proof.mjs
 */
import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const DAY = "2026-03-26";
const ev4 = [
  { date: DAY, time: "09:00", title: "a" },
  { date: DAY, time: "10:00", title: "b" },
  { date: DAY, time: "11:00", title: "c" },
  { date: DAY, time: "13:22", title: "d" }
];

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
    } catch (e) {
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
  await page.waitForFunction(() => typeof window.__iuGetTodayCalendarSummaryState === "function", null, {
    timeout: 120000
  });
  await installClsHarness(page);
  await page.evaluate(() => {
    window.__iuClsSum = 0;
  });

  async function runScenario(id, iso, items, checks) {
    const st = await page.evaluate(
      ({ isoIn, itemsIn }) => {
        const d = new Date(isoIn);
        return window.__iuGetTodayCalendarSummaryState(d, itemsIn);
      },
      { isoIn: iso, itemsIn: items }
    );
    let ok = true;
    if (checks.primaryText != null && st.primaryText !== checks.primaryText) ok = false;
    if (checks.secondaryText != null && st.secondaryText !== checks.secondaryText) ok = false;
    if (checks.hideSecondaryLine != null && st.hideSecondaryLine !== checks.hideSecondaryLine) ok = false;
    if (checks.secondaryMustNotInclude != null && String(st.secondaryText).includes(checks.secondaryMustNotInclude))
      ok = false;
    console.log(JSON.stringify({ scenario: id, pass: ok, actual: st, checks }));
    return ok;
  }

  const A = await runScenario(
    "A_before_first",
    DAY + "T08:00:00",
    ev4,
    {
      primaryText: "Kalendář: Na dnešek máte uložené 4 záznamy.",
      secondaryText: "První dnešní záznam v 09:00 hod.",
      secondaryMustNotInclude: "Další záznam"
    }
  );
  const B = await runScenario(
    "B_next_after_09",
    DAY + "T09:30:00",
    ev4,
    {
      primaryText: "Kalendář: Na dnešek máte uložené 4 záznamy.",
      secondaryText: "Další záznam v 10:00 hod."
    }
  );
  const C = await runScenario(
    "C_all_done",
    DAY + "T14:00:00",
    ev4,
    {
      primaryText: "Kalendář: Na dnešek jste měli uložené 4 záznamy.",
      secondaryText: "Dnešní záznamy už proběhly."
    }
  );
  const D = await runScenario(
    "D_single_before",
    DAY + "T08:00:00",
    [{ date: DAY, time: "09:00", title: "x" }],
    {
      primaryText: "Kalendář: Na dnešek máte uložený 1 záznam.",
      secondaryText: "Dnešní záznam v 09:00 hod.",
      secondaryMustNotInclude: "Další záznam"
    }
  );
  const E = await runScenario(
    "E_empty",
    DAY + "T12:00:00",
    [],
    {
      primaryText: "Kalendář: Na dnešek nemáte uložený žádný záznam.",
      secondaryText: "",
      hideSecondaryLine: true
    }
  );

  const m = await snapMetrics(page);
  await browser.close();
  server.close();

  const passAll = A && B && C && D && E && m.clsSum === 0 && !m.overflowX && m.railShift === 0 && consoleErrors.length === 0;
  console.log(
    JSON.stringify({
      zeroRegression: {
        CLS: m.clsSum,
        overflowX: m.overflowX,
        railShift: m.railShift,
        consoleErrorsCount: consoleErrors.length
      },
      passAll
    })
  );
  process.exit(passAll ? 0 : 1);
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
