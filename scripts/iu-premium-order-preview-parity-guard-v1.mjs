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
  const gridM = src.match(/export const PREMIUM_AFFILIATE_SLOT_GRID_CSS = `([\s\S]*?)`;/);
  const m = src.match(/export const PREMIUM_LIVE_SLOT_CSS = `([\s\S]*?)`;/);
  if (!m) throw new Error("missing PREMIUM_LIVE_SLOT_CSS");
  const grid = gridM ? gridM[1] : "";
  return m[1].replace("${PREMIUM_AFFILIATE_SLOT_GRID_CSS}", grid);
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
  const gridSrc = read("cloudflare/iu-ads/src/premium-live-slot-css.ts");
  ok("static:preview_block_center", /previewBlock/.test(orderUi));
  ok("static:preview_desktop_centered", /margin-left:auto;margin-right:auto/.test(gridSrc.replace(/\s/g, "")));
  ok("static:banner_slot_padding_zero", /iuPremiumSlot--banner\{padding:0\}/.test(gridSrc.replace(/\s/g, "")));
  ok("static:banner_object_position_center", /object-position:centercenter/.test(gridSrc.replace(/\s/g, "")));
  ok(
    "static:affiliate_grid_two_col",
    /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(gridSrc.replace(/\s/g, ""))
  );
  ok(
    "static:no_mobile_single_col_preview",
    !/@media\(max-width:520px\)[\s\S]*iuPremiumPreviewGrid[\s\S]*grid-template-columns:1fr/.test(
      previewCss.replace(/\s/g, "")
    )
  );
  const soldDesktop =
    /@media\(min-width:1025px\)[\s\S]*iuPremiumSlot--sold[\s\S]*--iuPremiumSoldChipH,124px/.test(
      liveCss.replace(/\s/g, "")
    ) &&
    /@media\(min-width:1025px\)[\s\S]*iuPremiumSlot--sold[\s\S]*--iuPremiumSoldChipH,124px/.test(
      previewCss.replace(/\s/g, "")
    );
  ok("static:sold_desktop_height_parity", soldDesktop);
  ok(
    "static:sales_slot_base_110",
    /#iuAffiliateViewa\.iuPremiumSlot\{[\s\S]*height:var\(--iuChipH,110px\)/.test(previewCss.replace(/\s/g, ""))
  );
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
const affiliateGridProdRule = `
#iuAffiliateView .iuJRGrid{
  width:100%;max-width:none;margin-left:0;margin-right:0;
  display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;
}
`;
const bannerSvg =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="370"><rect width="600" height="370" fill="#e11"/><rect x="600" width="600" height="370" fill="#06f"/></svg>'
  );
const logoSvg =
  "data:image/svg+xml," +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"/>');
const blendSvg =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#c4d4e0"/></svg>'
  );

const CREATIVE_MODES = ["logo", "image_small", "image_medium", "image_large", "full_bleed_banner"];

function creativeSrcForMode(creative) {
  if (creative === "full_bleed_banner") return bannerSvg;
  if (creative === "logo") return logoSvg;
  return blendSvg;
}

function creativeInitScript(creative) {
  const modeJson = JSON.stringify(creative);
  return (
    '<script src="/assets/iu-premium-creative-render-v1.js"></script>' +
    "<script>" +
    "(function(){var mode=" +
    modeJson +
    ";function ready(){var slot=document.getElementById('slot')||document.getElementById('previewSlot');" +
    "if(!slot)return;var img=slot.querySelector('img.iuPremiumSlotImg');" +
    "if(!img||!globalThis.iuPremiumCreativeRender)return;" +
    "function done(){window.__iuCreativeReady=true;}" +
    "img.addEventListener('load',function(){iuPremiumCreativeRender.bindPremiumCreativeImage(slot,img,mode);done();},{once:true});" +
    "if(img.complete&&img.naturalWidth>0){iuPremiumCreativeRender.bindPremiumCreativeImage(slot,img,mode);done();}" +
    "}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();})();" +
    "</script>"
  );
}

