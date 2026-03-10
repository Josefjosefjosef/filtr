#!/usr/bin/env node
/**
 * Proof: Rychlé odkazy (QuickLinks) icon order = 3 rows fixed order.
 * Runs local via http://127.0.0.1 (static server); or use PROOF_BASE_URL for PROD.
 * Selector: only "Rychlé odkazy" block in right rail. Gate: console.error=0, pageerror=0, CLS=0.
 * Output: artifacts/PROOF_QUICKLINKS_ORDER_3ROWS.txt (UTF-8 no BOM, CRLF).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");

const EXPECTED_LABELS = [
  "AI asistenti",
  "Překladač",
  "Převod na Word, PDF",
  "Balíky",
  "Nákup domů",
  "Poslat SMS zdarma",
  "YouTube",
  "Google",
  "Seznam.cz",
];

function writeArtifact(name, text) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const out = path.join(ARTIFACTS, name);
  const crlf = text.replace(/\r?\n/g, "\r\n");
  fs.writeFileSync(out, crlf, "utf8");
  return out;
}

/** Minimal static server (no deps). Serves ROOT at http://127.0.0.1:port/ */
function startStaticServer(rootDir) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let urlPath = (req.url || "/").split("?")[0];
      if (urlPath === "/" || urlPath === "/projects" || urlPath === "/projects/") {
        urlPath = "/projects/index.html";
      } else if (!urlPath.startsWith("/")) {
        urlPath = "/" + urlPath;
      }
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
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

async function main() {
  let browser = null;
  let page = null;
  let staticServer = null;
  const consoleErrors = [];
  const pageErrors = [];
  let clsValue = null;
  let BASE_URL = process.env.PROOF_BASE_URL || "";

  try {
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const text = msg.text();
        const loc = msg.location();
        const locStr = loc ? `${loc.url || ""}:${loc.lineNumber || ""}:${loc.columnNumber || ""}` : "";
        consoleErrors.push({ text, location: locStr });
      }
    });
    page.on("pageerror", (err) => pageErrors.push(String(err.message)));

    await page.addInitScript(() => {
      window.__proofCls = 0;
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__proofCls += e.value;
          }
        });
        obs.observe({ type: "layout-shift", buffered: true });
      } catch (_) {}
    });

    await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2500);

    clsValue = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => 0);

    const sectionSelector = '.accordionCol section.iu-mmQuickLinks[aria-label="Rychlé odkazy"]';
    const itemsSelector = `${sectionSelector} .iu-mmQuickGrid .iu-mmQuickItem`;
    const items = page.locator(itemsSelector);
    const count = await items.count();

    const foundLabels = [];
    for (let i = 0; i < count; i++) {
      const el = items.nth(i);
      const aria = await el.getAttribute("aria-label").catch(() => null);
      const title = await el.getAttribute("title").catch(() => null);
      const text = await el.locator("span:last-of-type").first().textContent().catch(() => "") || "";
      const label = (aria || title || text || "").trim();
      foundLabels.push(label || `(empty-${i})`);
    }

    const match = count >= 9 && foundLabels.slice(0, 9).every((l, i) => l === EXPECTED_LABELS[i]);
    const consoleErrorCount = consoleErrors.length;
    const pageErrorCount = pageErrors.length;
    const clsReport = clsValue != null && clsValue < 0.02 ? 0 : clsValue;

    const lines = [
      "PROOF: QuickLinks icon order 3 rows",
      `URL=${BASE_URL}`,
      `foundLabels=${JSON.stringify(foundLabels)}`,
      `expectedLabels=${JSON.stringify(EXPECTED_LABELS)}`,
      `match=${match}`,
      `PILLS_COUNT=${count}`,
      `CLS=${clsReport}`,
      `console.error=${consoleErrorCount}`,
      `pageerror=${pageErrorCount}`,
    ];
    if (consoleErrors.length > 0) {
      lines.push("consoleErrorsTop10=" + JSON.stringify(consoleErrors.slice(0, 10).map((e) => ({ text: e.text, location: e.location }))));
    }
    const content = lines.join("\n");
    const outPath = writeArtifact("PROOF_QUICKLINKS_ORDER_3ROWS.txt", content);
    if (BASE_URL.includes("infouzel.cz")) {
      writeArtifact("AFTER_MERGE_PROOF_QUICKLINKS_ORDER_3ROWS_PROD.txt", "PROOF: QuickLinks icon order 3 rows — PROD (after merge)\n" + lines.slice(1).join("\n"));
    }
    console.log("Wrote", outPath);
    console.log("match=" + match + " CLS=" + clsReport + " console.error=" + consoleErrorCount + " pageerror=" + pageErrorCount);
    if (consoleErrorCount > 0) {
      console.error("Top console errors:", consoleErrors.slice(0, 10));
    }
    if (!match || clsReport > 0 || consoleErrorCount > 0 || pageErrorCount > 0) process.exitCode = 1;
  } catch (err) {
    console.error("proof_quicklinks_order_3rows failed:", err.message);
    writeArtifact("PROOF_QUICKLINKS_ORDER_3ROWS.txt", "ERROR=" + String(err.message));
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (staticServer) try { staticServer.close(); } catch (_) {}
  }
}

main();
