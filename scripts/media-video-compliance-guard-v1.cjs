#!/usr/bin/env node
/**
 * MEDIA_VIDEO_COMPLIANCE_GUARD v1
 *
 * P1 compliance + media placeholder regression guards:
 *  - VIDEO_POOL_EMPTY_GUARD (build_videos.py max > 0)
 *  - VIDEO_SLOT_SELECTION_GUARD (iuPickVideosForSlots fills slots, no early break)
 *  - THUMBNAIL_RENDER_GUARD (Info Center + iuBuildYouTubeThumb disclosure)
 *  - DPA registry presence
 *
 * Usage:
 *   node scripts/media-video-compliance-guard-v1.cjs
 *   IU_GUARD_URL=http://127.0.0.1:PORT/projects/?section=feed&topic=zpravy&nosw=1 node scripts/media-video-compliance-guard-v1.cjs
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const REPO = path.resolve(__dirname, "..");
const PORT = Number(process.env.IU_GUARD_PORT || 8742);
const EXTERNAL = process.env.IU_GUARD_URL || null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function read(rel) {
  return fs.readFileSync(path.join(REPO, rel), "utf8");
}

function fail(msg) {
  console.error("FAIL " + msg);
  process.exit(1);
}

function pass(label) {
  console.log(label + "=PASS");
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
          res.end("not found");
          return;
        }
        res.writeHead(200, { "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
        res.end(fs.readFileSync(filePath));
      } catch (e) {
        res.writeHead(500);
        res.end("err");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function staticGuards() {
  const dpa = read("docs/governance/DPA_REGISTRY.md");
  if (!/GITHUB_DPA_REFERENCE=https:\/\/docs\.github\.com\/en\/site-policy\/privacy-policies\/github-data-protection-addendum/.test(dpa)) {
    fail("DPA_REGISTRY missing GitHub reference");
  }
  if (!/CLOUDFLARE_DPA_REFERENCE=https:\/\/www\.cloudflare\.com\/cloudflare-customer-dpa\//.test(dpa)) {
    fail("DPA_REGISTRY missing Cloudflare reference");
  }
  pass("DPA_REGISTRY_GUARD");

  const html = read("projects/index.html");
  if (!html.includes("i.ytimg.com")) fail("Info Center missing i.ytimg.com disclosure");
  if (!html.includes("oprávněný zájem")) fail("Privacy missing legal basis for logs");
  if (!html.includes("provozní logy")) fail("Privacy missing provozní logy");
  if (!html.includes("bezpečnostní logy")) fail("Privacy missing bezpečnostní logy");
  pass("THUMBNAIL_RENDER_GUARD");

  const appJs = read("assets/app.js");
  if (!appJs.includes("function iuBuildYouTubeThumb")) fail("iuBuildYouTubeThumb missing");
  if (!appJs.includes("fillEmptySlots")) fail("fillEmptySlots not wired");
  if (!appJs.includes("fill_slot_fallback")) fail("fill_slot_fallback missing");
  if (/if \(!chosen\) break;/.test(appJs)) fail("iuPickVideosForSlots still has early break");
  pass("VIDEO_SLOT_SELECTION_GUARD");

  const buildVideos = read("scripts/build_videos.py");
  if (!/MAX_VIDEOS_OUT\s*=\s*\d+/.test(buildVideos)) fail("build_videos MAX_VIDEOS_OUT missing");
  const m = buildVideos.match(/MAX_VIDEOS_OUT\s*=\s*(\d+)/);
  if (!m || Number(m[1]) <= 0) fail("VIDEO_POOL_EMPTY_GUARD would fail");
  pass("VIDEO_POOL_EMPTY_GUARD");
}

async function playwrightGuard(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(6000);

  await page.evaluate(() => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (/iu_video_queue|iu_video_seen/i.test(k)) localStorage.removeItem(k);
      }
    } catch (_) {}
  });

  await page.reload({ waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(8000);

  const diag = await page.evaluate(async () => {
    let poolLen = 0;
    try {
      if (typeof __iuLoadVideosJsonOnce === "function") {
        const raw = await __iuLoadVideosJsonOnce();
        poolLen = Array.isArray(raw?.videos) ? raw.videos.length : 0;
      }
    } catch (_) {}
    const cards = Array.from(document.querySelectorAll(".iuVideoCard[data-slot]"));
    const placeholders = cards.filter((c) => c.getAttribute("data-iu-placeholder") === "1").length;
    const withYtid = cards.filter((c) => String(c.getAttribute("data-ytid") || "").trim()).length;
    const missingThumb = cards.filter((c) => {
      const btn = c.querySelector(".iuVideoPoster");
      const style = btn ? btn.getAttribute("style") || "" : "";
      return c.getAttribute("data-iu-placeholder") !== "1" && !/--iuVideoThumb:\s*url\(/i.test(style);
    }).length;
    return { poolLen, visible: cards.length, placeholders, withYtid, missingThumb };
  });

  await browser.close();

  console.log("VIDEO_COUNT_IN_DATA=" + diag.poolLen);
  console.log("VISIBLE_VIDEO_COUNT=" + diag.visible);
  console.log("BROKEN_PLACEHOLDER_COUNT=" + diag.placeholders);
  console.log("MISSING_THUMBNAIL_COUNT=" + diag.missingThumb);
  console.log("CONSOLE_ERRORS=" + consoleErrors.length);

  if (diag.poolLen <= 0) fail("production/local pool empty in guard");
  if (diag.visible > 0 && diag.placeholders > 0 && diag.withYtid < diag.visible) {
    fail("broken placeholders remain: " + diag.placeholders + "/" + diag.visible);
  }
  if (consoleErrors.length > 0) fail("console errors: " + consoleErrors.slice(0, 3).join(" | "));
  pass("PLAYWRIGHT_PLACEHOLDER_GUARD");
}

(async () => {
  staticGuards();
  let server = null;
  let url = EXTERNAL;
  if (!url) {
    server = await startServer();
    url = "http://127.0.0.1:" + PORT + "/projects/?section=feed&topic=zpravy&nosw=1";
  }
  try {
    await playwrightGuard(url);
  } finally {
    if (server) server.close();
  }
  console.log("MEDIA_VIDEO_COMPLIANCE_GUARD=PASS");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
