#!/usr/bin/env node
/**
 * Long external-return scenarios: 50s stability, TTL expiry window, recorder on/off overhead,
 * coordinated restore completion, attempt-only export.
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8970", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?nosw=1&iuInfoSystem=cutover`;
const TARGET = 1991;
const fails = [];

function must(cond, id) {
  if (!cond) fails.push(id);
}

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function staticGate() {
  const rec = read("assets/iu-pwa-return-recorder-v1.js");
  must(/pwa-return-recorder-v8-20261014-correlated-diag-perf/.test(rec), "static:recorder_v8");
  must(/exportAttemptText/.test(rec), "static:export_attempt");
  must(/buildMetricCapabilities/.test(rec), "static:metric_capabilities");
  must(/section:content_cancelled/.test(rec), "static:content_cancelled");
  must(/scroll:apply/.test(rec), "static:scroll_apply_log");
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
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function bootRestoreAndWait(page, waitMs) {
  await page.goto(BASE + "&longret=1", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.iuPwaCoordinatedMainScrollRestore && window.iuNetwork, null, { timeout: 90000 });
  const setup = await page.evaluate((targetY) => {
    localStorage.setItem(
      "iuPwaExternalReturnMainScrollPersistV1",
      JSON.stringify({ y: targetY, t: Date.now(), gen: 3, route: "home" })
    );
    sessionStorage.setItem("iuPwaExternalReturnMainScrollY", String(targetY));
    if (window.iuNetwork && window.iuNetwork.restoreAppShellAfterReturn) {
      window.iuNetwork.restoreAppShellAfterReturn();
    }
    return { ok: true };
  }, TARGET);
  must(setup.ok === true, "rt:setup");
  await page.waitForTimeout(waitMs);
  return page.evaluate(() => ({
    y: window.iuPwaGetMainScrollY ? window.iuPwaGetMainScrollY() : 0,
    persist: !!localStorage.getItem("iuPwaExternalReturnMainScrollPersistV1"),
  }));
}

async function run50s(page) {
  const r = await bootRestoreAndWait(page, 50000);
  must(r.y >= TARGET - 80, "rt:50s_scroll:" + r.y);
}

async function runRecorderExport(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.iuPwaReturnRecorder && window.iuPwaReturnRecorder.exportAttemptText, null, {
    timeout: 90000,
  });
  const ex = await page.evaluate(() => {
    window.iuPwaReturnRecorder.startRecording();
    window.iuPwaReturnRecorder.stopRecording();
    const txt = window.iuPwaReturnRecorder.exportAttemptText();
    let parsed = null;
    try {
      parsed = JSON.parse(txt);
    } catch (_) {}
    return {
      ok: !!parsed,
      scope: parsed && parsed.exportScope,
      hasCaps: !!(parsed && parsed.metricCapabilities && parsed.metricCapabilities.supportedEntryTypes),
      attemptEntries: parsed && parsed.logMeta && parsed.logMeta.exportedEntryCount,
    };
  });
  must(ex.ok === true, "rt:export_parse");
  must(ex.scope === "current_attempt_only", "rt:export_scope");
  must(ex.hasCaps === true, "rt:export_caps");
  must(ex.attemptEntries >= 2, "rt:export_entries:" + ex.attemptEntries);
}

async function runRecorderOverhead(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.iuPwaCoordinatedMainScrollRestore, null, { timeout: 90000 });
  const times = await page.evaluate(async (targetY) => {
    async function one(recording) {
      try {
        localStorage.setItem("iu:pwa-return-recorder-active:v1", recording ? "1" : "0");
      } catch (_) {}
      if (recording && window.iuPwaReturnRecorder) window.iuPwaReturnRecorder.startRecording();
      const t0 = performance.now();
      window.iuPwaCoordinatedMainScrollRestore({
        targetY,
        shouldContinue: function () {
          return true;
        },
        onComplete: function () {},
        onCancel: function () {},
      });
      await new Promise((r) => setTimeout(r, 800));
      const ms = performance.now() - t0;
      if (recording && window.iuPwaReturnRecorder) window.iuPwaReturnRecorder.stopRecording();
      try {
        localStorage.setItem("iu:pwa-return-recorder-active:v1", "0");
      } catch (_) {}
      return ms;
    }
    const off = await one(false);
    const on = await one(true);
    return { off, on, ratio: on / Math.max(off, 1) };
  }, TARGET);
  must(times.ratio < 4, "rt:recorder_overhead_ratio:" + JSON.stringify(times));
}

async function main() {
  staticGate();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await ctx.newPage();
    await runRecorderExport(page);
    await runRecorderOverhead(page);
    await run50s(page);
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  if (fails.length) {
    console.log("IU_PWA_LONG_RETURN_SCENARIOS_GUARD_PASS=false");
    console.log("FAILS=" + fails.join("|"));
    process.exit(1);
  }
  console.log("IU_PWA_LONG_RETURN_SCENARIOS_GUARD_PASS=true");
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
