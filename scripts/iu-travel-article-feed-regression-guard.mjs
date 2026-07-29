#!/usr/bin/env node
/**
 * Travel article feed regression guard â€” post PR #5993 hotfix.
 * Ensures section=travel shows cestovani article feed (not blank), poradna stays removed.
 *
 * Run: npm run travel-article-feed-regression-guard
 */
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { bootstrapGuardContext } from "./guards/guard-playwright-bootstrap.mjs";
import { exitIfMediaArticlesGuardsSkipped } from "./media-articles-cutover-skip.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8897", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

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

async function waitTravelFeedReady(page) {
  await page.waitForFunction(() => String(location.href).includes("section=travel"), null, { timeout: 30000 });
  await page.evaluate(() => {
    try {
      const fn = window.iuApplySectionFromURL || window.applySectionFromURL;
      if (typeof fn === "function") fn();
    } catch (_) {}
  });
  await page.waitForTimeout(800);
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
      const st = window.__iuFeedPipelineState || {};
      const topic = String(st.mediaTopicKey || "").toLowerCase();
      const sec = String(document.body?.dataset?.section || "").toLowerCase();
      return sec === "travel" && topic === "cestovani";
    },
    null,
    { timeout: 30000 }
  );
  await page.waitForFunction(
    () => {
      const feed = document.getElementById("feed");
      if (!feed) return false;
      const domN = feed.querySelectorAll("article.news-card, article").length;
      if (domN >= 1) return true;
      const st = window.__iuFeedPipelineState || {};
      const cl = st.chunkLoader || {};
      const received = Number(cl.articlesReceivedCount);
      if (Number.isFinite(received) && received >= 1 && feed.children.length >= 1) return true;
      const filtered = Array.isArray(st.filteredItems) ? st.filteredItems.length : 0;
      return filtered >= 1 && feed.children.length >= 1;
    },
    null,
    { timeout: 120000 }
  );
}

async function probeTravelSection(page) {
  return page.evaluate(() => {
    const feed = document.getElementById("feed");
    const feedCs = feed ? window.getComputedStyle(feed) : null;
    const leftContent = document.getElementById("leftContent");
    const leftCs = leftContent ? window.getComputedStyle(leftContent) : null;
    const mobileOk =
      window.innerWidth > 767 ||
      (document.body.classList.contains("iu-mobileMainVisible") &&
        (!leftContent || leftCs.display !== "none"));
    const articleDomCount = feed ? feed.querySelectorAll("article.news-card, article").length : 0;
    const st = window.__iuFeedPipelineState || {};
    const cl = st.chunkLoader || {};
    const pipelineCount = Number.isFinite(Number(cl.articlesReceivedCount))
      ? Number(cl.articlesReceivedCount)
      : Array.isArray(st.filteredItems)
        ? st.filteredItems.length
        : 0;
    const articleCount = Math.max(articleDomCount, pipelineCount > 0 && feed && feed.children.length > 0 ? 1 : 0);
    const feedVisible =
      mobileOk &&
      !!feed &&
      feedCs &&
      feedCs.display !== "none" &&
      (feed.offsetHeight > 20 || articleDomCount > 0) &&
      feed.getAttribute("data-feed-ready") === "true";
    const iuFc = document.body ? document.body.getAttribute("data-iu-fc") : null;
    const sec = document.body ? document.body.dataset.section : "";
    const url = location.href;
    const stOut = window.__iuFeedPipelineState || {};
    const poradnaLabels = Array.from(document.querySelectorAll("button, a, [role=button]"))
      .map((el) => String(el.textContent || "").trim())
      .filter((t) => /cestovn[iĂ­]\s*poradna/i.test(t));
    const overflowX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
    return {
      url,
      section: sec,
      iuFc,
      feedVisible,
      articleCount,
      mediaTopicKey: stOut.mediaTopicKey || null,
      pipelineArticleCount: pipelineCount,
      articleDomCount,
      travelViewExists: !!document.getElementById("iuTravelView"),
      travelNavBarExists: !!document.getElementById("iuTravelNavBar"),
      poradnaButtonCount: poradnaLabels.length,
      hexExists: !!document.querySelector('.iuHex--travel[data-section="travel"]'),
      overflowX,
    };
  });
}

async function testLoadMore(page) {
  const btnVisible = await page.evaluate(() => {
    const btn = document.querySelector(".iuLoadMoreBtn");
    return !!(btn && btn.offsetParent !== null);
  });
  if (!btnVisible) return { skipped: true, ok: true };
  const before = await page.evaluate(() => {
    const feed = document.getElementById("feed");
    return feed ? feed.querySelectorAll("article.news-card, article").length : 0;
  });
  await page.evaluate(() => {
    const btn = document.querySelector(".iuLoadMoreBtn");
    if (btn) btn.click();
  });
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const feed = document.getElementById("feed");
    return feed ? feed.querySelectorAll("article.news-card, article").length : 0;
  });
  return { skipped: false, ok: after > before, before, after };
}

