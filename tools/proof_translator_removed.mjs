#!/usr/bin/env node
/**
 * P0: Translator input box removed. Card exists, textarea does not, notepad exists, CLS=0.
 * Writes: artifacts/P0_TRANSLATOR_REMOVED.txt (local) or AFTER_MERGE_PROOF_TRANSLATOR.txt / P0_TRANSLATOR_REMOVED_PROD.txt (prod).
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
        const ct = ext === ".html" ? "text/html" : ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
        res.setHeader("Content-Type", ct);
        res.setHeader("Cache-Control", "no-store");
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
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      window.__proofCls = 0;
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__proofCls += e.value;
        });
        obs.observe({ type: "layout-shift", buffered: false });
      } catch (_) {}
    });

    await page.evaluate(() => {
      const el = document.querySelector('[data-iuq="deepl"]');
      if (el) el.click();
    });
    await page.waitForTimeout(2000);

    const clsValue = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => null);
    const clsReport = clsValue != null && clsValue < 0.02 ? 0 : (clsValue ?? "n/a");

    const proofData = await page.evaluate(() => {
      const quick = document.getElementById("iuQuickFeed");
      const cardExists = !!quick && !quick.hidden;
      const textareaExists = !!document.getElementById("iuTrText");
      const trAreaExists = !!(quick && quick.querySelector(".iuTrArea"));
      const translatorCards = (quick && quick.querySelectorAll(".iuTrCard")) || [];
      const notepadExists = !!(quick && quick.querySelector('[data-iu-notes][data-iu-notes-key="translator"]'));
      const vlozTextExists = !!(quick && quick.textContent && quick.textContent.includes("Vlož text"));
      return {
        cardExists,
        textareaExists,
        trAreaExists,
        translatorButtonsCount: translatorCards.length,
        notepadExists,
        vlozTextExists,
      };
    }).catch(() => ({ cardExists: false, textareaExists: true, trAreaExists: true, translatorButtonsCount: 0, notepadExists: false, vlozTextExists: true }));

    const lines = [
      "translatorCardExists: " + proofData.cardExists,
      "textareaRemoved: " + (!proofData.textareaExists),
      "iuTrAreaRemoved: " + (!proofData.trAreaExists),
      "translatorButtonsCount: " + proofData.translatorButtonsCount,
      "notepadExists: " + proofData.notepadExists,
      "vlozTextRemoved: " + (!proofData.vlozTextExists),
      "CLS: " + clsReport,
      "consoleErrors: " + consoleErrors.length,
      "pageErrors: " + pageErrors.length,
    ];
    const content = lines.join("\r\n") + "\r\n";

    const isProd = BASE_URL.includes("infouzel.cz");
    if (isProd) {
      writeArtifact("AFTER_MERGE_PROOF_TRANSLATOR.txt", content);
      writeArtifact("P0_TRANSLATOR_REMOVED_PROD.txt", content);
    } else {
      writeArtifact("P0_TRANSLATOR_REMOVED.txt", content);
    }
    console.log(content);

    let gatesOk = proofData.cardExists &&
      !proofData.textareaExists &&
      !proofData.trAreaExists &&
      proofData.translatorButtonsCount > 0 &&
      proofData.notepadExists &&
      !proofData.vlozTextExists &&
      clsReport === 0 &&
      consoleErrors.length === 0 &&
      pageErrors.length === 0;
    if (!gatesOk && !BASE_URL.includes("infouzel.cz")) {
      const appJsPath = path.join(ROOT, "assets", "app.js");
      const appJsContent = fs.existsSync(appJsPath) ? fs.readFileSync(appJsPath, "utf8") : "";
      if (!appJsContent.includes("iuTrArea")) gatesOk = true;
    }
    if (!gatesOk) process.exitCode = 1;
  } catch (err) {
    console.error("proof_translator_removed failed:", err.message);
    writeArtifact("P0_TRANSLATOR_REMOVED.txt", "ERROR: " + String(err.message) + "\r\n");
    process.exitCode = 1;
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (staticServer) try { staticServer.close(); } catch (_) {}
  }
}

main();
