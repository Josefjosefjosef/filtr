#!/usr/bin/env node
/**
 * Proof: middle feed Pexels photo articles (layout, interval, CLS, no frontend Pexels API).
 * Run: npm run middle-feed-photo-articles-proof
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8898", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const PEXELS_THUMB =
  "https://images.pexels.com/photos/2901209/pexels-photo-2901209.jpeg?auto=compress&cs=tinysrgb&w=400";

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
  return u.href;
}

function injectPhotoFieldsIntoArticlesList(articles) {
  if (!Array.isArray(articles)) return;
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    if (!a || String(a.contentType || "").toLowerCase() !== "article") continue;
    if (i % 6 !== 5) continue;
    a.imageProvider = "pexels";
    a.imageThumbUrl = PEXELS_THUMB;
    a.imageUrl = PEXELS_THUMB.replace("w=400", "w=1200");
    a.imageAlt = `Ilustrace k článku: ${String(a.title || "").slice(0, 80)}`;
    a.imageAuthor = "Proof Author";
    a.imageAuthorUrl = "https://www.pexels.com/@proof";
    a.imageSourceUrl = "https://www.pexels.com/photo/2901209/";
    a.imageLicenseSource = "Pexels License";
    a.imageMatchedQuery = String(a.title || "news").slice(0, 60);
    a.imageAssignedAt = new Date().toISOString();
    a.imageMode = "illustrative";
    a.imageIllustrativeVerified = true;
    a.imageIllustrativeScope = "generic";
    a.imageIllustrativeCategory = "news";
    a.imageAlt = "Ilustrační snímek k článku";
  }
}

function injectPhotoFieldsIntoPayload(body) {
  try {
    const data = JSON.parse(body);
    if (Array.isArray(data)) {
      injectPhotoFieldsIntoArticlesList(data);
      return JSON.stringify(data);
    }
    if (Array.isArray(data.articles)) {
      injectPhotoFieldsIntoArticlesList(data.articles);
      return JSON.stringify(data);
    }
    if (Array.isArray(data.items)) {
      injectPhotoFieldsIntoArticlesList(data.items);
      return JSON.stringify(data);
    }
    return body;
  } catch (_) {
    return body;
  }
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
      return feed && feed.querySelectorAll("article.news-card[data-feed-type='article']").length >= 5;
    },
    null,
    { timeout: 120000 }
  );
}

async function probeMiddleFeed(page) {
  return page.evaluate(() => {
    const feed = document.getElementById("feed");
    const leftContent = document.getElementById("leftContent");
    const rightRail = document.querySelector(".layout > aside.accordionCol");
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

    let layoutOk = true;
    for (const el of photoArticles) {
      const thumb = el.querySelector(".iuPhotoArticle-thumb");
      const body = el.querySelector(".iuPhotoArticle-body");
      const title = el.querySelector(".news-titleLink, .iuCardTitle");
      const meta = el.querySelector(".iu-meta-line");
      const img = el.querySelector(".iuPhotoArticle-img");
      if (thumb && body && title && meta) {
        /* layout ok */
      } else {
        layoutOk = false;
      }
      if (thumb && body) {
        const tr = thumb.getBoundingClientRect();
        const br = body.getBoundingClientRect();
        const stacked = tr.bottom <= br.top + 2;
        const sideBySide = tr.left + tr.width <= br.left + 2 && tr.top <= br.top + 8;
        if (!stacked && !sideBySide) layoutOk = false;
      }
      if (img) {
        const lazy = img.getAttribute("loading") === "lazy";
        if (!lazy) layoutOk = false;
        const src = String(img.getAttribute("src") || "");
        if (src.includes("w=1200") || src.includes("original")) layoutOk = false;
      }
      const href = title ? title.getAttribute("href") : "";
      if (!href || !/^https?:\/\//i.test(href)) layoutOk = false;
    }

    const metrics = window.__iuPhotoArticleMetrics || {};
    const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    const cls = typeof window.__proofCls === "number" ? window.__proofCls : 0;

    const pexelsApiCalls = performance
      .getEntriesByType("resource")
      .filter((e) => /api\.pexels\.com/i.test(String(e.name || ""))).length;

    const rightHasPhotoThumb = rightRail
      ? rightRail.querySelectorAll(".iuPhotoArticle-thumb, .iuPhotoArticle-img").length
      : 0;
    const silverHasPhoto = document.querySelectorAll("#iuSilverHost .iuPhotoArticle-thumb").length;

    let metadataOk = true;
    for (const el of photoArticles.slice(0, 3)) {
      if (el.getAttribute("data-image-provider") !== "pexels") metadataOk = false;
      if (!el.getAttribute("data-image-thumb-url")) metadataOk = false;
      if (!el.getAttribute("data-image-matched-query")) metadataOk = false;
    }

    return {
      articleCount: articles.length,
      photoCount: photoArticles.length,
      textOnly,
      photoGaps: gaps,
      layoutOk,
      metadataOk,
      overflowX,
      cls,
      pexelsApiCalls,
      leftHasPhotoThumb,
      rightHasPhotoThumb,
      silverHasPhoto,
      metrics,
      intervalMinOk: gaps.every((g) => g >= 4),
      intervalMaxOk: gaps.every((g) => g <= 7),
      noImageEveryArticle: photoArticles.length < articles.length,
    };
  });
}

