#!/usr/bin/env node
/**
 * Proof: Moje služby modal anchored to center feed.
 * Verifies: modal_parent_is_feed, modal_not_in_rightRail, modal_within_feed_width,
 * modal_centered (delta<=2), CLS=0. Output: 1 metric per line (LF).
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

function writeArtifact(name, lines) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const outPath = path.join(ARTIFACTS, name);
  const content = (Array.isArray(lines) ? lines.join("\n") : String(lines)) + "\n";
  fs.writeFileSync(outPath, content, "utf8");
  return outPath;
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

    await page.evaluate(() => {
      const btn = document.querySelector('[data-iu-modal="banka"]');
      if (btn) btn.click();
    });
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const panel = document.getElementById("iu-mojeSluzbyPanel");
      const overlay = document.getElementById("iu-mojeSluzbyOverlay");
      const rightRail = document.querySelector(".layout > aside.accordionCol");
      const feed = document.getElementById("feed") || document.getElementById("iuCenterStage");

      const out = {};

      const panelInRail = rightRail && panel && rightRail.contains(panel);
      const overlayInRail = rightRail && overlay && rightRail.contains(overlay);
      out.modal_not_in_rightRail = !panelInRail && !overlayInRail;

      const panelParent = panel ? panel.parentElement : null;
      out.modal_parent_is_feed = !!(panelParent && panelParent.classList && panelParent.classList.contains("container"));

      let modalCenterX = 0;
      let feedCenterX = 0;
      const modalInner = panel ? panel.querySelector(".iu-aiModal, .iu-mojeSluzbyModal") : panel;
      const el = modalInner || panel;
      if (el) {
        const rect = el.getBoundingClientRect();
        modalCenterX = rect.left + rect.width / 2;
      }
      if (feed) {
        const fRect = feed.getBoundingClientRect();
        feedCenterX = fRect.left + fRect.width / 2;
      }

      const centerDeltaPx = Math.abs(modalCenterX - feedCenterX);
      out.modal_centered = centerDeltaPx <= 2;
      out.center_delta_px = centerDeltaPx.toFixed(1);

      const modalRect = panel ? panel.getBoundingClientRect() : { left: 0, right: 0 };
      const feedRect = feed ? feed.getBoundingClientRect() : { left: 0, right: 0 };
      out.modal_within_feed_width = modalRect.left >= feedRect.left - 1 && modalRect.right <= feedRect.right + 1;

      out.modal_center_x = modalCenterX.toFixed(1);
      out.feed_center_x = feedCenterX.toFixed(1);

      return out;
    });

    const cls = await page.evaluate(() => (window.__proofCls || 0).toFixed(6));
    const allPass = result.modal_parent_is_feed &&
      result.modal_not_in_rightRail &&
      result.modal_within_feed_width &&
      result.modal_centered &&
      parseFloat(cls) === 0;

    out("URL", BASE_URL);
    out("modal_parent_is_feed", result.modal_parent_is_feed);
    out("modal_not_in_rightRail", result.modal_not_in_rightRail);
    out("modal_within_feed_width", result.modal_within_feed_width);
    out("modal_center_x", result.modal_center_x);
    out("feed_center_x", result.feed_center_x);
    out("center_delta_px", result.center_delta_px);
    out("CLS", cls);
    out("PASS", allPass);
    process.stdout.write("\n");

    const lines = [
      "URL=" + BASE_URL,
      "modal_parent_is_feed=" + result.modal_parent_is_feed,
      "modal_not_in_rightRail=" + result.modal_not_in_rightRail,
      "modal_within_feed_width=" + result.modal_within_feed_width,
      "modal_center_x=" + result.modal_center_x,
      "feed_center_x=" + result.feed_center_x,
      "center_delta_px=" + result.center_delta_px,
      "CLS=" + cls,
      "PASS=" + allPass
    ];
    const content = lines.join("\n") + "\n";
    const artifactName = process.env.PROOF_BASE_URL ? "AFTER_MERGE_PROOF_modal_center.txt" : "PROOF_modal_center_LOCAL.txt";
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS, artifactName), content, "utf8");

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
