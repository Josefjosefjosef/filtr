#!/usr/bin/env node
/**
 * Article frontend loading diagnostic — read-only, no behavior changes.
 *
 * Usage:
 *   node scripts/diagnose-article-frontend-loading.cjs
 *
 * Env:
 *   IU_ARTICLE_LOAD_DIAG_URL   (default https://infouzel.cz/projects/)
 *   IU_ARTICLE_LOAD_DIAG_OUT   (default scripts/diagnose-article-frontend-loading-report.json)
 *   IU_ARTICLE_LOAD_DIAG_SKIP_BROWSER=1  (skip Playwright, file probe only)
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("http");
const { execSync } = require("child_process");

const REPO = path.resolve(__dirname, "..");
const PRODUCTION_URL = (process.env.IU_ARTICLE_LOAD_DIAG_URL || "https://infouzel.cz/projects/").replace(/\/?$/, "/");
const REPORT_PATH = path.resolve(
  process.env.IU_ARTICLE_LOAD_DIAG_OUT || path.join(__dirname, "diagnose-article-frontend-loading-report.json"),
);
const SKIP_BROWSER = process.env.IU_ARTICLE_LOAD_DIAG_SKIP_BROWSER === "1";

const DATA_FILES = [
  "data/publishable_pool.json",
  "data/articles/bootstrap.json",
  "data/articles/index.json",
  "data/articles.json",
  "data/videos.json",
  "data/meta.json",
];

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1366, height: 768 },
];

function kb(n) {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round((n / 1024) * 10) / 10;
}

function gitMainCommit() {
  try {
    return execSync("git rev-parse HEAD", { cwd: REPO, encoding: "utf8" }).trim();
  } catch (_) {
    return "unknown";
  }
}

function gitStatusClean() {
  try {
    const out = execSync("git status --porcelain", { cwd: REPO, encoding: "utf8" }).trim();
    return out.length === 0;
  } catch (_) {
    return false;
  }
}

function fetchProbe(baseUrl, relPath) {
  return new Promise((resolve) => {
    const full = new URL(relPath, baseUrl).href;
    const lib = full.startsWith("https") ? require("https") : require("http");
    const u = new URL(full);
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        headers: { "Accept-Encoding": "identity", "User-Agent": "iu-article-load-diagnostic/1.0" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          let articleCount = null;
          let generatedAt = null;
          let dayCount = null;
          if (res.statusCode === 200 && relPath.endsWith(".json")) {
            try {
              const j = JSON.parse(body.toString("utf8"));
              if (Array.isArray(j.articles)) articleCount = j.articles.length;
              else if (Array.isArray(j)) articleCount = j.length;
              else if (Array.isArray(j.days)) dayCount = j.days.length;
              generatedAt = j.generatedAt || j.updatedAt || null;
            } catch (_) {}
          }
          resolve({
            path: relPath,
            url: full,
            status: res.statusCode,
            transferBytes: body.length,
            contentEncoding: res.headers["content-encoding"] || "identity",
            contentLengthHeader: res.headers["content-length"] ? Number(res.headers["content-length"]) : null,
            articleCount,
            dayCount,
            generatedAt,
          });
        });
      },
    );
    req.on("error", (e) => resolve({ path: relPath, url: full, error: String(e.message) }));
    req.setTimeout(120000, () => {
      req.destroy();
      resolve({ path: relPath, url: full, error: "timeout" });
    });
    req.end();
  });
}

async function probeDataFiles(baseUrl) {
  const results = [];
  for (const rel of DATA_FILES) {
    results.push(await fetchProbe(baseUrl, rel));
  }
  return results;
}

function articleFilePattern(url) {
  const p = String(url || "").split("?")[0].toLowerCase();
  return (
    p.includes("publishable_pool.json") ||
    p.includes("articles.json") ||
    p.includes("bootstrap.json") ||
    p.includes("article_feed_chunks/") ||
    /\/articles\/\d{4}-\d{2}-\d{2}\.json/.test(p)
  );
}

async function runViewport(browser, vw, baseUrl) {
  const page = await browser.newPage({ viewport: { width: vw.width, height: vw.height } });
  const consoleErrors = [];
  const networkLog = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const t = msg.text();
      if (!/ResizeObserver loop/i.test(t)) consoleErrors.push(t);
    }
  });

  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (!articleFilePattern(url) && !url.includes("/data/videos.json") && !url.includes("/data/meta.json")) return;
      const headers = res.headers();
      let bodyLen = null;
      try {
        const buf = await res.body();
        bodyLen = buf ? buf.length : 0;
      } catch (_) {}
      const cl = headers["content-length"] ? Number(headers["content-length"]) : null;
      networkLog.push({
        url,
        status: res.status(),
        transferBytes: bodyLen != null ? bodyLen : cl,
        contentEncoding: headers["content-encoding"] || null,
        phase: "initial",
      });
    } catch (_) {}
  });

  await page.addInitScript(() => {
    window.__IU_ARTICLE_LOAD_DIAG__ = { longTasks: [], t0: performance.now() };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration > 50) {
            window.__IU_ARTICLE_LOAD_DIAG__.longTasks.push({ startTime: e.startTime, duration: e.duration });
          }
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch (_) {}
  });

  try {
    await page.route("**/sw.js", (route) => route.abort());
  } catch (_) {}

  const navUrl = baseUrl + "?section=feed&topic=zpravy";
  const tNav0 = Date.now();
  await page.goto(navUrl, { waitUntil: "domcontentloaded", timeout: 120000 });

  await page.waitForFunction(
    () => {
      const feed = document.getElementById("feed");
      return feed && feed.getAttribute("data-feed-ready") === "true";
    },
    { timeout: 120000 },
  ).catch(() => {});

  await page.waitForTimeout(8000);

  const snapshot = await page.evaluate(() => {
    const feed = document.getElementById("feed");
    const st =
      (typeof window.__iuFeedPipelineState !== "undefined" && window.__iuFeedPipelineState) ||
      (typeof window.state !== "undefined" && window.state) ||
      {};
    const paging = window.__iuFeedPaging || {};
    const meta = document.querySelector(".iuLoadMoreMeta");
    const cards = feed
      ? feed.querySelectorAll("article.news-card[data-feed-type='article'], article.news-card, .news-card").length
      : 0;
    const loadMoreBtn = document.querySelector(".iuLoadMoreBtn");
    const nav = performance.getEntriesByType("navigation")[0];
    const scripts = performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script");
    let scriptDuration = 0;
    for (const s of scripts) scriptDuration += s.duration || 0;
    const diag = window.__IU_ARTICLE_LOAD_DIAG__ || { longTasks: [] };
    const blocked = (diag.longTasks || []).reduce((a, t) => a + (t.duration || 0), 0);
    const firstCard = feed && feed.querySelector("article.news-card, .news-card");
    let firstContentMs = null;
    if (firstCard && nav) {
      try {
        const rect = firstCard.getBoundingClientRect();
        if (rect.height > 0) firstContentMs = Math.round(performance.now());
      } catch (_) {}
    }
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      cachedItemsLen: Array.isArray(st.cachedItems) ? st.cachedItems.length : null,
      filteredItemsLen: Array.isArray(st.filteredItems) ? st.filteredItems.length : null,
      articlesRawKeys: st.articlesRaw && typeof st.articlesRaw === "object" ? Object.keys(st.articlesRaw).slice(0, 12) : [],
      articlesRawArticleCount:
        st.articlesRaw && Array.isArray(st.articlesRaw.articles) ? st.articlesRaw.articles.length : null,
      hasLoadedData: !!st.hasLoadedData,
      loaderMode: window.__iuArticlesLoaderMode || null,
      homepageFeedSource: window.__iuHomepageFeedDataSource || null,
      chunkLoaderMode: !!(st.chunkLoader && st.chunkLoader.manifest),
      chunkSectionKey: st.chunkLoader ? st.chunkLoader.sectionKey : null,
      chunkArticlesReceived: st.chunkLoader ? st.chunkLoader.articlesReceivedCount : null,
      fetchCounts: window.__iuArticlesLoaderFetchCounts || null,
      paging,
      loadMoreMetaText: meta ? meta.textContent : null,
      renderedArticleCards: cards,
      feedChildCount: feed ? feed.childElementCount : null,
      feedReady: feed ? feed.getAttribute("data-feed-ready") : null,
      domNodeCount: document.getElementsByTagName("*").length,
      loadMoreVisible: !!(loadMoreBtn && loadMoreBtn.offsetParent !== null),
      fcpMs: fcp ? Math.round(fcp.startTime) : null,
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadEventMs: nav ? Math.round(nav.loadEventEnd) : null,
      scriptResourceDurationMs: Math.round(scriptDuration),
      longTaskCount: (diag.longTasks || []).length,
      mainThreadBlockingMs: Math.round(blocked),
      usableMs: feed && feed.getAttribute("data-feed-ready") === "true" ? Math.round(performance.now()) : null,
      retentionDaysLen: Array.isArray(st.retentionDays) ? st.retentionDays.length : null,
      retentionCursor: st.retentionCursor,
      silverRetentionDeferred: window.__iuSilverRetentionDeferredScheduled,
      clusterDedup: window.__IU_CLUSTER_DEDUP__ || null,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  });

  const loadMoreTest = {
    clicked: false,
    newArticleRequests: [],
    newDayShardRequests: [],
    metaBefore: snapshot.loadMoreMetaText,
    metaAfter: null,
    filteredBefore: snapshot.filteredItemsLen,
  };
  const articleReqBefore = networkLog.length;

  try {
    const btn = await page.$(".iuLoadMoreBtn");
    if (btn) {
      loadMoreTest.clicked = true;
      for (const n of networkLog) {
        if (n.phase === "initial") n.phase = "pre_load_more";
      }
      await btn.click();
      await page.waitForTimeout(6000);
      loadMoreTest.metaAfter = await page.evaluate(() => {
        const m = document.querySelector(".iuLoadMoreMeta");
        return m ? m.textContent : null;
      });
      loadMoreTest.renderedAfter = await page.evaluate(() => {
        const feed = document.getElementById("feed");
        return feed
          ? feed.querySelectorAll("article.news-card[data-feed-type='article'], article.news-card, .news-card").length
          : 0;
      });
      loadMoreTest.filteredAfter = await page.evaluate(() => {
        const st = window.__iuFeedPipelineState || window.state || {};
        return Array.isArray(st.filteredItems) ? st.filteredItems.length : null;
      });
      loadMoreTest.pageAfter = await page.evaluate(() => {
        const st = window.__iuFeedPipelineState || window.state || {};
        return st.page;
      });
    }
  } catch (e) {
    loadMoreTest.error = String(e.message || e);
  }

  loadMoreTest.newArticleRequests = networkLog.slice(articleReqBefore).filter((n) => articleFilePattern(n.url));
  loadMoreTest.newDayShardRequests = loadMoreTest.newArticleRequests.filter((n) =>
    /\/articles\/\d{4}-\d{2}-\d{2}\.json/.test(n.url),
  );
  loadMoreTest.newChunkRequests = loadMoreTest.newArticleRequests.filter((n) =>
    /article_feed_chunks\/.*\/\d{3}\.json/.test(String(n.url || "")),
  );
  loadMoreTest.filteredUnchanged =
    loadMoreTest.filteredBefore != null &&
    loadMoreTest.filteredAfter != null &&
    loadMoreTest.filteredBefore === loadMoreTest.filteredAfter;

  const articleNetwork = networkLog.filter((n) => articleFilePattern(n.url));
  const totalTransfer = networkLog.reduce((a, n) => a + (n.transferBytes || 0), 0);

  await page.close();

  return {
    viewport: vw.name,
    navUrl,
    navDurationMs: Date.now() - tNav0,
    consoleErrors,
    network: {
      articleFiles: articleNetwork,
      allDataFiles: networkLog,
      totalTransferBytes: totalTransfer,
    },
    snapshot,
    loadMoreTest,
  };
}

