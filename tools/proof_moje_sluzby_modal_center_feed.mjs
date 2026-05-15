#!/usr/bin/env node
/**
 * Proof: Moje služby modals (Banka, Bakaláři, Pojistovna) centered over feed.
 * Verifies: modal in #iuModalHost, modal_is_child_of_rightRail=false,
 * modal_within_feed_width, modal_center_delta_px<=1, CLS=0.
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
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

function checkModal(page, modalKind) {
  return page.evaluate((kind) => {
    const panel = document.getElementById("iu-mojeSluzbyPanel");
    const overlay = document.getElementById("iu-mojeSluzbyOverlay");
    const rightRail = document.querySelector(".layout > aside.accordionCol");
    const feed = document.getElementById("feed") || document.getElementById("iuCenterStage");

    const panelInRail = rightRail && panel && rightRail.contains(panel);
    const overlayInRail = rightRail && overlay && rightRail.contains(overlay);
    const inRightRail = panelInRail || overlayInRail;

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
    const modalRect = panel ? panel.getBoundingClientRect() : { left: 0, right: 0 };
    const feedRect = feed ? feed.getBoundingClientRect() : { left: 0, right: 0 };
    const withinFeedWidth = modalRect.left >= feedRect.left - 1 && modalRect.right <= feedRect.right + 1;

    return {
      modal_kind: kind,
      modal_is_child_of_rightRail: inRightRail,
      modal_within_feed_width: withinFeedWidth,
      modal_center_delta_px: centerDeltaPx.toFixed(1),
      center_delta_px: centerDeltaPx
    };
  }, modalKind);
}

async function main() {
  let browser = null;
  let page = null;
  let staticServer = null;
  const consoleErrors = [];
  const pageErrors = [];

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
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => pageErrors.push(String(err.message)));

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

    const modals = ["banka", "bakalari", "pojistovna"];
    const results = [];
    for (const kind of modals) {
      await page.evaluate((k) => {
        const btn = document.querySelector(`[data-iu-modal="${k}"]`);
        if (btn) btn.click();
      }, kind);
      await page.waitForTimeout(500);
      const r = await checkModal(page, kind);
      results.push(r);
      await page.evaluate(() => {
        const closeBtn = document.querySelector("#iu-mojeSluzbyPanel [data-iu-close]");
        if (closeBtn) closeBtn.click();
      });
      await page.waitForTimeout(300);
    }

    const cls = await page.evaluate(() => (window.__proofCls || 0).toFixed(6));
    const allWithin = results.every(r => r.modal_within_feed_width);
    const allDeltaOk = results.every(r => r.center_delta_px <= 1);
    const allNotInRail = results.every(r => !r.modal_is_child_of_rightRail);
    const allPass = allWithin && allDeltaOk && allNotInRail && parseFloat(cls) === 0 && consoleErrors.length === 0 && pageErrors.length === 0;

    out("URL", BASE_URL);
    results.forEach((r, i) => {
      const k = modals[i];
      out("modal_" + k + "_within_feed_width", r.modal_within_feed_width);
      out("modal_" + k + "_center_delta_px", r.modal_center_delta_px);
      out("modal_" + k + "_is_child_of_rightRail", r.modal_is_child_of_rightRail);
    });
    out("CLS", cls);
    out("console_errors", consoleErrors.length);
    out("pageerrors", pageErrors.length);
    out("modal_within_feed_width", allWithin);
    out("modal_center_delta_px_ok", allDeltaOk);
    out("modal_is_child_of_rightRail", results.some(r => r.modal_is_child_of_rightRail) ? "true" : "false");
    out("PASS", allPass);
    out("SCOPE_FILES", "assets/app.js,assets/app.css");
    process.stdout.write("\n");

    const lines = [
      "URL=" + BASE_URL,
      ...results.flatMap((r, i) => [
        "modal_" + modals[i] + "_within_feed_width=" + r.modal_within_feed_width,
        "modal_" + modals[i] + "_center_delta_px=" + r.modal_center_delta_px,
        "modal_" + modals[i] + "_is_child_of_rightRail=" + r.modal_is_child_of_rightRail
      ]),
      "CLS=" + cls,
      "console_errors=" + consoleErrors.length,
      "pageerrors=" + pageErrors.length,
      "modal_within_feed_width=" + allWithin,
      "modal_center_delta_px_ok=" + allDeltaOk,
      "modal_is_child_of_rightRail=" + (results.some(r => r.modal_is_child_of_rightRail) ? "true" : "false"),
      "PASS=" + allPass,
      "SCOPE_FILES=assets/app.js,assets/app.css"
    ];
    const content = lines.join("\n") + "\n";
    const artifactName = process.env.PROOF_BASE_URL ? "AFTER_MERGE_PROOF_MOJE_SLUZBY_MODAL.txt" : "PROOF_MOJE_SLUZBY_MODAL_LOCAL.txt";
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
