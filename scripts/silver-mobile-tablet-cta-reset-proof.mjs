#!/usr/bin/env node
/**
 * Silver mobile/tablet CTA reset proof (Kalendář → hlavní overlay, žádný starý mezikrok).
 * Env: SILVER_CTA_RESET_URL (default vlastní server), SILVER_CTA_RESET_MAIN_COMMIT (jen prod hlavička).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DEFAULT_PORT = 8791;
const PORT = Number(process.env.SILVER_CTA_RESET_PORT || DEFAULT_PORT);
const ENV_URL = String(process.env.SILVER_CTA_RESET_URL || "").trim();
const MAIN_COMMIT = String(process.env.SILVER_CTA_RESET_MAIN_COMMIT || "").trim();
const CLS_CAP = 0.05;

function serveFile(urlPath) {
  let filePath = path.join(
    ROOT,
    urlPath === "/" || urlPath === "" ? "index.html" : urlPath.replace(/^\//, "").replace(/\/$/, "") || "index.html"
  );
  if (urlPath && urlPath !== "/" && !urlPath.startsWith("/projects")) {
    const lastSeg = (urlPath.split("?")[0] || "").split("/").filter(Boolean).pop() || "";
    if (!path.extname(lastSeg)) {
      const p = path.join(ROOT, urlPath.replace(/^\//, "").split("/")[0]);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) filePath = path.join(p, "index.html");
    }
  }
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT))) return null;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath);
        const ct =
          ext === ".css"
            ? "text/css"
            : ext === ".js"
              ? "application/javascript"
              : ext === ".json"
                ? "application/json"
                : ext === ".ico"
                  ? "image/x-icon"
                  : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function installCls(page) {
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

async function runViewport(page, base, w, h) {
  await page.setViewportSize({ width: w, height: h });
  const consoleErrors = [];
  let appErrors = 0;
  const onConsole = (msg) => {
    try {
      if (msg.type() === "error") consoleErrors.push(String(msg.text()));
    } catch (_) {}
  };
  const onPageError = (err) => {
    try {
      appErrors += 1;
      consoleErrors.push(String(err && err.message ? err.message : err));
    } catch (_) {}
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);

  const projectsUrl = base.replace(/\/$/, "") + "/projects/";
  await page.goto(projectsUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(
    () => window.iuCalendarService && typeof window.iuCalendarService.openOverlay === "function",
    null,
    { timeout: 90000 }
  );
  await installCls(page);
  await page.evaluate(() => {
    window.__iuClsSum = 0;
  });
  await page.waitForTimeout(800);

  const pre = await page.evaluate(() => {
    function vis(el) {
      if (!el) return false;
      const st = window.getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2;
    }
    const docEl = document.documentElement;
    const body = document.body;
    const overflowX =
      (docEl && docEl.scrollWidth > docEl.clientWidth + 1) ||
      (body && body.scrollWidth > body.clientWidth + 1);
    const inp = document.getElementById("iuSilverHomeInput");
    const calBtn = document.getElementById("iuHeroQuickCal");
    const tasksBtn = document.getElementById("iuHeroQuickTasks");
    const notesBtn = document.getElementById("iuHeroQuickNotes");
    const oldSave = document.querySelector('[data-iu-silver-guided="save"]');
    const oldSearch = document.querySelector('[data-iu-silver-guided="search"]');
    const oldCancel = document.querySelector('[data-iu-silver-guided="cal-back"]');
    const miniCalGrid = document.querySelector(".iuSilverMiniCal__grid");
    const composeAux = document.querySelector("[data-iu-silver-calendar-compose-aux]");
    return {
      overflowX: !!overflowX,
      silverInputExists: !!inp,
      calendarButtonVisible: vis(calBtn),
      tasksButtonVisible: vis(tasksBtn),
      notesButtonVisible: vis(notesBtn),
      oldSaveCalendarVisible: vis(oldSave),
      oldSearchCalendarVisible: vis(oldSearch),
      oldCancelVisible: vis(oldCancel),
      quickDateFlowVisible: !!(miniCalGrid && vis(miniCalGrid)),
      quickTimeFlowVisible: !!(composeAux && vis(composeAux)),
    };
  });

  let calendarClickOpensMainCalendar = false;
  try {
    await page.locator("#iuHeroQuickCal").scrollIntoViewIfNeeded();
    await page.click("#iuHeroQuickCal", { timeout: 15000, force: true });
    await page.waitForTimeout(600);
    calendarClickOpensMainCalendar = await page.evaluate(() => {
      const ov = document.getElementById("iuCalendarOverlay");
      return !!(ov && !ov.hasAttribute("hidden") && ov.getAttribute("aria-hidden") !== "true");
    });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(300);
  } catch (_) {
    calendarClickOpensMainCalendar = false;
  }

  const clsVal = await page.evaluate(() => Number(window.__iuClsSum || 0));

  page.off("console", onConsole);
  page.off("pageerror", onPageError);

  return {
    ...pre,
    calendarClickOpensMainCalendar,
    consoleErrorsCount: consoleErrors.length,
    appErrorsCount: appErrors,
    cls: clsVal,
  };
}

function validate(o) {
  if (!o.silverInputExists) return false;
  if (!o.calendarButtonVisible || !o.tasksButtonVisible || !o.notesButtonVisible) return false;
  if (o.oldSaveCalendarVisible || o.oldSearchCalendarVisible || o.oldCancelVisible) return false;
  if (!o.calendarClickOpensMainCalendar) return false;
  if (o.quickDateFlowVisible || o.quickTimeFlowVisible) return false;
  if (o.overflowX) return false;
  if (o.consoleErrorsCount !== 0 || o.appErrorsCount !== 0) return false;
  if (o.cls > CLS_CAP) return false;
  return true;
}

async function main() {
  let server = null;
  let base = ENV_URL || `http://127.0.0.1:${PORT}`;
  if (!ENV_URL) {
    server = await startServer();
    base = `http://127.0.0.1:${PORT}`;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const viewports = [
    { w: 390, h: 844 },
    { w: 768, h: 1024 },
  ];
  const isProd = /infouzel\.cz/i.test(base);
  const lines = [];
  if (isProd) {
    lines.push("url=" + base.replace(/\/$/, "") + "/");
    lines.push("mainCommit=" + (MAIN_COMMIT || "unknown"));
  }

  let allOk = true;
  for (const vp of viewports) {
    const o = await runViewport(page, base, vp.w, vp.h);
    lines.push("viewport=" + vp.w + "x" + vp.h);
    lines.push("silverInputExists=" + o.silverInputExists);
    lines.push("calendarButtonVisible=" + o.calendarButtonVisible);
    lines.push("tasksButtonVisible=" + o.tasksButtonVisible);
    lines.push("notesButtonVisible=" + o.notesButtonVisible);
    lines.push("oldSaveCalendarVisible=" + o.oldSaveCalendarVisible);
    lines.push("oldSearchCalendarVisible=" + o.oldSearchCalendarVisible);
    lines.push("oldCancelVisible=" + o.oldCancelVisible);
    lines.push("calendarClickOpensMainCalendar=" + o.calendarClickOpensMainCalendar);
    lines.push("quickDateFlowVisible=" + o.quickDateFlowVisible);
    lines.push("quickTimeFlowVisible=" + o.quickTimeFlowVisible);
    lines.push("overflowX=" + o.overflowX);
    lines.push("consoleErrorsCount=" + o.consoleErrorsCount);
    lines.push("appErrorsCount=" + o.appErrorsCount);
    if (!validate(o)) allOk = false;
  }

  await browser.close();
  if (server) {
    await new Promise((r) => server.close(() => r()));
  }

  const tag = isProd ? "PROD_SILVER_MOBILE_TABLET_CTA_RESET_PROOF" : "SILVER_MOBILE_TABLET_CTA_RESET_PROOF";
  console.log("=== " + tag + " ===");
  for (let i = 0; i < lines.length; i++) console.log(lines[i]);
  console.log("=== END_" + tag + " ===");

  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