function liveCreativeFixtureHtml(creative) {
  const src = creativeSrcForMode(creative);
  const gridBlock = `<div class="iuRadioGrid iuJRGrid iuPremiumGrid">
<a class="iuPremiumSlot iuPremiumSlot--sold iuPremiumSlot--logo" id="slot" href="#"><img class="iuPremiumSlotImg" alt="" src="${src}"/></a>
<a class="iuPremiumSlot iuPremiumSlot--free" href="#"><span>P2</span></a>
</div>`;
  return `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="utf-8"/>
<link rel="stylesheet" href="${prodCssLink}"/>
<style>
:root{--iuChipH:110px;--iuChipPadX:12px}
.iuRadioGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
${affiliateGridProdRule}
body{margin:0}
.stage{width:calc(100vw - 24px);margin:0 auto;box-sizing:border-box}
@media(min-width:521px){.stage{width:calc(100vw - 39px)}}
@media(min-width:1240px){.stage{width:608px}}
</style>
</head><body><div class="stage"><div id="iuAffiliateView">${gridBlock}</div></div>${creativeInitScript(creative)}</body></html>`;
}

function orderCreativeFixtureHtml(creative) {
  const src = creativeSrcForMode(creative);
  const previewOnlySlot = `<a class="iuPremiumSlot iuPremiumSlot--sold iuPremiumSlot--logo" id="previewSlot" href="#"><img class="iuPremiumSlotImg" alt="" src="${src}"/></a>`;
  const stageShell = `<div class="stage"><div class="previewBlock"><div class="previewWrap" id="iuAffiliateView"><div class="iuJRGrid iuPremiumGrid iuPremiumPreviewGrid iuPremiumPreviewGrid--p1">${previewOnlySlot}</div></div></div></div>`;
  return `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="utf-8"/>
<style>
:root{--iuChipH:110px;--iuChipPadX:12px}
body{margin:0}
.stage{width:calc(100vw - 24px);margin:0 auto;box-sizing:border-box}
@media(min-width:521px){.stage{width:calc(100vw - 39px)}}
@media(min-width:1240px){.stage{width:608px}}
${previewCssInline}
</style>
</head><body>${stageShell}${creativeInitScript(creative)}</body></html>`;
}

function salesVsSoldFixtureHtml() {
  return `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="utf-8"/>
<link rel="stylesheet" href="${prodCssLink}"/>
<style>
:root{--iuChipH:110px;--iuChipPadX:12px}
${affiliateGridProdRule}
body{margin:0;padding:16px;box-sizing:border-box}
.stage{width:608px;max-width:calc(100vw - 32px);margin:0 auto}
</style>
</head><body><div class="stage"><div id="iuAffiliateView">
<div class="iuRadioGrid iuJRGrid iuPremiumGrid">
<a class="iuPremiumSlot iuPremiumSlot--sold iuPremiumSlot--logo" id="soldSlot" href="#"><span>Sold</span></a>
<a class="iuPremiumSlot iuPremiumSlot--free" href="#"><span>Std</span></a>
</div>
<div class="iuPremiumSalesPanel">
<div class="iuRadioGrid iuJRGrid iuPremiumGrid iuPremiumSalesGrid">
<a class="iuPremiumSlot iuPremiumSlot--free iuPremiumSlot--sale" id="saleSlot" href="#"><span class="iuPremiumSlotCta">P1</span></a>
<a class="iuPremiumSlot iuPremiumSlot--free iuPremiumSlot--sale" href="#"><span class="iuPremiumSlotCta">P2</span></a>
</div>
</div>
</div></div></body></html>`;
}

function liveFixtureHtml(mode) {
  const modeClass = mode === "banner" ? "iuPremiumSlot--banner" : "iuPremiumSlot--logo";
  const src = mode === "banner" ? bannerSvg : logoSvg;
  const gridBlock = `<div class="iuRadioGrid iuJRGrid iuPremiumGrid">
<a class="iuPremiumSlot iuPremiumSlot--sold ${modeClass}" id="slot" href="#"><img class="iuPremiumSlotImg" alt="" src="${src}"/></a>
<a class="iuPremiumSlot iuPremiumSlot--free" href="#"><span>P2</span></a>
</div>`;
  return `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="utf-8"/>
<link rel="stylesheet" href="${prodCssLink}"/>
<style>
:root{--iuChipH:110px;--iuChipPadX:12px}
.iuRadioGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
@media(max-width:520px){.iuRadioGrid{grid-template-columns:1fr}}
${affiliateGridProdRule}
body{margin:0}
.stage{width:calc(100vw - 24px);margin:0 auto;box-sizing:border-box}
@media(min-width:521px){.stage{width:calc(100vw - 39px)}}
@media(min-width:1240px){.stage{width:608px}}
</style>
</head><body><div class="stage"><div id="iuAffiliateView">${gridBlock}</div></div></body></html>`;
}

