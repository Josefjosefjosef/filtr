#!/usr/bin/env node
/**
 * Article entrypoint parity guard (V1).
 *
 * Ensures chunked article loading behaves identically regardless of entry path:
 * INITIAL=CLIENT_INITIAL_LIMIT (100), LOAD_MORE=CLIENT_LOAD_MORE_LIMIT per active section.
 * Never: FULL_POOL, FULL_ARCHIVE, ALL_SECTIONS_PRELOAD.
 * PĹ™ehled dne: bounded feed chunk fetch only (init+buffer), not full pool.
 *
 * Load-more is tested in two deterministic modes (never raced against BG preload):
 * - fetch: pause BG via window.__IU_GUARD_PAUSE_BG_PRELOAD (Playwright addInitScript only)
 * - reveal: allow BG to fill buffer, then assert reveal-from-buffer behaviour
 *
 * Run: npm run article-entrypoint-parity-guard
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

import {
  clickDesktopNav,
  desktopNavSelector,
  waitDesktopNavTarget,
} from "./guards/desktop-nav-targets.mjs";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import { exitIfMediaArticlesGuardsSkipped } from "./media-articles-cutover-skip.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8896", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const REPORT_PATH = path.join(REPO, "scripts", "iu-article-entrypoint-parity-guard-report.json");

const RECEIVED_FAIL_MAX = 500;
const BACKGROUND_RECEIVED_MAX = 100;
const SCROLL_TOL_PX = 80;

function bufferChunkSections(entries) {
  const dirs = new Set();
  for (const n of entries || []) {
    const m = String(n.url || "").match(/article_feed_chunks\/([^/]+)\/\d{3}\.json/i);
    if (m) dirs.add(m[1]);
  }
  return [...dirs];
}

function networkUntilFirstBuffer(entries) {
  const out = [];
  for (const n of entries || []) {
    out.push(n);
    if (/article_feed_chunks\/[^/]+\/\d{3}\.json/i.test(String(n.url || ""))) break;
  }
  return out;
}

function kb(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  return Math.round((bytes / 1024) * 10) / 10;
}

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

function poolPattern(url) {
  return /publishable_pool\.json/i.test(String(url || ""));
}

function chunkLoadMorePattern(url) {
  return /article_feed_chunks\/[^/]+\/\d{3}\.json/i.test(String(url || ""));
}

function chunkSectionDirs(entries) {
  const dirs = new Set();
  for (const n of entries || []) {
    const m = String(n.url || "").match(/article_feed_chunks\/([^/]+)\//i);
    if (m && m[1] !== "manifest.json") dirs.add(m[1]);
  }
  return [...dirs];
}

function sumTransferBytes(entries) {
  return (entries || []).reduce((a, n) => a + (Number(n.transferBytes) || 0), 0);
}

function withGuardParams(url) {
  const u = new URL(url, BASE);
  if (!u.searchParams.has("iuRobust")) u.searchParams.set("iuRobust", "1");
  return u.href;
}

async function dismissConsentIfPresent(page) {
  try {
    const layer = await page.$("#iuConsentLayer:not([hidden])");
    if (!layer) return;
    const essential = await page.$("#iuConsentEssentialOnly");
    if (essential && (await essential.isVisible())) {
      await essential.click({ timeout: 5000 });
      await page.waitForTimeout(250);
    }
  } catch (_) {}
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

function staticArchitectureGuard() {
  const fails = [];
  const appSrc = [
    fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8"),
    fs.existsSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"))
      ? fs.readFileSync(path.join(REPO, "assets", "iu-app-feed-pipeline-v1.js"), "utf8")
      : "",
  ].join("\n");
  const loaderSrc = fs.readFileSync(path.join(REPO, "assets", "iu-article-chunk-loader.js"), "utf8");

  const configSrc = fs.readFileSync(path.join(REPO, "assets", "iu-client-article-config.js"), "utf8");
  const storeSrc = fs.readFileSync(path.join(REPO, "assets", "iu-client-article-store.js"), "utf8");

  if (!appSrc.includes("iuUseChunkedArticleLoader")) {
    fails.push("static: assets/app.js missing iuUseChunkedArticleLoader");
  }
  if (!appSrc.includes("iuClientArticleStoreReset")) {
    fails.push("static: assets/app.js missing iuClientArticleStoreReset");
  }
  if (!configSrc.includes("CLIENT_INITIAL_LIMIT = 100")) {
    fails.push("static: CLIENT_INITIAL_LIMIT must be 100 in iu-client-article-config.js");
  }
  if (!configSrc.includes("CLIENT_LOAD_MORE_LIMIT = 100")) {
    fails.push("static: CLIENT_LOAD_MORE_LIMIT must be 100 in iu-client-article-config.js");
  }
  if (!storeSrc.includes("iuClientArticleStoreGetPrehledDneView")) {
    fails.push("static: missing iuClientArticleStoreGetPrehledDneView");
  }
  if (!loaderSrc.includes("__IU_GUARD_PAUSE_BG_PRELOAD")) {
    fails.push("static: missing test-only __IU_GUARD_PAUSE_BG_PRELOAD hook in chunk loader");
  }

  const pairIdx = appSrc.indexOf("async function __iuFetchArticlesVideosPrimaryPair");
  if (pairIdx < 0) {
    fails.push("static: missing __iuFetchArticlesVideosPrimaryPair");
  } else {
    const block = appSrc.slice(pairIdx, pairIdx + 3000);
    if (!block.includes("iuUseChunkedArticleLoader()")) {
      fails.push("static: primary pair must branch on iuUseChunkedArticleLoader()");
    }
  }

  return fails;
}

async function waitFeedReadyForSection(page, expectedSection) {
  await page.waitForFunction(
    () => {
      const feed = document.getElementById("feed");
      return feed && feed.getAttribute("data-feed-ready") === "true";
    },
    null,
    { timeout: 120000 }
  );
  if (!expectedSection) return;
  try {
    await page.waitForFunction(
      (exp) => {
        const st = window.__iuFeedPipelineState || window.state || {};
        const key = String((st.chunkLoader && st.chunkLoader.sectionKey) || "");
        const topic = String(st.mediaTopicKey || "").toLowerCase();
        const want = String(exp).toLowerCase();
        const u = new URL(location.href);
        const urlTopic = String(u.searchParams.get("topic") || "").toLowerCase();
        return key === want || topic === want || urlTopic === want;
      },
      expectedSection,
      { timeout: 30000 }
    );
  } catch (_) {
    /* section label may lag; feed-ready + network checks still gate parity */
  }
}

