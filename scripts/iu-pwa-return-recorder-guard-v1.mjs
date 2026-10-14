#!/usr/bin/env node
/**
 * Guard: iCentrum → Diagnostika PWA → start/stop/copy (local recorder, no upload).
 * Run: npm run iu-pwa-return-recorder-guard
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8962", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?nosw=1&iuInfoSystem=cutover`;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const html = read("projects/index.html");
  const rec = read("assets/iu-pwa-return-recorder-v1.js");
  must(html.includes("Diagnostika PWA"), "static:tile_label");
  must(html.includes('data-iu-info-section="pwa-diag"'), "static:tile_section");
  must(html.includes("iuPwaDiagStartBtn"), "static:start_btn");
  must(html.includes("iu-pwa-return-recorder-v1.js"), "static:script_tag");
  must(/window\.iuPwaReturnRecorder\s*=/.test(rec), "static:recorder_api");
  must(/iu:pwa-return-recorder-log:v1/.test(rec), "static:log_key");
  must(/pwa-return-recorder-v5-20261014-home-visible-probes/.test(rec), "static:recorder_build_id");
  must(/ingestSectionApplyStart/.test(rec), "static:section_apply_ingest");
  must(/ingestNavIntent/.test(rec), "static:nav_intent_ingest");
  must(/back:click/.test(rec), "static:back_click_event");
  must(/mmArmed:/.test(rec), "static:session_mmArmed_field");
  must(/visualLayerSnapshot/.test(rec), "static:display_snapshot");
  must(/tabSessionSid/.test(rec), "static:tab_session_sid");
  must(html.includes("pwa-return-recorder-v5-20261014-home-visible-probes"), "static:recorder_cache_bust");
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
              : ext === ".css"
                ? "text/css; charset=utf-8"
                : ext === ".json"
                  ? "application/json"
                  : "application/octet-stream";
        res.writeHead(200, { "content-type": mime });
        res.end(fs.readFileSync(filePath));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function openInfoCenter(page) {
  return page.evaluate(() => {
    const candidates = [
      document.getElementById("iuTopbarInfoBtn"),
      document.getElementById("iuSilverWelcomeInfoBtn"),
      document.querySelector("[data-iu-mobile-gate-info-btn]"),
    ].filter(Boolean);
    if (!candidates.length) return { ok: false };
    let target =
      candidates.find((el) => {
        const r = el.getBoundingClientRect();
        const st = window.getComputedStyle(el);
        return st.display !== "none" && st.visibility !== "hidden" && r.width > 0 && r.height > 0;
      }) || candidates[0];
    target.click();
    return { ok: true, id: target.id || "gate-info" };
  });
}

async function runUiGate(page) {
  await page.goto(BASE, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(3500);
  await page.waitForFunction(() => window.iuPwaReturnRecorder && window.iuNetwork, null, { timeout: 60000 });

  const opened = await openInfoCenter(page);
  must(opened.ok === true, "ui:open_icentrum");

  const diagTile = page.locator('.iuInfoCenter__tile[data-iu-info-section="pwa-diag"]');
  await diagTile.waitFor({ state: "visible", timeout: 15000 });
  await diagTile.click({ timeout: 10000 });

  const startBtn = page.locator("#iuPwaDiagStartBtn");
  await startBtn.click();

  const recording = await page.evaluate(() => window.iuPwaReturnRecorder.isRecording());
  must(recording === true, "ui:recording_after_start");

  const closeBtn = page.locator("#iuTopbarInfoOverlayClose");
  await closeBtn.click({ force: true });

  await page.waitForTimeout(400);

  const stillRecording = await page.evaluate(() => window.iuPwaReturnRecorder.isRecording());
  must(stillRecording === true, "ui:recording_after_close_panel");

  const reopened = await openInfoCenter(page);
  must(reopened.ok === true, "ui:reopen_icentrum");
  await diagTile.waitFor({ state: "visible", timeout: 15000 });
  await diagTile.click();

  const stopBtn = page.locator("#iuPwaDiagStopBtn");
  await stopBtn.click();

  const stopped = await page.evaluate(() => !window.iuPwaReturnRecorder.isRecording());
  must(stopped === true, "ui:stopped");

  await page.locator("#iuPwaDiagCopyBtn").click();

  const exportOk = await page.evaluate(() => {
    const txt = window.iuPwaReturnRecorder.exportText();
    let parsed = null;
    try {
      parsed = JSON.parse(txt);
    } catch (_) {}
    return {
      ok: typeof txt === "string" && txt.length > 40 && txt.indexOf("recorder:start") >= 0,
      recorderBuildId: parsed && parsed.recorderBuildId,
      hasSessionMmArmed: txt.indexOf('"mmArmed"') >= 0,
      hasDisplay: txt.indexOf('"homeFeedVisible"') >= 0,
      hasDelivery: !!(
        parsed &&
        parsed.delivery &&
        typeof parsed.delivery === "object" &&
        parsed.delivery.recorderBuildId === "pwa-return-recorder-v5-20261014-home-visible-probes"
      ),
      tabSid: parsed && parsed.tabSessionSid,
      docSid: parsed && parsed.documentSid,
    };
  });
  must(exportOk.ok === true, "ui:export_has_entries");
  must(exportOk.recorderBuildId === "pwa-return-recorder-v5-20261014-home-visible-probes", "ui:export_recorder_build");
  must(exportOk.hasSessionMmArmed === true, "ui:export_session_mmArmed");
  must(exportOk.hasDisplay === true, "ui:export_display_field");
  must(exportOk.hasDelivery === true, "ui:export_delivery_proof");

  await page.locator("#iuPwaDiagClearBtn").click();
  const cleared = await page.evaluate(() => {
    try {
      return !localStorage.getItem("iu:pwa-return-recorder-log:v1");
    } catch (_) {
      return true;
    }
  });
  must(cleared, "ui:cleared_log");
}

async function main() {
  staticGate();
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await runUiGate(page);
    await context.close();
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  if (fails.length) {
    console.error("FAIL iu-pwa-return-recorder-guard:", fails.join(", "));
    process.exit(1);
  }
  console.log("PASS iu-pwa-return-recorder-guard");
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
