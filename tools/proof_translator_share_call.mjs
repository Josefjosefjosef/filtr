#!/usr/bin/env node
/**
 * Proof: Translator "Přeposlat" and AI "Přeposlat" both trigger navigator.share (same handler).
 * Stubs navigator.share, fills text, clicks button, asserts payload.
 * Writes: artifacts/PROOF_TRANSLATOR_SHARE_CALL.txt, artifacts/PROOF_TRANSLATOR_SHARE_CLS.txt
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const TEST_STRING = "TEST_SHARE_TRANSLATOR_123";

function writeArtifact(name, text) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, name), String(text).replace(/\r?\n/g, "\r\n"), "utf8");
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
  let BASE_URL = process.env.PROOF_BASE_URL || "";
  let staticServer = null;
  const shareCallLines = [];
  let clsValue = null;

  try {
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();

    await page.addInitScript(() => {
      window.__shareCalls = [];
      window.__proofCls = 0;
      const stub = function (p) {
        window.__shareCalls.push(p);
        return Promise.resolve();
      };
      if (typeof navigator.share === "function") {
        navigator.share = stub;
      } else {
        try { Object.defineProperty(navigator, "share", { value: stub, configurable: true, writable: true }); } catch (_) { navigator.share = stub; }
      }
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__proofCls += (e.value || 0);
        });
        obs.observe({ type: "layout-shift", buffered: true });
      } catch (_) {}
    });

    await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(800);

    // --- Translator: open, fill notes, click Přeposlat ---
    await page.evaluate(() => {
      const el = document.querySelector('[data-iuq="deepl"]');
      if (el) el.click();
    });
    await page.waitForTimeout(1200);

    await page.evaluate((str) => {
      const ta = document.querySelector('#iuQuickFeed [data-iu-notes-key="translator"] [data-iu-notes-text], #iuQuickFeed .iuNotesText');
      if (ta) ta.value = str;
    }, TEST_STRING);
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      window.__shareCalls = [];
    });
    const preposlatBtn = page.locator("#iuTrHeaderPreposlat");
    await preposlatBtn.waitFor({ state: "visible", timeout: 5000 });
    await preposlatBtn.click();
    await page.waitForTimeout(600);

    const translatorResult = await page.evaluate(() => {
      const calls = window.__shareCalls || [];
      const one = calls[0];
      const text = one && one.text != null ? String(one.text) : "";
      return { count: calls.length, text, payload: one ? JSON.stringify(one) : null };
    });

    shareCallLines.push("=== Translator Přeposlat ===");
    shareCallLines.push("shareCalls.length=" + translatorResult.count);
    shareCallLines.push("payload.text contains test string: " + (translatorResult.text.indexOf("TEST_SHARE_TRANSLATOR_123") !== -1));
    if (translatorResult.payload) shareCallLines.push("payload: " + translatorResult.payload);

    const translatorPass = translatorResult.count === 1 && translatorResult.text.indexOf(TEST_STRING) !== -1;

    // --- AI: open AI tab, click Přeposlat (same stub) ---
    await page.evaluate(() => {
      const closeBtn = document.getElementById("iuQCloseBtn") || document.querySelector(".iuQClose");
      if (closeBtn) closeBtn.click();
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const el = document.querySelector('[data-iuq="ai"]');
      if (el) el.click();
    });
    await page.waitForTimeout(2000);

    await page.evaluate(() => {
      window.__shareCalls = [];
    });
    await page.locator("#iuQuickFeed .iuAiShareBtn, #iuAiShareBtn").first().click();
    await page.waitForTimeout(500);

    const aiResult = await page.evaluate(() => {
      const calls = window.__shareCalls || [];
      const one = calls[0];
      return { count: calls.length, payload: one ? JSON.stringify(one) : null };
    });

    shareCallLines.push("");
    shareCallLines.push("=== AI Přeposlat (same handler) ===");
    shareCallLines.push("shareCalls.length=" + aiResult.count);
    if (aiResult.payload) shareCallLines.push("payload: " + aiResult.payload);
    const aiPass = aiResult.count === 1;

    clsValue = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : null));
    shareCallLines.push("");
    shareCallLines.push("CLS=" + (clsValue != null ? clsValue.toFixed(6) : "n/a"));
    shareCallLines.push("PASS=" + (translatorPass && aiPass));

    writeArtifact("PROOF_TRANSLATOR_SHARE_CALL.txt", shareCallLines.join("\r\n") + "\r\n");

    const clsLines = ["CLS=" + (clsValue != null ? clsValue.toFixed(6) : "n/a"), "PASS=" + (clsValue != null && clsValue < 0.001)];
    writeArtifact("PROOF_TRANSLATOR_SHARE_CLS.txt", clsLines.join("\r\n") + "\r\n");

    await browser.close();
    if (staticServer) try { staticServer.close(); } catch (_) {}

    const exitOk = translatorPass && aiPass && (clsValue != null && clsValue < 0.001);
    process.exitCode = exitOk ? 0 : 1;
  } catch (err) {
    console.error(err);
    writeArtifact("PROOF_TRANSLATOR_SHARE_CALL.txt", "ERROR: " + String(err.message) + "\r\n");
    if (clsValue != null) writeArtifact("PROOF_TRANSLATOR_SHARE_CLS.txt", "CLS=" + clsValue.toFixed(6) + "\r\n");
    process.exitCode = 1;
  }
}

main();
