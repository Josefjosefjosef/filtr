#!/usr/bin/env node
/**
 * Proof: MindMenu — after removing 2 buttons, right rail height shrinks,
 * "Rychlé odkazy" moves up, no gap. CLS_LOAD = 0, CLS_AFTER_REMOVE = 0, console/pageerror = 0.
 * Writes: artifacts/PROOF_MINDMENU_REMOVE_GAP.txt
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
  fs.writeFileSync(path.join(ARTIFACTS, name), String(text).replace(/\r?\n/g, "\r\n"), "utf8");
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

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => pageErrors.push(String(err.message)));

    await page.addInitScript(() => {
      window.__proofCls = 0;
      window.__proofShiftEntries = [];
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) {
            if (e.hadRecentInput) continue;
            window.__proofCls += (e.value || 0);
            const entry = { value: e.value };
            if (e.sources && e.sources.length) {
              entry.sources = e.sources.slice(0, 3).map((s) => ({
                node: s.node ? { tagName: s.node.tagName, className: (s.node.className || "").slice(0, 80), id: (s.node.id || "").slice(0, 40) } : null,
              }));
            }
            window.__proofShiftEntries.push(entry);
          }
        });
        obs.observe({ type: "layout-shift", buffered: true });
      } catch (_) {}
    });

    await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(2000);

    const getMetrics = () =>
      page.evaluate(() => {
        const rail = document.querySelector(".layout > aside.accordionCol");
        const mind = document.querySelector(".accordionCol .mindMenu");
        const quickLinks = document.querySelector(".accordionCol .mindMenu section.iu-mmQuickLinks");
        const rows = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-row");
        return {
          buttonCount: rows.length,
          railHeight: rail ? rail.getBoundingClientRect().height : 0,
          mindHeight: mind ? mind.getBoundingClientRect().height : 0,
          quickLinksTop: quickLinks ? quickLinks.getBoundingClientRect().top : 0,
          cls: typeof window.__proofCls === "number" ? window.__proofCls : null,
        };
      });

    const clsLoad = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : null));
    const before = await getMetrics();

    out("CLS_LOAD=" + (clsLoad != null ? clsLoad.toFixed(6) : "n/a"));
    out("buttons_before=" + before.buttonCount);
    out("mindmenu_height_before=" + Math.round(before.mindHeight));
    out("quicklinks_top_before=" + Math.round(before.quickLinksTop));

    const removeBtn = page.locator("#iuMailboxRemove");
    await removeBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    const removeCount = Math.min(2, Math.max(0, before.buttonCount - 1));
    for (let i = 0; i < removeCount; i++) {
      await removeBtn.click();
      await page.waitForTimeout(350);
    }
    out("removed_buttons=" + removeCount);

    await page.waitForTimeout(500);
    const after = await getMetrics();
    const clsAfter = after.cls;

    out("CLS_AFTER_REMOVE=" + (clsAfter != null ? clsAfter.toFixed(6) : "n/a"));
    out("buttons_after=" + after.buttonCount);
    out("mindmenu_height_after=" + Math.round(after.mindHeight));
    out("quicklinks_top_after=" + Math.round(after.quickLinksTop));
    out("console_errors_count=" + consoleErrors.length);
    out("pageerror_count=" + pageErrors.length);

    const heightShrunk = after.railHeight < before.railHeight || after.mindHeight < before.mindHeight;
    const quickLinksMovedUp = after.quickLinksTop < before.quickLinksTop;
    const noConsoleError = consoleErrors.length === 0;
    const noPageError = pageErrors.length === 0;

    if (clsLoad != null && clsLoad >= 0.001) {
      const entries = await page.evaluate(() => (window.__proofShiftEntries || []).slice(-10));
      out("layout_shift_entries_last10=" + JSON.stringify(entries));
    }
    if (clsAfter != null && clsAfter >= 0.001) {
      const entries = await page.evaluate(() => (window.__proofShiftEntries || []).slice(-10));
      out("layout_shift_entries_after_remove_last10=" + JSON.stringify(entries));
    }

    out("height_shrunk=" + heightShrunk);
    out("quicklinks_moved_up=" + quickLinksMovedUp);

    const clsLoadOk = clsLoad != null && clsLoad < 0.001;
    const clsAfterOk = clsAfter != null && clsAfter < 0.001;
    if (!clsLoadOk) throw new Error("CLS_LOAD must be 0.000000, got " + clsLoad);
    if (!clsAfterOk) throw new Error("CLS_AFTER_REMOVE must be 0.000000, got " + clsAfter);

    const pass = heightShrunk && quickLinksMovedUp && noConsoleError && noPageError && clsLoadOk && clsAfterOk;
    out("PASS=" + pass);

    writeArtifact("PROOF_MINDMENU_REMOVE_GAP.txt", lines.join("\r\n") + "\r\n");

    await browser.close();
    if (staticServer) try { staticServer.close(); } catch (_) {}

    process.exitCode = pass ? 0 : 1;
  } catch (err) {
    console.error(err);
    out("ERROR: " + String(err.message));
    writeArtifact("PROOF_MINDMENU_REMOVE_GAP.txt", lines.join("\r\n") + "\r\n");
    process.exitCode = 1;
  }
}

main();