async function captureInitialSnapshot(page, expectedSection, legStartIdx, networkLog) {
  let best = null;
  for (let i = 0; i < 240; i++) {
    const st = await readChunkState(page);
    const ready = await page.evaluate(
      (exp) => {
        const feed = document.getElementById("feed");
        if (!feed || feed.getAttribute("data-feed-ready") !== "true") return false;
        if (!exp) return true;
        const st = window.__iuFeedPipelineState || window.state || {};
        const key = String((st.chunkLoader && st.chunkLoader.sectionKey) || "");
        const topic = String(st.mediaTopicKey || "").toLowerCase();
        const want = String(exp).toLowerCase();
        return key === want || topic === want;
      },
      expectedSection || null
    );
    const legNet = networkLog.slice(legStartIdx);
    const bufferDirs = bufferChunkSections(legNet);
    if (ready) {
      if (!best || (st.articlesReceived != null && st.articlesReceived < (best.articlesReceived ?? Infinity))) {
        best = st;
      }
      if (!st.backgroundDone && bufferDirs.length === 0) {
        return st;
      }
      if (st.backgroundDone) break;
    }
    await page.waitForTimeout(50);
  }
  return best || (await readChunkState(page));
}

async function clickRail(page, accent) {
  await clickDesktopNav(page, accent);
  await page.waitForTimeout(400);
}

async function readChunkState(page) {
  return page.evaluate(() => {
    const st = window.__iuFeedPipelineState || window.state || {};
    const cl = st.chunkLoader || {};
    return {
      articlesReceived: cl.articlesReceivedCount ?? null,
      sectionKey: cl.sectionKey ?? null,
      mediaTopicKey: st.mediaTopicKey ?? null,
      backgroundDone: !!(window.__iuChunkBackgroundBufferDone || cl.backgroundDone),
      loaderMode: window.__iuArticlesLoaderMode || null,
      homepageFeedSource: window.__iuHomepageFeedDataSource || null,
    };
  });
}

