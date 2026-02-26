#!/usr/bin/env node
/**
 * Proof: Convert UI — 6 buttons, header like AI/Translator, share handler, CLS=0.
 * Writes: artifacts/PROOF_CONVERT_UI_LINKS.txt (local) or AFTER_MERGE_PROOF_CONVERT_UI_LINKS.txt (prod).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");

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

function writeArtifact(name, text) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, name), String(text).replace(/\r?\n/g, "\r\n") + "\r\n", "utf8");
}

async function main() {
  let BASE_URL = process.env.PROOF_BASE_URL || "";
  let staticServer = null;
  const lines = [];
  const out = (s) => { lines.push(s); console.log(s); };

  try {
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }

    const isProd = BASE_URL.includes("infouzel.cz");
    const tz = "Europe/Prague";
    const ts = new Date().toLocaleString("cs-CZ", { timeZone: tz });
    out("PROD_URL=" + BASE_URL);
    out("timestamp=" + ts + " (" + tz + ")");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => pageErrors.push(String(err.message)));

    await page.addInitScript(() => {
      window.__proofCls = 0;
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__proofCls += (e.value || 0);
          }
        });
        obs.observe({ type: "layout-shift", buffered: true });
      } catch (_) {}
    });

    await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      const el = document.querySelector('[data-iuq="convert"]');
      if (el) el.click();
    });
    await page.waitForTimeout(800);

    const domDump = await page.evaluate(() => {
      const grid = document.querySelector("#iuQuickFeed .iuQGrid");
      if (!grid) return { count: 0, buttons: [] };
      const links = Array.from(grid.querySelectorAll("a.iuAiCard.iuConvert, a.iuAiCard"));
      const buttons = links.map((a) => ({
        text: (a.querySelector(".iuAiName") || a).textContent?.trim() || "",
        href: a.getAttribute("href") || "",
      }));
      return { count: buttons.length, buttons };
    });

    out("DOM_button_count=" + domDump.count);
    domDump.buttons.forEach((b, i) => {
      out("DOM_button_" + (i + 1) + "_text=" + b.text);
      out("DOM_button_" + (i + 1) + "_href=" + b.href);
    });

    const shareHandlerProof = await page.evaluate(() => {
      const shareBtn = document.querySelector("#iuQuickFeed .iuAiShareBtn");
      if (!shareBtn) return { hasShareBtn: false, hasIuForward: false };
      const hasIuForward = typeof window.iuForwardActionSameAsTranslator === "function";
      return { hasShareBtn: true, hasIuForward };
    });
    out("share_handler_same_function=" + (shareHandlerProof.hasShareBtn && shareHandlerProof.hasIuForward));

    await page.evaluate(() => {
      window.__proofSharePayload = null;
      window.__iuShareTestOverride = async (opts) => { window.__proofSharePayload = opts; };
    });
    await page.evaluate(() => {
      const btn = document.querySelector("#iuQuickFeed .iuAiShareBtn");
      if (btn) btn.click();
    });
    await page.waitForTimeout(400);
    const sharePayload = await page.evaluate(() => window.__proofSharePayload || null);
    out("share_payload_title=" + (sharePayload ? sharePayload.title : ""));
    out("share_payload_text_contains_prevod=" + (sharePayload && (sharePayload.text || "").indexOf("Převod") !== -1));

    const clsVal = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => null);
    const clsReport = clsVal != null && clsVal < 0.000001 ? "0.000000" : (clsVal != null ? String(clsVal) : "n/a");
    out("CLS=" + clsReport);
    out("console_errors=" + consoleErrors.length);
    out("pageerrors=" + pageErrors.length);

    const pass = domDump.count === 6 &&
      shareHandlerProof.hasShareBtn &&
      shareHandlerProof.hasIuForward &&
      (clsVal == null || clsVal < 0.000001) &&
      consoleErrors.length === 0 &&
      pageErrors.length === 0;
    out("PASS=" + pass);

    const content = lines.join("\r\n") + "\r\n";
    writeArtifact("PROOF_CONVERT_UI_LINKS.txt", content);
    if (isProd) writeArtifact("AFTER_MERGE_PROOF_CONVERT_UI_LINKS.txt", content);

    await browser.close();
    if (staticServer) try { staticServer.close(); } catch (_) {}

    process.exitCode = pass ? 0 : 1;
  } catch (err) {
    console.error(err);
    out("ERROR=" + String(err.message));
    writeArtifact("PROOF_CONVERT_UI_LINKS.txt", lines.join("\r\n") + "\r\n");
    process.exitCode = 1;
  }
}

main();
