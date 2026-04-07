#!/usr/bin/env node
/**
 * Raw Cumulative Layout Shift (CLS) proof — no thresholding, no <0.02→0 mapping.
 * Prints full-precision sums and per-entry value/startTime/sources (element hints).
 *
 * Env:
 *   PROOF_BASE_URL — if set, load this URL (e.g. https://infouzel.cz/projects/?debug=1&nosw=1&section=media).
 *                    If unset, serves repo root on 127.0.0.1 and uses /projects/?debug=1&nosw=1&section=media
 *   PROOF_WAIT_MS  — settle time after load/reload (default 2000)
 *
 * Exit code: 0 only if initial_load_raw_cls === 0 && reload_raw_cls === 0 (strict).
 */
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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
        if (err) {
          res.writeHead(404);
          res.end();
          return;
        }
        const ext = path.extname(p);
        const ct =
          ext === ".html"
            ? "text/html"
            : ext === ".js"
              ? "application/javascript"
              : ext === ".css"
                ? "text/css"
                : "application/octet-stream";
        res.setHeader("Content-Type", ct);
        res.end(data);
      });
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

function installClsHooks() {
  window.__rawClsSum = 0;
  window.__rawClsLog = [];
  window.__iuPageshowPersisted = null;
  try {
    window.addEventListener(
      "pageshow",
      (ev) => {
        try {
          window.__iuPageshowPersisted = !!ev.persisted;
        } catch (_) {}
      },
      true
    );
  } catch (_) {}
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__rawClsSum += e.value;
        const sources = (e.sources || []).map((s) => {
          const n = s && s.node;
          if (!n || n.nodeType !== 1) return "(non-element)";
          const el = n;
          const id = el.id ? "#" + el.id : "";
          const cl = el.className
            ? "." +
              String(el.className)
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .join(".")
            : "";
          return (el.tagName || "?").toLowerCase() + id + cl;
        });
        window.__rawClsLog.push({
          value: e.value,
          startTime: e.startTime,
          sources,
        });
      }
    });
    po.observe({ type: "layout-shift", buffered: true });
  } catch (err) {
    window.__clsErr = String(err && err.message);
  }
}

async function main() {
  const waitMs = Math.max(0, parseInt(process.env.PROOF_WAIT_MS || "2000", 10) || 2000);
  let staticServer = null;
  let url = (process.env.PROOF_BASE_URL || "").trim();
  if (!url) {
    staticServer = await startStaticServer(ROOT);
    const port = staticServer.address().port;
    url = `http://127.0.0.1:${port}/projects/?debug=1&nosw=1&section=media`;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--force-device-scale-factor=1"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.addInitScript(installClsHooks);

  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  try {
    await page.evaluate(() => window.scrollTo(0, 0));
  } catch (_) {}
  await page.waitForTimeout(waitMs);

  const initial = await page.evaluate(() => ({
    sum: window.__rawClsSum,
    log: window.__rawClsLog ? window.__rawClsLog.slice() : [],
    err: window.__clsErr || null,
    pageshowPersisted: window.__iuPageshowPersisted,
  }));

  await page.evaluate(() => {
    window.__rawClsSum = 0;
    window.__rawClsLog = [];
  });

  await page.reload({ waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(waitMs);

  const afterReload = await page.evaluate(() => ({
    sum: window.__rawClsSum,
    log: window.__rawClsLog ? window.__rawClsLog.slice() : [],
    pageshowPersisted: window.__iuPageshowPersisted,
  }));

  const out = {
    url,
    initial_load_raw_cls: initial.sum,
    initial_entries: initial.log,
    reload_raw_cls: afterReload.sum,
    reload_entries: afterReload.log,
    observer_err: initial.err,
    pageshow_persisted_seen_initial: initial.pageshowPersisted,
    pageshow_persisted_seen_after_reload: afterReload.pageshowPersisted,
    verdict:
      initial.sum === 0 && afterReload.sum === 0
        ? "PASS_RAW_CLS_ZERO"
        : "FAIL_RAW_CLS_NONZERO",
  };

  console.log(JSON.stringify(out, null, 2));

  const fail = initial.sum !== 0 || afterReload.sum !== 0;
  process.exitCode = fail ? 1 : 0;

  await browser.close();
  if (staticServer) {
    try {
      staticServer.close();
    } catch (_) {}
  }
}

main().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
