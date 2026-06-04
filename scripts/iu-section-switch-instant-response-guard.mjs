#!/usr/bin/env node
/**
 * Section switch instant response guard (Playwright, local server).
 * Run: npm run iu-section-switch-instant-response-guard
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  isIgnorableGuardConsoleError,
} from "./proofs/open_meteo_guard_stub.cjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8895", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const CLS_CAP = 0.043;
const STALE_VISIBLE_MAX_MS = 150;
const CORRECT_HEADER_MAX_MS = 450;
const FIRST_ARTICLES_MAX_MS = 600;
const INITIAL_RENDER_MAX_COUNT = 40;
const FULL_RENDER_MAX_MS = 5000;

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

async function installClsObserver(context) {
  await context.addInitScript(() => {
    try {
      window.__iuInstantSwitchCls = 0;
      new PerformanceObserver(function (list) {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && e.value) {
            window.__iuInstantSwitchCls = (window.__iuInstantSwitchCls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
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
  await page.waitForTimeout(300);

  return page.evaluate(
    async ({ fromHeader, toHeader, toAccent, fullRenderMaxMs }) => {
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
      let clickToCorrectHeaderMs = null;
      let clickToFirstCorrectArticlesMs = null;
      let staleOldSectionVisibleMs = 0;
      let initialRenderCount = null;
      let fullRenderDurationMs = null;
      let maxStaleMs = 0;

      el.click();

      const deadline = tClick + fullRenderMaxMs;
      while (performance.now() < deadline) {
        const now = performance.now();
        const s = snap();

        const staleHeader = s.headerFile === fromHeader && s.headerFile !== toHeader;
        const staleTopic = s.topic && s.topic !== toAccent;
        const staleVisible =
          (staleHeader || staleTopic) && s.switching !== "1" && s.cards > 0;
        if (staleVisible) maxStaleMs = Math.max(maxStaleMs, now - tClick);

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
          initialRenderCount = s.cards;
        }

        if (
          fullRenderDurationMs == null &&
          s.headerFile === toHeader &&
          s.topic === toAccent &&
          s.ready === "true" &&
          s.switching !== "1"
        ) {
          fullRenderDurationMs = now - tClick;
          break;
        }
        await new Promise((r) => requestAnimationFrame(r));
      }

      return {
        clickToCorrectHeaderMs,
        clickToFirstCorrectArticlesMs,
        staleOldSectionVisibleMs: maxStaleMs,
        initialRenderCount,
        initialBatchCount:
          (window.__iuFeedSwitchMetrics && window.__iuFeedSwitchMetrics.initialBatchCount) || null,
        fullRenderDurationMs,
      };
    },
    { fromHeader, toHeader, toAccent, fullRenderMaxMs: FULL_RENDER_MAX_MS }
  );
}

function round1(n) {
  return n == null ? null : Math.round(n * 10) / 10;
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

  const consoleErrors = [];
  const appErrors = [];
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  });
  await installClsObserver(context);
  const page = await context.newPage();
  await installProofGuardNetworkStubs(page);
  const ignorableTracker = createIgnorableResourceTracker();
  ignorableTracker.attachToPage(page);
  const ignorableOpts = {
    hadRecentIgnorableFailure: () => ignorableTracker.hadRecentIgnorableFailure(),
  };
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = String(msg.text());
    if (isIgnorableGuardConsoleError(t, ignorableOpts)) return;
    consoleErrors.push(t);
  });
  page.on("pageerror", (err) => {
    const t = String(err && err.message ? err.message : err);
    if (isIgnorableGuardConsoleError(t, ignorableOpts)) return;
    appErrors.push("pageerror");
  });

  const results = [];
  const fails = [];
  try {
    for (const t of TRANSITIONS) {
      const row = await measureTransition(page, t.from, t.to);
      const entry = {
        transition: t.from + "->" + t.to,
        clickToCorrectHeaderMs: round1(row.clickToCorrectHeaderMs),
        clickToFirstCorrectArticlesMs: round1(row.clickToFirstCorrectArticlesMs),
        staleOldSectionVisibleMs: round1(row.staleOldSectionVisibleMs),
        initialRenderCount: row.initialRenderCount,
        initialBatchCount: row.initialBatchCount,
        fullRenderDurationMs: round1(row.fullRenderDurationMs),
      };
      results.push(entry);

      if (row.error) fails.push(entry.transition + ": " + row.error);
      if (row.clickToCorrectHeaderMs == null || row.clickToCorrectHeaderMs > CORRECT_HEADER_MAX_MS) {
        fails.push(
          entry.transition + ": header too slow " + String(entry.clickToCorrectHeaderMs) + "ms > " + CORRECT_HEADER_MAX_MS
        );
      }
      if (row.clickToFirstCorrectArticlesMs == null || row.clickToFirstCorrectArticlesMs > FIRST_ARTICLES_MAX_MS) {
        fails.push(
          entry.transition +
            ": first articles too slow " +
            String(entry.clickToFirstCorrectArticlesMs) +
            "ms > " +
            FIRST_ARTICLES_MAX_MS
        );
      }
      if ((row.staleOldSectionVisibleMs || 0) > STALE_VISIBLE_MAX_MS) {
        fails.push(
          entry.transition +
            ": stale visible " +
            String(entry.staleOldSectionVisibleMs) +
            "ms > " +
            STALE_VISIBLE_MAX_MS
        );
      }
      if (row.initialBatchCount != null && row.initialBatchCount > INITIAL_RENDER_MAX_COUNT) {
        fails.push(
          entry.transition +
            ": initial batch count " +
            String(row.initialBatchCount) +
            " > " +
            INITIAL_RENDER_MAX_COUNT
        );
      }
      if (row.fullRenderDurationMs == null || row.fullRenderDurationMs > FULL_RENDER_MAX_MS) {
        fails.push(entry.transition + ": full render timeout or > " + FULL_RENDER_MAX_MS + "ms");
      }
    }

    const cls = await page.evaluate(() => Number(window.__iuInstantSwitchCls || 0));
    const overflowX = await page.evaluate(() => {
      const d = document.documentElement;
      const b = document.body;
      return (d && d.scrollWidth > d.clientWidth + 1) || (b && b.scrollWidth > b.clientWidth + 1);
    });

    if (cls > CLS_CAP) fails.push("CLS " + cls + " > " + CLS_CAP);
    if (overflowX) fails.push("overflowX");
    if (consoleErrors.length) fails.push("consoleErrors=" + consoleErrors.length);
    if (appErrors.length) fails.push("appErrors=" + appErrors.length);

    console.log(
      JSON.stringify(
        {
          results,
          cls,
          overflowX,
          consoleErrorsCount: consoleErrors.length,
          appErrorsCount: appErrors.length,
        },
        null,
        2
      )
    );

    if (fails.length) {
      console.error("FAIL");
      for (const f of fails) console.error(f);
      process.exitCode = 1;
    } else {
      console.log("PASS");
    }
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
