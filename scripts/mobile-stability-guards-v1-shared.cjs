#!/usr/bin/env node
"use strict";

/* Shared helpers for MOBILE/TABLET STABILITY V1 regression guards:
   - bottom-navigation-visibility-guard-v1.cjs
   - mobile-navigation-stability-guard-v1.cjs
   - media-cls-guard-v1.cjs
   - media-load-more-scroll-guard-v1.cjs
   - silver-copy-guard-v1.cjs
   Local static server (repo checkout) + CLS observer + banner/report conventions. */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_PORT = 8897;

const VIEWPORTS = [
  { w: 390, h: 844, mode: "mobile" },
  { w: 768, h: 1024, mode: "tablet" },
];

function envBaseUrl() {
  const env = String(process.env.MOBILE_STABILITY_GUARDS_URL || "").trim();
  if (env) return env.replace(/\/+$/, "");
  return "http://127.0.0.1:" + DEFAULT_PORT;
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function resolveFile(urlPath) {
  let rel = urlPath.replace(/^\/+/, "");
  if (rel === "") rel = "index.html";
  let filePath = path.join(ROOT, rel);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(ROOT))) return null;
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
      filePath = path.join(resolved, "index.html");
    } else {
      filePath = resolved;
    }
    if (!fs.existsSync(filePath)) return null;
    return { data: fs.readFileSync(filePath), ext: path.extname(filePath).toLowerCase() };
  } catch (_) {
    return null;
  }
}

function startStaticServer(port) {
  const p = port || DEFAULT_PORT;
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];
      const hit = resolveFile(urlPath);
      if (hit) {
        res.writeHead(200, { "Content-Type": CONTENT_TYPES[hit.ext] || "application/octet-stream" });
        res.end(hit.data);
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found");
      }
    });
    server.on("error", reject);
    server.listen(p, "127.0.0.1", () => resolve(server));
  });
}

/* Cumulative layout shift without recent input; window.__iuMsCls, reset via __iuMsClsReset(). */
function clsInitScript() {
  return `(function(){
    try{
      window.__iuMsCls = 0;
      window.__iuMsClsReset = function(){ window.__iuMsCls = 0; };
      var po = new PerformanceObserver(function(list){
        var entries = list.getEntries();
        for (var i = 0; i < entries.length; i++) {
          var e = entries[i];
          if (!e.hadRecentInput) window.__iuMsCls += e.value;
        }
      });
      po.observe({ type: "layout-shift", buffered: true });
    }catch(_){}
  })();`;
}

async function readCls(page) {
  return page.evaluate(() => Number(window.__iuMsCls || 0));
}

async function resetCls(page) {
  await page.evaluate(() => {
    if (typeof window.__iuMsClsReset === "function") window.__iuMsClsReset();
  });
}

async function preparePage(page) {
  let stubs = null;
  try {
    stubs = require("./proofs/open_meteo_guard_stub.cjs");
  } catch (_) {}
  if (stubs && typeof stubs.installProofGuardNetworkStubs === "function") {
    await stubs.installProofGuardNetworkStubs(page);
  }
}

async function scrollAllToBottom(page) {
  await page.evaluate(() => {
    function bottomOf(el) {
      if (!el) return;
      try { el.scrollTop = el.scrollHeight; } catch (_) {}
    }
    try { window.scrollTo(0, document.documentElement.scrollHeight); } catch (_) {}
    bottomOf(document.getElementById("leftContent"));
    bottomOf(document.getElementById("feed"));
  });
}

function emitBanner(name, out, reportFile) {
  process.stdout.write("=== " + name + " ===\n\n");
  for (let i = 0; i < out.results.length; i++) {
    const copy = Object.assign({}, out.results[i]);
    delete copy._pass;
    process.stdout.write(JSON.stringify(copy, null, 2) + "\n\n");
  }
  process.stdout.write("PASS_FAIL=" + (out.pass ? "PASS" : "FAIL") + "\n");
  process.stdout.write("report=" + reportFile + "\n");
  process.stdout.write("=== END_" + name + " ===\n");
  fs.writeFileSync(
    path.join(ROOT, reportFile),
    JSON.stringify(
      {
        pass: out.pass,
        url: out.url || null,
        results: out.results.map((r) => {
          const c = Object.assign({}, r);
          delete c._pass;
          return c;
        }),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

async function runStandalone(runGuard, name, reportFile) {
  const envUrl = String(process.env.MOBILE_STABILITY_GUARDS_URL || "").trim();
  let server = null;
  if (!envUrl) server = await startStaticServer(DEFAULT_PORT);
  try {
    const out = await runGuard(envBaseUrl());
    emitBanner(name, out, reportFile);
    if (!out.pass) process.exitCode = 1;
  } finally {
    if (server) server.close();
  }
}

module.exports = {
  ROOT,
  DEFAULT_PORT,
  VIEWPORTS,
  envBaseUrl,
  startStaticServer,
  clsInitScript,
  readCls,
  resetCls,
  preparePage,
  scrollAllToBottom,
  emitBanner,
  runStandalone,
};
