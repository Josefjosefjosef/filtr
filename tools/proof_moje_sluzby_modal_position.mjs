#!/usr/bin/env node
/**
 * Proof: Moje služby modal opens over center feed (not right rail).
 * Verifies: modal_parent_is_feed, modal_centered, modal_not_in_rightRail, CLS=0.
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
  const lines = [];

  try {
    let BASE_URL = process.env.PROOF_BASE_URL || "";
    if (!BASE_URL.trim()) {
      const { server, port } = await startStaticServer(ROOT);
      staticServer = server;
      BASE_URL = `http://127.0.0.1:${port}/projects/`;
    }
    lines.push("URL=" + BASE_URL);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();

    await page.addInitScript(() => { window.__proofCls = 0; });
    await page.goto(BASE_URL, { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(1500);

    await page.evaluate(() => {
      try {
        const obs = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) window.__proofCls += e.value;
        });
        obs.observe({ type: "layout-shift", buffered: false });
      } catch (_) {}
    });

    // Open Banka modal
    await page.evaluate(() => {
      const btn = document.querySelector('[data-iu-modal="banka"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const panel = document.getElementById("iu-mojeSluzbyPanel");
      const overlay = document.getElementById("iu-mojeSluzbyOverlay");
      const rightRail = document.querySelector(".layout > aside.accordionCol");
      const feed = document.getElementById("feed") || document.getElementById("iuCenterStage") || document.querySelector(".iuFeedColumn");
      const feedParent = feed ? feed.closest(".container") : null;

      const out = {};

      // modal_not_in_rightRail: panel and overlay must NOT be descendants of right rail
      const panelInRail = rightRail && panel && rightRail.contains(panel);
      const overlayInRail = rightRail && overlay && rightRail.contains(overlay);
      out.modal_not_in_rightRail = !panelInRail && !overlayInRail;

      // modal_parent_is_feed: panel should be in .container (sibling of .layout), not in accordionCol
      const panelParent = panel ? panel.parentElement : null;
      const panelParentIsContainer = panelParent && panelParent.classList && panelParent.classList.contains("container");
      out.modal_parent_is_feed = panelParentIsContainer;

      // modal_centered: modal center X should be near viewport center (or feed center)
      let modalCenterX = 0;
      let feedCenterX = 0;
      let viewportCenterX = 0;
      if (panel) {
        const rect = panel.getBoundingClientRect();
        modalCenterX = rect.left + rect.width / 2;
      }
      if (feed) {
        const rect = feed.getBoundingClientRect();
        feedCenterX = rect.left + rect.width / 2;
      }
      viewportCenterX = window.innerWidth / 2;

      // Modal should be centered over viewport (within ~100px of center)
      const distFromViewportCenter = Math.abs(modalCenterX - viewportCenterX);
      out.modal_centered = distFromViewportCenter < 150;

      // Modal inner content rect should be within feed width (roughly)
      const modalInner = panel ? panel.querySelector(".iu-aiModal, .iu-mojeSluzbyModal") : null;
      if (modalInner && feed) {
        const mRect = modalInner.getBoundingClientRect();
        const fRect = feed.getBoundingClientRect();
        out.modal_within_feed_width = mRect.left >= fRect.left - 50 && mRect.right <= fRect.right + 50;
      } else {
        out.modal_within_feed_width = true;
      }

      out.modal_center_x = modalCenterX.toFixed(0);
      out.feed_center_x = feedCenterX.toFixed(0);
      out.viewport_center_x = viewportCenterX.toFixed(0);

      return out;
    });

    lines.push("modal_parent_is_feed=" + result.modal_parent_is_feed);
    lines.push("modal_centered=" + result.modal_centered);
    lines.push("modal_not_in_rightRail=" + result.modal_not_in_rightRail);
    lines.push("modal_within_feed_width=" + result.modal_within_feed_width);
    lines.push("modal_center_x=" + result.modal_center_x);
    lines.push("feed_center_x=" + result.feed_center_x);
    lines.push("viewport_center_x=" + result.viewport_center_x);

    const cls = await page.evaluate(() => (window.__proofCls || 0).toFixed(6));
    lines.push("CLS=" + cls);

    const allPass = result.modal_parent_is_feed && result.modal_centered && result.modal_not_in_rightRail && parseFloat(cls) === 0;
    lines.push("PASS=" + allPass);

    const outText = lines.join("\n");
    console.log(outText);

    const artifactName = process.env.PROOF_BASE_URL ? "AFTER_MERGE_PROOF_modal_center.txt" : "PROOF_modal_center_LOCAL.txt";
    writeArtifact(artifactName, outText);

    if (!allPass) process.exit(1);
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (staticServer) staticServer.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
