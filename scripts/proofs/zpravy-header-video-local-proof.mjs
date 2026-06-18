#!/usr/bin/env node
/**
 * Local proof: Zprávy feed section header video + fallback (no duplicate banner).
 * Viewports: mobile 390×844, tablet 768×1024, desktop 1440×900.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const require = createRequire(path.join(ROOT, "package.json"));
const { chromium } = require("playwright");

const PORT = Math.max(1024, parseInt(process.env.IU_ZPRAVY_VIDEO_PROOF_PORT || "8096", 10));
const BASE = `http://127.0.0.1:${PORT}/projects/`;

const VIEWPORTS = [
  { key: "mobile", width: 390, height: 844, label: "MOBILE_OK" },
  { key: "tablet", width: 768, height: 1024, label: "TABLET_OK" },
  { key: "desktop", width: 1440, height: 900, label: "DESKTOP_OK" },
];

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "application/javascript";
  if (ext === ".json") return "application/json";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".woff2") return "font/woff2";
  return "text/html";
}

function resolveFile(urlPath) {
  const clean = (urlPath || "/").split("?")[0];
  let rel = clean.replace(/^\//, "");
  if (!rel || rel === "/") rel = "projects/index.html";
  const filePath = path.join(ROOT, rel);
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT))) return null;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      return path.join(filePath, "index.html");
    }
    if (fs.existsSync(filePath)) return filePath;
  } catch (_) {}
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const filePath = resolveFile(req.url);
      if (!filePath) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function measureViewport(page, vp) {
  let consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (/favicon\.ico/i.test(text)) return;
      if (/Failed to load resource: the server responded with a status of 404/i.test(text)) return;
      consoleErrors.push(text);
    }
  });

  await page.setViewportSize({ width: vp.width, height: vp.height });
  const videoResponses = [];
  const jpgResponses = [];
  page.on("response", (res) => {
    const url = res.url();
    if (url.includes("section-zpravy-header-video-v1.mp4")) {
      videoResponses.push({ url, status: res.status() });
    }
    if (url.includes("section-zpravy.jpg")) {
      jpgResponses.push({ url, status: res.status() });
    }
  });

  if (vp.width <= 767) {
    await page.goto(BASE + "?section=media&iuRobust=1", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForSelector('[data-iu-news-preview-card="1"]', { timeout: 60000 });
    await page.locator('[data-iu-news-preview-card="1"]').first().click({ timeout: 15000 });
  } else {
    await page.goto(BASE + "?section=feed&topic=zpravy&iuRobust=1", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  }
  if (vp.width <= 767) {
    await page.waitForFunction(
      () =>
        document.body &&
        document.body.classList.contains("iu-mobileMainVisible") &&
        document.getElementById("feed") &&
        String(document.getElementById("feed").getAttribute("data-feed-ready") || "") === "true",
      null,
      { timeout: 60000 }
    );
  } else {
    await page.waitForFunction(
      () => {
        const feed = document.getElementById("feed");
        return feed && String(feed.getAttribute("data-feed-ready") || "") === "true";
      },
      null,
      { timeout: 60000 }
    );
  }
  await page.waitForTimeout(1200);

  const metrics = await page.evaluate(() => {
    const feed = document.getElementById("feed");
    const videoWrap = feed && feed.querySelector(".iu-feed-section-header-video-wrap");
    const video = feed && feed.querySelector("video.iu-feed-section-header-video");
    const pictures = feed ? feed.querySelectorAll("picture.iu-feed-section-header-picture") : [];
    const imgs = feed ? feed.querySelectorAll("img.iu-feed-section-header-img") : [];
    const banners = feed
      ? feed.querySelectorAll(
          "picture.iu-feed-section-header-picture, .iu-feed-section-header-video-wrap, img.iu-feed-section-header-img"
        )
      : [];
    const zpravyImgVisible = Array.from(imgs).some((img) => {
      const src = String(img.getAttribute("src") || img.currentSrc || "");
      if (!src.includes("section-zpravy.jpg")) return false;
      const r = img.getBoundingClientRect();
      const cs = getComputedStyle(img);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
    });
    const videoVisible =
      !!(video &&
        video.getBoundingClientRect().width > 0 &&
        video.getBoundingClientRect().height > 0 &&
        getComputedStyle(video).display !== "none" &&
        getComputedStyle(video).visibility !== "hidden");
    const headerRect = (videoWrap || pictures[0] || imgs[0])?.getBoundingClientRect();
    const firstArticle = feed && feed.querySelector("article.news-card");
    const articleRect = firstArticle ? firstArticle.getBoundingClientRect() : null;
    const layoutGap =
      headerRect && articleRect ? Math.round(articleRect.top - headerRect.bottom) : null;
    return {
      videoVisible,
      videoWrapPresent: !!videoWrap,
      videoPlaying: !!(video && !video.paused && video.readyState >= 2),
      videoMuted: video ? video.muted : false,
      videoLoop: video ? video.loop : false,
      videoPlaysInline: video ? video.playsInline : false,
      videoAutoplay: video ? video.autoplay : false,
      headerImgCount: imgs.length,
      headerBannerCount: banners.length,
      zpravyImgVisible,
      duplicateBanner: banners.length > 1,
      layoutGap,
      feedReady: feed ? feed.getAttribute("data-feed-ready") : "",
      headerFile: videoWrap
        ? videoWrap.getAttribute("data-feed-header-file")
        : imgs[0]
          ? String(imgs[0].getAttribute("src") || "").split("/").pop()
          : "",
    };
  });

  const fallbackMetrics = await page.evaluate(() => {
    const feed = document.getElementById("feed");
    const wrap = feed && feed.querySelector(".iu-feed-section-header-video-wrap");
    const video = wrap && wrap.querySelector("video");
    if (!video) return { fallbackTriggered: false, fallbackImgVisible: false };
    video.dispatchEvent(new Event("error"));
    const img = feed && feed.querySelector('img.iu-feed-section-header-img[src*="section-zpravy.jpg"]');
    const fallbackImgVisible = !!(
      img &&
      img.getBoundingClientRect().width > 0 &&
      img.getBoundingClientRect().height > 0 &&
      getComputedStyle(img).display !== "none"
    );
    const videoStillVisible = !!(
      feed &&
      feed.querySelector("video.iu-feed-section-header-video") &&
      getComputedStyle(feed.querySelector("video.iu-feed-section-header-video")).display !== "none"
    );
    return {
      fallbackTriggered: true,
      fallbackImgVisible,
      videoStillVisible,
    };
  });

  return {
    viewport: vp.key,
    VIDEO_VISIBLE: metrics.videoVisible ? "YES" : "NO",
    IMAGE_VISIBLE_UNDER_VIDEO: metrics.zpravyImgVisible && metrics.videoVisible ? "YES" : "NO",
    IMAGE_VISIBLE_NEXT_TO_VIDEO:
      metrics.zpravyImgVisible && metrics.videoVisible && metrics.headerBannerCount > 1 ? "YES" : "NO",
    DUPLICATE_BANNER: metrics.duplicateBanner ? "YES" : "NO",
    FALLBACK_IMAGE_WORKS:
      fallbackMetrics.fallbackImgVisible && !fallbackMetrics.videoStillVisible ? "YES" : "NO",
    [vp.label]: metrics.videoVisible && !metrics.duplicateBanner && !metrics.zpravyImgVisible ? "YES" : "NO",
    LAYOUT_SHIFT: metrics.layoutGap != null && metrics.layoutGap >= 0 && metrics.layoutGap < 120 ? "NO" : "CHECK",
    CONSOLE_ERRORS: consoleErrors.length,
    NETWORK_VIDEO_STATUS_OK:
      videoResponses.length > 0 && videoResponses.every((r) => r.status >= 200 && r.status < 400)
        ? "YES"
        : videoResponses.length === 0
          ? "NO_REQUEST"
          : "NO",
    metrics,
    fallbackMetrics,
    videoResponses,
    jpgResponses,
    jpgLoadedDuringVideo: jpgResponses.length > 0 ? "YES" : "NO",
    consoleErrors,
  };
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext();
      const page = await context.newPage();
      results.push(await measureViewport(page, vp));
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  const summary = {
    VIDEO_VISIBLE: results.every((r) => r.VIDEO_VISIBLE === "YES") ? "YES" : "NO",
    IMAGE_VISIBLE_UNDER_VIDEO: results.every((r) => r.IMAGE_VISIBLE_UNDER_VIDEO === "NO") ? "NO" : "YES",
    IMAGE_VISIBLE_NEXT_TO_VIDEO: results.every((r) => r.IMAGE_VISIBLE_NEXT_TO_VIDEO === "NO") ? "NO" : "YES",
    DUPLICATE_BANNER: results.every((r) => r.DUPLICATE_BANNER === "NO") ? "NO" : "YES",
    FALLBACK_IMAGE_WORKS: results.every((r) => r.FALLBACK_IMAGE_WORKS === "YES") ? "YES" : "NO",
    MOBILE_OK: results.find((r) => r.viewport === "mobile")?.MOBILE_OK || "NO",
    TABLET_OK: results.find((r) => r.viewport === "tablet")?.TABLET_OK || "NO",
    DESKTOP_OK: results.find((r) => r.viewport === "desktop")?.DESKTOP_OK || "NO",
    LAYOUT_SHIFT: results.every((r) => r.LAYOUT_SHIFT === "NO") ? "NO" : "CHECK",
    CONSOLE_ERRORS: results.reduce((n, r) => n + r.CONSOLE_ERRORS, 0),
    NETWORK_VIDEO_STATUS_OK: results.every((r) => r.NETWORK_VIDEO_STATUS_OK === "YES") ? "YES" : "NO",
  };

  console.log(JSON.stringify({ summary, results }, null, 2));
  const pass =
    summary.VIDEO_VISIBLE === "YES" &&
    summary.IMAGE_VISIBLE_UNDER_VIDEO === "NO" &&
    summary.IMAGE_VISIBLE_NEXT_TO_VIDEO === "NO" &&
    summary.DUPLICATE_BANNER === "NO" &&
    summary.FALLBACK_IMAGE_WORKS === "YES" &&
    summary.MOBILE_OK === "YES" &&
    summary.TABLET_OK === "YES" &&
    summary.DESKTOP_OK === "YES" &&
    summary.NETWORK_VIDEO_STATUS_OK === "YES" &&
    summary.CONSOLE_ERRORS === 0 &&
    results.every((r) => r.jpgLoadedDuringVideo === "NO");

  if (pass) {
    try {
      process.stdout.write("\u0007");
    } catch (_) {}
  }

  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