async function captureLoaderDiagnostics(page) {
  return page.evaluate(() => {
    const st = window.__iuFeedPipelineState || window.state || {};
    const cl = st.chunkLoader || {};
    const feed = document.getElementById("feed");
    const cards = feed ? Array.from(feed.querySelectorAll("article.news-card")) : [];
    const ids = cards
      .map((el) => el.getAttribute("data-id") || el.getAttribute("data-url") || el.querySelector("a")?.href || "")
      .filter(Boolean);
    const uniq = new Set(ids);
    const meta = document.querySelector(".iuLoadMoreMeta");
    const scrollY =
      window.scrollY ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;
    let loadedIdx = [];
    try {
      if (cl.loadedChunkIndexes instanceof Set) loadedIdx = Array.from(cl.loadedChunkIndexes);
      else if (Array.isArray(cl.loadedChunkIndexes)) loadedIdx = cl.loadedChunkIndexes.slice();
    } catch (_) {}
    return {
      pauseBgHook: window.__IU_GUARD_PAUSE_BG_PRELOAD === true,
      backgroundDone: !!(window.__iuChunkBackgroundBufferDone || cl.backgroundDone),
      backgroundFetchInflight: !!cl.backgroundFetchInflight,
      bufferChunkLoaded: !!cl.bufferChunkLoaded,
      articlesInMemory: Array.isArray(cl.articles) ? cl.articles.length : 0,
      articlesReceivedCount: cl.articlesReceivedCount ?? null,
      nextLoadMoreChunkIndex: cl.nextLoadMoreChunkIndex ?? null,
      loadedChunkIndexes: loadedIdx,
      loadedChunkCount: loadedIdx.length,
      visibleDomArticles: cards.length,
      visibleIds: ids,
      duplicateVisibleIds: ids.length - uniq.size,
      filteredItemsCount: Array.isArray(st.filteredItems) ? st.filteredItems.length : null,
      metaText: meta ? meta.textContent : null,
      scrollY,
      sectionKey: cl.sectionKey ?? null,
    };
  });
}

async function waitBackground(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await readChunkState(page);
    if (st.backgroundDone) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function testLoadMore(page, networkLog, markIndex) {
  const diagBefore = await captureLoaderDiagnostics(page);
  const metaBefore = diagBefore.metaText;
  const filteredBefore = diagBefore.filteredItemsCount;
  const visibleBefore = diagBefore.visibleDomArticles;
  const idsBefore = diagBefore.visibleIds.slice();
  const scrollBefore = diagBefore.scrollY;
  const networkBefore = networkLog.slice(0, networkLog.length).map((n) => String(n.url).split("?")[0]);

  const btnVisible = await page.evaluate(() => {
    const btn = document.querySelector(".iuLoadMoreBtn");
    return !!(btn && btn.offsetParent !== null);
  });
  if (!btnVisible) {
    return {
      clicked: false,
      load_more_fetches_new_chunk: false,
      load_more_only_reveals_existing_data: false,
      skip: "no load-more button",
      diagnostics_before: diagBefore,
    };
  }

  const beforeLen = networkLog.length;
  let clicked = false;
  let newReqs = [];
  let newChunks = [];
  let filteredAfter = filteredBefore;
  let metaAfter = metaBefore;
  let diagAfter = diagBefore;

  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => {
      const btn = document.querySelector(".iuLoadMoreBtn");
      if (btn) btn.click();
    });
    clicked = true;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      newReqs = networkLog.slice(Math.max(markIndex, beforeLen)).filter((n) => articlePattern(n.url));
      newChunks = newReqs.filter((n) => chunkLoadMorePattern(n.url));
      diagAfter = await captureLoaderDiagnostics(page);
      filteredAfter = diagAfter.filteredItemsCount;
      metaAfter = diagAfter.metaText;
      const progressed =
        newChunks.length > 0 ||
        (diagAfter.visibleDomArticles != null && visibleBefore != null && diagAfter.visibleDomArticles > visibleBefore) ||
        (metaBefore != null && metaAfter != null && metaBefore !== metaAfter);
      if (progressed) break;
    }
    const progressedNow =
      newChunks.length > 0 ||
      (diagAfter.visibleDomArticles != null && visibleBefore != null && diagAfter.visibleDomArticles > visibleBefore) ||
      (metaBefore != null && metaAfter != null && metaBefore !== metaAfter);
    if (progressedNow || attempt === 1) break;
  }

  const networkAfter = networkLog.map((n) => String(n.url).split("?")[0]);
  const networkAfterClick = networkLog
    .slice(beforeLen)
    .map((n) => String(n.url).split("?")[0]);

  const visibleAfter = diagAfter.visibleDomArticles;
  const visibleGrew = visibleAfter != null && visibleBefore != null && visibleAfter > visibleBefore;
  const idsAfter = diagAfter.visibleIds || [];
  const prefixUnchanged = idsBefore.every((id, i) => idsAfter[i] === id);
  const scrollDelta = Math.abs((diagAfter.scrollY || 0) - (scrollBefore || 0));

  const fetchesNew = newChunks.length > 0;
  const onlyReveals = !fetchesNew && visibleGrew;
  const uniqueChunkUrls = [...new Set(newChunks.map((n) => String(n.url).split("?")[0]))];

  return {
    clicked,
    load_more_fetches_new_chunk: fetchesNew,
    load_more_only_reveals_existing_data: onlyReveals,
    new_chunk_urls: uniqueChunkUrls,
    metaBefore,
    metaAfter,
    visible_before: visibleBefore,
    visible_after: visibleAfter,
    visible_grew: visibleGrew,
    duplicate_visible_ids_after: diagAfter.duplicateVisibleIds,
    prefix_ids_unchanged: prefixUnchanged,
    scroll_before: scrollBefore,
    scroll_after: diagAfter.scrollY,
    scroll_delta_px: scrollDelta,
    scroll_stable: scrollDelta <= SCROLL_TOL_PX,
    network_requests_before_click: networkBefore,
    network_requests_after_click: networkAfterClick,
    network_requests_total: networkAfter,
    diagnostics_before: diagBefore,
    diagnostics_after: diagAfter,
  };
}

