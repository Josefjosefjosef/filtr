#!/usr/bin/env node
/**
 * Export-116-class recorder load: multi-document returns, high event volume, export completeness.
 * Output summary: %TEMP%/iu_pwa_recorder_export116_load_summary.json
 * Full scale (1777 events / 17 boots): IU_EXPORT116_LOAD_FULL=1 (slow, local proof).
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const FULL = process.env.IU_EXPORT116_LOAD_FULL === "1";
const HANDOFFS = FULL ? 14 : 14;
const BOOTS = FULL ? 17 : 4;
const TRACE_BURST = FULL ? 120 : 48;
const FETCH_BURST = FULL ? 80 : 30;
const OUT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_pwa_recorder_export116_load_summary.json");

const fails = [];
function must(cond, id) {
  if (!cond) fails.push(id);
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

function validateExport(parsed, entries) {
  const types = {};
  for (const e of entries) {
    const ev = e.ev || e.type;
    types[ev] = (types[ev] || 0) + 1;
  }
  const returnOps = new Set();
  for (const e of entries) {
    const d = e.detail || {};
    if (d.returnOpId) returnOps.add(d.returnOpId);
    const c = d.correlation || {};
    if (c.returnOpId) returnOps.add(c.returnOpId);
  }
  const boots = entries.filter((e) => (e.ev || e.type) === "document:boot");
  const teardown = entries.some((e) => (e.ev || e.type) === "recorder:teardown");
  const stopEv = entries.some((e) => (e.ev || e.type) === "recorder:stop");
  const withElapsed = entries.filter(
    (e) => e.detail && e.detail.correlation && e.detail.correlation.attemptElapsedMs != null
  );
  const meta = parsed.logMeta || {};
  const serialized = parsed.logMeta && parsed.logMeta.serializedExportChars;
  return { types, returnOps: returnOps.size, boots: boots.length, teardown, stopEv, withElapsed: withElapsed.length, meta, serialized };
}

async function runLoad(page, base) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.iuPwaReturnRecorder && window.iuNetwork, null, { timeout: 90000 });
  await page.evaluate(() => {
    window.iuPwaReturnRecorder.startRecording();
  });

  for (let h = 0; h < HANDOFFS; h++) {
    await page.evaluate((i) => {
      const r = window.iuPwaReturnRecorder;
      r.ingestTrace("external_handoff", { n: i, quality: "synthetic_load" });
      r.ingestTrace("restore_start", { n: i, quality: "synthetic_load" });
      r.ingestTrace("settle_done", { ms: 12 + i, quality: "synthetic_load" });
    }, h);
  }

  for (let b = 0; b < BOOTS; b++) {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.iuPwaReturnRecorder, null, { timeout: 90000 });
    await page.evaluate(() => {
      try {
        if (localStorage.getItem("iu:pwa-return-recorder-active:v1") !== "1") {
          window.iuPwaReturnRecorder.startRecording();
        }
      } catch (_) {
        window.iuPwaReturnRecorder.startRecording();
      }
    });
  }

  await page.evaluate(
    async (cfg) => {
      const r = window.iuPwaReturnRecorder;
      for (let i = 0; i < cfg.traceBurst; i++) {
        r.ingestTrace("view:frame", { i, quality: "synthetic_low" });
      }
      for (let j = 0; j < cfg.fetchBurst; j++) {
        try {
          await fetch("/projects/version.json?iuRecLoad=" + j, { cache: "no-store" });
        } catch (_) {}
      }
    },
    { traceBurst: TRACE_BURST, fetchBurst: FETCH_BURST }
  );

  await page.waitForTimeout(400);
  const raw = await page.evaluate(() => {
    window.iuPwaReturnRecorder.stopRecording();
    return window.iuPwaReturnRecorder.exportAttemptText();
  });

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {}
  const entries = (parsed && parsed.log && parsed.log.entries) || [];
  const v = validateExport(parsed, entries);

  must(!!parsed, "export:json_parse");
  must(v.stopEv, "export:recorder_stop");
  must(v.teardown, "export:recorder_teardown");
  must(v.boots >= Math.min(3, BOOTS), "export:document_boots:" + v.boots);
  must(v.returnOps >= Math.min(3, HANDOFFS), "export:return_ops:" + v.returnOps);
  must(entries.length >= (FULL ? 400 : 80), "export:entry_count:" + entries.length);
  must(v.withElapsed >= 1, "export:attempt_elapsed_present:" + v.withElapsed);
  if (parsed.logMeta && parsed.logMeta.maxJsonChars) {
    const ser = JSON.stringify(parsed).length;
    must(ser <= parsed.logMeta.maxJsonChars + 5000, "export:serialized_within_cap:" + ser);
  }

  const summary = {
    pass: fails.length === 0,
    fullScale: FULL,
    handoffs: HANDOFFS,
    bootsTarget: BOOTS,
    exportedEntries: entries.length,
    dropped: v.meta.droppedEntries,
    documentBoots: v.boots,
    returnOps: v.returnOps,
    teardown: v.teardown,
    attemptElapsedSamples: v.withElapsed,
    fails: fails.slice(),
    note: FULL ? "export116_full_scale_requested" : "export116_ci_scaled_representative",
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  return summary;
}

async function main() {
  const server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/projects/?nosw=1`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const summary = await runLoad(page, base);
    console.log("IU_PWA_RECORDER_EXPORT116_LOAD_GUARD=" + (summary.pass ? "PASS" : "FAIL"));
    console.log(OUT);
    console.log(JSON.stringify(summary));
    if (fails.length) {
      console.log(fails.join(","));
      process.exit(1);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.log(String(e));
  process.exit(1);
});
