#!/usr/bin/env node
/**
 * Order preview slot geometry must match production premium slot CSS (390 / 820 / 1280).
 * Run: npm run iu-premium-order-preview-parity-guard
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const fails = [];
function ok(id, cond, detail) {
  if (!cond) fails.push(id + (detail ? ":" + detail : ""));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function extractLiveSlotCssExport() {
  const src = read("cloudflare/iu-ads/src/premium-live-slot-css.ts");
  const m = src.match(/export const PREMIUM_LIVE_SLOT_CSS = `([\s\S]*?)`;/);
  if (!m) throw new Error("missing PREMIUM_LIVE_SLOT_CSS");
  return m[1];
}

function staticParity() {
  const liveCss = read("assets/iu-premium-selected-services-v1.css");
  const previewCss = extractLiveSlotCssExport();
  const orderUi = read("cloudflare/iu-ads/src/premium-order-ui.ts");
  const tokens = [
    "height:var(--iuChipH,110px)",
    "max-height:var(--iuChipH,110px)",
    "border-radius:12px",
    "object-fit:contain",
    "object-fit:cover",
    "padding:10px",
  ];
  for (const t of tokens) {
    ok("static:prod_css_" + t, liveCss.replace(/\s/g, "").includes(t.replace(/\s/g, "")), t);
    ok("static:preview_css_" + t, previewCss.replace(/\s/g, "").includes(t.replace(/\s/g, "")), t);
  }
  ok("static:order_preview_slot", /id="previewSlot"/.test(orderUi) && /iuPremiumSlot--sold/.test(orderUi));
  ok("static:order_injects_live_css", /PREMIUM_LIVE_SLOT_CSS/.test(orderUi));
  ok("static:no_previewBox", !/previewBox/.test(orderUi));
}

staticParity();
if (fails.length) {
  console.error("FAIL iu-premium-order-preview-parity-guard-v1 static");
  for (const f of fails) console.error(f);
  process.exit(1);
}

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const s = net.createConnection({ host, port }, () => {
        s.end();
        resolve();
      });
      s.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("port_timeout"));
        else setTimeout(tick, 100);
      });
    };
    tick();
  });
}

const previewCssInline = extractLiveSlotCssExport();
const prodCssLink = "/assets/iu-premium-selected-services-v1.css";
const gridBlock = `<div class="iuRadioGrid iuJRGrid iuPremiumGrid">
<a class="iuPremiumSlot iuPremiumSlot--sold iuPremiumSlot--logo" id="slot" href="#"><img class="iuPremiumSlotImg" alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='200'/%3E"/></a>
<a class="iuPremiumSlot iuPremiumSlot--free" href="#"><span>P2</span></a>
</div>`;
const liveFixtureHtml = `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="utf-8"/>
<link rel="stylesheet" href="${prodCssLink}"/>
<style>
:root{--iuChipH:110px;--iuChipPadX:12px}
.iuRadioGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media(max-width:520px){.iuRadioGrid{grid-template-columns:1fr}}
.wrap{max-width:720px;margin:0 auto;padding:16px}
</style>
</head><body><div class="wrap"><div id="iuAffiliateView">${gridBlock}</div></div></body></html>`;
const orderFixtureHtml = `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="utf-8"/>
<style>
:root{--iuChipH:110px;--iuChipPadX:12px}
.wrap{max-width:720px;margin:0 auto;padding:16px}
${previewCssInline}
</style>
</head><body><div class="wrap"><div class="previewWrap" id="iuAffiliateView">${gridBlock.replace('id="slot"', 'id="previewSlot"')}</div></div></body></html>`;

const PORT = parseInt(process.env.IU_GUARD_PORT || "8969", 10);
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/fixture-live.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(liveFixtureHtml);
      return;
    }
    if (url.pathname === "/fixture-order.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(orderFixtureHtml);
      return;
    }
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith("/")) p += "index.html";
    const fp = path.join(ROOT, p.replace(/^\/+/, ""));
    if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const mime = fp.endsWith(".css")
      ? "text/css; charset=utf-8"
      : fp.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : "application/octet-stream";
    res.writeHead(200, { "content-type": mime });
    res.end(fs.readFileSync(fp));
  } catch (_) {
    res.writeHead(500);
    res.end("err");
  }
});

await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
await waitForPort("127.0.0.1", PORT, 10000);

const viewports = [
  { id: "mobile", width: 390, height: 844 },
  { id: "tablet", width: 820, height: 900 },
  { id: "desktop", width: 1280, height: 800 },
  { id: "pwa", width: 390, height: 844, isMobile: true },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: !!vp.isMobile,
      hasTouch: !!vp.isMobile,
    });
    const page = await context.newPage();
    const base = `http://127.0.0.1:${PORT}`;
    await page.goto(`${base}/fixture-live.html`, { waitUntil: "networkidle", timeout: 60000 });
    const liveGeom = await page.evaluate(() => {
      const el = document.getElementById("slot");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      return { w: r.width, h: r.height, br: parseFloat(cs.borderRadius) || 0 };
    });
    await page.goto(`${base}/fixture-order.html`, { waitUntil: "networkidle", timeout: 60000 });
    const orderGeom = await page.evaluate(() => {
      const el = document.getElementById("previewSlot");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = window.getComputedStyle(el);
      return { w: r.width, h: r.height, br: parseFloat(cs.borderRadius) || 0 };
    });
    function near(a, b, tol) {
      return Math.abs(a - b) <= tol;
    }
    const tol = 2;
    const geom = {
      ok:
        liveGeom &&
        orderGeom &&
        near(liveGeom.w, orderGeom.w, tol) &&
        near(liveGeom.h, orderGeom.h, tol) &&
        near(liveGeom.br, orderGeom.br, tol),
      liveGeom,
      orderGeom,
    };
    ok("geom:" + vp.id, geom.ok, JSON.stringify(geom));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (fails.length) {
  console.error("FAIL iu-premium-order-preview-parity-guard-v1");
  for (const f of fails) console.error(f);
  process.exit(1);
}
console.log("PASS iu-premium-order-preview-parity-guard-v1");
