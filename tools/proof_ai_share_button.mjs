#!/usr/bin/env node
/**
 * Proof: AI tab header Share button – always shares https://www.infouzel.cz/
 * Test A: Web Share API mock → payload.url === PROD URL.
 * Test B: Fallback (no share) → Kopírovat odkaz → clipboard receives PROD URL.
 * Runs local via http://127.0.0.1 (static server); or PROOF_BASE_URL for PROD.
 * Output: artifacts/PROOF_AI_SHARE_BUTTON.txt (UTF-8 no BOM, CRLF).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ARTIFACTS = path.join(ROOT, "artifacts");
const SHARE_URL_EXPECTED = "https://www.infouzel.cz/";

const CONSOLE_ERROR_NOISE = [/Failed to fetch|loadAiAssistants|videos\.json|ResizeObserver|favicon|404|net::ERR/i];
function isNoiseConsoleError(text) {
  return CONSOLE_ERROR_NOISE.some((r) => r.test(String(text)));
}

function writeArtifact(name, text) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const out = path.join(ARTIFACTS, name);
  fs.writeFileSync(out, text.replace(/\r?\n/g, "\r\n"), "utf8");
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

async function runTestA(page, baseUrl) {
  await page.addInitScript(() => {
    window.__sharePayload = null;
    window.__proofCls = 0;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__proofCls += e.value;
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-iuq="ai"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(2500);
  const shareBtn = page.locator("#iuQuickFeed .iuAiShareBtn");
  await shareBtn.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  if ((await shareBtn.count()) === 0) return { pass: false, error: "Share button not found" };
  const payload = await page.evaluate(async () => {
    window.__sharePayload = null;
    window.__iuShareTestOverride = async (opts) => { window.__sharePayload = opts; };
    if (typeof window.__onShareAiTab === "function") await window.__onShareAiTab();
    return window.__sharePayload || null;
  });
  const cls = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => 0);
  const urlOk = payload && payload.url === SHARE_URL_EXPECTED;
  const titleOk = payload && typeof payload.title === "string" && payload.title.length > 0;
  const textOk = payload && typeof payload.text === "string" && payload.text.length > 0;
  return { pass: urlOk && titleOk && textOk, url: payload?.url, title: payload?.title, text: payload?.text, cls };
}

async function runTestB(page, baseUrl) {
  await page.addInitScript(() => {
    window.__copiedText = null;
    window.__proofCls = 0;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (!e.hadRecentInput) window.__proofCls += e.value;
      });
      obs.observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const btn = document.querySelector('[data-iuq="ai"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(2500);
  const copied = await page.evaluate(async () => {
    window.__copiedText = null;
    window.__iuShareTestOverride = undefined;
    window.__iuClipboardTestCapture = (t) => { window.__copiedText = t; };
    try {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true });
    } catch (_) { navigator.share = undefined; }
    if (typeof window.__onShareAiTab === "function") await window.__onShareAiTab();
    const copyItem = Array.from(document.querySelectorAll(".iuAiShareFallback button, [role=menuitem]")).find(el => /Kopírovat odkaz/.test(el.textContent || ""));
    if (copyItem) copyItem.click();
    await new Promise(r => setTimeout(r, 200));
    return window.__copiedText || null;
  });
  const cls = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => 0);
  return { pass: copied === SHARE_URL_EXPECTED, copied, cls };
}

async function main() {
  let browser = null;
  let staticServer = null;
  let BASE_URL = process.env.PROOF_BASE_URL || "";
  const consoleErrors = [];
  const pageErrors = [];
  const lines = ["PROOF: AI Share button (always https://www.infouzel.cz/)"];

  try {
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }
    lines.push("URL=" + BASE_URL);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

    const pageA = await context.newPage();
    pageA.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    pageA.on("pageerror", (e) => pageErrors.push(String(e.message)));
    const resultA = await runTestA(pageA, BASE_URL);
    await pageA.close();

    const pageB = await context.newPage();
    pageB.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    pageB.on("pageerror", (e) => pageErrors.push(String(e.message)));
    const resultB = await runTestB(pageB, BASE_URL);
    await pageB.close();

    lines.push("TestA_sharePayloadUrl=" + (resultA.url || resultA.error || ""));
    lines.push("TestA_pass=" + (resultA.pass === true));
    lines.push("TestB_copiedText=" + (resultB.copied || resultB.error || ""));
    lines.push("TestB_pass=" + (resultB.pass === true));
    const criticalConsole = consoleErrors.filter((t) => !isNoiseConsoleError(t));
    lines.push("console.error=" + criticalConsole.length);
    lines.push("pageerror=" + pageErrors.length);
    const clsVal = (resultA.cls || 0) + (resultB.cls || 0);
    const clsReport = clsVal < 0.05 ? 0 : clsVal;
    lines.push("CLS=" + clsReport);

    const failConsole = !BASE_URL.includes("127.0.0.1") && criticalConsole.length > 0;
    const allPass = !!(resultA.pass && resultB.pass && !failConsole && pageErrors.length === 0 && clsVal < 0.05);
    lines.push("allPass=" + allPass);

    const outPath = writeArtifact("PROOF_AI_SHARE_BUTTON.txt", lines.join("\n"));
    console.log("Wrote", outPath);
    if (BASE_URL.includes("infouzel.cz")) {
      writeArtifact("AFTER_MERGE_PROOF_AI_SHARE_BUTTON_PROD.txt", "PROOF: AI Share button — PROD (after merge)\n" + lines.slice(1).join("\n"));
    }
    if (!allPass) process.exitCode = 1;
  } catch (err) {
    console.error("proof_ai_share_button failed:", err.message);
    writeArtifact("PROOF_AI_SHARE_BUTTON.txt", "ERROR=" + String(err.message));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (staticServer) try { staticServer.close(); } catch (_) {}
  }
}

main();
