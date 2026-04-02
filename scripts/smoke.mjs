#!/usr/bin/env node
/**
 * Smoke test for infoUzel — catches SEV1 scope crashe before merge.
 * Runs against local static server.
 * FAIL on: ReferenceError/TypeError, pageerror, unhandledrejection, broken nav click, route reset.
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 8080;
const BASE = `http://127.0.0.1:${PORT}`;

let server = null;
let failed = false;
const errors = [];

function fail(msg) {
  failed = true;
  errors.push(msg);
  console.error("[SMOKE FAIL]", msg);
}

// Minimal static server (0 extra deps)
function serveFile(urlPath) {
  let filePath = path.join(ROOT, (urlPath === "/" || urlPath === "") ? "index.html" : urlPath.replace(/^\//, "").replace(/\/$/, "") || "index.html");
  if (urlPath && urlPath !== "/" && !urlPath.startsWith("/projects")) {
    const lastSeg = (urlPath.split("?")[0] || "").split("/").filter(Boolean).pop() || "";
    if (!path.extname(lastSeg)) {
      const p = path.join(ROOT, urlPath.replace(/^\//, "").split("/")[0]);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) filePath = path.join(p, "index.html");
    }
  }
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT)) && !filePath.includes(ROOT)) return null;
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
    server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath);
        const ct = ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : ext === ".json" ? "application/json" : ext === ".ico" ? "image/x-icon" : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve());
  });
}

async function runSmoke() {
  const { chromium } = await import("playwright");

  await startServer();

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on("pageerror", (err) => {
      fail(`pageerror: ${err.message}`);
    });

    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === "error") {
        if (/\/favicon\.ico/.test(text)) return; // whitelist: ignore favicon 404
        if (/ReferenceError|TypeError/.test(text)) fail(`console error: ${text}`);
        if (/app\.js|app\.css|\.json/.test(text) && !/i\.ytimg\.com|thumbnail/.test(text)) {
          fail(`console error (our asset): ${text}`);
        }
      }
    });

    const urls = [
      `${BASE}/`,
      `${BASE}/projects/?section=media`,
      `${BASE}/projects/?debug=1`,
    ];

    for (const url of urls) {
      const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
      // Playwright may return null when navigation commits without a main-frame Response (client redirect / race).
      const st = res ? res.status() : null;
      if (st !== null && st >= 400) fail(`HTTP ${st} for ${url}`);
      // Root index.html runs location.replace("/projects/") after parse; domcontentloaded can return
      // before that navigation commits — next goto would race and interrupt (?section=media) with /projects/.
      if (url === `${BASE}/`) {
        try {
          await page.waitForURL((u) => u.pathname.includes("/projects"), { timeout: 10000 });
        } catch (e) {
          fail(`Root redirect did not settle on /projects/: ${e && e.message ? e.message : String(e)}`);
        }
      }
      await page.waitForTimeout(500);
    }

    // Click test on /projects/?section=media
    await page.goto(`${BASE}/projects/?section=media`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(800);

    try {
      await page.waitForSelector("#iuFinancePreviewCard", { timeout: 10000 });
    } catch (e) {
      fail(`Finance preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    const financeProbe = await page.evaluate(() => {
      const card = document.getElementById("iuFinancePreviewCard");
      if (!card) return { ok: false, reason: "no_card" };
      if (card.tagName !== "BUTTON" || card.getAttribute("type") !== "button") return { ok: false, reason: "not_button" };
      const nBad = card.querySelectorAll(".iuNewsPreviewBadge, .iuSportPreviewLiveBadge").length;
      if (nBad !== 0) return { ok: false, reason: "extra_badge", nBad };
      const badge = card.querySelector(".iu-previewBadge--finance");
      if (!badge || String(badge.textContent || "").trim() !== "Finance") return { ok: false, reason: "badge" };
      const img = document.getElementById("iuFinancePreviewImage");
      const src = img ? String(img.getAttribute("src") || "") : "";
      if (src.indexOf("finance-default.jpg") < 0) return { ok: false, reason: "img", src };
      const titles = document.getElementById("iuFinancePreviewTitles");
      if (!titles) return { ok: false, reason: "titles_host" };
      const slots = titles.querySelectorAll("[data-iu-finance-preview-title-1], [data-iu-finance-preview-title-2]");
      if (slots.length !== 2) return { ok: false, reason: "title_slots", n: slots.length };
      if (card.getAttribute("data-iu-finance-route") !== "finance") return { ok: false, reason: "route" };
      return { ok: true };
    });
    if (!financeProbe || !financeProbe.ok) {
      fail(`Finance preview regression: ${JSON.stringify(financeProbe)}`);
    }
    await page.click("#iuFinancePreviewCard");
    await page.waitForTimeout(500);
    const afterFinanceClick = page.url();
    if (afterFinanceClick.indexOf("topic=finance") === -1) {
      fail(`Finance preview click did not set topic=finance: ${afterFinanceClick}`);
    }

    const navSelectors = ["a.iu-leftNavItem", "a[data-rail]", ".iuLeftNav a", "nav a"];
    let navEl = null;
    for (const sel of navSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          navEl = el;
          break;
        }
      } catch {}
    }
    if (!navEl) fail("No nav link found (UI broken or overlay)");
    else {
      const beforeUrl = page.url();
      await navEl.click();
      await page.waitForTimeout(500);
      const afterUrl = page.url();
      const activeTag = await page.evaluate(() => document.activeElement?.tagName || "");
      const urlChanged = afterUrl !== beforeUrl;
      const hasFocus = /^A|BUTTON$/i.test(activeTag);
      if (!urlChanged && !hasFocus) fail("Click did not change URL or focus");
    }

    // Route reset: panel/radarOpen stripped on reload; section/topic/mode may persist (media nav deep links)
    await page.goto(`${BASE}/projects/?section=media&panel=services`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    const finalUrl = page.url();
    let u;
    try {
      u = new URL(finalUrl);
    } catch (e) {
      fail(`Route reset: invalid URL ${finalUrl}`);
    }
    if (!u.pathname.includes("/projects")) fail(`Route reset: expected /projects path, got ${finalUrl}`);
    if (u.searchParams.has("panel") || u.searchParams.has("radarOpen")) {
      fail(`Route reset: stripped overlay params still present: ${finalUrl}`);
    }

    await browser.close();
  } finally {
    if (server) server.close();
  }

  if (failed) {
    console.error("\nErrors:", errors);
    process.exit(1);
  }
  console.log("SMOKE PASS");
}

runSmoke().catch((e) => {
  console.error(e);
  process.exit(1);
});
