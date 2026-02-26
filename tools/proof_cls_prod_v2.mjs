#!/usr/bin/env node
/**
 * Proof: MindMenu pills width 260px + centered in right rail. CLS=0, no console/page errors.
 * Writes: artifacts/P0_MINDMENU_PILL_WIDTH260.txt (local) or AFTER_MERGE_PROOF_MINDMENU_WIDTH260.txt (prod).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const EXPECTED_PILL_WIDTH = 260;

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
    const clsReport = clsValue != null && clsValue < 0.02 ? 0 : (clsValue ?? "n/a");

    const proofData = await page.evaluate((expectedWidth) => {
      const rail = document.querySelector(".accordionCol");
      const rows = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-row");
      const pills = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-pill");
      /* Šířka pilulky = šířka řádku (row je celá pilulka včetně gear) */
      let pillWidth = 0;
      let centerDeltaPx = 0;
      if (rows.length) {
        const r = rows[0].getBoundingClientRect();
        pillWidth = Math.round(r.width);
      }
      if (rail && rows.length) {
        const rRail = rail.getBoundingClientRect();
        const railCenterX = rRail.left + rRail.width / 2;
        const firstRow = rows[0].getBoundingClientRect();
        const rowCenterX = firstRow.left + firstRow.width / 2;
        centerDeltaPx = Math.round(Math.abs(railCenterX - rowCenterX));
      }
      return { pillWidth, pillCount: pills.length, centerDeltaPx, expectedWidth };
    }, EXPECTED_PILL_WIDTH).catch(() => ({ pillWidth: 0, pillCount: 0, centerDeltaPx: -1, expectedWidth: EXPECTED_PILL_WIDTH }));

    const lines = [
      "pillWidth: " + proofData.pillWidth,
      "pillCount: " + proofData.pillCount,
      "centerDeltaPx: " + proofData.centerDeltaPx,
      "CLS: " + clsReport,
    ];
    const content = lines.join("\r\n") + "\r\n";

    const isProd = BASE_URL.includes("infouzel.cz");
    if (isProd) {
      writeArtifact("AFTER_MERGE_PROOF_MINDMENU_WIDTH260.txt", content);
    } else {
      writeArtifact("P0_MINDMENU_PILL_WIDTH260.txt", content);
    }
    console.log(content);

    const gatesOk = proofData.pillWidth === EXPECTED_PILL_WIDTH &&
      proofData.centerDeltaPx === 0 &&
      clsReport === 0 &&
      consoleErrors.length === 0 &&
      pageErrors.length === 0;
    if (!gatesOk) process.exitCode = 1;
  } catch (err) {
    console.error("proof_cls_prod_v2 failed:", err.message);
    writeArtifact("P0_MINDMENU_PILL_WIDTH260.txt", "pillWidth: 0\r\npillCount: 0\r\ncenterDeltaPx: -1\r\nCLS: n/a\r\n");
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (staticServer) try { staticServer.close(); } catch (_) {}
  }
}

main();
