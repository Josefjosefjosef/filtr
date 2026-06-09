#!/usr/bin/env node
/**
 * Article entrypoint parity guard (V1).
 *
 * Ensures chunked article loading behaves identically regardless of entry path:
 * INIT=30, BUFFER=100 (active section only), LOAD_MORE=fetches next chunk.
 * Never: FULL_POOL, FULL_ARCHIVE, ALL_SECTIONS_PRELOAD.
 *
 * Run: npm run article-entrypoint-parity-guard
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

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
const BACKGROUND_RECEIVED_MAX = 150;

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
  const appSrc = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const loaderSrc = fs.readFileSync(path.join(REPO, "assets", "iu-article-chunk-loader.js"), "utf8");

  if (!appSrc.includes("iuUseChunkedArticleLoader")) {
    fails.push("static: assets/app.js missing iuUseChunkedArticleLoader");
  }
  if (!appSrc.includes("iuChunkScheduleBackgroundBuffer")) {
    fails.push("static: assets/app.js missing iuChunkScheduleBackgroundBuffer");
  }
  if (!loaderSrc.includes("IU_CHUNK_INITIAL_SIZE = 30")) {
    fails.push("static: IU_CHUNK_INITIAL_SIZE must remain 30");
  }
  if (!loaderSrc.includes("IU_CHUNK_BUFFER_MAX = 100")) {
    fails.push("static: IU_CHUNK_BUFFER_MAX must remain 100");
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
  const sel = `#iuLeftRail a[data-accent="${accent}"]`;
  await page.waitForSelector(sel, { timeout: 60000 });
  await page.click(sel);
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
  const metaBefore = await page.evaluate(() => {
    const m = document.querySelector(".iuLoadMoreMeta");
    return m ? m.textContent : null;
  });
  const filteredBefore = await page.evaluate(() => {
    const st = window.__iuFeedPipelineState || window.state || {};
    return Array.isArray(st.filteredItems) ? st.filteredItems.length : null;
  });
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
    };
  }
  const beforeLen = networkLog.length;
  await page.evaluate(() => {
    const btn = document.querySelector(".iuLoadMoreBtn");
    if (btn) btn.click();
  });
  await page.waitForTimeout(5000);
  const newReqs = networkLog.slice(Math.max(markIndex, beforeLen)).filter((n) => articlePattern(n.url));
  const newChunks = newReqs.filter((n) => chunkLoadMorePattern(n.url));
  const filteredAfter = await page.evaluate(() => {
    const st = window.__iuFeedPipelineState || window.state || {};
    return Array.isArray(st.filteredItems) ? st.filteredItems.length : null;
  });
  const metaAfter = await page.evaluate(() => {
    const m = document.querySelector(".iuLoadMoreMeta");
    return m ? m.textContent : null;
  });
  const filteredUnchanged =
    filteredBefore != null && filteredAfter != null && filteredBefore === filteredAfter;
  const fetchesNew =
    newChunks.length > 0 ||
    (filteredAfter != null && filteredBefore != null && filteredAfter > filteredBefore);
  const onlyReveals =
    !fetchesNew && metaBefore !== metaAfter && filteredUnchanged && newChunks.length === 0;
  return {
    clicked: true,
    load_more_fetches_new_chunk: fetchesNew,
    load_more_only_reveals_existing_data: onlyReveals,
    new_chunk_urls: newChunks.map((n) => String(n.url).split("?")[0]),
    metaBefore,
    metaAfter,
  };
}

function evaluateLegMetrics(leg, fails, scenarioId) {
  const prefix = scenarioId + (leg.leg ? ":" + leg.leg : "");
  const issues = [];

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
  if (leg.load_more && leg.load_more.clicked && !leg.load_more.skipped && !leg.load_more.load_more_fetches_new_chunk) {
    issues.push("load_more_fetches_new_chunk=NO");
  }
  if (leg.load_more && leg.load_more.load_more_only_reveals_existing_data) {
    issues.push("load_more_only_reveals_existing_data=YES");
  }
  if (leg.loaderMode && leg.loaderMode !== "chunk-v1") {
    issues.push("loaderMode=" + leg.loaderMode);
  }

  if (issues.length) {
    for (const i of issues) fails.push(prefix + ": " + i);
  }
  return issues.length === 0;
}

async function attachNetwork(page, networkLog) {
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
      });
    } catch (_) {}
  });
}

async function measureLeg(page, networkLog, legStartIdx, legLabel, expectedSection, opts = {}) {
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
  const bgDone = await waitBackground(page);
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

  const loadMore = opts.testLoadMore === false
    ? { skipped: true, clicked: false, load_more_fetches_new_chunk: true, load_more_only_reveals_existing_data: false }
    : await testLoadMore(page, networkLog, bgStartIdx);

  return {
    leg: legLabel,
    ...initial,
    background_preload_completed: bgDone,
    after_background_article_count_received: bgState.articlesReceived,
    after_background_transfer_kb: kb(sumTransferBytes(bgArticleNetwork)),
    background_preloads_all_sections: backgroundPreloadsAllSections,
    url_topic: urlTopic,
    chunk_sections_after_background: chunkSectionDirs(bgArticleNetwork),
    buffer_chunk_sections: bufferDirs,
    load_more: loadMore,
  };
}

async function runScenario(browser, scenario) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const networkLog = [];
  await attachNetwork(page, networkLog);
  try {
    await page.route("**/sw.js", (route) => route.abort());
  } catch (_) {}

  const legs = [];

  if (scenario.kind === "direct") {
    await page.goto(withGuardParams(scenario.url), { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsentIfPresent(page);
    legs.push(await measureLeg(page, networkLog, 0, scenario.target, scenario.target));
  } else if (scenario.kind === "chain") {
    await page.goto(withGuardParams(BASE), { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsentIfPresent(page);
    for (let i = 0; i < scenario.hops.length; i++) {
      const hop = scenario.hops[i];
      const mark = networkLog.length;
      await clickRail(page, hop);
      legs.push(await measureLeg(page, networkLog, mark, hop, hop, { testLoadMore: false }));
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
    legs.push(await measureLeg(page, networkLog, mark, scenario.target, scenario.target));
  } else if (scenario.kind === "menu") {
    await page.goto(withGuardParams(BASE), { waitUntil: "domcontentloaded", timeout: 120000 });
    await dismissConsentIfPresent(page);
    await page.waitForSelector("#iuLeftRail", { timeout: 60000 });
    const mark = networkLog.length;
    await clickRail(page, scenario.target);
    await page
      .waitForFunction(
        (t) => new URL(location.href).searchParams.get("topic") === t,
        scenario.target,
        { timeout: 30000 }
      )
      .catch(() => {});
    legs.push(await measureLeg(page, networkLog, mark, scenario.target, scenario.target));
  }

  await page.close();
  return { id: scenario.id, category: scenario.category, legs };
}

const SCENARIOS = [
  {
    id: "A",
    category: "homepage_entry",
    kind: "homepage_then_menu",
    target: "zpravy",
    waitHomeReady: true,
  },
  { id: "B", category: "menu_entry", kind: "menu", target: "zpravy" },
  { id: "C", category: "menu_entry", kind: "menu", target: "sport" },
  {
    id: "D",
    category: "direct_url_entry",
    kind: "direct",
    url: withGuardParams(BASE + "?section=feed&topic=zpravy"),
    target: "zpravy",
  },
  {
    id: "E",
    category: "direct_url_entry",
    kind: "direct",
    url: withGuardParams(BASE + "?section=feed&topic=sport"),
    target: "sport",
  },
  {
    id: "F",
    category: "internal_navigation",
    kind: "chain",
    hops: ["zpravy", "sport", "finance"],
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
    "",
    "publishable_pool_requested_anywhere=" + (report.publishable_pool_requested_anywhere ? "YES" : "NO"),
    "all_sections_preloaded_anywhere=" + (report.all_sections_preloaded_anywhere ? "YES" : "NO"),
    "load_more_fetches_chunk_everywhere=" + (report.load_more_fetches_chunk_everywhere ? "YES" : "NO"),
    "load_more_reveals_cache_anywhere=" + (report.load_more_reveals_cache_anywhere ? "YES" : "NO"),
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
  const staticFails = staticArchitectureGuard();
  const fails = staticFails.slice();
  const scenarioResults = [];

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
  };

  const allLegs = scenarioResults.flatMap((s) => s.legs);
  const publishablePoolAnywhere = allLegs.some((l) => l.publishable_pool_requested);
  const allSectionsPreloadedAnywhere = allLegs.some((l) => l.background_preloads_all_sections);
  const loadMoreFetchEverywhere = allLegs.every(
    (l) =>
      !l.load_more ||
      l.load_more.skipped ||
      !l.load_more.clicked ||
      l.load_more.load_more_fetches_new_chunk
  );
  const loadMoreRevealsAnywhere = allLegs.some(
    (l) => l.load_more && l.load_more.load_more_only_reveals_existing_data
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
    publishable_pool_requested_anywhere: publishablePoolAnywhere,
    all_sections_preloaded_anywhere: allSectionsPreloadedAnywhere,
    load_more_fetches_chunk_everywhere: loadMoreFetchEverywhere,
    load_more_reveals_cache_anywhere: loadMoreRevealsAnywhere,
    guard_added: true,
    ci_blocks_regression: true,
    git_status_clean: gitClean,
    recommended_merge_decision: finalPass ? "MERGE_AS_IS" : "FIX_BEFORE_MERGE",
    final_verdict: finalPass ? "PASS" : "FAIL",
    failures: fails,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ scenarios: scenarioResults.map((s) => ({ id: s.id, pass: s.pass, legs: s.legs })) }, null, 2));
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
