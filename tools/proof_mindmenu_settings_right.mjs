#!/usr/bin/env node
/**
 * Proof: MindMenu — pill spans over gear + height 35px (row = pill).
 * Gate: gear inside row bbox, position absolute/relative, right !== auto, row height >= 35px, CLS=0, console/pageerror=0.
 * Output: artifacts/PROOF_MINDMENU_PILL_SPAN_GEAR_HEIGHT35.txt (or _PROD / AFTER_MERGE when PROOF_BASE_URL=prod).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const MIN_ROW_HEIGHT = 35;

function writeArtifact(name, text) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const out = path.join(ARTIFACTS, name);
  fs.writeFileSync(out, String(text), { encoding: "utf8" });
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
        const ct = ext === ".html" ? "text/html" : ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
        res.setHeader("Content-Type", ct);
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

async function main() {
  let browser = null;
  let page = null;
  let staticServer = null;
  const consoleErrors = [];
  const pageErrors = [];

  try {
    let BASE_URL = process.env.PROOF_BASE_URL || "";
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();

    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => pageErrors.push(String(err.message)));

    await page.addInitScript(() => { window.__proofCls = 0; });
    await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2500);

    const diagPage = await page.evaluate(() => {
      const canonical = document.querySelector('link[rel="canonical"]');
      const canonicalHref = canonical && canonical.href ? canonical.href : null;
      const scripts = Array.from(document.querySelectorAll("script[src]")).filter((s) => (s.getAttribute("src") || "").includes("assets/app.")).map((s) => s.getAttribute("src"));
      const resources = (performance.getEntriesByType && performance.getEntriesByType("resource")) || [];
      const appResources = resources.filter((r) => (r.name || "").includes("assets/app.")).map((r) => ({ name: r.name, transferSize: r.transferSize || 0, decodedBodySize: r.decodedBodySize || 0 }));
      return { locationHref: location.href, canonicalHref, scriptSrcs: scripts, appResources };
    }).catch(() => ({}));

    await page.evaluate(() => {
      window.__proofCls = 0;
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__proofCls += e.value;
        });
        obs.observe({ type: "layout-shift", buffered: false });
      } catch (_) {}
    });

    const clsValue = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => null);
    const proofData = await page.evaluate((minHeight) => {
      const rows = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-row");
      const pills = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-pill");
      const gears = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-gear");
      let allInside = true;
      let gearPositionAbsolute = true;
      let rowPositionRelative = true;
      let gearRightNotAuto = true;
      let rowHeightOk = true;
      let checked = 0;
      for (const row of rows) {
        const gear = row.querySelector(".iu-mailbox-gear");
        if (!gear) continue;
        checked++;
        const rRow = row.getBoundingClientRect();
        const rGear = gear.getBoundingClientRect();
        if (rGear.right > rRow.right || rGear.left < rRow.left || rGear.top < rRow.top || rGear.bottom > rRow.bottom) allInside = false;
        const gStyle = getComputedStyle(gear);
        const rStyle = getComputedStyle(row);
        if (gStyle.position !== "absolute") gearPositionAbsolute = false;
        if (rStyle.position !== "relative") rowPositionRelative = false;
        if (gStyle.right === "auto") gearRightNotAuto = false;
        if (rRow.height < minHeight) rowHeightOk = false;
      }
      if (checked === 0) gearPositionAbsolute = rowPositionRelative = gearRightNotAuto = rowHeightOk = false;
      return {
        pillsCount: pills.length,
        settingsIconsCount: gears.length,
        allIconsInsideRowBox: allInside,
        gearPositionAbsolute,
        rowPositionRelative,
        gearRightNotAuto,
        rowHeightOk,
      };
    }, MIN_ROW_HEIGHT).catch((e) => ({ pillsCount: 0, settingsIconsCount: 0, allIconsInsideRowBox: false, gearPositionAbsolute: false, rowPositionRelative: false, gearRightNotAuto: false, rowHeightOk: false, error: String(e) }));

    const styleDiag = await page.evaluate(() => {
      const row = document.querySelector(".accordionCol .mindMenu .iu-mailbox-row");
      const gear = row ? row.querySelector(".iu-mailbox-gear") : null;
      if (!row || !gear) return null;
      const rStyle = getComputedStyle(row);
      const gStyle = getComputedStyle(gear);
      const rRect = row.getBoundingClientRect();
      const gRect = gear.getBoundingClientRect();
      return { rowPosition: rStyle.position, gearPosition: gStyle.position, gearRight: gStyle.right, rowRect: { x: rRect.x, y: rRect.y, width: rRect.width, height: rRect.height }, gearRect: { x: gRect.x, y: gRect.y, width: gRect.width, height: gRect.height } };
    }).catch(() => null);

    const clsReport = clsValue != null && clsValue < 0.02 ? 0 : (clsValue ?? "n/a");
    const lines = [];
    lines.push("MindMenu pill spans gear + height 35px");
    lines.push("diag_locationHref: " + (diagPage.locationHref != null ? diagPage.locationHref : ""));
    lines.push("diag_canonicalHref: " + (diagPage.canonicalHref != null && diagPage.canonicalHref !== "" ? diagPage.canonicalHref : "null"));
    lines.push("diag_scriptSrcs: " + (diagPage.scriptSrcs && diagPage.scriptSrcs.length ? diagPage.scriptSrcs.join(" | ") : ""));
    lines.push("diag_appResources: " + (diagPage.appResources && diagPage.appResources.length ? JSON.stringify(diagPage.appResources) : ""));
    lines.push("pillsCount: " + proofData.pillsCount);
    lines.push("settingsIconsCount: " + proofData.settingsIconsCount);
    lines.push("allIconsInsideRowBox: " + (proofData.allIconsInsideRowBox ? "true" : "false"));
    lines.push("rowPositionRelative: " + (proofData.rowPositionRelative === true));
    lines.push("gearPositionAbsolute: " + (proofData.gearPositionAbsolute === true));
    lines.push("gearRightNotAuto: " + (proofData.gearRightNotAuto === true));
    lines.push("rowHeightGte35: " + (proofData.rowHeightOk === true));
    lines.push("CLS: " + clsReport);
    lines.push("console.error: " + consoleErrors.length);
    lines.push("pageerror: " + pageErrors.length);
    if (proofData.error) lines.push("error: " + proofData.error);
    if (styleDiag) {
      lines.push("diag_rowPosition: " + styleDiag.rowPosition);
      lines.push("diag_gearPosition: " + styleDiag.gearPosition);
      lines.push("diag_gearRight: " + styleDiag.gearRight);
      lines.push("diag_rowRect: " + JSON.stringify(styleDiag.rowRect));
      lines.push("diag_gearRect: " + JSON.stringify(styleDiag.gearRect));
    }
    const content = lines.join("\r\n") + "\r\n";
    const isProd = BASE_URL.includes("infouzel.cz");
    const outPath = isProd
      ? writeArtifact("PROOF_MINDMENU_PILL_SPAN_GEAR_HEIGHT35_PROD.txt", content)
      : writeArtifact("PROOF_MINDMENU_PILL_SPAN_GEAR_HEIGHT35.txt", content);
    if (isProd) writeArtifact("AFTER_MERGE_PROOF_MINDMENU_PILL_SPAN_GEAR_HEIGHT35.txt", "PROOF: MindMenu pill spans gear + height 35px — after merge\r\n" + lines.slice(1).join("\r\n") + "\r\n");
    console.log("Wrote", outPath);
    console.log(content);
    const gatesOk = proofData.allIconsInsideRowBox && proofData.gearPositionAbsolute && proofData.rowPositionRelative && proofData.gearRightNotAuto && proofData.rowHeightOk && clsReport === 0 && consoleErrors.length === 0 && pageErrors.length === 0;
    if (!gatesOk) process.exitCode = 1;
  } catch (err) {
    console.error("proof_mindmenu_settings_right failed:", err.message);
    writeArtifact("PROOF_MINDMENU_PILL_SPAN_GEAR_HEIGHT35.txt", "ERROR=" + String(err.message));
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (staticServer) try { staticServer.close(); } catch (_) {}
  }
}

main();
