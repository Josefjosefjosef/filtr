#!/usr/bin/env node
/**
 * Proof: MindMenu mailbox row centered in right rail + raw CLS (no thresholding).
 * Optional strict mailbox row width when PROOF_EXPECTED_MAILBOX_ROW_PX is set (integer px).
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

/** Legacy name: previously compared pill to 260; layout uses full row width (pill + gear). */
const EXPECTED_ROW_PX_ENV = process.env.PROOF_EXPECTED_MAILBOX_ROW_PX;

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
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
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

function installRawCls() {
  window.__proofClsRaw = 0;
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__proofClsRaw += e.value;
      }
    });
    obs.observe({ type: "layout-shift", buffered: true });
  } catch (_) {}
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
      BASE_URL = `http://127.0.0.1:${port}/projects/?debug=1&nosw=1&section=media`;
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err.message)));

    await page.addInitScript(installRawCls);

    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForTimeout(2500);

    const clsRaw = await page.evaluate(() => (typeof window.__proofClsRaw === "number" ? window.__proofClsRaw : 0)).catch(() => null);

    const overflowX = await page.evaluate(() => {
      const el = document.documentElement;
      return el.scrollWidth > el.clientWidth + 1;
    });
    const railShift = await page.evaluate(() => (typeof window.__iuRailShiftProbe === "number" ? window.__iuRailShiftProbe : 0));

    const proofData = await page.evaluate((expectedRowPx) => {
      const rail = document.querySelector(".accordionCol");
      const rows = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-row");
      const pills = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-pill");
      let rowWidth = 0;
      let centerDeltaPx = -1;
      if (rows.length) {
        const r = rows[0].getBoundingClientRect();
        rowWidth = Math.round(r.width);
      }
      if (rail && rows.length) {
        const rRail = rail.getBoundingClientRect();
        const railCenterX = rRail.left + rRail.width / 2;
        const firstRow = rows[0].getBoundingClientRect();
        const rowCenterX = firstRow.left + firstRow.width / 2;
        centerDeltaPx = Math.round(Math.abs(railCenterX - rowCenterX));
      }
      let rowWidthGate = "SKIP_NO_EXPECTED_ROW_PX";
      if (expectedRowPx != null && expectedRowPx !== "" && rows.length) {
        const exp = parseInt(String(expectedRowPx), 10);
        if (Number.isFinite(exp)) rowWidthGate = rowWidth === exp ? "PASS" : "FAIL";
      }
      return {
        rowWidth,
        pillCount: pills.length,
        rowCount: rows.length,
        centerDeltaPx,
        rowWidthGate,
        expectedRowPx: expectedRowPx != null && expectedRowPx !== "" ? String(expectedRowPx) : "",
      };
    }, EXPECTED_ROW_PX_ENV || "").catch(() => ({
      rowWidth: 0,
      pillCount: 0,
      rowCount: 0,
      centerDeltaPx: -1,
      rowWidthGate: "ERROR",
      expectedRowPx: "",
    }));

    const lines = [
      "rowWidth: " + proofData.rowWidth,
      "rowCount: " + proofData.rowCount,
      "pillCount: " + proofData.pillCount,
      "centerDeltaPx: " + proofData.centerDeltaPx,
      "rowWidthGate: " + proofData.rowWidthGate,
      "CLS_raw: " + (clsRaw != null ? String(clsRaw) : "n/a"),
      "overflowX: " + overflowX,
      "railShift: " + railShift,
      "consoleErrorsCount: " + consoleErrors.length,
      "firstConsoleError: " + (consoleErrors[0] ? String(consoleErrors[0]).slice(0, 500) : ""),
      "pageErrorsCount: " + pageErrors.length,
    ];
    const content = lines.join("\r\n") + "\r\n";

    const isProd = BASE_URL.includes("infouzel.cz");
    if (isProd) {
      writeArtifact("AFTER_MERGE_PROOF_MINDMENU_WIDTH260.txt", content);
    } else {
      writeArtifact("P0_MINDMENU_PILL_WIDTH260.txt", content);
    }
    console.log(content);

    const widthOk =
      proofData.rowWidthGate === "SKIP_NO_EXPECTED_ROW_PX" || proofData.rowWidthGate === "PASS";
    const centerOk = proofData.rowCount === 0 || proofData.centerDeltaPx === 0;
    const gatesOk =
      widthOk &&
      centerOk &&
      clsRaw === 0 &&
      overflowX === false &&
      railShift === 0 &&
      consoleErrors.length === 0 &&
      pageErrors.length === 0;
    if (!gatesOk) process.exitCode = 1;
  } catch (err) {
    console.error("proof_cls_prod_v2 failed:", err.message);
    writeArtifact("P0_MINDMENU_PILL_WIDTH260.txt", "CLS_raw: n/a\r\noverflowX: n/a\r\n");
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (staticServer)
      try {
        staticServer.close();
      } catch (_) {}
  }
}

main();
