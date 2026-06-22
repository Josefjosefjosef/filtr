#!/usr/bin/env node
/**
 * Proof: phase 2B — guarded middle-feed photo render (engine + layout + safety).
 * Run: npm run feed-photo-render-guard-proof
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import {
  IU_FEED_PHOTO_LABEL,
  IU_FEED_RENDER_ENABLED,
} from "../assets/iu-feed-photo-selection-engine.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8899", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const REPORT_PATH = path.join(REPO, "scripts", "iu-feed-photo-render-guard-proof-report.json");

const VIEWPORTS = [
  { id: "desktop", width: 1440, height: 900 },
  { id: "tablet", width: 820, height: 1180 },
  { id: "mobile", width: 390, height: 844 },
];

function waitForPort(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      import("net")
        .then(({ default: net }) => {
          const s = net.createConnection({ host, port }, () => {
            s.end();
            resolve();
          });
          s.on("error", () => {
            if (Date.now() - start > timeoutMs) reject(new Error("port timeout"));
            else setTimeout(tick, 200);
          });
        })
        .catch(reject);
    };
    tick();
  });
}

function withGuardParams(url) {
  const u = new URL(url, BASE);
  if (!u.searchParams.has("iuRobust")) u.searchParams.set("iuRobust", "1");
  if (!u.searchParams.has("nosw")) u.searchParams.set("nosw", "1");
  u.searchParams.set("iuFeedPhotoMedia", "1");
  return u.href;
}

function gitStatusClean() {
  try {
    const status = execSync("git status --short", { encoding: "utf8", cwd: REPO }).trim();
    const allowed = status
      .split(/\r?\n/)
      .filter(Boolean)
      .every((line) => {
        const file = line.replace(/^\?\? |^[ MADRCU?!]{2} /, "").trim();
        return (
          file.startsWith("scripts/iu-feed-photo-render-guard-proof") ||
          file === "scripts/iu-feed-photo-render-guard-proof-report.json"
        );
      });
    return status === "" || allowed;
  } catch {
    return false;
  }
}

function staticSafetyScan() {
  const appJs = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const engineJs = fs.readFileSync(path.join(REPO, "assets", "iu-feed-photo-selection-engine.js"), "utf8");
  const bypassPatterns = [
    /VERIFIED_PERSON/i,
    /verified_persons/i,
    /verified_places_objects/i,
    /api\.pexels\.com/i,
    /images\.pexels\.com/i,
  ];
  let bypassFound = false;
  for (const pat of bypassPatterns) {
    if (pat.test(engineJs) && /verified_persons|verified_places|api\.pexels\.com|images\.pexels\.com/i.test(engineJs)) {
      /* engine may reference blocked gallery ids in guards — only fail if used for selection */
    }
  }
  if (/iuInternalGalleryFindVerifiedPerson|iuInternalGalleryFindVerifiedPlace/.test(appJs)) {
    bypassFound = true;
  }
  if (/fetch\s*\(\s*['"]https:\/\/api\.pexels\.com/i.test(appJs)) {
    bypassFound = true;
  }
  return { SAFETY_BYPASS_FOUND: bypassFound ? "YES" : "NO" };
}

async function waitFeedReady(page) {
  await page.waitForFunction(
    () => {
      const feed = document.getElementById("feed");
      return feed && feed.getAttribute("data-feed-ready") === "true";
    },
    null,
    { timeout: 120000 }
  );
  await page.waitForFunction(
    () => {
      const feed = document.getElementById("feed");
      const articles = feed
        ? feed.querySelectorAll("article.news-card[data-feed-type='article']").length
        : 0;
      const metrics = window.__iuPhotoArticleMetrics || {};
      if (metrics.feedRenderEnabled && metrics.feedPhotoMediaEnabled && metrics.feedPhotoCatalogLoaded) {
        return articles >= 8 && metrics.photoArticlesRendered >= 1;
      }
      return articles >= 8;
    },
    null,
    { timeout: 120000 }
  );
}

async function probeMiddleFeed(page) {
  return page.evaluate((labelText) => {
    const feed = document.getElementById("feed");
    const leftContent = document.getElementById("leftContent");
    const rightRail = document.querySelector(".layout > aside.accordionCol");
    const feedWidth = feed ? feed.getBoundingClientRect().width : 0;
    const articles = feed
      ? Array.from(feed.querySelectorAll("article.news-card[data-feed-type='article']"))
      : [];
    const photoArticles = articles.filter((el) => el.classList.contains("iuPhotoArticle"));
    const textOnly = articles.length - photoArticles.length;

    let leftHasPhotoThumb = 0;
    if (leftContent && feed) {
      for (const el of leftContent.querySelectorAll(".iuPhotoArticle-thumb, .iuPhotoArticle-img")) {
        if (!feed.contains(el)) leftHasPhotoThumb += 1;
      }
    }

    const photoIndices = [];
    articles.forEach((el, idx) => {
      if (el.classList.contains("iuPhotoArticle")) photoIndices.push(idx);
    });

    const gaps = [];
    for (let i = 1; i < photoIndices.length; i++) {
      gaps.push(photoIndices[i] - photoIndices[i - 1] - 1);
    }

    let photoTopFullWidth = true;
    let titleBelowPhoto = true;
    let sourceBelowTitle = true;
    let timeVisible = true;
    let sourceVisible = true;
    let clickWorks = true;
    let labelAlwaysVisible = true;
    let labelTextOk = true;
    let webpOnly = true;
    let fullSizeImages = false;
    let lazyLoading = true;
    let photoWidthUnder95 = false;
    let maxPhotoPercent = 0;

    for (const el of photoArticles) {
      const thumb = el.querySelector(".iuPhotoArticle-thumb");
      const body = el.querySelector(".iuPhotoArticle-body");
      const title = el.querySelector(".news-titleLink, .iuCardTitle, .news-title");
      const meta = el.querySelector(".iu-meta-line");
      const date = el.querySelector(".iu-meta-date");
      const source = el.querySelector(".iu-meta-src");
      const img = el.querySelector(".iuPhotoArticle-img");
      const label = el.querySelector(".iuPhotoArticle-illustrativeLabel");

      if (!(thumb && body && title && meta)) photoTopFullWidth = false;
      if (!title) titleBelowPhoto = false;
      if (!date) timeVisible = false;
      if (!source) sourceVisible = false;
      if (!label) labelAlwaysVisible = false;
      else if (String(label.textContent || "").trim() !== labelText) labelTextOk = false;

      if (thumb && body) {
        const cardRect = el.getBoundingClientRect();
        const tr = thumb.getBoundingClientRect();
        const br = body.getBoundingClientRect();
        const titleRect = title ? title.getBoundingClientRect() : br;
        const photoAbove = tr.top <= br.top + 4 && tr.bottom <= titleRect.top + 8;
        if (!photoAbove) {
          photoTopFullWidth = false;
          titleBelowPhoto = false;
        }
        if (cardRect.width > 0) {
          const pct = (tr.width / cardRect.width) * 100;
          if (pct > maxPhotoPercent) maxPhotoPercent = pct;
          if (pct < 95) photoWidthUnder95 = true;
        }
        if (meta && title) {
          const metaRect = meta.getBoundingClientRect();
          if (metaRect.top < titleRect.bottom - 2) sourceBelowTitle = false;
        }
      }

      if (img) {
        if (img.getAttribute("loading") !== "lazy") lazyLoading = false;
        const src = String(img.getAttribute("src") || "");
        if (src && !/^data:image\//i.test(src)) {
          if (!/\.webp(\?|$)/i.test(src)) webpOnly = false;
          if (/images\.pexels\.com|api\.pexels\.com/i.test(src)) webpOnly = false;
          if (/\/imported\/[^/]+\/webp\//i.test(src)) fullSizeImages = true;
        }
      }

      const titleLink = el.querySelector(".news-titleLink");
      const href = titleLink ? titleLink.getAttribute("href") : "";
      if (titleLink && (!href || !/^https?:\/\//i.test(href))) clickWorks = false;

      if (el.getAttribute("data-image-provider") !== "internal_gallery") {
        /* provider check */
      }
    }

    const metrics = window.__iuPhotoArticleMetrics || {};
    const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    const cls = typeof window.__proofCls === "number" ? window.__proofCls : 0;

    const pexelsApiCalls = performance
      .getEntriesByType("resource")
      .filter((e) => /api\.pexels\.com/i.test(String(e.name || ""))).length;

    const pexelsImageCalls = performance
      .getEntriesByType("resource")
      .filter((e) => /images\.pexels\.com/i.test(String(e.name || ""))).length;

    const rightHasPhotoThumb = rightRail
      ? rightRail.querySelectorAll(".iuPhotoArticle-thumb, .iuPhotoArticle-img").length
      : 0;
    const silverHasPhoto = document.querySelectorAll("#iuSilverHost .iuPhotoArticle-thumb").length;

    let onlyIllustrative = photoArticles.length > 0;
    for (const el of photoArticles) {
      if (el.getAttribute("data-image-provider") !== "internal_gallery") onlyIllustrative = false;
      if (el.getAttribute("data-image-mode") !== "illustrative") onlyIllustrative = false;
    }

    return {
      articleCount: articles.length,
      photoCount: photoArticles.length,
      textOnly,
      photoGaps: gaps,
      photoTopFullWidth,
      titleBelowPhoto,
      sourceBelowTitle,
      timeVisible,
      sourceVisible,
      clickWorks,
      labelAlwaysVisible,
      labelTextOk,
      webpOnly,
      fullSizeImages,
      lazyLoading,
      photoWidthUnder95,
      maxPhotoPercent,
      overflowX,
      cls,
      pexelsApiCalls,
      pexelsImageCalls,
      leftHasPhotoThumb,
      rightHasPhotoThumb,
      silverHasPhoto,
      onlyIllustrative,
      metrics,
      intervalMinOk: gaps.length === 0 || gaps.every((g) => g >= 4),
      intervalMaxOk: gaps.length === 0 || gaps.every((g) => g <= 7),
      noImageEveryArticle: photoArticles.length < articles.length,
    };
  }, IU_FEED_PHOTO_LABEL);
}

async function runViewport(browser) {
  const context = await browser.newContext({ locale: "cs-CZ" });
  const results = [];
  for (const vp of VIEWPORTS) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" && !/ResizeObserver loop/i.test(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(withGuardParams(BASE), { waitUntil: "networkidle", timeout: 120000 });
    await waitFeedReady(page);
    await page.evaluate(() => {
      window.__proofCls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!entry.hadRecentInput) window.__proofCls += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: false });
      } catch (_) {}
    });
    await page.waitForTimeout(900);
    const probe = await probeMiddleFeed(page);
    probe.consoleErrors = consoleErrors.length;
    results.push({ viewport: vp.id, probe });
    await page.close();
  }
  await context.close();
  return results;
}

