#!/usr/bin/env node
/**
 * Section switch performance measurement (Playwright, local server).
 * Run: node scripts/section-switch-performance-proof.mjs [--out=path.json]
 */
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8894", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const SECTION_HEADERS = {
  zpravy: "section-zpravy.jpg",
  sport: "section-sport.jpg",
  finance: "section-finance.jpg",
  zdravi: "section-zdravi.jpg",
};

const TRANSITIONS = [
  { from: "zpravy", to: "sport" },
  { from: "sport", to: "finance" },
  { from: "finance", to: "zdravi" },
  { from: "zdravi", to: "zpravy" },
];

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

async function installObservers(context) {
  await context.addInitScript(() => {
    try {
      window.__iuSectionSwitchPerf = { cls: 0, longTasks: [] };
      new PerformanceObserver(function (list) {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && e.value) {
            window.__iuSectionSwitchPerf.cls = (window.__iuSectionSwitchPerf.cls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
      try {
        new PerformanceObserver(function (list) {
          for (const e of list.getEntries()) {
            if (e.duration > 50) {
              window.__iuSectionSwitchPerf.longTasks.push({
                startTime: e.startTime,
                duration: e.duration,
              });
            }
          }
        }).observe({ entryTypes: ["longtask"] });
      } catch (_) {}
    } catch (_) {}
  });
}

function readFeedSnapshot() {
  const feed = document.getElementById("feed");
  const img =
    (feed && feed.querySelector(".iu-feed-section-header-img")) ||
    (feed && feed.querySelector("picture.iu-feed-section-header-picture img"));
  const src = img ? String(img.getAttribute("src") || img.currentSrc || "") : "";
  const headerFile = src.split("/").pop() || "";
  const switching = feed ? String(feed.getAttribute("data-feed-switching") || "") : "";
  const ready = feed ? String(feed.getAttribute("data-feed-ready") || "") : "";
  const visualKey = feed ? String(feed.getAttribute("data-feed-visual-key") || "") : "";
  const cards = feed ? feed.querySelectorAll("article.news-card[data-feed-type='article']").length : 0;
  const topic =
    (typeof window !== "undefined" &&
      window.__iuFeedPipelineState &&
      String(window.__iuFeedPipelineState.mediaTopicKey || "")) ||
    "";
  const urlTopic = new URL(location.href).searchParams.get("topic") || "";
  return { headerFile, switching, ready, visualKey, cards, topic, urlTopic };
}

async function measureTransition(page, fromAccent, toAccent) {
  const fromHeader = SECTION_HEADERS[fromAccent];
  const toHeader = SECTION_HEADERS[toAccent];

  await page.goto(BASE + "?section=feed&topic=" + fromAccent + "&iuRobust=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(
    () => {
      const f = document.getElementById("feed");
      return f && String(f.getAttribute("data-feed-ready") || "") === "true";
    },
    null,
    { timeout: 60000 }
  );
  await page.waitForTimeout(400);

  const result = await page.evaluate(
    async ({ fromHeader, toHeader, toAccent }) => {
      function snap() {
        const feed = document.getElementById("feed");
        const img =
          (feed && feed.querySelector(".iu-feed-section-header-img")) ||
          (feed && feed.querySelector("picture.iu-feed-section-header-picture img"));
        const src = img ? String(img.getAttribute("src") || img.currentSrc || "") : "";
        const headerFile = src.split("/").pop() || "";
        const switching = feed ? String(feed.getAttribute("data-feed-switching") || "") : "";
        const ready = feed ? String(feed.getAttribute("data-feed-ready") || "") : "";
        const cards = feed
          ? feed.querySelectorAll("article.news-card[data-feed-type='article']").length
          : 0;
        const topic =
          (window.__iuFeedPipelineState && String(window.__iuFeedPipelineState.mediaTopicKey || "")) || "";
        return { headerFile, switching, ready, cards, topic };
      }

      const el = document.querySelector('#iuLeftRail a[data-accent="' + toAccent + '"]');
      if (!el) return { error: "no rail link" };

      const tClick = performance.now();
      let firstVisualChangeMs = null;
      let clickToCorrectHeaderMs = null;
      let clickToFirstCorrectArticlesMs = null;
      let staleOldSectionVisibleMs = 0;
      let initialRenderCount = 0;
      let fullRenderDurationMs = null;
      let prevSnap = snap();
      let sawFirstBatch = false;
      let maxStaleMs = 0;
      let cardsWhenSwitchingCleared = null;

      el.click();

      const deadline = tClick + 15000;
      while (performance.now() < deadline) {
        const now = performance.now();
        const s = snap();

        if (prevSnap.switching === "1" && s.switching !== "1" && cardsWhenSwitchingCleared == null) {
          cardsWhenSwitchingCleared = s.cards;
        }

        const visualChanged =
          s.headerFile !== prevSnap.headerFile ||
          s.switching !== prevSnap.switching ||
          s.cards !== prevSnap.cards ||
          s.ready !== prevSnap.ready;
        if (visualChanged && firstVisualChangeMs == null) {
          firstVisualChangeMs = now - tClick;
        }

        const staleHeader = s.headerFile === fromHeader && s.headerFile !== toHeader;
        const staleTopic = s.topic === "" ? false : s.topic !== toAccent;
        const staleVisible =
          (staleHeader || staleTopic) &&
          s.switching !== "1" &&
          s.cards > 0;
        if (staleVisible) {
          maxStaleMs = Math.max(maxStaleMs, now - tClick);
        }

        if (clickToCorrectHeaderMs == null && s.headerFile === toHeader) {
          clickToCorrectHeaderMs = now - tClick;
        }

        if (
          clickToFirstCorrectArticlesMs == null &&
          s.headerFile === toHeader &&
          s.topic === toAccent &&
          s.cards > 0 &&
          s.switching !== "1"
        ) {
          clickToFirstCorrectArticlesMs = now - tClick;
          if (!sawFirstBatch) {
            initialRenderCount = s.cards;
            sawFirstBatch = true;
          }
        }

        if (
          fullRenderDurationMs == null &&
          s.headerFile === toHeader &&
          s.topic === toAccent &&
          s.ready === "true" &&
          s.switching !== "1"
        ) {
          fullRenderDurationMs = now - tClick;
        }

        if (fullRenderDurationMs != null) break;
        await new Promise((r) => requestAnimationFrame(r));
      }

      staleOldSectionVisibleMs = Math.round(maxStaleMs * 10) / 10;
      const finalSnap = snap();

      return {
        clickToFirstVisualChangeMs: firstVisualChangeMs != null ? Math.round(firstVisualChangeMs * 10) / 10 : null,
        clickToCorrectHeaderMs: clickToCorrectHeaderMs != null ? Math.round(clickToCorrectHeaderMs * 10) / 10 : null,
        clickToFirstCorrectArticlesMs:
          clickToFirstCorrectArticlesMs != null ? Math.round(clickToFirstCorrectArticlesMs * 10) / 10 : null,
        staleOldSectionVisibleMs,
        initialRenderCount: cardsWhenSwitchingCleared != null ? cardsWhenSwitchingCleared : initialRenderCount,
        cardsWhenSwitchingCleared,
        initialBatchCount:
          (typeof window !== "undefined" &&
            window.__iuFeedSwitchMetrics &&
            window.__iuFeedSwitchMetrics.initialBatchCount) ||
          null,
        fullRenderDurationMs: fullRenderDurationMs != null ? Math.round(fullRenderDurationMs * 10) / 10 : null,
        finalCards: finalSnap.cards,
        finalReady: finalSnap.ready,
        finalSwitching: finalSnap.switching,
      };
    },
    { fromHeader, toHeader, toAccent }
  );

  return {
    transition: fromAccent + "->" + toAccent,
    ...result,
  };
}

async function main() {
  const outArg = process.argv.find((a) => a.startsWith("--out="));
  const outPath = outArg
    ? path.resolve(outArg.slice("--out=".length))
    : path.join(REPO, "scripts", "section-switch-performance-before-report.json");

  let server = null;
  if (USE_LOCAL_SERVER) {
    server = spawn(process.execPath, [path.join(REPO, "server", "projects-static-and-vin.mjs")], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });
    await waitForPort("127.0.0.1", PORT, 30000);
  }

  const consoleErrors = [];
  const appErrors = [];
  let overflowX = false;
  let cls = 0;
  let longTaskCount = 0;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installObservers(context);
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(String(msg.text()));
  });
  page.on("pageerror", () => appErrors.push("pageerror"));

  const transitions = [];
  try {
    for (const t of TRANSITIONS) {
      transitions.push(await measureTransition(page, t.from, t.to));
    }
    cls = await page.evaluate(() => Number(window.__iuSectionSwitchPerf?.cls || 0));
    longTaskCount = await page.evaluate(() => (window.__iuSectionSwitchPerf?.longTasks || []).length);
    overflowX = await page.evaluate(() => {
      const d = document.documentElement;
      const b = document.body;
      return (d && d.scrollWidth > d.clientWidth + 1) || (b && b.scrollWidth > b.clientWidth + 1);
    });
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    if (server) server.kill("SIGTERM");
  }

  const report = {
    measuredAt: new Date().toISOString(),
    transitions,
    summary: {
      avgClickToFirstVisualChangeMs: avg(transitions.map((t) => t.clickToFirstVisualChangeMs)),
      avgClickToCorrectHeaderMs: avg(transitions.map((t) => t.clickToCorrectHeaderMs)),
      avgClickToFirstCorrectArticlesMs: avg(transitions.map((t) => t.clickToFirstCorrectArticlesMs)),
      maxStaleOldSectionVisibleMs: Math.max(...transitions.map((t) => t.staleOldSectionVisibleMs || 0)),
      avgInitialRenderCount: avg(transitions.map((t) => t.initialRenderCount)),
      avgInitialBatchCount: avg(transitions.map((t) => t.initialBatchCount)),
      avgFullRenderDurationMs: avg(transitions.map((t) => t.fullRenderDurationMs)),
      longTaskCount,
      consoleErrorsCount: consoleErrors.length,
      appErrorsCount: appErrors.length,
      overflowX,
      cls: Math.round(cls * 10000) / 10000,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("WROTE " + outPath);
}

function avg(nums) {
  const v = nums.filter((n) => n != null && Number.isFinite(n));
  if (!v.length) return null;
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