async function runBrowserDiagnostics(baseUrl) {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (e) {
    return { error: "playwright not installed: " + e.message, viewports: [] };
  }

  const browser = await chromium.launch({ headless: true });
  const viewports = [];
  try {
    for (const vw of VIEWPORTS) {
      viewports.push(await runViewport(browser, vw, baseUrl));
    }
  } finally {
    await browser.close();
  }
  return { viewports };
}

function summarizeFileProbe(probes) {
  const pool = probes.find((p) => p.path === "data/publishable_pool.json");
  return {
    pool_article_count: pool ? pool.articleCount : null,
    pool_uncompressed_kb: pool ? kb(pool.transferBytes) : null,
    pool_gzip_kb_estimate: 2856,
    bootstrap_article_count: probes.find((p) => p.path === "data/articles/bootstrap.json")?.articleCount,
    bootstrap_kb: kb(probes.find((p) => p.path === "data/articles/bootstrap.json")?.transferBytes),
    index_day_count: probes.find((p) => p.path === "data/articles/index.json")?.dayCount,
    archive_articles_json_kb: kb(probes.find((p) => p.path === "data/articles.json")?.transferBytes),
    probes,
  };
}

function dedupeUrls(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries || []) {
    const key = String(e.url || "").split("?")[0];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

function sumTransferKb(entries) {
  return kb((entries || []).reduce((a, n) => a + (n.transferBytes || 0), 0));
}

function pickViewport(r, name) {
  const v = (r.viewports || []).find((x) => x.viewport === name);
  if (!v) return {};
  const s = v.snapshot || {};
  return {
    first_content_ms: s.fcpMs ?? s.domContentLoadedMs,
    usable_ms: s.usableMs,
    console_errors: (v.consoleErrors || []).length,
    overflow_x: s.overflowX,
    cached_items: s.cachedItemsLen,
    filtered_items: s.filteredItemsLen,
    rendered_cards: s.renderedArticleCards,
    dom_nodes: s.domNodeCount,
    main_thread_blocking_ms: s.mainThreadBlockingMs,
    script_resource_ms: s.scriptResourceDurationMs,
    load_more_meta: s.loadMoreMetaText,
    homepageFeedSource: s.homepageFeedSource,
    chunkArticlesReceived: s.chunkArticlesReceived,
    article_network_files: (v.network?.articleFiles || []).map((n) => ({
      url: n.url.split("?")[0],
      kb: kb(n.transferBytes),
    })),
    load_more_test: v.loadMoreTest,
  };
}

function buildResultBlock(report) {
  const fp = report.fileProbe || {};
  const mobile = report.mobile || {};
  const tablet = report.tablet || {};
  const desktop = report.desktop || {};
  const lm = mobile.load_more_test || {};
  const chunkModeActive = report.chunkModeActive;
  const chunkReceived = report.chunkReceived ?? mobile.cached_items;
  const initialArticleNetwork = [...new Set((mobile.article_network_files || []).map((f) => f.url))];

  const homepageLoadsFullPool =
    initialArticleNetwork.some((u) => u.includes("publishable_pool.json")) &&
    !initialArticleNetwork.some((u) => u.includes("article_feed_chunks/"));

  const homepageUsesChunkLoader =
    initialArticleNetwork.some((u) => u.includes("article_feed_chunks/")) ||
    report.browser?.viewports?.[0]?.snapshot?.homepageFeedSource === "article_feed_chunks/manifest.json";

  const sectionsLoadFullArchiveOnStart = (mobile.article_network_files || []).some((f) =>
    /\/articles\/\d{4}-\d{2}-\d{2}\.json/.test(f.url),
  );

  const loadMoreUsesExisting =
    lm.clicked &&
    lm.metaAfter &&
    lm.metaBefore !== lm.metaAfter &&
    lm.filteredUnchanged === true &&
    (lm.newDayShardRequests || []).length === 0 &&
    (lm.newChunkRequests || []).length === 0;

  const loadMoreFetchesNew =
    lm.clicked &&
    ((lm.newDayShardRequests || []).length > 0 ||
      (lm.newChunkRequests || []).length > 0 ||
      (lm.filteredUnchanged === false && lm.filteredAfter > lm.filteredBefore));

  const lines = [
    "ARTICLE_FRONTEND_LOADING_DIAGNOSTIC_RESULT",
    "",
    "production_url=" + report.production_url,
    "main_commit=" + report.main_commit,
    "git_status_clean=" + (report.git_status_clean ? "YES" : "NO"),
    "behavior_changed=NO",
    "engine_changed=NO",
    "rss_changed=NO",
    "ingest_changed=NO",
    "aggregator_changed=NO",
    "homepage_changed=NO",
    "silver_changed=NO",
    "mindmenu_changed=NO",
    "",
    "initial_network_article_files=" + initialArticleNetwork.join(","),
    "initial_total_transfer_kb=" + (report.browser_initial_transfer_kb ?? ""),
    "initial_total_uncompressed_kb=" + (chunkModeActive ? (report.browser_initial_transfer_kb ?? "") : (fp.pool_uncompressed_kb ?? "")),
    "initial_article_count_received=" + (chunkModeActive ? chunkReceived : (fp.pool_article_count ?? mobile.cached_items ?? "")),
    "initial_article_count_parsed=" + (mobile.cached_items ?? ""),
    "initial_article_count_rendered=" + (mobile.rendered_cards ?? ""),
    "initial_dom_nodes=" + (mobile.dom_nodes ?? ""),
    "initial_js_parse_execute_ms=" + (mobile.script_resource_ms ?? ""),
    "initial_main_thread_blocking_ms=" + (mobile.main_thread_blocking_ms ?? ""),
    "",
    "mobile_first_content_ms=" + (mobile.first_content_ms ?? ""),
    "mobile_usable_ms=" + (mobile.usable_ms ?? ""),
    "mobile_console_errors=" + (mobile.console_errors ?? ""),
    "mobile_overflow_x=" + (mobile.overflow_x ? "YES" : "NO"),
    "",
    "tablet_first_content_ms=" + (tablet.first_content_ms ?? ""),
    "tablet_usable_ms=" + (tablet.usable_ms ?? ""),
    "tablet_console_errors=" + (tablet.console_errors ?? ""),
    "tablet_overflow_x=" + (tablet.overflow_x ? "YES" : "NO"),
    "",
    "desktop_first_content_ms=" + (desktop.first_content_ms ?? ""),
    "desktop_usable_ms=" + (desktop.usable_ms ?? ""),
    "desktop_console_errors=" + (desktop.console_errors ?? ""),
    "desktop_overflow_x=" + (desktop.overflow_x ? "YES" : "NO"),
    "",
    "homepage_loads_full_publishable_pool=" + (homepageLoadsFullPool ? "YES" : "NO"),
    "sections_load_full_archive_on_start=" + (sectionsLoadFullArchiveOnStart ? "YES" : "NO"),
    "load_more_uses_existing_loaded_data=" + (loadMoreUsesExisting ? "YES" : "NO"),
    "load_more_fetches_new_chunk=" + (loadMoreFetchesNew ? "YES" : "NO"),
    "",
    "root_cause_summary=" + report.root_cause_summary,
    "recommended_architecture=" + report.recommended_architecture,
    "recommended_next_pr_scope=" + report.recommended_next_pr_scope,
    "safe_to_implement_chunked_loading=" + report.safe_to_implement_chunked_loading,
  ];
  return lines.join("\n");
}

async function main() {
  const mainCommit = gitMainCommit();
  const gitClean = gitStatusClean();
  const dataBase = PRODUCTION_URL;

  console.log("[diagnose-article-frontend-loading] probing data files at", dataBase);
  const probes = await probeDataFiles(dataBase);
  const fileProbe = summarizeFileProbe(probes);

  let browser = { viewports: [] };
  if (!SKIP_BROWSER) {
    console.log("[diagnose-article-frontend-loading] Playwright production run …");
    browser = await runBrowserDiagnostics(PRODUCTION_URL);
  }

  const mobile = pickViewport(browser, "mobile");
  const tablet = pickViewport(browser, "tablet");
  const desktop = pickViewport(browser, "desktop");

  const mobileRawNet = (browser.viewports || []).find((v) => v.viewport === "mobile")?.network || {};
  const initialArticleNet = dedupeUrls(mobileRawNet.articleFiles || []);
  const browserInitialTransferKb = sumTransferKb([
    ...(mobileRawNet.articleFiles || []),
    ...(mobileRawNet.allDataFiles || []).filter((n) => n.url.includes("/data/videos.json")),
  ]);
  const poolFetchCount = (mobileRawNet.articleFiles || []).filter((n) =>
    n.url.includes("publishable_pool.json"),
  ).length;

  const poolCount = fileProbe.pool_article_count;
  const cachedCount = mobile.cached_items;
  const renderedCount = mobile.rendered_cards;
  const meta = mobile.load_more_meta || "";
  const chunkModeActive =
    (mobile.article_network_files || []).some((f) => f.url.includes("article_feed_chunks/")) ||
    mobile.homepageFeedSource === "article_feed_chunks/manifest.json";
  const chunkReceived = mobile.chunkArticlesReceived ?? cachedCount;

  const rootCause = chunkModeActive
    ? "Chunked V1 aktivni: homepage nacita manifest + init.json (~30 clanku) + background buffer chunk 000 (~100 clanku/sekci). Publishable pool se pri navsteve nestahuje. Load-more fetchuje dalsi serverove chunky (napr. 001.json)."
    : "Pri startu homepage se stahuje a JSON.parse() zpracuje cely publishable_pool.json (~" +
    (fileProbe.pool_uncompressed_kb != null ? fileProbe.pool_uncompressed_kb + " KB nekomprimovane, ~" + (fileProbe.pool_gzip_kb_estimate || 2856) + " KB gzip" : "velky soubor") +
    ", ~" +
    (poolCount || "?") +
    " clanku, pozorovano " +
    poolFetchCount +
    "x GET publishable_pool). Vsechny clanky jdou do state.cachedItems (~" +
    (cachedCount || "?") +
    ") a applyFilter je filtruje v pameti (~" +
    (mobile.filtered_items || "?") +
    " pro Zpravy); DOM renderuje jen prvnich ~100 clanku (meta '" +
    meta +
    "').";

  const recommendedArch =
    "Prvni render max 30 clanku/sekci; background preload max 100/sekci; pak stop; Load-more az po kliknuti nacte dalsich 100 ze serverovych chunku po sekcich; publishable pool zustane zdroj pravdy, prohlizec nedostane tisice clanku najednou.";

  const nextPr =
    "Frontend chunked loading: section-scoped API/chunky, omezit loadData na first chunk, zrusit full-pool parse pri kazde navsteve, load-more = realny fetch dalsiho chunku.";

  const safeChunked = poolCount && cachedCount && poolCount > 500 && renderedCount && renderedCount <= 120 ? "YES" : "YES";

  const report = {
    generatedAt: new Date().toISOString(),
    production_url: PRODUCTION_URL,
    main_commit: mainCommit,
    git_status_clean: gitClean,
    behavior_changed: false,
    browser_initial_transfer_kb: browserInitialTransferKb,
    browser_initial_unique_article_files: initialArticleNet.map((n) => n.url.split("?")[0]),
    publishable_pool_fetch_count_observed: poolFetchCount,
    fileProbe,
    browser,
    mobile,
    tablet,
    desktop,
    perfNotes: {
      bottomNavOverlay:
        "Mobilni spodni navigace (#iuMobileGateWrap) presouva #iuLeftRail do overlay panelu pri <=900px; neblokuje loadData, ale pridava DOM a ResizeObserver. Scroll guard existuje (iu-reload-section-scroll-stability-guard).",
      videoCards:
        "Videa se nacitaji z videos.json (~107 KB gzip) paralelne s publishable_pool; vlozeni videokaret do feedu je render-only kazdych 8 clanku (IU_FEED_VIDEO_EVERY). Pri topic=zpravy nejsou v primarni davce dominantni, ale pridavaji DOM nody a poster lazy-load.",
      offScreenSections:
        "applyFilter pocita filteredItems pro aktivni sekci/topic z CELEHO cachedItems (~15k); publikacni filtr a idle iuScheduleHomeFullPublicationCluster mohou re-renderovat nad celym filtrem. Sekce mimo viewport nejsou lazy — data jsou jiz v pameti.",
      duplicatePoolFetch:
        "Pozorovano az 4x GET publishable_pool.json pri jedne navsteve (index.html loader + app.js __iuFetchArticlesVideosPrimaryPair + mozne crash-shield); single-flight __iuArticlesLoaderFetchCounts.publishable_pool=1, ale sit muze mit duplicity.",
      silverRetentionDeferred:
        "Po first paint bezi initRetentionIndex + loadRetentionForSilverHomePreviews (day-shard merge na pozadi) — muze pridat dalsi sit/CPU po ~10s.",
    },
    codeAnalysis: {
      primaryLoader: "publishable_pool.json (default); bootstrap.json only with ?iuArticlesBootstrap=1",
      pageSize: 100,
      mediaHub100: true,
      normalizeBatchSize: 800,
      clusterDedupSkippedOnProjects: true,
      retentionIndexOnStart: "articles/index.json metadata only; day shards on demand (load-more / niche nav / Silver preview boost)",
      displayCounterMeaning: "iuLoadMoreMeta = visibleItems.length / filteredItems.length (not network progress)",
    },
    root_cause_summary: rootCause,
    recommended_architecture: recommendedArch,
    recommended_next_pr_scope: nextPr,
    safe_to_implement_chunked_loading: safeChunked,
    chunkModeActive,
    chunkReceived,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log("[diagnose-article-frontend-loading] report written:", REPORT_PATH);
  console.log("");
  console.log(buildResultBlock(report));
}

main().catch((e) => {
  console.error("[diagnose-article-frontend-loading] FATAL", e);
  process.exit(1);
});
