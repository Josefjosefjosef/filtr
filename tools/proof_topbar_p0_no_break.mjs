#!/usr/bin/env node
/**
 * P0 Topbar: no search, date always visible, nameday shown. CLS=0, nothing broken.
 * Writes: artifacts/PROOF_TOPBAR_P0_NO_BREAK_LOCAL.txt or PROOF_TOPBAR_P0_NO_BREAK_PROD.txt (UTF-8, CRLF).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");

function writeArtifact(name, text) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const out = path.join(ARTIFACTS, name);
  fs.writeFileSync(out, String(text).replace(/\r?\n/g, "\r\n"), "utf8");
  return out;
}

function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = (req.url || "/").split("?")[0];
      if (urlPath === "/" || urlPath === "/projects" || urlPath === "/projects/") urlPath = "/projects/index.html";
      else if (!urlPath.startsWith("/")) urlPath = "/" + urlPath;
      const p = path.join(rootDir, urlPath.slice(1));
      const resolved = path.resolve(p);
      const rootResolved = path.resolve(rootDir);
      if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
        res.writeHead(404);
        res.end();
        return;
      }
      fs.readFile(p, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(p);
        const ct = ext === ".html" ? "text/html" : ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : ext === ".json" ? "application/json" : "application/octet-stream";
        res.setHeader("Content-Type", ct);
        res.setHeader("Cache-Control", "no-store");
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

async function runProof(page, viewportLabel, consoleErrors, pageErrors) {
  const checks = await page.evaluate(() => {
    const searchSelectors = ["#iuTopbarSearchInput", "#iuTopbarSearchBtn", "#iuTopbarSearchForm", "#iuTopSearch input", ".iuTopbarSearchInput"];
    let searchCount = 0;
    for (const sel of searchSelectors) {
      try { searchCount += document.querySelectorAll(sel).length; } catch (_) {}
    }
    const today = document.getElementById("iuTopbarToday");
    const day = document.getElementById("iuTopbarDay");
    const date = document.getElementById("iuTopbarDate");
    const nameday = document.getElementById("iuTopbarNameday");
    let dateVisible = false;
    let dateText = "";
    let namedayText = "";
    if (today) {
      const s = getComputedStyle(today);
      dateVisible = s.display !== "none" && s.visibility !== "hidden" && parseFloat(s.opacity) > 0;
      dateText = (day ? day.textContent : "") + " " + (date ? date.textContent : "");
    }
    if (nameday) namedayText = String(nameday.textContent || "").trim();
    const namedayNonEmpty = namedayText.length > 0 && !/^svátek\s+má\s*[—\-]*$/i.test(namedayText);
    return { searchCount, dateVisible, dateText, namedayNonEmpty, namedayText: namedayText.slice(0, 60) };
  }).catch(() => ({ searchCount: -1, dateVisible: false, dateText: "", namedayNonEmpty: false, namedayText: "" }));

  return {
    viewport: viewportLabel,
    searchCount: checks.searchCount,
    searchOk: checks.searchCount === 0,
    dateVisible: checks.dateVisible,
    dateText: checks.dateText,
    namedayNonEmpty: checks.namedayNonEmpty,
    namedayText: checks.namedayText,
  };
}

async function main() {
  let browser = null;
  let page = null;
  let staticServer = null;
  const consoleErrors = [];
  const pageErrors = [];
  const lines = [];
  let BASE_URL = process.env.PROOF_BASE_URL || "";

  try {
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1400, height: 800 } });
    page = await context.newPage();

    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => pageErrors.push(String(err.message)));

    await page.addInitScript(() => { window.__proofCls = 0; });
    await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(4000);

    await page.evaluate(() => {
      window.__proofCls = 0;
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__proofCls += e.value;
        });
        obs.observe({ type: "layout-shift", buffered: false });
      } catch (_) {}
    });

    const viewports = [
      [1400, 800, "1400"],
      [1000, 800, "1000"],
      [430, 700, "430"],
    ];

    const results = [];
    for (const [w, h, label] of viewports) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(500);
      let r = await runProof(page, label, consoleErrors, pageErrors);
      results.push(r);
      lines.push(`[${label}] searchCount: ${r.searchCount} dateVisible: ${r.dateVisible} namedayNonEmpty: ${r.namedayNonEmpty}`);
    }

    await page.setViewportSize({ width: 1400, height: 800 });
    await page.waitForTimeout(10000);
    const after10s = await runProof(page, "1400_after10s", consoleErrors, pageErrors);
    results.push(after10s);
    lines.push(`[1400_after10s] searchCount: ${after10s.searchCount} dateVisible: ${after10s.dateVisible} namedayNonEmpty: ${after10s.namedayNonEmpty}`);

    const clsValue = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => null);
    const clsReport = clsValue != null ? clsValue : "n/a";
    lines.push("CLS: " + clsReport);
    lines.push("consoleErrors: " + consoleErrors.length);
    if (consoleErrors.length) lines.push("consoleErrorSample: " + consoleErrors.slice(0, 3).join(" | "));
    lines.push("pageErrors: " + pageErrors.length);

    await page.evaluate(() => { const el = document.querySelector('[data-iuq="deepl"]'); if (el) el.click(); });
    await page.waitForTimeout(1500);
    const quickVisible = await page.evaluate(() => !!document.getElementById("iuQuickFeed") && !document.getElementById("iuQuickFeed").hidden);
    await page.evaluate(() => { const btn = document.querySelector("#iuQuickFeed .iuQClose, #iuQCloseBtn"); if (btn) btn.click(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { const el = document.querySelector('[data-iuq="ai"]'); if (el) el.click(); });
    await page.waitForTimeout(1500);
    const aiOk = await page.evaluate(() => !!document.getElementById("iuQuickFeed") && !document.getElementById("iuQuickFeed").hidden);
    lines.push("smoke_quicklinks_open: " + quickVisible);
    lines.push("smoke_ai_open: " + aiOk);

    const url = await page.evaluate(() => location.href).catch(() => BASE_URL);
    lines.push("url: " + url);
    const scriptSrc = await page.evaluate(() => {
      const s = document.querySelector('script[src*="app."][src*=".js"]');
      return s ? (s.getAttribute("src") || "") : "";
    }).catch(() => "");
    lines.push("bundleRef: " + (scriptSrc.match(/app\.([a-f0-9]+)\.js/) ? scriptSrc.match(/app\.([a-f0-9]+)\.js/)[1] : scriptSrc || "n/a"));

    const allSearchOk = results.every(r => r.searchOk);
    const allDateVisible = results.every(r => r.dateVisible);
    const allNamedayOk = results.every(r => r.namedayNonEmpty);
    const smokeOk = quickVisible && aiOk;
    const noErrors = consoleErrors.length === 0 && pageErrors.length === 0;
    const clsOk = clsValue != null && clsValue === 0;
    const pass = allSearchOk && allDateVisible && allNamedayOk && smokeOk && noErrors && clsOk;
    lines.push("RECAP: " + (pass ? "PASS" : "FAIL"));
    lines.push("  searchOk: " + allSearchOk + " dateVisible: " + allDateVisible + " namedayOk: " + allNamedayOk + " smokeOk: " + smokeOk + " noErrors: " + noErrors + " clsOk: " + clsOk);

    const content = lines.join("\r\n") + "\r\n";
    const isProd = BASE_URL.includes("infouzel.cz");
    const outName = isProd ? "PROOF_TOPBAR_P0_NO_BREAK_PROD.txt" : "PROOF_TOPBAR_P0_NO_BREAK_LOCAL.txt";
    writeArtifact(outName, content);
    console.log(content);

    if (!pass) process.exitCode = 1;
  } catch (err) {
    console.error("proof_topbar_p0_no_break failed:", err.message);
    writeArtifact("PROOF_TOPBAR_P0_NO_BREAK_LOCAL.txt", "ERROR: " + String(err.message) + "\r\nRECAP: FAIL\r\n");
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (staticServer) try { staticServer.close(); } catch (_) {}
  }
}

main();