function evaluateProbe(probe, loadMore, viewportId, fails) {
  let pass = true;
  if (!probe.url.includes("section=travel")) {
    pass = false;
    fails.push(`${viewportId}: TRAVEL_ROUTE_WORKS=NO url=${probe.url}`);
  }
  if (probe.section !== "travel") {
    pass = false;
    fails.push(`${viewportId}: TRAVEL_SECTION_EXISTS=NO section=${probe.section}`);
  }
  if (probe.iuFc !== "1") {
    pass = false;
    fails.push(`${viewportId}: feed hidden (data-iu-fc=${probe.iuFc})`);
  }
  if (!probe.feedVisible) {
    pass = false;
    fails.push(`${viewportId}: TRAVEL_ARTICLE_FEED_EXISTS=NO feed not visible`);
  }
  if (probe.articleCount < 1) {
    pass = false;
    fails.push(`${viewportId}: TRAVEL_ARTICLES_RENDER=NO count=${probe.articleCount}`);
  }
  if (probe.mediaTopicKey !== "cestovani") {
    pass = false;
    fails.push(`${viewportId}: mediaTopicKey=${probe.mediaTopicKey}`);
  }
  if (probe.poradnaButtonCount > 0) {
    pass = false;
    fails.push(`${viewportId}: TRAVEL_ADVISORY_BUTTON_REMOVED=NO count=${probe.poradnaButtonCount}`);
  }
  if (probe.travelViewExists) {
    pass = false;
    fails.push(`${viewportId}: TRAVEL_ADVISORY_VIEW_REMOVED=NO iuTravelView exists`);
  }
  if (probe.travelNavBarExists) {
    pass = false;
    fails.push(`${viewportId}: iuTravelNavBar exists`);
  }
  if (probe.overflowX) {
    pass = false;
    fails.push(`${viewportId}: layout overflow-x`);
  }
  if (!loadMore.skipped && !loadMore.ok) {
    pass = false;
    fails.push(`${viewportId}: TRAVEL_LOAD_MORE_WORKS=NO before=${loadMore.before} after=${loadMore.after}`);
  }
  return pass;
}

async function runViewport(browser, vp) {
  const context = await bootstrapGuardContext(browser, {
    viewport: { width: vp.width, height: vp.height },
    locale: "cs-CZ",
  });
  const page = await context.newPage();
  const url = withGuardParams(`${BASE}?section=travel`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 120000 });
  await waitTravelFeedReady(page);
  const probe = await probeTravelSection(page);
  const loadMore = await testLoadMore(page);
  await context.close();
  return { viewport: vp.id, probe, loadMore };
}

async function main() {
  exitIfMediaArticlesGuardsSkipped("iu-travel-article-feed-regression-guard");
  const fails = [];
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
  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      const r = await runViewport(browser, vp);
      const pass = evaluateProbe(r.probe, r.loadMore, vp.id, fails);
      results.push({ ...r, pass });
    }
  } finally {
    await browser.close();
    if (server) {
      try {
        server.kill("SIGTERM");
      } catch (_) {}
    }
  }

  const allPass = results.every((r) => r.pass) && fails.length === 0;
  const report = {
    TRAVEL_SECTION_EXISTS: results.every((r) => r.probe.section === "travel") ? "YES" : "NO",
    TRAVEL_ARTICLE_FEED_EXISTS: results.every((r) => r.probe.feedVisible) ? "YES" : "NO",
    TRAVEL_ARTICLES_RENDER: results.every((r) => r.probe.articleCount >= 1) ? "YES" : "NO",
    TRAVEL_LOAD_MORE_WORKS: results.every((r) => r.loadMore.skipped || r.loadMore.ok) ? "YES" : "NO",
    TRAVEL_ROUTE_WORKS: results.every((r) => r.probe.url.includes("section=travel")) ? "YES" : "NO",
    TRAVEL_ADVISORY_BUTTON_REMOVED: results.every((r) => r.probe.poradnaButtonCount === 0) ? "YES" : "NO",
    TRAVEL_ADVISORY_VIEW_REMOVED: results.every((r) => !r.probe.travelViewExists && !r.probe.travelNavBarExists)
      ? "YES"
      : "NO",
    TRAVEL_ARTICLE_FEED_PRESERVED: results.every((r) => r.probe.mediaTopicKey === "cestovani") ? "YES" : "NO",
    TRAVEL_DESKTOP_OK: results.find((r) => r.viewport === "desktop")?.pass ? "YES" : "NO",
    TRAVEL_TABLET_OK: results.find((r) => r.viewport === "tablet")?.pass ? "YES" : "NO",
    TRAVEL_MOBILE_OK: results.find((r) => r.viewport === "mobile")?.pass ? "YES" : "NO",
    TRAVEL_ARTICLE_FEED_REGRESSION_GUARD: allPass ? "PASS" : "FAIL",
    results,
    fails,
  };

  const outPath = path.join(REPO, "scripts", "iu-travel-article-feed-regression-guard-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("TRAVEL_ARTICLE_FEED_REGRESSION_GUARD_RESULT");
  for (const [k, v] of Object.entries(report)) {
    if (k === "results" || k === "fails") continue;
    console.log(`${k}=${v}`);
  }
  if (fails.length) {
    for (const f of fails) console.log("FAIL:" + f);
  }
  console.log("FINAL_VERDICT=" + (allPass ? "PASS" : "FAIL"));
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