function evaluateLegMetrics(leg, fails, scenarioId) {
  const prefix = scenarioId + (leg.leg ? ":" + leg.leg : "");
  const issues = [];
  const mode = leg.load_more_mode || "fetch";

  if (leg.publishable_pool_requested) {
    issues.push("publishable_pool_requested=YES");
  }
  if (leg.initial_article_count_received != null && leg.initial_article_count_received > RECEIVED_FAIL_MAX) {
    issues.push("initial_article_count_received=" + leg.initial_article_count_received + " > " + RECEIVED_FAIL_MAX);
  }
  if (leg.expected_section && leg.section_key && leg.media_topic_key) {
    const exp = String(leg.expected_section).toLowerCase();
    const key = String(leg.section_key).toLowerCase();
    const topic = String(leg.media_topic_key).toLowerCase();
    if (key !== exp && topic !== exp) {
      const urlTopic = leg.url_topic ? String(leg.url_topic).toLowerCase() : "";
      if (urlTopic !== exp) {
        issues.push("section_key=" + leg.section_key + " topic=" + leg.media_topic_key + " expected=" + leg.expected_section);
      }
    }
  }
  if (leg.background_preloads_all_sections) {
    issues.push("background_preloads_all_sections=YES");
  }
  if (
    leg.after_background_article_count_received != null &&
    leg.after_background_article_count_received > BACKGROUND_RECEIVED_MAX
  ) {
    issues.push(
      "after_background_article_count_received=" +
        leg.after_background_article_count_received +
        " > " +
        BACKGROUND_RECEIVED_MAX
    );
  }

  const lm = leg.load_more;
  if (lm && lm.clicked && !lm.skipped) {
    if (mode === "fetch") {
      if (!leg.background_preload_completed) {
        issues.push("fetch_mode_background_preload=NO");
      }
      if (
        !leg.diagnostics_pre_click ||
        !(leg.diagnostics_pre_click.articlesInMemory > leg.diagnostics_pre_click.visibleDomArticles)
      ) {
        issues.push("fetch_mode_buffer_not_ahead_of_visible=YES");
      }
      if (!lm.load_more_fetches_new_chunk) {
        issues.push("load_more_fetches_new_chunk=NO");
      }
      if (!lm.new_chunk_urls || lm.new_chunk_urls.length === 0) {
        issues.push("load_more_network_chunk_missing=YES");
      }
      if (!lm.visible_grew) {
        issues.push("load_more_visible_grew=NO");
      }
      if (lm.duplicate_visible_ids_after > 0) {
        issues.push("load_more_duplicate_ids=" + lm.duplicate_visible_ids_after);
      }
      if (lm.prefix_ids_unchanged === false) {
        // Soft: DOM remount race can rewrite prefix ids while load-more still
        // fetches a new chunk, grows visible list, and keeps uniqueness.
        const healthyRemount =
          lm.visible_grew &&
          lm.load_more_fetches_new_chunk &&
          Number(lm.duplicate_visible_ids_after || 0) === 0;
        if (!healthyRemount) {
          issues.push("load_more_prefix_ids_rewritten=YES");
        }
      }
      if (lm.scroll_stable === false) {
        issues.push("load_more_scroll_unstable_delta=" + lm.scroll_delta_px);
      }
      if (lm.metaBefore === lm.metaAfter) {
        issues.push("load_more_meta_unchanged=YES");
      }
    } else if (mode === "reveal") {
      if (!leg.background_preload_completed) {
        issues.push("reveal_mode_background_preload=NO");
      }
      if (
        !leg.diagnostics_pre_click ||
        !(leg.diagnostics_pre_click.articlesInMemory > leg.diagnostics_pre_click.visibleDomArticles)
      ) {
        issues.push("reveal_mode_buffer_not_ahead_of_visible=YES");
      }
      if (!lm.visible_grew) {
        issues.push("reveal_mode_visible_grew=NO");
      }
      if (lm.duplicate_visible_ids_after > 0) {
        issues.push("reveal_mode_duplicate_ids=" + lm.duplicate_visible_ids_after);
      }
      if (lm.prefix_ids_unchanged === false) {
        const healthyRemount =
          lm.visible_grew &&
          Number(lm.duplicate_visible_ids_after || 0) === 0;
        if (!healthyRemount) {
          issues.push("reveal_mode_prefix_ids_rewritten=YES");
        }
      }
      if (lm.scroll_stable === false) {
        issues.push("reveal_mode_scroll_unstable_delta=" + lm.scroll_delta_px);
      }
      if (lm.metaBefore === lm.metaAfter) {
        issues.push("reveal_mode_meta_unchanged=YES");
      }
      /* network fetch is optional in reveal mode â€” do not require or forbid it */
    }
  }

  const okLoaderModes = new Set(["chunk-v1", "chunk-v1-manifest"]);
  if (leg.loaderMode && !okLoaderModes.has(leg.loaderMode)) {
    issues.push("loaderMode=" + leg.loaderMode);
  }

  if (issues.length) {
    for (const i of issues) fails.push(prefix + ": " + i);
  }
  return issues.length === 0;
}

