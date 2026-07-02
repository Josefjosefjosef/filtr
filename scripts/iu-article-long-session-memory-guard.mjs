#!/usr/bin/env node
/**
 * Task 66 — long-session memory + network guard for chunked article client layer.
 * Run: npm run iu-article-long-session-memory-guard
 * Prod: IU_GUARD_BASE_URL=https://www.infouzel.cz/projects/ npm run iu-article-long-session-memory-guard
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

import {
  createIgnorableResourceTracker,
  installProofGuardNetworkStubs,
  isIgnorableGuardConsoleError,
} from "./proofs/open_meteo_guard_stub.cjs";

import {
  clickDesktopNav,
  waitDesktopNavTarget,
} from "./guards/desktop-nav-targets.mjs";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireFromRepo = createRequire(path.join(REPO, "package.json"));
const requireFromScript = createRequire(import.meta.url);
const shared = requireFromScript("./mobile-stability-guards-v1-shared.cjs");
const { chromium } = requireFromRepo("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8897", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const SESSION_ROUNDS = parseInt(process.env.IU_LONG_SESSION_ROUNDS || (process.env.IU_LONG_SESSION_STRESS === "1" ? "12" : "6"), 10);
const HEAP_DELTA_MAX_MB = parseFloat(process.env.IU_LONG_SESSION_HEAP_MB || (process.env.IU_LONG_SESSION_STRESS === "1" ? "70" : "45"));
const ARTICLE_RECEIVED_MAX = parseInt(process.env.IU_LONG_SESSION_ARTICLES_MAX || (process.env.IU_LONG_SESSION_STRESS === "1" ? "1200" : "650"), 10);
const LOAD_MORE_CLICKS_PER_SECTION = parseInt(process.env.IU_LONG_SESSION_LOAD_MORE_CLICKS || (process.env.IU_LONG_SESSION_STRESS === "1" ? "5" : "1"), 10);
const SECTIONS = ["zpravy", "sport", "finance", "zdravi"];

function articlePattern(url) {
  const p = String(url || "").split("?")[0].toLowerCase();
  return (
    p.includes("publishable_pool.json") ||
    p.includes("article_feed_chunks/") ||
    p.includes("articles.json") ||
    p.includes("bootstrap.json") ||
    /\/articles\/\d{4}-\d{2}-\d{2}\.json/.test(p)
  );
}

function initPattern(url) {
  return /article_feed_chunks\/[^/]+\/init\.json/i.test(String(url || ""));
}

function bufferPattern(url) {
  return /article_feed_chunks\/[^/]+\/\d{3}\.json/i.test(String(url || ""));
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request({ host, port, path: "/projects/", method: "HEAD", timeout: 800 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 120);
      });
      req.end();
    };
    tryOnce();
  });
}

async function dismissConsentIfPresent(page) {
  try {
    await shared.dismissGuardOverlays(page);
  } catch (_) {}
}

async function readSessionMetrics(page) {
  return page.evaluate(() => {
    const st = window.__iuFeedPipelineState || window.state || {};
    const loader = st.chunkLoader || null;
    const mem = performance.memory
      ? {
          used: performance.memory.usedJSHeapSize,
          total: performance.memory.totalJSHeapSize,
        }
      : null;
    const feed = document.getElementById("feed");
    const cards = feed ? feed.querySelectorAll("article.news-card, .iuNewsPreviewCard, .box-sport, .box-finance").length : 0;
    const loadMore = document.querySelector(".iuLoadMoreBtn");
    return {
      mem,
      articlesReceived: loader ? Number(loader.articlesReceivedCount || 0) : 0,
      articlesParsed: loader ? Number(loader.articlesParsedCount || 0) : 0,
      backgroundDone: !!(loader && loader.backgroundDone),
      sectionKey: loader ? String(loader.sectionKey || "") : "",
      mediaTopicKey: String(st.mediaTopicKey || ""),
      feedCards: cards,
      loadMoreVisible: !!(loadMore && loadMore.offsetParent !== null && !loadMore.disabled),
    };
  });
}

async function waitFeedReady(page, timeoutMs = 120000) {
  try {
    await page.waitForFunction(
      () => {
        const feed = document.getElementById("feed");
        return feed && feed.getAttribute("data-feed-ready") === "true";
      },
      null,
      { timeout: timeoutMs }
    );
  } catch (err) {
    const snap = await page.evaluate(() => ({
      ready: document.getElementById("feed") ? document.getElementById("feed").getAttribute("data-feed-ready") : null,
      feedExists: !!document.getElementById("feed"),
      cards: document.querySelectorAll("#feed article").length,
      href: String(location.href || ""),
    }));
    throw new Error(String(err && err.message ? err.message : err) + " snap=" + JSON.stringify(snap));
  }
}

async function scrollFeed(page) {
  await page.evaluate(async () => {
    const maxY = Math.max(
      document.body ? document.body.scrollHeight - window.innerHeight : 0,
      document.documentElement.scrollHeight - window.innerHeight,
      900
    );
    for (let i = 1; i <= 6; i++) {
      const y = Math.round((maxY * i) / 6);
      window.scrollTo(0, y);
      if (document.body) document.body.scrollTop = y;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });
  await page.waitForTimeout(120);
}

function loadMoreChunkPattern(url) {
  return /article_feed_chunks\/[^/]+\/(?!000\.json)[0-9]{3}\.json/i.test(String(url || ""));
}

async function clickLoadMoreRepeated(page, networkLog, markIdx, maxClicks) {
  const steps = [];
  for (let i = 0; i < maxClicks; i++) {
    const row = await clickLoadMoreIfPresent(page, networkLog, markIdx);
    if (!row.clicked) break;
    steps.push(row);
    markIdx = networkLog.length;
    await scrollFeed(page);
  }
  return steps;
}

async function clickLoadMoreIfPresent(page, networkLog, markIdx) {
  const btn = page.locator(".iuLoadMoreBtn");
  if ((await btn.count()) === 0) return { clicked: false, fetchesNewChunk: true };
  if (!(await btn.first().isVisible())) return { clicked: false, fetchesNewChunk: true };
  const disabled = await btn.first().isDisabled().catch(() => true);
  if (disabled) return { clicked: false, fetchesNewChunk: true };
  await dismissConsentIfPresent(page);
  const filteredBefore = await page.evaluate(() => {
    const st = window.__iuFeedPipelineState || window.state || {};
    return {
      len: Array.isArray(st.filteredItems) ? st.filteredItems.length : null,
      page: Number(st.page) >= 1 ? Number(st.page) : 1,
      domArticles: document.querySelectorAll("#feed article.news-card").length,
    };
  });
  await btn.first().click({ timeout: 10000 });
  await page.waitForTimeout(2500);
  await waitFeedReady(page, 90000).catch(() => {});
  const filteredAfter = await page.evaluate(() => {
    const st = window.__iuFeedPipelineState || window.state || {};
    return {
      len: Array.isArray(st.filteredItems) ? st.filteredItems.length : null,
      page: Number(st.page) >= 1 ? Number(st.page) : 1,
      domArticles: document.querySelectorAll("#feed article.news-card").length,
    };
  });
  const newChunks = networkLog.slice(markIdx).filter((n) => loadMoreChunkPattern(n.url));
  const fetchesNew =
    newChunks.length > 0 ||
    filteredAfter.page > filteredBefore.page ||
    (filteredAfter.len != null &&
      filteredBefore.len != null &&
      filteredAfter.len > filteredBefore.len) ||
    filteredAfter.domArticles > filteredBefore.domArticles;
  return { clicked: true, fetchesNewChunk: fetchesNew, newChunkCount: newChunks.length };
}

async function runLongSession(page, networkLog) {
  const rounds = [];
  let heapStart = null;
  let heapEnd = null;
  let maxArticlesReceived = 0;

  await page.goto(BASE + (BASE.includes("?") ? "&" : "?") + "section=media&topic=zpravy&iuRobust=1", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await dismissConsentIfPresent(page);
  await waitFeedReady(page);

  const baseline = await readSessionMetrics(page);
  heapStart = baseline.mem ? baseline.mem.used : null;

  for (let round = 0; round < SESSION_ROUNDS; round++) {
    for (const section of SECTIONS) {
      const mark = networkLog.length;
      await clickDesktopNav(page, section);
      await waitDesktopNavTarget(page, section, 90000).catch(() => {});
      await waitFeedReady(page);
      await page.waitForTimeout(400);
      await scrollFeed(page);
      const metrics = await readSessionMetrics(page);
      maxArticlesReceived = Math.max(maxArticlesReceived, metrics.articlesReceived || 0);
      const loadMoreSteps = await clickLoadMoreRepeated(page, networkLog, mark, LOAD_MORE_CLICKS_PER_SECTION);
      const loadMore = loadMoreSteps.length ? loadMoreSteps[loadMoreSteps.length - 1] : { clicked: false, fetchesNewChunk: true };
      const afterLoadMore = loadMore.clicked ? await readSessionMetrics(page) : metrics;
      maxArticlesReceived = Math.max(maxArticlesReceived, afterLoadMore.articlesReceived || 0);
      rounds.push({
        round,
        section,
        articlesReceived: afterLoadMore.articlesReceived,
        feedCards: afterLoadMore.feedCards,
        loadMore,
        loadMoreSteps: loadMoreSteps.length,
        initFetches: networkLog.slice(mark).filter((n) => initPattern(n.url)).length,
        bufferFetches: networkLog.slice(mark).filter((n) => bufferPattern(n.url)).length,
      });
    }
  }

  await clickDesktopNav(page, "media").catch(() => {});
  await page.waitForTimeout(600);
  const prehledNetMark = networkLog.length;
  await page.waitForTimeout(400);
  const prehledArticleFetches = networkLog.slice(prehledNetMark).filter((n) => articlePattern(n.url)).length;

  const finalMetrics = await readSessionMetrics(page);
  heapEnd = finalMetrics.mem ? finalMetrics.mem.used : null;

  return {
    baseline,
    finalMetrics,
    rounds,
    maxArticlesReceived,
    heapStart,
    heapEnd,
    heapDeltaMb:
      heapStart != null && heapEnd != null ? Math.round(((heapEnd - heapStart) / (1024 * 1024)) * 10) / 10 : null,
    prehledArticleFetches,
  };
}

function analyzeNetwork(networkLog) {
  const articleRequests = networkLog.filter((n) => articlePattern(n.url));
  const counts = new Map();
  for (const n of articleRequests) {
    counts.set(n.url, (counts.get(n.url) || 0) + 1);
  }
  const duplicates = [...counts.entries()].filter(([, c]) => c > 1).map(([url, count]) => ({ url, count }));
  const poolHits = networkLog.filter((n) => /publishable_pool\.json/i.test(String(n.url || "")));
  return { duplicates, poolHits: poolHits.length, totalArticleRequests: articleRequests.length };
}

async function main() {
  let server = null;
  if (USE_LOCAL_SERVER) {
    server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await waitForPort("127.0.0.1", PORT, 30000);
  }

  const networkLog = [];
  const consoleErrors = [];
  const browser = await chromium.launch({ headless: true });
  const context = await bootstrapGuardContext(browser, { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const ignorableTracker = createIgnorableResourceTracker();
  ignorableTracker.attachToPage(page);
  const ignorableOpts = {
    hadRecentIgnorableFailure: () => ignorableTracker.hadRecentIgnorableFailure(),
  };
  page.on("request", (req) => {
    if (req.resourceType() !== "fetch" && req.resourceType() !== "xhr") return;
    networkLog.push({ url: req.url(), method: req.method() });
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = String(msg.text());
    if (/Failed to load resource/i.test(t) && /503 \(Network Error\)/i.test(t)) return;
    if (isIgnorableGuardConsoleError(t, ignorableOpts)) return;
    consoleErrors.push(t);
  });
  try {
    await page.route("**/sw.js", (route) => route.abort());
  } catch (_) {}
  try {
    await installProofGuardNetworkStubs(page);
  } catch (_) {}

  const fails = [];
  let session = null;
  try {
    session = await runLongSession(page, networkLog);
  } catch (err) {
    fails.push(String(err && err.message ? err.message : err));
  }

  const net = analyzeNetwork(networkLog);
  await browser.close();
  if (server) server.kill("SIGTERM");

  if (session) {
    if (session.heapDeltaMb != null && session.heapDeltaMb > HEAP_DELTA_MAX_MB) {
      fails.push(`heap delta ${session.heapDeltaMb}MB > ${HEAP_DELTA_MAX_MB}MB`);
    }
    if (session.maxArticlesReceived > ARTICLE_RECEIVED_MAX) {
      fails.push(`articlesReceived ${session.maxArticlesReceived} > ${ARTICLE_RECEIVED_MAX}`);
    }
    if (net.poolHits > 0) {
      fails.push("publishable_pool.json requested");
    }
    if (session.prehledArticleFetches > 3) {
      fails.push(`prehled dne triggered ${session.prehledArticleFetches} article fetches (max 3 init+buffer)`);
    }
    for (const row of session.rounds) {
      if (
        row.loadMore.clicked &&
        !row.loadMore.fetchesNewChunk &&
        Number(row.feedCards) < 40
      ) {
        fails.push(`section ${row.section} round ${row.round}: load-more did not fetch or reveal new articles`);
      }
    }
  }

  if (consoleErrors.length) {
    fails.push(`console errors: ${consoleErrors.length}`);
    if (consoleErrors.length <= 3) {
      for (const line of consoleErrors) fails.push(`console: ${line.slice(0, 240)}`);
    }
  }

  const report = {
    measuredAt: new Date().toISOString(),
    baseUrl: BASE,
    sessionRounds: SESSION_ROUNDS,
    loadMoreClicksPerSection: LOAD_MORE_CLICKS_PER_SECTION,
    stressMode: process.env.IU_LONG_SESSION_STRESS === "1",
    heapDeltaMb: session ? session.heapDeltaMb : null,
    heapDeltaMaxMb: HEAP_DELTA_MAX_MB,
    maxArticlesReceived: session ? session.maxArticlesReceived : null,
    articlesReceivedMax: ARTICLE_RECEIVED_MAX,
    prehledArticleFetches: session ? session.prehledArticleFetches : null,
    duplicateArticleRequests: net.duplicates.slice(0, 12),
    publishablePoolRequests: net.poolHits,
    totalArticleRequests: net.totalArticleRequests,
    rounds: session ? session.rounds : [],
    consoleErrorsCount: consoleErrors.length,
    pass: fails.length === 0,
    fails,
  };

  const reportPath = path.join(REPO, "scripts", "iu-article-long-session-memory-guard-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log("IU_ARTICLE_LONG_SESSION_MEMORY_GUARD_RESULT");
  console.log(JSON.stringify(report, null, 2));
  if (fails.length) {
    console.error("FAIL");
    fails.forEach((f) => console.error(f));
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