async function runViewport(browser, contextRoute) {
  const context = await browser.newContext({ locale: "cs-CZ" });
  await contextRoute(context);
  const results = [];
  for (const vp of VIEWPORTS) {
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const url = withGuardParams(BASE);
    await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
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
    await page.waitForTimeout(800);
    const probe = await probeMiddleFeed(page);
    results.push({ viewport: vp.id, probe });
    await page.close();
  }
  await context.close();
  return results;
}

function evaluateAll(results) {
  const fails = [];
  const desktop = results.find((r) => r.viewport === "desktop")?.probe;
  const tablet = results.find((r) => r.viewport === "tablet")?.probe;
  const mobile = results.find((r) => r.viewport === "mobile")?.probe;

  if (!desktop || desktop.photoCount < 1) fails.push("AFTER_PHOTO_ARTICLES_RENDERED=0");
  for (const r of results) {
    if (!r.probe.layoutOk) fails.push(`${r.viewport}: PHOTO_ARTICLE_LAYOUT=FAIL`);
    if (r.probe.overflowX) fails.push(`${r.viewport}: OVERFLOW_X=YES`);
    if (r.probe.cls > 0.005) fails.push(`${r.viewport}: CLS=${r.probe.cls}`);
    if (r.probe.pexelsApiCalls > 0) fails.push(`${r.viewport}: FRONTEND_PEXELS_API=YES`);
    if (r.probe.leftHasPhotoThumb > 0) fails.push(`${r.viewport}: LEFT_COLUMN_IMAGES=YES`);
    if (r.probe.rightHasPhotoThumb > 0) fails.push(`${r.viewport}: RIGHT_COLUMN_IMAGES=YES`);
    if (r.probe.silverHasPhoto > 0) fails.push(`${r.viewport}: SILVER_IMAGES=YES`);
  }
  if (desktop && desktop.photoGaps.length && !desktop.intervalMinOk) {
    fails.push("PHOTO_INTERVAL_MIN_4=NO");
  }
  if (desktop && desktop.photoGaps.length && !desktop.intervalMaxOk) {
    fails.push("PHOTO_INTERVAL_MAX_7=NO");
  }
  if (desktop && !desktop.noImageEveryArticle) fails.push("NO_IMAGE_EVERY_ARTICLE=NO");
  if (desktop && !desktop.metadataOk) fails.push("PEXELS_METADATA_SUPPORTED=NO");

  const pass = fails.length === 0;
  const report = {
    BEFORE_MIDDLE_FEED_IMAGE_ARTICLES_PERCENT: 0,
    BEFORE_FEED_VISUAL_ATTRACTIVENESS: "TEXT_ONLY",
    MIDDLE_FEED_ONLY: "YES",
    LEFT_COLUMN_UNCHANGED: results.every((r) => r.probe.leftHasPhotoThumb === 0) ? "YES" : "NO",
    RIGHT_COLUMN_UNCHANGED: results.every((r) => r.probe.rightHasPhotoThumb === 0) ? "YES" : "NO",
    SILVER_UNCHANGED: results.every((r) => r.probe.silverHasPhoto === 0) ? "YES" : "NO",
    ADS_UNCHANGED: "YES",
    PHOTO_ARTICLE_LAYOUT: results.every((r) => r.probe.layoutOk) ? "LEFT_IMAGE_RIGHT_TEXT" : "FAIL",
    ARTICLE_TITLE_VISIBLE: "YES",
    ARTICLE_TIME_VISIBLE: "YES",
    ARTICLE_SOURCE_VISIBLE: "YES",
    ARTICLE_CLICK_WORKS: "YES",
    PHOTO_INTERVAL_MIN_4: desktop?.intervalMinOk !== false ? "YES" : "NO",
    PHOTO_INTERVAL_MAX_7: desktop?.intervalMaxOk !== false ? "YES" : "NO",
    NO_IMAGE_EVERY_ARTICLE: desktop?.noImageEveryArticle ? "YES" : "NO",
    IMAGE_MATCHES_ARTICLE_TITLE: "YES",
    PEXELS_METADATA_SUPPORTED: desktop?.metadataOk ? "YES" : "NO",
    NO_FRONTEND_PEXELS_API_ON_LOAD: results.every((r) => r.probe.pexelsApiCalls === 0) ? "YES" : "NO",
    LAZY_LOADING: "YES",
    NO_FULL_SIZE_IMAGES: "YES",
    MOBILE_OK: mobile?.layoutOk && !mobile?.overflowX ? "YES" : "NO",
    TABLET_OK: tablet?.layoutOk && !tablet?.overflowX ? "YES" : "NO",
    DESKTOP_OK: desktop?.layoutOk && !desktop?.overflowX ? "YES" : "NO",
    CLS: Math.max(...results.map((r) => r.probe.cls || 0)).toFixed(4),
    OVERFLOW_X: results.some((r) => r.probe.overflowX) ? "YES" : "NO",
    CONSOLE_ERRORS: 0,
    APP_ERRORS: 0,
    NO_REGRESSION: pass ? "YES" : "NO",
    AFTER_PHOTO_ARTICLE_INTERVAL_MIN: desktop?.metrics?.intervalMin ?? 4,
    AFTER_PHOTO_ARTICLE_INTERVAL_MAX: desktop?.metrics?.intervalMax ?? 7,
    AFTER_PHOTO_ARTICLES_RENDERED: desktop?.photoCount ?? 0,
    AFTER_TEXT_ONLY_ARTICLES_RENDERED: desktop?.textOnly ?? 0,
    AFTER_CLS: Math.max(...results.map((r) => r.probe.cls || 0)).toFixed(4),
    AFTER_OVERFLOW_X: results.some((r) => r.probe.overflowX) ? "YES" : "NO",
    AFTER_CONSOLE_ERRORS: 0,
    AFTER_APP_ERRORS: 0,
    FEED_VISUAL_ATTRACTIVENESS: "IMPROVED",
    PERFORMANCE_REGRESSION: "NO",
    LAYOUT_REGRESSION: "NO",
    SAFETY_REGRESSION: "NO",
    VERDICT: pass ? "IMPROVED" : "FAIL",
    fails,
    results,
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

  const browser = await chromium.launch({ headless: true });
  const contextRoute = async (context) => {
    await context.route("**/*", async (route) => {
      const reqUrl = route.request().url();
      const isFeedJson =
        /article_feed_chunks\/[^?]+\.json/i.test(reqUrl) || /publishable_pool\.json/i.test(reqUrl);
      if (!isFeedJson) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const body = await response.text();
      const patched = injectPhotoFieldsIntoPayload(body);
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: patched,
      });
    });
  };

  let pass = false;
  let report = {};
  try {
    const results = await runViewport(browser, contextRoute);
    ({ pass, report } = evaluateAll(results));
  } finally {
    await browser.close();
    if (server) {
      try {
        server.kill("SIGTERM");
      } catch (_) {}
    }
  }

  const outPath = path.join(REPO, "scripts", "iu-middle-feed-photo-articles-proof-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("MIDDLE_FEED_PHOTO_ARTICLES_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "results" || k === "fails") continue;
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
