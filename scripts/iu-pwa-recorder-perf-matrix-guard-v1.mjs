#!/usr/bin/env node
/**
 * PWA recorder overhead matrix (n>=10, local Playwright). Not a latency proof for prod handoff.
 */
import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const N = Math.max(10, parseInt(process.env.IU_PERF_MATRIX_N || "10", 10));
const PORT = parseInt(process.env.IU_GUARD_PORT || "8978", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/?nosw=1`;

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

function stats(arr) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  return { n: sorted.length, mean: Math.round(mean), p50, p90, min: sorted[0], max: sorted[sorted.length - 1] };
}

async function sample(page, recorderOn) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  if (recorderOn) {
    await page.waitForFunction(() => window.iuPwaReturnRecorder && window.iuPwaReturnRecorder.startRecording, null, {
      timeout: 60000,
    });
    await page.evaluate(() => window.iuPwaReturnRecorder.startRecording());
  }
  return page.evaluate(() => {
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) {
      document.body.getBoundingClientRect();
    }
    return Math.round(performance.now() - t0);
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const off = [];
  const on = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    for (let i = 0; i < N; i++) off.push(await sample(page, false));
    for (let i = 0; i < N; i++) on.push(await sample(page, true));
  } finally {
    await browser.close();
    server.close();
  }
  const offS = stats(off);
  const onS = stats(on);
  const deltaMean = onS.mean - offS.mean;
  console.log(
    JSON.stringify({
      IU_PWA_RECORDER_PERF_MATRIX: "PASS",
      n: N,
      config: "local_playwright_390x844_dom_microbench_not_handoff",
      off: offS,
      on: onS,
      deltaMeanMs: deltaMean,
      note: "warm_after_first_goto; not prod device; handoff excluded",
    })
  );
}

main().catch((e) => {
  console.log("IU_PWA_RECORDER_PERF_MATRIX=FAIL");
  console.log(String(e));
  process.exit(1);
});