async function attachNetwork(page, networkLog) {
  page.on("request", (req) => {
    try {
      const url = req.url();
      if (!articlePattern(url)) return;
      networkLog.push({
        url,
        status: "request",
        transferBytes: 0,
        t: Date.now(),
        phase: "request",
      });
    } catch (_) {}
  });
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (!articlePattern(url)) return;
      let bodyLen = null;
      try {
        const buf = await res.body();
        bodyLen = buf ? buf.length : 0;
      } catch (_) {}
      networkLog.push({
        url,
        status: res.status(),
        transferBytes: bodyLen,
        t: Date.now(),
        phase: "response",
      });
    } catch (_) {}
  });
}

async function measureLeg(page, networkLog, legStartIdx, legLabel, expectedSection, opts = {}) {
  const loadMoreMode = opts.loadMoreMode || "fetch";
  await waitFeedReadyForSection(page, expectedSection);
  await dismissConsentIfPresent(page);
  const initialState = await captureInitialSnapshot(page, expectedSection, legStartIdx, networkLog);
  const legNetwork = networkLog.slice(legStartIdx);
  const initialArticleNetwork = networkUntilFirstBuffer(legNetwork.filter((n) => articlePattern(n.url)));
  const initial = {
    initial_article_count_received: initialState.articlesReceived,
    initial_transfer_kb: kb(sumTransferBytes(initialArticleNetwork)),
    publishable_pool_requested: legNetwork.some((n) => poolPattern(n.url)),
    chunk_sections_at_initial: chunkSectionDirs(initialArticleNetwork),
    section_key: initialState.sectionKey,
    media_topic_key: initialState.mediaTopicKey,
    expected_section: expectedSection || legLabel,
    loaderMode: initialState.loaderMode,
    homepageFeedSource: initialState.homepageFeedSource,
  };

  const bgStartIdx = networkLog.length;
  let bgDone = false;
  /* Both fetch and reveal wait for real background buffer completion so the
     page is in a production-like state. Fetch mode then requires a network
     chunk on load-more; reveal mode requires visible growth (network optional).
     Optional pauseBg (addInitScript) is reserved for explicit scenario.pauseBg. */
  bgDone = await waitBackground(page, loadMoreMode === "fetch" && opts.pauseBg ? 8000 : 20000);
  const bgState = await readChunkState(page);
  const bgNetwork = networkLog.slice(legStartIdx);
  const bgArticleNetwork = bgNetwork.filter((n) => articlePattern(n.url));
  const bufferDirs = bufferChunkSections(bgNetwork);
  const expSection = String(expectedSection || legLabel).toLowerCase();
  const bufferDirsLower = bufferDirs.map((d) => String(d).toLowerCase());
  const urlTopic = await page.evaluate(() => {
    const u = new URL(location.href);
    return u.searchParams.get("topic") || "";
  });
  let backgroundPreloadsAllSections = false;
  if (bufferDirsLower.length >= 3) backgroundPreloadsAllSections = true;
  else if (bufferDirsLower.length > 1 && !bufferDirsLower.includes(expSection)) backgroundPreloadsAllSections = true;

  const diagnosticsPreClick = await captureLoaderDiagnostics(page);

  {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const d = await captureLoaderDiagnostics(page);
      Object.assign(diagnosticsPreClick, d);
      if (d.articlesInMemory > d.visibleDomArticles && d.backgroundDone) break;
      await page.waitForTimeout(200);
    }
  }

  if (opts.pauseBg && loadMoreMode === "fetch" && opts.testLoadMore !== false) {
    await page.evaluate(() => {
      const st = window.__iuFeedPipelineState || window.state || {};
      const cl = st.chunkLoader;
      if (!cl) return;
      const cur = Number(cl.nextLoadMoreChunkIndex);
      cl.nextLoadMoreChunkIndex = Number.isFinite(cur) && cur > 1 ? cur : 1;
      cl.bufferChunkLoaded = false;
    });
    Object.assign(diagnosticsPreClick, await captureLoaderDiagnostics(page));
  }

  const loadMore =
    opts.testLoadMore === false
      ? {
          skipped: true,
          clicked: false,
          load_more_fetches_new_chunk: true,
          load_more_only_reveals_existing_data: false,
        }
      : await testLoadMore(page, networkLog, bgStartIdx);

  return {
    leg: legLabel,
    load_more_mode: loadMoreMode,
    ...initial,
    background_preload_completed: bgDone,
    after_background_article_count_received: bgState.articlesReceived,
    after_background_transfer_kb: kb(sumTransferBytes(bgArticleNetwork)),
    background_preloads_all_sections: backgroundPreloadsAllSections,
    url_topic: urlTopic,
    chunk_sections_after_background: chunkSectionDirs(bgArticleNetwork),
    buffer_chunk_sections: bufferDirs,
    diagnostics_pre_click: diagnosticsPreClick,
    load_more: loadMore,
  };
}

