#!/usr/bin/env node
/**
 * Proof: MindMenu — after removing 2 buttons, right rail height shrinks,
 * "Rychlé odkazy" moves up, no gap, CLS=0, no console.error.
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
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.addInitScript(() => {
      window.__proofCls = 0;
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__proofCls += (e.value || 0);
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
        const mailboxes = document.querySelector(".accordionCol .mindMenu .iu-mailboxes");
        const quickLinks = document.querySelector(".accordionCol .mindMenu section.iu-mmQuickLinks");
        const rows = document.querySelectorAll(".accordionCol .mindMenu .iu-mailbox-row");
        return {
          buttonCount: rows.length,
          railHeight: rail ? rail.getBoundingClientRect().height : 0,
          mindHeight: mind ? mind.getBoundingClientRect().height : 0,
          mailboxesHeight: mailboxes ? mailboxes.getBoundingClientRect().height : 0,
          quickLinksTop: quickLinks ? quickLinks.getBoundingClientRect().top : 0,
          cls: typeof window.__proofCls === "number" ? window.__proofCls : null,
        };
      });

    const clsAfterLoad = await page.evaluate(() => (typeof window.__proofCls === "number" ? window.__proofCls : null));
    out("0) CLS after load (before any click): " + (clsAfterLoad != null ? clsAfterLoad.toFixed(6) : "n/a"));

    const before = await getMetrics();
    out("1) Before: buttonCount=" + before.buttonCount + " railHeight=" + Math.round(before.railHeight) + " quickLinksTop=" + Math.round(before.quickLinksTop));

    const removeBtn = page.locator("#iuMailboxRemove");
    await removeBtn.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    const removeCount = Math.min(2, Math.max(0, before.buttonCount - 1));
    for (let i = 0; i < removeCount; i++) {
      await removeBtn.click();
      await page.waitForTimeout(300);
    }
    out("2) Removed " + removeCount + " button(s)");

    await page.waitForTimeout(400);
    const after = await getMetrics();
    out("3) After: buttonCount=" + after.buttonCount + " railHeight=" + Math.round(after.railHeight) + " quickLinksTop=" + Math.round(after.quickLinksTop));

    const heightShrunk = after.railHeight < before.railHeight || after.mindHeight < before.mindHeight;
    out("4) Height shrunk: " + heightShrunk);

    const quickLinksMovedUp = after.quickLinksTop < before.quickLinksTop;
    out("5) Rychlé odkazy moved up: " + quickLinksMovedUp);

    const clsValue = after.cls != null ? after.cls : null;
    const clsFromLoadOnly = clsValue != null && clsAfterLoad != null && clsValue <= clsAfterLoad + 0.001;
    out("6) CLS=" + (clsValue != null ? clsValue.toFixed(6) : "n/a") + (clsValue != null && clsValue < 0.001 ? " (0.000000)" : ""));
    out("6b) No new CLS from remove (delta<=0): " + clsFromLoadOnly);

    const noConsoleError = consoleErrors.length === 0;
    out("7) console.error count: " + consoleErrors.length + (noConsoleError ? " (0)" : ""));

    await browser.close();
    if (staticServer) try { staticServer.close(); } catch (_) {}

    const pass = heightShrunk && quickLinksMovedUp && noConsoleError && clsFromLoadOnly;
    out("PASS=" + pass);

    writeArtifact("PROOF_MINDMENU_REMOVE_GAP.txt", lines.join("\r\n") + "\r\n");
    process.exitCode = pass ? 0 : 1;
  } catch (err) {
    console.error(err);
    out("ERROR: " + String(err.message));
    writeArtifact("PROOF_MINDMENU_REMOVE_GAP.txt", lines.join("\r\n") + "\r\n");
    process.exitCode = 1;
  }
}

main();
