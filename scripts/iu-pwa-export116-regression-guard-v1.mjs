#!/usr/bin/env node
/**
 * Export 116 (Dokument 116.docx) — affiliate shell hidden attr, MindMenu boot after navigate doc, log retention.
 * Physical export not parsed in CI; repro uses documented shapes from recordingAttemptId amv9dyz4hhj5u baseline.
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const rec = read("assets/iu-pwa-return-recorder-v1.js");
  const app = read("assets/app.js");
  const cat = read("assets/iu-affiliate-catalog.js");
  const feed = read("assets/iu-app-feed-pipeline-v1.js");
  const html = read("projects/index.html");

  must(/pwa-return-recorder-v9-20261016-export118-video-home-diag/.test(rec), "static:recorder_build");
  must(/ATTEMPT_STARTED_AT_KEY/.test(rec), "static:attempt_started_persist");
  must(/tiered_priority_v10_export116/.test(rec), "static:evict_policy_v10");
  must(/iuSetElOpenVisible\(el, open\)/.test(app), "static:showview_hidden_toggle");
  must(/view\.removeAttribute\("hidden"\)/.test(cat), "static:affiliate_unhide_on_render");
  must(/iuMindMenuEnsureReturnBootClass/.test(feed), "static:mm_ensure_return_boot");
  must(!/__iuMmReturnBootRelease\("restore-if-armed"\)/.test(feed), "static:no_premature_boot_release");
  must(html.includes("export118-video-home-diag"), "static:index_recorder_token");
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
        if (urlPath.endsWith("/")) urlPath += "index.html";
        const filePath = path.join(REPO, urlPath.replace(/^\/+/, ""));
        if (!filePath.startsWith(REPO) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
          res.writeHead(404);
          res.end("nf");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime =
          ext === ".html"
            ? "text/html; charset=utf-8"
            : ext === ".js"
              ? "text/javascript; charset=utf-8"
              : "application/octet-stream";
        res.writeHead(200, { "content-type": mime });
        res.end(fs.readFileSync(filePath));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function affiliateHiddenFixGate(server) {
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const base = `http://127.0.0.1:${port}/projects/?nosw=1&section=aff-kosmetika`;
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => typeof window.iuAffiliateApplySection === "function", null, { timeout: 90000 });
    await page.evaluate(() => {
      window.iuAffiliateApplySection("aff-kosmetika");
    });
    const snap = await page.evaluate(() => {
      var v = document.getElementById("iuAffiliateView");
      var cs = document.getElementById("iuCenterStage");
      var chips = document.querySelectorAll("#iuAffiliateGrid a.iuAffiliateChip[data-aff-ready='1']");
      return {
        htmlHidden: v ? v.hidden : null,
        hasHiddenAttr: v ? v.hasAttribute("hidden") : null,
        dataView: cs ? cs.getAttribute("data-view") : "",
        readyChips: chips.length,
      };
    });
    must(snap.dataView === "affiliate", "ui:center_data_view_affiliate");
    must(snap.hasHiddenAttr === false, "ui:aff_view_hidden_removed");
    must(snap.readyChips >= 1, "ui:aff_partner_chips_ready");
    await page.waitForFunction(() => window.iuPwaReturnRecorder && window.iuPwaReturnRecorder.getAffiliateContentMetrics, null, {
      timeout: 90000,
    });
    const m = await page.evaluate(() => window.iuPwaReturnRecorder.getAffiliateContentMetrics());
    must(m && m.contentReadinessScope === true, "ui:readiness_scope");
    must(m && m.affiliateProbe && m.affiliateProbe.sectionActive === true, "ui:section_active_after_unhide");
  } finally {
    await browser.close();
  }
}

async function mindMenuBootGate(server) {
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      try {
        Object.defineProperty(navigator, "standalone", { get: () => true });
      } catch (_) {}
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/projects/?nosw=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => typeof window.iuMindMenuEnsureReturnBootClass === "function", null, { timeout: 120000 });
    await page.evaluate(() => {
      localStorage.setItem(
        "iuMindMenuReturnPendingV1",
        JSON.stringify({ t: Date.now(), y: 809, ai: 0, aiY: 0 })
      );
      window.iuMindMenuEnsureReturnBootClass();
    });
    const boot = await page.evaluate(() => ({
      boot: document.documentElement.classList.contains("iu-mm-return-boot"),
      silverHidden: (() => {
        var el = document.getElementById("iuMobileSilverSlot");
        if (!el) return null;
        var st = getComputedStyle(el);
        return st.visibility === "hidden" || st.display === "none";
      })(),
    }));
    must(boot.boot === true, "ui:mm_return_boot_class");
    must(boot.silverHidden === true, "ui:silver_hidden_under_boot");
  } finally {
    await browser.close();
  }
}

async function main() {
  staticGate();
  const server = await startServer();
  try {
    await affiliateHiddenFixGate(server);
    await mindMenuBootGate(server);
  } finally {
    server.close();
  }
  if (fails.length) {
    console.log("IU_PWA_EXPORT116_REGRESSION_GUARD=FAIL");
    console.log(fails.join(","));
    process.exit(1);
  }
  console.log("IU_PWA_EXPORT116_REGRESSION_GUARD=PASS");
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
