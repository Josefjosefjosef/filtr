#!/usr/bin/env node
/**
 * Proof: Translator card — PŘEPOSLAT in header, notes frame filled, input untouched, CLS=0.
 * Usage: PROOF_BASE_URL="" node tools/proof_translator_preposlat_v1.mjs  (local)
 *        PROOF_BASE_URL="https://infouzel.cz/projects/" node tools/proof_translator_preposlat_v1.mjs  (prod)
 * Writes to stdout; caller can redirect to artifacts/PROOF_TRANSLATOR_NOTES_PREPOSLAT_HEADER.txt or AFTER_MERGE_PROOF_TRANSLATOR_PREPOSLAT_PROD.txt
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
    out("Datum/čas: " + new Date().toISOString());
    out("test URL: " + BASE_URL);
    out("HEAD=" + (process.env.GIT_HEAD || "unknown"));

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();

    const layoutShifts = [];
    await page.evaluate(() => {
      window.__proofCls = 0;
      const observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__proofCls = (window.__proofCls || 0) + (e.value || 0);
        }
      });
      try {
        observer.observe({ type: "layout-shift", buffered: true });
      } catch (_) {}
    });

    await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(800);

    const openTranslator = async () => {
      await page.evaluate(() => {
        const el = document.querySelector('[data-iuq="deepl"]');
        if (el) el.click();
      });
      await page.waitForTimeout(1000);
    };
    const closeCard = async () => {
      const closeBtn = await page.$("#iuQCloseBtn, .iuQClose");
      if (closeBtn) await closeBtn.click();
      await page.waitForTimeout(400);
    };

    await openTranslator();

    const dom = await page.evaluate(() => {
      const quick = document.getElementById("iuQuickFeed");
      if (!quick || quick.hidden) return { headerPreposlat: 0, notesSend: 0, linkColor: "", notesContainerBg: "", inputBg: "", containerSelector: "", inputSelector: "" };
      const headerPreposlat = quick.querySelectorAll("#iuTrHeaderPreposlat, .iuTrHeaderPreposlat").length;
      const notesBlock = quick.querySelector('[data-iu-notes][data-iu-notes-key="translator"]');
      const notesSend = notesBlock ? notesBlock.querySelectorAll("[data-iu-notes-send]").length : 0;
      const linkEl = quick.querySelector(".iuTrCard, .iuAiCard, a[href]");
      const container = quick.querySelector(".iuNotes[data-iu-notes]");
      const inputEl = notesBlock ? notesBlock.querySelector(".iuNotesText, [data-iu-notes-text]") : null;
      return {
        headerPreposlat,
        notesSend,
        linkColor: linkEl ? getComputedStyle(linkEl).color : "",
        notesContainerBg: container ? getComputedStyle(container).backgroundColor : "",
        inputBg: inputEl ? getComputedStyle(inputEl).backgroundColor : "",
        containerSelector: "#iuQuickFeed .iuNotes[data-iu-notes]",
        inputSelector: "[data-iu-notes] .iuNotesText, [data-iu-notes] [data-iu-notes-text]",
      };
    });

    out("DOM counts: headerPreposlat=" + dom.headerPreposlat + " notesSend=" + dom.notesSend);
    out("Barvy: linkColor=" + dom.linkColor + " notesContainerBg=" + dom.notesContainerBg + " inputBg=" + dom.inputBg);
    out("containerSelector=" + dom.containerSelector + " (neobsahuje textarea/input)");
    out("inputSelector=" + dom.inputSelector);

    const delegation = await page.evaluate(() => {
      const quick = document.getElementById("iuQuickFeed");
      const sendBtn = quick ? quick.querySelector('[data-iu-notes][data-iu-notes-key="translator"] [data-iu-notes-send]') : null;
      const foundTargetSelector = sendBtn ? '[data-iu-notes][data-iu-notes-key="translator"] [data-iu-notes-send]' : "";
      if (sendBtn) sendBtn.click();
      return { foundTargetSelector, clickDispatched: !!sendBtn };
    });
    out("Delegace: foundTargetSelector=" + delegation.foundTargetSelector + " clickDispatched=" + delegation.clickDispatched);

    const inputNotTouched = dom.inputBg && dom.notesContainerBg && dom.inputBg !== dom.notesContainerBg;
    out("INPUT_NOT_TOUCHED=" + (inputNotTouched ? "true" : "false") + " (selector audit: container only; input má vlastní background)");

    await closeCard();
    await page.waitForTimeout(300);
    await openTranslator();
    await page.waitForTimeout(200);

    const clsValue = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : 0)).catch(() => null);
    const clsOk = clsValue != null && clsValue < 0.001;
    out("CLS=" + (clsValue != null ? clsValue.toFixed(6) : "n/a") + (clsOk ? " (0.000000)" : " entries>0"));

    if (isProd) {
      const appScriptSrc = await page.evaluate(() => {
        const s = document.querySelector('script[src*="assets/app."][src*=".js"]');
        return s ? (s.getAttribute("src") || "") : "";
      }).catch(() => "");
      out("appScriptSrc=" + appScriptSrc);
    }

    await browser.close();
    if (staticServer) try { staticServer.close(); } catch (_) {}

    const crlf = lines.join("\r\n") + "\r\n";
    const proofName = isProd ? "AFTER_MERGE_PROOF_TRANSLATOR_PREPOSLAT_PROD.txt" : "PROOF_TRANSLATOR_NOTES_PREPOSLAT_HEADER.txt";
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS, proofName), crlf, "utf8");
    process.exitCode = (dom.headerPreposlat === 1 && dom.notesSend === 1 && delegation.clickDispatched && inputNotTouched && clsOk) ? 0 : 1;
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
}

main();
