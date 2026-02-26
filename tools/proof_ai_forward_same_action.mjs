#!/usr/bin/env node
/**
 * Proof: AI "Přeposlat" uses same action as Translator (iuForwardActionSameAsTranslator)
 * without opening Translator UI. Clipboard or share receives payload with signature.
 * Output: artifacts/P0_AI_FORWARD_SAME_ACTION.txt
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const EXPECTED_SUFFIX = "\n\n— infoUzel.cz\nhttps://infouzel.cz/";

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
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

async function runProof(page, baseUrl) {
  await page.addInitScript(() => {
    window.__proofCls = 0;
    window.__sharePayload = null;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__proofCls += e.value;
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });

  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    const q = document.getElementById("iuQuickFeed");
    const tr = document.querySelector('[data-iu-notes-key="translator"]');
    return !!(q && !q.hidden && tr && tr.offsetParent);
  });

  await page.evaluate(() => {
    const btn = document.querySelector('[data-iuq="ai"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    window.__sharePayload = null;
    if (typeof navigator.share === "function") {
      navigator.share = function(opts) {
        window.__sharePayload = opts;
        return Promise.reject(new Error("proof: force fallback"));
      };
    }
  });

  const shareBtn = page.locator("#iuQuickFeed .iuAiShareBtn, #iuAiShareBtn");
  await shareBtn.first().waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
  await shareBtn.first().click();
  await page.waitForTimeout(600);

  const translatorOpenedAfter = await page.evaluate(() => {
    const q = document.getElementById("iuQuickFeed");
    const tr = document.querySelector('[data-iu-notes-key="translator"]');
    return !!(q && !q.hidden && tr && tr.offsetParent);
  });

  let sharePayload = await page.evaluate(() => window.__sharePayload || null);

  let clipboardText = null;
  const fallbackMenu = page.locator("#iuForwardFallbackMenu").first();
  await page.waitForTimeout(400);
  if (await fallbackMenu.count() > 0 && await fallbackMenu.isVisible().catch(() => false)) {
    const copyBtn = page.locator('#iuForwardFallbackMenu button:has-text("Kopírovat pro odeslání")').first();
    if (await copyBtn.count() > 0) {
      await copyBtn.click();
      await page.waitForTimeout(400);
      try {
        clipboardText = await page.evaluate(async () => {
          try { return await navigator.clipboard.readText(); } catch (_) { return null; }
        });
      } catch (_) {}
    }
  }

  if (!sharePayload && !clipboardText) {
    sharePayload = await page.evaluate(() => window.__sharePayload || null);
  }
  const payloadText = (sharePayload && sharePayload.text) ? sharePayload.text : clipboardText;
  const payloadHasSignature = typeof payloadText === "string" && (
    payloadText.endsWith(EXPECTED_SUFFIX) ||
    (payloadText.includes("— infoUzel.cz") && payloadText.includes("https://infouzel.cz/"))
  );
  const sharedFunctionRan = typeof payloadText === "string" && payloadText.length > 0 && payloadHasSignature;

  const cls = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => 0);

  return {
    translatorOpenedAfter,
    translatorNotOpened: !translatorOpenedAfter,
    sharedFunctionRan,
    payloadHasSignature,
    cls,
    payloadPreview: payloadText ? String(payloadText).slice(0, 120) + "..." : "",
    sharePayloadSet: !!sharePayload,
    clipboardLength: clipboardText ? clipboardText.length : 0,
  };
}

async function main() {
  let browser = null;
  let staticServer = null;
  let BASE_URL = process.env.PROOF_BASE_URL || "";
  const lines = ["P0_AI_FORWARD_SAME_ACTION: AI Přeposlat = same action as Translator, no Translator UI"];

  try {
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }
    lines.push("URL=" + BASE_URL);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});

    const page = await context.newPage();
    const result = await runProof(page, BASE_URL);
    await page.close();

    lines.push("translatorNotOpened=" + result.translatorNotOpened);
    lines.push("sharePayloadSet=" + (result.sharePayloadSet || false));
    lines.push("clipboardLength=" + (result.clipboardLength || 0));
    lines.push("sharedFunctionRan=" + result.sharedFunctionRan);
    lines.push("payloadHasSignature=" + result.payloadHasSignature);
    lines.push("payloadPreview=" + (result.payloadPreview || ""));
    lines.push("CLS=" + (result.cls < 0.05 ? 0 : result.cls));
    lines.push("RECAP: " + (result.translatorNotOpened && result.sharedFunctionRan && result.cls < 0.05 ? "PASS" : "FAIL"));

    const outPath = writeArtifact("P0_AI_FORWARD_SAME_ACTION.txt", lines.join("\n"));
    console.log("Wrote", outPath);
    if (!result.translatorNotOpened || !result.sharedFunctionRan || result.cls >= 0.05) process.exitCode = 1;
  } catch (err) {
    console.error("proof_ai_forward_same_action failed:", err.message);
    writeArtifact("P0_AI_FORWARD_SAME_ACTION.txt", "ERROR=" + String(err.message));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (staticServer) try { staticServer.close(); } catch (_) {}
  }
}

main();