function orderFixtureHtml(pos, mode, layout) {
  const modeClass = mode === "banner" ? "iuPremiumSlot--banner" : "iuPremiumSlot--logo";
  const src = mode === "banner" ? bannerSvg : logoSvg;
  const posClass = "iuPremiumPreviewGrid--p" + String(pos);
  const previewOnlySlot = `<a class="iuPremiumSlot iuPremiumSlot--sold ${modeClass}" id="previewSlot" href="#"><img class="iuPremiumSlotImg" alt="" src="${src}"/></a>`;
  const stageShell =
    layout === "center"
      ? `<div class="shell"><div class="card"><div class="previewBlock"><div class="previewWrap" id="iuAffiliateView"><div class="iuJRGrid iuPremiumGrid iuPremiumPreviewGrid ${posClass}">${previewOnlySlot}</div></div></div></div></div>`
      : `<div class="stage"><div class="previewBlock"><div class="previewWrap" id="iuAffiliateView"><div class="iuJRGrid iuPremiumGrid iuPremiumPreviewGrid ${posClass}">${previewOnlySlot}</div></div></div></div>`;
  const stageCss =
    layout === "center"
      ? ""
      : `
.stage{width:calc(100vw - 24px);margin:0 auto;box-sizing:border-box}
@media(min-width:521px){.stage{width:calc(100vw - 39px)}}
@media(min-width:1240px){.stage{width:608px}}
`;
  return `<!DOCTYPE html>
<html lang="cs"><head>
<meta charset="utf-8"/>
<style>
:root{--iuChipH:110px;--iuChipPadX:12px}
body{margin:0}
.shell{max-width:720px;margin:0 auto;padding:1.25rem;box-sizing:border-box}
.card{padding:1rem;box-sizing:border-box}
${stageCss}
${previewCssInline}
</style>
</head><body>${stageShell}</body></html>`;
}

