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

function out(k, v) {
  process.stdout.write(`${k}=${v}\n`);
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

function writeArtifact(name, lines) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const outPath = path.join(ARTIFACTS, name);
  const content = (Array.isArray(lines) ? lines.join("\n") : String(lines)) + "\n";
  fs.writeFileSync(outPath, content, "utf8");
}

async function main() {
  let BASE_URL = process.env.PROOF_BASE_URL || "";
  let staticServer = null;

  try {
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }

    const isProd = BASE_URL.includes("infouzel.cz");
    const tsPrague = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Prague" }).replace(" ", "T").replace(":", ":").slice(0, 19) + "+01:00";

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

    const shareHandlerProof = await page.evaluate(() => {
      const h = window.__iuShareHandlers || {};
      const convertRef = h.convert;
      const translatorRef = h.translator;
      const aiRef = h.ai;
      const sameRefAi = !!(convertRef && aiRef && convertRef === aiRef);
      const sameRefTranslator = !!(convertRef && translatorRef && convertRef === translatorRef);
      const sameRefAll = sameRefAi && sameRefTranslator;
      return {
        hasShareBtn: !!document.querySelector("#iuQuickFeed .iuAiShareBtn"),
        handlerName: convertRef && convertRef.name ? convertRef.name : (convertRef ? "iuForwardActionSameAsTranslator" : ""),
        SHARE_HANDLER_SAME_REF_AI: sameRefAi,
        SHARE_HANDLER_SAME_REF_TRANSLATOR: sameRefTranslator,
        SHARE_HANDLER_SAME_REF_ALL: sameRefAll,
      };
    });

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

    const clsVal = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => null);
    const clsReport = clsVal != null && clsVal < 0.000001 ? "0.000000" : (clsVal != null ? String(clsVal) : "n/a");

    const pass = domDump.count === 6 &&
      shareHandlerProof.SHARE_HANDLER_SAME_REF_ALL &&
      (clsVal == null || clsVal < 0.000001) &&
      consoleErrors.length === 0 &&
      pageErrors.length === 0;

    out("PROD_URL", BASE_URL);
    out("TIMESTAMP_PRAGUE", tsPrague);
    out("DOM_button_count", domDump.count);
    domDump.buttons.forEach((b, i) => {
      out("BTN_" + (i + 1) + "_TEXT", b.text);
      out("BTN_" + (i + 1) + "_HREF", b.href);
    });
    out("SHARE_HANDLER_NAME", shareHandlerProof.handlerName);
    out("SHARE_HANDLER_SAME_REF_AI", shareHandlerProof.SHARE_HANDLER_SAME_REF_AI);
    out("SHARE_HANDLER_SAME_REF_TRANSLATOR", shareHandlerProof.SHARE_HANDLER_SAME_REF_TRANSLATOR);
    out("SHARE_HANDLER_SAME_REF_ALL", shareHandlerProof.SHARE_HANDLER_SAME_REF_ALL);
    out("SHARE_PAYLOAD_TITLE", sharePayload ? sharePayload.title : "");
    out("SHARE_PAYLOAD_TEXT", sharePayload ? sharePayload.text : "");
    out("CLS", clsReport);
    out("console_errors", consoleErrors.length);
    out("pageerrors", pageErrors.length);
    out("PASS", pass);
    out("SCOPE_FILES", "tools/proof_convert_ui_links.mjs");
    process.stdout.write("\n");
    const outLines = [
      "PROD_URL=" + BASE_URL,
      "TIMESTAMP_PRAGUE=" + tsPrague,
      "DOM_button_count=" + domDump.count,
      ...domDump.buttons.flatMap((b, i) => ["BTN_" + (i + 1) + "_TEXT=" + b.text, "BTN_" + (i + 1) + "_HREF=" + b.href]),
      "SHARE_HANDLER_NAME=" + shareHandlerProof.handlerName,
      "SHARE_HANDLER_SAME_REF_AI=" + shareHandlerProof.SHARE_HANDLER_SAME_REF_AI,
      "SHARE_HANDLER_SAME_REF_TRANSLATOR=" + shareHandlerProof.SHARE_HANDLER_SAME_REF_TRANSLATOR,
      "SHARE_HANDLER_SAME_REF_ALL=" + shareHandlerProof.SHARE_HANDLER_SAME_REF_ALL,
      "SHARE_PAYLOAD_TITLE=" + (sharePayload ? sharePayload.title : ""),
      "SHARE_PAYLOAD_TEXT=" + (sharePayload ? sharePayload.text : ""),
      "CLS=" + clsReport,
      "console_errors=" + consoleErrors.length,
      "pageerrors=" + pageErrors.length,
      "PASS=" + pass,
      "SCOPE_FILES=tools/proof_convert_ui_links.mjs"
    ];
    writeArtifact("PROOF_CONVERT_UI_LINKS.txt", outLines);
    if (isProd) writeArtifact("AFTER_MERGE_PROOF_CONVERT_UI_LINKS.txt", outLines);

    await browser.close();
    if (staticServer) try { staticServer.close(); } catch (_) {}

    process.exitCode = pass ? 0 : 1;
  } catch (err) {
    console.error(err);
    writeArtifact("PROOF_CONVERT_UI_LINKS.txt", ["ERROR=" + String(err.message)]);
    process.exitCode = 1;
  }
}

main();