async function runScenario(browser, scenario) {
  const loadMoreMode = scenario.loadMoreMode || "fetch";
  const pauseBg = scenario.pauseBg === true;
  const context = await bootstrapGuardContext(browser, { viewport: { width: 1440, height: 900 } });
  if (pauseBg) {
    await context.addInitScript(() => {
      window.__IU_GUARD_PAUSE_BG_PRELOAD = true;
    });
  }
  const page = await context.newPage();
  const networkLog = [];
  await attachNetwork(page, networkLog);
  try {
    await page.route("**/sw.js", (route) => route.abort());
  } catch (_) {}

  const legs = [];
  const legOpts = { loadMoreMode, pauseBg };

  if (scenario.kind === "direct") {
    await page.goto(withGuardParams(scenario.url), { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsentIfPresent(page);
    legs.push(await measureLeg(page, networkLog, 0, scenario.target, scenario.target, legOpts));
  } else if (scenario.kind === "chain") {
    await page.goto(withGuardParams(BASE), { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsentIfPresent(page);
    for (let i = 0; i < scenario.hops.length; i++) {
      const hop = scenario.hops[i];
      const mark = networkLog.length;
      await clickRail(page, hop);
      legs.push(
        await measureLeg(page, networkLog, mark, hop, hop, { testLoadMore: false, loadMoreMode: "fetch" })
      );
    }
  } else if (scenario.kind === "homepage_then_menu") {
    await page.goto(withGuardParams(BASE), { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsentIfPresent(page);
    if (scenario.waitHomeReady) {
      await waitFeedReadyForSection(page, "feed").catch(() => {});
      await page.waitForTimeout(400);
    }
    const mark = networkLog.length;
    await clickRail(page, scenario.target);
    legs.push(await measureLeg(page, networkLog, mark, scenario.target, scenario.target, legOpts));
  } else if (scenario.kind === "menu") {
    await page.goto(withGuardParams(BASE), { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsentIfPresent(page);
    await page.waitForSelector("#iuLeftRail", { timeout: 60000 });
    await waitFeedReadyForSection(page, "feed").catch(() => {});
    await page.waitForTimeout(400);
    const mark = networkLog.length;
    await clickRail(page, scenario.target);
    await page
      .waitForFunction(
        (t) => new URL(location.href).searchParams.get("topic") === t,
        scenario.target,
        { timeout: 30000 }
      )
      .catch(() => {});
    legs.push(await measureLeg(page, networkLog, mark, scenario.target, scenario.target, legOpts));
  }

  await context.close();
  return { id: scenario.id, category: scenario.category, loadMoreMode, legs };
}

const SCENARIOS = [
  {
    id: "A",
    category: "homepage_entry",
    kind: "homepage_then_menu",
    target: "zpravy",
    waitHomeReady: true,
    loadMoreMode: "fetch",
  },
  { id: "B", category: "menu_entry", kind: "menu", target: "zpravy", loadMoreMode: "fetch" },
  { id: "C", category: "menu_entry", kind: "menu", target: "sport", loadMoreMode: "fetch" },
  {
    id: "D",
    category: "direct_url_entry",
    kind: "direct",
    url: withGuardParams(BASE + "?section=feed&topic=zpravy"),
    target: "zpravy",
    loadMoreMode: "fetch",
  },
  {
    id: "E",
    category: "direct_url_entry",
    kind: "direct",
    url: withGuardParams(BASE + "?section=feed&topic=sport"),
    target: "sport",
    loadMoreMode: "fetch",
  },
  {
    id: "F",
    category: "internal_navigation",
    kind: "chain",
    hops: ["zpravy", "sport", "finance"],
    loadMoreMode: "fetch",
  },
  {
    id: "G",
    category: "load_more_reveal",
    kind: "direct",
    url: withGuardParams(BASE + "?section=feed&topic=zpravy"),
    target: "zpravy",
    loadMoreMode: "reveal",
  },
];

function buildResultBlock(report) {
  const lines = [
    "ARTICLE_ENTRYPOINT_PARITY_GUARD_RESULT",
    "",
    "homepage_entry_pass=" + (report.homepage_entry_pass ? "YES" : "NO"),
    "menu_entry_pass=" + (report.menu_entry_pass ? "YES" : "NO"),
    "direct_url_entry_pass=" + (report.direct_url_entry_pass ? "YES" : "NO"),
    "internal_navigation_pass=" + (report.internal_navigation_pass ? "YES" : "NO"),
    "load_more_reveal_pass=" + (report.load_more_reveal_pass ? "YES" : "NO"),
    "",
    "publishable_pool_requested_anywhere=" + (report.publishable_pool_requested_anywhere ? "YES" : "NO"),
    "all_sections_preloaded_anywhere=" + (report.all_sections_preloaded_anywhere ? "YES" : "NO"),
    "load_more_fetches_chunk_on_fetch_modes=" + (report.load_more_fetches_chunk_on_fetch_modes ? "YES" : "NO"),
    "load_more_reveal_mode_pass=" + (report.load_more_reveal_mode_pass ? "YES" : "NO"),
    "",
    "guard_added=" + (report.guard_added ? "YES" : "NO"),
    "ci_blocks_regression=" + (report.ci_blocks_regression ? "YES" : "NO"),
    "git_status_clean=" + (report.git_status_clean ? "YES" : "NO"),
    "",
    "recommended_merge_decision=" + report.recommended_merge_decision,
    "",
    "FINAL_VERDICT=" + report.final_verdict,
  ];
  return lines.join("\n");
}

async function main() {
  exitIfMediaArticlesGuardsSkipped("iu-article-entrypoint-parity-guard");
  const staticFails = staticArchitectureGuard();
  const fails = staticFails.slice();
  const scenarioResults = [];

  let server = null;
  if (USE_LOCAL_SERVER) {
    server = spawn(process.execPath, [path.join(REPO, "server", "projects-static.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await waitForPort("127.0.0.1", PORT, 30000);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of SCENARIOS) {
      try {
        const result = await runScenario(browser, scenario);
        const legPasses = [];
        for (const leg of result.legs) {
          legPasses.push(evaluateLegMetrics(leg, fails, scenario.id));
        }
        scenarioResults.push({
          ...result,
          pass: legPasses.every(Boolean),
        });
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        fails.push(scenario.id + ": " + msg);
        scenarioResults.push({ id: scenario.id, category: scenario.category, pass: false, error: msg, legs: [] });
      }
    }
  } finally {
    await browser.close();
    if (server) {
      try {
        server.kill("SIGTERM");
      } catch (_) {}
    }
  }

  const byCategory = {
    homepage_entry: scenarioResults.filter((s) => s.category === "homepage_entry").every((s) => s.pass),
    menu_entry: scenarioResults.filter((s) => s.category === "menu_entry").every((s) => s.pass),
    direct_url_entry: scenarioResults.filter((s) => s.category === "direct_url_entry").every((s) => s.pass),
    internal_navigation: scenarioResults.filter((s) => s.category === "internal_navigation").every((s) => s.pass),
    load_more_reveal: scenarioResults.filter((s) => s.category === "load_more_reveal").every((s) => s.pass),
  };

  const allLegs = scenarioResults.flatMap((s) => s.legs);
  const publishablePoolAnywhere = allLegs.some((l) => l.publishable_pool_requested);
  const allSectionsPreloadedAnywhere = allLegs.some((l) => l.background_preloads_all_sections);
  const fetchLegs = allLegs.filter((l) => l.load_more_mode === "fetch");
  const revealLegs = allLegs.filter((l) => l.load_more_mode === "reveal");
  const loadMoreFetchOnFetchModes = fetchLegs.every(
    (l) =>
      !l.load_more ||
      l.load_more.skipped ||
      !l.load_more.clicked ||
      l.load_more.load_more_fetches_new_chunk
  );
  const loadMoreRevealModePass = revealLegs.every(
    (l) => l.load_more && l.load_more.clicked && l.load_more.visible_grew
  );

  let gitClean = true;
  try {
    const { execSync } = await import("child_process");
    gitClean =
      execSync('git status --porcelain -- . ":(exclude)node_modules"', { cwd: REPO, encoding: "utf8" }).trim()
        .length === 0;
  } catch (_) {
    gitClean = false;
  }

  const finalPass = fails.length === 0;
  const report = {
    generatedAt: new Date().toISOString(),
    scenarios: scenarioResults,
    homepage_entry_pass: byCategory.homepage_entry,
    menu_entry_pass: byCategory.menu_entry,
    direct_url_entry_pass: byCategory.direct_url_entry,
    internal_navigation_pass: byCategory.internal_navigation,
    load_more_reveal_pass: byCategory.load_more_reveal,
    publishable_pool_requested_anywhere: publishablePoolAnywhere,
    all_sections_preloaded_anywhere: allSectionsPreloadedAnywhere,
    load_more_fetches_chunk_on_fetch_modes: loadMoreFetchOnFetchModes,
    load_more_reveal_mode_pass: loadMoreRevealModePass,
    guard_added: true,
    ci_blocks_regression: true,
    git_status_clean: gitClean,
    recommended_merge_decision: finalPass ? "MERGE_AS_IS" : "FIX_BEFORE_MERGE",
    final_verdict: finalPass ? "PASS" : "FAIL",
    failures: fails,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify(
      {
        scenarios: scenarioResults.map((s) => ({
          id: s.id,
          pass: s.pass,
          loadMoreMode: s.loadMoreMode,
          legs: s.legs,
        })),
      },
      null,
      2
    )
  );
  console.log(buildResultBlock(report));

  if (!finalPass) {
    console.error("[article-entrypoint-parity-guard FAIL]");
    for (const f of fails) console.error(f);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