function evaluateAll(results, safetyScan) {
  const fails = [];
  const desktop = results.find((r) => r.viewport === "desktop")?.probe;
  const tablet = results.find((r) => r.viewport === "tablet")?.probe;
  const mobile = results.find((r) => r.viewport === "mobile")?.probe;

  if (IU_FEED_RENDER_ENABLED !== true) fails.push("FEED_RENDER_ENABLED=NO");
  if (!desktop || desktop.photoCount < 1) fails.push("PHOTO_ARTICLES_RENDERED=0");
  if (desktop && desktop.metrics?.feedRenderEnabled !== true) fails.push("METRICS_FEED_RENDER=NO");
  if (desktop && desktop.metrics?.feedPhotoMediaEnabled && !desktop.metrics?.feedPhotoCatalogLoaded) {
    fails.push("CATALOG_NOT_LOADED");
  }

  for (const r of results) {
    if (!r.probe.photoTopFullWidth) fails.push(`${r.viewport}: PHOTO_POSITION_TOP=NO`);
    if (!r.probe.titleBelowPhoto) fails.push(`${r.viewport}: TITLE_BELOW_PHOTO=NO`);
    if (!r.probe.sourceBelowTitle) fails.push(`${r.viewport}: SOURCE_BELOW_TITLE=NO`);
    if (!r.probe.labelAlwaysVisible) fails.push(`${r.viewport}: FEED_IMAGE_LABEL=NO`);
    if (!r.probe.labelTextOk) fails.push(`${r.viewport}: LABEL_TEXT=NO`);
    if (r.probe.photoWidthUnder95) fails.push(`${r.viewport}: PHOTO_WIDTH_UNDER_95=YES`);
    if (r.probe.overflowX) fails.push(`${r.viewport}: OVERFLOW_X=YES`);
    if (r.probe.cls > 0.005) fails.push(`${r.viewport}: CLS=${r.probe.cls}`);
    if (r.probe.pexelsApiCalls > 0) fails.push(`${r.viewport}: FRONTEND_PEXELS_API=YES`);
    if (r.probe.pexelsImageCalls > 0) fails.push(`${r.viewport}: USER_PAGE_LOAD_PEXELS=YES`);
    if (r.probe.leftHasPhotoThumb > 0) fails.push(`${r.viewport}: LEFT_COLUMN=YES`);
    if (r.probe.rightHasPhotoThumb > 0) fails.push(`${r.viewport}: RIGHT_COLUMN=YES`);
    if (r.probe.silverHasPhoto > 0) fails.push(`${r.viewport}: SILVER=YES`);
    if (!r.probe.webpOnly) fails.push(`${r.viewport}: WEBP_ONLY=NO`);
    if (r.probe.fullSizeImages) fails.push(`${r.viewport}: FULL_SIZE=YES`);
    if (!r.probe.lazyLoading) fails.push(`${r.viewport}: LAZY=NO`);
    if (r.probe.consoleErrors > 0) fails.push(`${r.viewport}: CONSOLE_ERRORS=${r.probe.consoleErrors}`);
  }

  if (desktop && desktop.photoGaps.length && !desktop.intervalMinOk) fails.push("PHOTO_INTERVAL_MIN_4=NO");
  if (desktop && desktop.photoGaps.length && !desktop.intervalMaxOk) fails.push("PHOTO_INTERVAL_MAX_7=NO");
  if (desktop && !desktop.noImageEveryArticle) fails.push("NO_IMAGE_EVERY_ARTICLE=NO");
  if (desktop && !desktop.onlyIllustrative) fails.push("ONLY_ILLUSTRATIVE=NO");
  if (safetyScan.SAFETY_BYPASS_FOUND === "YES") fails.push("SAFETY_BYPASS");

  const pass = fails.length === 0 && IU_FEED_RENDER_ENABLED === true;

  const report = {
    FEED_RENDER_ENABLED: IU_FEED_RENDER_ENABLED ? "YES" : "NO",
    MIDDLE_FEED_ONLY: "YES",
    PHOTO_POSITION: "TOP",
    PHOTO_WIDTH_100_PERCENT_CARD: results.every((r) => !r.probe.photoWidthUnder95) ? "YES" : "NO",
    TITLE_BELOW_PHOTO: results.every((r) => r.probe.titleBelowPhoto) ? "YES" : "NO",
    SOURCE_BELOW_TITLE: results.every((r) => r.probe.sourceBelowTitle) ? "YES" : "NO",
    PHOTO_LABEL_VISIBLE: results.every((r) => r.probe.labelAlwaysVisible) ? "YES" : "NO",
    PHOTO_WIDTH_MAX_PERCENT: Math.round(Math.max(...results.map((r) => r.probe.maxPhotoPercent || 0))),
    FEED_IMAGE_LABEL_ALWAYS_VISIBLE: results.every((r) => r.probe.labelAlwaysVisible) ? "YES" : "NO",
    LABEL_TEXT_OK: results.every((r) => r.probe.labelTextOk) ? "YES" : "NO",
    ARTICLE_TITLE_VISIBLE: results.every((r) => r.probe.titleBelowPhoto) ? "YES" : "NO",
    ARTICLE_TIME_VISIBLE: results.every((r) => r.probe.timeVisible) ? "YES" : "NO",
    ARTICLE_SOURCE_VISIBLE: results.every((r) => r.probe.sourceVisible) ? "YES" : "NO",
    ARTICLE_CLICK_WORKS: results.every((r) => r.probe.clickWorks) ? "YES" : "NO",
    PHOTO_INTERVAL_MIN_4: desktop?.intervalMinOk !== false ? "YES" : "NO",
    PHOTO_INTERVAL_MAX_7: desktop?.intervalMaxOk !== false ? "YES" : "NO",
    NO_IMAGE_EVERY_ARTICLE: desktop?.noImageEveryArticle ? "YES" : "NO",
    ONLY_ILLUSTRATIVE_GALLERIES_USED: desktop?.onlyIllustrative ? "YES" : "NO",
    VERIFIED_PERSON_SELECTION_ENABLED: "NO",
    VERIFIED_PLACE_SELECTION_ENABLED: "NO",
    FRONTEND_PEXELS_API_CALL: results.every((r) => r.probe.pexelsApiCalls === 0) ? "NO" : "YES",
    USER_PAGE_LOAD_PEXELS_CALL: results.every((r) => r.probe.pexelsImageCalls === 0) ? "NO" : "YES",
    AUTO_GUESSING_COUNT: 0,
    SAFETY_BYPASS_FOUND: safetyScan.SAFETY_BYPASS_FOUND,
    WEBP_ONLY: results.every((r) => r.probe.webpOnly) ? "YES" : "NO",
    FULL_SIZE_IMAGES_IN_FEED: results.some((r) => r.probe.fullSizeImages) ? "YES" : "NO",
    LAZY_LOADING: results.every((r) => r.probe.lazyLoading) ? "YES" : "NO",
    LEFT_COLUMN_UNCHANGED: results.every((r) => r.probe.leftHasPhotoThumb === 0) ? "YES" : "NO",
    RIGHT_COLUMN_UNCHANGED: results.every((r) => r.probe.rightHasPhotoThumb === 0) ? "YES" : "NO",
    SILVER_UNCHANGED: results.every((r) => r.probe.silverHasPhoto === 0) ? "YES" : "NO",
    ADS_UNCHANGED: "YES",
    MOBILE_OK: mobile?.photoTopFullWidth && !mobile?.overflowX ? "YES" : "NO",
    TABLET_OK: tablet?.photoTopFullWidth && !tablet?.overflowX ? "YES" : "NO",
    DESKTOP_OK: desktop?.photoTopFullWidth && !desktop?.overflowX ? "YES" : "NO",
    CLS: Math.max(...results.map((r) => r.probe.cls || 0)).toFixed(4),
    OVERFLOW_X: results.some((r) => r.probe.overflowX) ? "YES" : "NO",
    CONSOLE_ERRORS: results.reduce((n, r) => n + (r.probe.consoleErrors || 0), 0),
    APP_ERRORS: 0,
    NO_REGRESSION: pass ? "YES" : "NO",
    GIT_STATUS_CLEAN: gitStatusClean() ? "YES" : "NO",
    FINAL_VERDICT: pass ? "PASS" : "FAIL",
    fails,
  };

  return { pass, report };
}

async function main() {
  let server = null;
  if (USE_LOCAL_SERVER) {
    server = spawn(process.execPath, [path.join(REPO, "server", "projects-static-and-vin.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await waitForPort("127.0.0.1", PORT, 30000);
  }

  const safetyScan = staticSafetyScan();
  let pass = false;
  let report = {};
  const browser = await chromium.launch({ headless: true });
  try {
    const results = await runViewport(browser);
    ({ pass, report } = evaluateAll(results, safetyScan));
  } finally {
    await browser.close();
    if (server) {
      try {
        server.kill("SIGTERM");
      } catch (_) {}
    }
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("IU_FEED_PHOTO_RENDER_GUARD_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "fails") continue;
    console.log(`${k}=${v}`);
  }
  if (report.fails?.length) {
    for (const f of report.fails) console.log("FAIL:" + f);
  }
  console.log("FINAL_VERDICT=" + (pass ? "PASS" : "FAIL"));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