const PORT = parseInt(process.env.IU_GUARD_PORT || "8969", 10);
const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/fixture-live.html") {
      const mode = url.searchParams.get("mode") === "banner" ? "banner" : "logo";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(liveFixtureHtml(mode));
      return;
    }
    if (url.pathname === "/fixture-order.html") {
      const pos = Math.min(8, Math.max(1, parseInt(url.searchParams.get("pos") || "1", 10) || 1));
      const mode = url.searchParams.get("mode") === "banner" ? "banner" : "logo";
      const layout = url.searchParams.get("layout") === "center" ? "center" : "geom";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(orderFixtureHtml(pos, mode, layout));
      return;
    }
    if (url.pathname === "/fixture-live-creative.html") {
      const creative = url.searchParams.get("creative") || "logo";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(liveCreativeFixtureHtml(creative));
      return;
    }
    if (url.pathname === "/fixture-order-creative.html") {
      const creative = url.searchParams.get("creative") || "logo";
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(orderCreativeFixtureHtml(creative));
      return;
    }
    if (url.pathname === "/fixture-sales-sold.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(salesVsSoldFixtureHtml());
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

const GEOMETRY_TOLERANCE_PX = 1;

const viewports = [
  { id: "mobile_narrow", width: 360, height: 740 },
  { id: "mobile", width: 390, height: 844 },
  { id: "mobile_wide", width: 430, height: 932 },
  { id: "tablet", width: 820, height: 900 },
  { id: "desktop", width: 1280, height: 800 },
  { id: "pwa", width: 390, height: 844, isMobile: true },
];

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function expectedPremiumCellWidth(gridW) {
  if (gridW == null || !Number.isFinite(gridW)) return null;
  return (gridW - 10) / 2;
}

function expectedSoldSlotHeight(viewportWidth) {
  return viewportWidth >= 1025 ? 124 : 110;
}

function geometryParityOk(liveGeom, orderGeom, tol) {
  const liveCell = expectedPremiumCellWidth(liveGeom && liveGeom.gridW);
  const orderCell = expectedPremiumCellWidth(orderGeom && orderGeom.gridW);
  return (
    liveGeom &&
    orderGeom &&
    liveCell != null &&
    orderCell != null &&
    near(liveGeom.w, liveCell, tol) &&
    near(orderGeom.w, orderCell, tol) &&
    near(liveGeom.w, orderGeom.w, tol) &&
    near(liveGeom.h, orderGeom.h, tol) &&
    near(liveGeom.br, orderGeom.br, tol) &&
    liveGeom.img &&
    orderGeom.img &&
    near(liveGeom.img.w, orderGeom.img.w, tol) &&
    near(liveGeom.img.h, orderGeom.img.h, tol) &&
    liveGeom.img.objectFit === orderGeom.img.objectFit
  );
}

async function measureSlotGeometry(page, slotId) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const img = el.querySelector("img.iuPremiumSlotImg");
    let imgCs = null;
    if (img) {
      const ir = img.getBoundingClientRect();
      const ics = window.getComputedStyle(img);
      imgCs = {
        w: ir.width,
        h: ir.height,
        objectFit: ics.objectFit,
        objectPosition: ics.objectPosition,
      };
    }
    const grid = el.closest(".iuJRGrid, .iuPremiumPreviewGrid");
    let gridW = null;
    if (grid) gridW = grid.getBoundingClientRect().width;
    return {
      w: r.width,
      h: r.height,
      br: parseFloat(cs.borderRadius) || 0,
      img: imgCs,
      gridW,
    };
  }, slotId);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const vp of viewports) {
    for (const pos of [1, 2, 5, 8]) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: !!vp.isMobile,
        hasTouch: !!vp.isMobile,
      });
      const page = await context.newPage();
      const base = `http://127.0.0.1:${PORT}`;
      await page.goto(`${base}/fixture-live.html?mode=logo`, { waitUntil: "networkidle", timeout: 60000 });
      const liveGeom = await measureSlotGeometry(page, "slot");
      await page.goto(`${base}/fixture-order.html?pos=${pos}&mode=logo&layout=geom`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      const orderGeom = await measureSlotGeometry(page, "previewSlot");
      const tol = GEOMETRY_TOLERANCE_PX;
      const geomOk = geometryParityOk(liveGeom, orderGeom, tol);
      ok("geom:" + vp.id + ":p" + pos, geomOk, JSON.stringify({ liveGeom, orderGeom }));
      await page.goto(`${base}/fixture-order.html?pos=${pos}&mode=logo&layout=center`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      const centerSnap = await page.evaluate(() => {
        const wrap = document.querySelector(".previewWrap");
        const block = document.querySelector(".previewBlock");
        if (!wrap || !block) return null;
        const br = block.getBoundingClientRect();
        const wr = wrap.getBoundingClientRect();
        const left = wr.left - br.left;
        const right = br.right - wr.right;
        return { left, right, delta: Math.abs(left - right) };
      });
      ok("center:" + vp.id + ":p" + pos, centerSnap && centerSnap.delta <= 1, JSON.stringify(centerSnap));
      if (vp.id === "mobile" && pos === 1 && liveGeom && orderGeom) {
        const fullWidth = orderGeom.w >= liveGeom.gridW * 0.92;
        ok("regression:mobile_not_full_width", !fullWidth, JSON.stringify({ liveGeom, orderGeom }));
      }
      await context.close();
    }
  }

  const bannerVp = { width: 390, height: 844, isMobile: true };
  const bctx = await browser.newContext({
    viewport: { width: bannerVp.width, height: bannerVp.height },
    isMobile: true,
    hasTouch: true,
  });
  const bpage = await bctx.newPage();
  const base = `http://127.0.0.1:${PORT}`;
  await bpage.goto(`${base}/fixture-live.html?mode=banner`, { waitUntil: "networkidle", timeout: 60000 });
  const liveBanner = await measureSlotGeometry(bpage, "slot");
  await bpage.goto(`${base}/fixture-order.html?pos=1&mode=banner&layout=geom`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  const previewBanner = await measureSlotGeometry(bpage, "previewSlot");
  ok(
    "banner_crop_parity",
    liveBanner &&
      previewBanner &&
      near(liveBanner.w, previewBanner.w, GEOMETRY_TOLERANCE_PX) &&
      near(liveBanner.h, previewBanner.h, GEOMETRY_TOLERANCE_PX) &&
      liveBanner.img?.objectFit === "cover" &&
      previewBanner.img?.objectFit === "cover" &&
      /center|50%\s*50%/.test(String(liveBanner.img?.objectPosition || "")) &&
      /center|50%\s*50%/.test(String(previewBanner.img?.objectPosition || "")),
    JSON.stringify({ liveBanner, previewBanner })
  );
  await bctx.close();

  const creativeViewports = [
    { id: "mobile", width: 390, height: 844, isMobile: true },
    { id: "tablet", width: 820, height: 900 },
    { id: "desktop", width: 1280, height: 800 },
  ];
  for (const creative of CREATIVE_MODES) {
    for (const vp of creativeViewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: !!vp.isMobile,
        hasTouch: !!vp.isMobile,
      });
      const page = await context.newPage();
      const base = `http://127.0.0.1:${PORT}`;
      await page.goto(`${base}/fixture-live-creative.html?creative=${encodeURIComponent(creative)}`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.waitForFunction(() => window.__iuCreativeReady === true, { timeout: 15000 });
      const liveGeom = await measureSlotGeometry(page, "slot");
      await page.goto(`${base}/fixture-order-creative.html?creative=${encodeURIComponent(creative)}`, {
        waitUntil: "networkidle",
        timeout: 60000,
      });
      await page.waitForFunction(() => window.__iuCreativeReady === true, { timeout: 15000 });
      const orderGeom = await measureSlotGeometry(page, "previewSlot");
      const tol = GEOMETRY_TOLERANCE_PX;
      ok(
        "creative:" + creative + ":" + vp.id,
        geometryParityOk(liveGeom, orderGeom, tol),
        JSON.stringify({ liveGeom, orderGeom })
      );
      const expH = expectedSoldSlotHeight(vp.width);
      ok(
        "creative_height:" + creative + ":" + vp.id,
        liveGeom && near(liveGeom.h, expH, tol) && orderGeom && near(orderGeom.h, expH, tol),
        JSON.stringify({ expH, liveGeom, orderGeom })
      );
      await context.close();
    }
  }

  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const deskPage = await deskCtx.newPage();
  await deskPage.goto(`http://127.0.0.1:${PORT}/fixture-sales-sold.html`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  const heights = await deskPage.evaluate(() => {
    const sold = document.getElementById("soldSlot");
    const sale = document.getElementById("saleSlot");
    if (!sold || !sale) return null;
    return { sold: sold.getBoundingClientRect().height, sale: sale.getBoundingClientRect().height };
  });
  ok(
    "sales_cards_height_110_desktop",
    heights && near(heights.sale, 110, GEOMETRY_TOLERANCE_PX),
    JSON.stringify(heights)
  );
  ok(
    "sold_slot_height_124_desktop",
    heights && near(heights.sold, 124, GEOMETRY_TOLERANCE_PX),
    JSON.stringify(heights)
  );
  await deskCtx.close();

  const tabCtx = await browser.newContext({ viewport: { width: 820, height: 900 } });
  const tabPage = await tabCtx.newPage();
  await tabPage.goto(`http://127.0.0.1:${PORT}/fixture-sales-sold.html`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  const tabHeights = await tabPage.evaluate(() => {
    const sold = document.getElementById("soldSlot");
    const sale = document.getElementById("saleSlot");
    if (!sold || !sale) return null;
    return { sold: sold.getBoundingClientRect().height, sale: sale.getBoundingClientRect().height };
  });
  ok(
    "mobile_tablet_sold_and_sales_110",
    tabHeights &&
      near(tabHeights.sold, 110, GEOMETRY_TOLERANCE_PX) &&
      near(tabHeights.sale, 110, GEOMETRY_TOLERANCE_PX),
    JSON.stringify(tabHeights)
  );
  await tabCtx.close();
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
