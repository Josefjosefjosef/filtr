#!/usr/bin/env node
"use strict";
/**
 * Homepage mobile empty-space guard (gate home: Silver + Přehled dne).
 * PASS when after last real content the remaining document gap is within
 * bottom-nav safe clearance (+ small tolerance), false #lastErrInline is hidden,
 * and layout spacer is collapsed.
 */
const path = require("path");
const http = require("http");
const fs = require("fs");
const { createRequire } = require("module");

const REPO = path.resolve(__dirname, "..");
const req = createRequire(path.join(REPO, "package.json"));
const { chromium } = req("playwright");

const PORT = 8827;
const OUT = path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "iu_home_empty_space_guard.json");
const GAP_MAX_PX = 200; // safe-space ~145 + card/footer pad tolerance

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((reqIn, res) => {
      try {
        let p = decodeURIComponent(new URL(reqIn.url, "http://x").pathname);
        if (p.endsWith("/")) p += "index.html";
        const fp = path.join(REPO, p.replace(/^\/+/, ""));
        if (!fp.startsWith(REPO) || !fs.existsSync(fp) || !fs.statSync(fp).isFile()) {
          res.writeHead(404);
          res.end("nf");
          return;
        }
        res.writeHead(200, { "content-type": MIME[path.extname(fp).toLowerCase()] || "application/octet-stream" });
        res.end(fs.readFileSync(fp));
      } catch (_) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function measure(page) {
  return page.evaluate(() => {
    const docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const absBottom = (el) => {
      if (!el) return null;
      return Math.round(el.getBoundingClientRect().bottom + window.scrollY);
    };
    const cards = [...document.querySelectorAll("#iuPrehledDneRoot .iuPdCard.iuPrehledDne__item")];
    const more = document.querySelector('#iuPrehledDneRoot [data-act="more"]');
    const lastReal = more || cards[cards.length - 1] || null;
    const lastBottom = absBottom(lastReal);
    const spacer = document.querySelector(".iuSilverTallScrollLayoutSpacer");
    const err = document.querySelector("#lastErrInline");
    const gate = document.querySelector("#iuMobileGateWrap");
    const timeline = document.querySelector("#iuPrehledDneTimeline");
    const feed = document.querySelector("#feed");
    const gatePad = gate ? parseFloat(cs(gate).paddingBottom) || 0 : 0;
    const gap = lastBottom == null ? null : docH - lastBottom;
    const errDisp = err ? cs(err).display : "none";
    const errText = err ? (err.textContent || "").trim() : "";
    const spacerH = spacer ? Math.round(spacer.getBoundingClientRect().height) : 0;
    const spacerDisp = spacer ? cs(spacer).display : "none";
    const trafficPad = timeline ? timeline.classList.contains("iuPdFeed--trafficPad") : false;
    const timelinePadB = timeline ? parseFloat(cs(timeline).paddingBottom) || 0 : 0;
    return {
      docH,
      cardCount: cards.length,
      morePresent: !!more,
      lastText: lastReal ? (lastReal.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) : "",
      lastBottom,
      gapAfterLast: gap,
      gatePadB: gatePad,
      spacerH,
      spacerDisp,
      errDisp,
      errText: errText.slice(0, 80),
      trafficPad,
      timelinePadB,
      feedDisp: feed ? cs(feed).display : null,
      mainVisible: document.body.classList.contains("iu-mobileMainVisible"),
      paintedP: typeof window.iuArticleFeedHostPaintedP === "function" ? !!window.iuArticleFeedHostPaintedP() : null,
    };
  });
}

function verdict(m) {
  const fails = [];
  if (!(m.cardCount > 0 || m.morePresent)) fails.push("no_prehled_content");
  if (m.gapAfterLast == null) fails.push("no_last_bottom");
  else if (m.gapAfterLast > GAP_MAX_PX) fails.push("gap_too_large:" + m.gapAfterLast);
  if (m.spacerH > 1 || (m.spacerDisp && m.spacerDisp !== "none")) fails.push("spacer_not_collapsed:" + m.spacerH + "/" + m.spacerDisp);
  if (m.errDisp === "block" && /nepodařilo|Obsah se/i.test(m.errText || "")) fails.push("false_err_visible");
  if (m.trafficPad && m.timelinePadB > 8) fails.push("trafficPad_padding:" + m.timelinePadB);
  if (m.mainVisible) fails.push("unexpected_main_visible");
  return fails;
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:" + PORT + "/projects/", { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(5500);

  // Prefer production-like data if local feed empty — inject wait for prehled cards
  for (let i = 0; i < 20; i++) {
    const n = await page.evaluate(() => document.querySelectorAll("#iuPrehledDneRoot .iuPdCard").length);
    if (n > 0) break;
    await page.waitForTimeout(500);
  }

  const phone = await measure(page);
  const phoneFails = verdict(phone);

  // Tablet portrait
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.waitForTimeout(800);
  const tablet = await measure(page);
  const tabletFails = verdict(tablet);

  // Click "Načíst další" if present and re-measure
  let moreState = null;
  const hasMore = await page.evaluate(() => {
    const b = document.querySelector('#iuPrehledDneRoot [data-act="more"]');
    if (!b) return false;
    b.click();
    return true;
  });
  if (hasMore) {
    await page.waitForTimeout(2500);
    moreState = await measure(page);
  }

  const report = {
    gapMaxPx: GAP_MAX_PX,
    phone,
    phoneFails,
    tablet,
    tabletFails,
    moreState,
    pass: phoneFails.length === 0 && tabletFails.length === 0,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(OUT);
  console.log(
    "PASS=" +
      report.pass +
      " phoneGap=" +
      phone.gapAfterLast +
      " phoneFails=" +
      JSON.stringify(phoneFails) +
      " tabletGap=" +
      tablet.gapAfterLast +
      " tabletFails=" +
      JSON.stringify(tabletFails) +
      " errDisp=" +
      phone.errDisp +
      " spacerH=" +
      phone.spacerH
  );
  await browser.close();
  server.close();
  process.exit(report.pass ? 0 : 1);
})().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
