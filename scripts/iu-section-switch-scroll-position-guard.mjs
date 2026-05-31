#!/usr/bin/env node
/**
 * Section switch scroll position guard — dynamically tests all left-rail sections.
 * Run: npm run iu-section-switch-scroll-position-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-section-switch-scroll-position-guard
 */
import { createRequire } from "module";
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

const DISTANCE_MAX_PX = parseInt(process.env.IU_SCROLL_DISTANCE_MAX || "120", 10);
const INHERITED_SCROLL_MIN_BEFORE = 400;
/** Fail only when deep scroll is largely preserved (not when correctly reset to section start). */
const INHERITED_SCROLL_RATIO = 0.7;
const TOOL_SCROLL_MAX_Y = 400;
/** Per-transition cap: scroll-to-section-start + feed minHeight release can register one shift. */
const CLS_CAP = 0.55;
const MIN_SECTIONS_TO_TEST = 3;
const SECTION_SETTLE_MS = 8000;

function isProdHost(base) {
  return /infouzel\.cz/i.test(base);
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

async function installClsObserver(context) {
  await context.addInitScript(() => {
    try {
      window.__iuScrollGuardCls = 0;
      new PerformanceObserver(function (list) {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && e.value) {
            window.__iuScrollGuardCls = (window.__iuScrollGuardCls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
}

/** Mirrors assets/app.js IU_FEED_SECTION_HEADER_ASSETS for feed-topic / feed-section headers. */
const FEED_HEADER_BY_KEY = {
  zpravy: "section-zpravy.jpg",
  sport: "section-sport.jpg",
  finance: "section-finance.jpg",
  zdravi: "section-zdravi.jpg",
  cestovani: "section-cestovani.jpg",
  travel: "section-cestovani.jpg",
  hry: "section-hry.jpg",
  kultura: "section-kultura-akce.jpg",
  veda: "section-veda-historie.jpg",
  vzdelavani: "section-vzdelavani.jpg",
};

function readMetricsScript(distanceMax) {
  return `(() => {
    const feed = document.getElementById("feed");
    const header =
      (feed && feed.querySelector("picture.iu-feed-section-header-picture")) ||
      (feed && feed.querySelector("img.iu-feed-section-header-img")) ||
      (feed && feed.querySelector(".iu-feed-section-header-img"));
    const toolHeader =
      document.querySelector("#iuCenterStage .iuSectionHeader") ||
      document.querySelector("[data-iu-view] .iuSectionHeader") ||
      document.getElementById("iuCenterStage");
    const sticky =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbarStackH")) || 68;
    const scrollY =
      (document.body && document.body.scrollTop) ||
      window.scrollY ||
      (document.documentElement && document.documentElement.scrollTop) ||
      0;
    const anchor = header || toolHeader || feed;
    const headerTop = anchor ? anchor.getBoundingClientRect().top : 0;
    const targetSectionTop = anchor
      ? Math.round(anchor.getBoundingClientRect().top + scrollY)
      : 0;
    const distanceFromTargetTop = Math.round(Math.abs(headerTop - sticky));
    const topic =
      (window.__iuFeedPipelineState && String(window.__iuFeedPipelineState.mediaTopicKey || "")) || "";
    const img =
      (feed && feed.querySelector(".iu-feed-section-header-img")) ||
      (feed && feed.querySelector("picture.iu-feed-section-header-picture img"));
    const src = img ? String(img.getAttribute("src") || img.currentSrc || "") : "";
    const headerFile = src.split("/").pop() || "";
    const ready = feed ? String(feed.getAttribute("data-feed-ready") || "") : "";
    const switching = feed ? String(feed.getAttribute("data-feed-switching") || "") : "";
    const feedVisible = !!(feed && feed.offsetParent !== null && feed.getBoundingClientRect().height > 40);
    return {
      scrollY: Math.round(scrollY),
      headerTop: Math.round(headerTop),
      sticky: Math.round(sticky),
      targetSectionTop,
      distanceFromTargetTop,
      openedAtTop: distanceFromTargetTop <= ${distanceMax},
      topic,
      headerFile,
      ready,
      switching,
      feedVisible,
    };
  })()`;
}

async function discoverRailSections(page) {
  const raw = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll("#iuLeftRail .iu-leftNavItem[data-accent]"));
    const out = [];
    for (const el of items) {
      const accent = String(el.getAttribute("data-accent") || "").trim().toLowerCase();
      if (!accent) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
      const topicRaw = String(el.getAttribute("data-media-topic") || "").trim().toLowerCase();
      const topic = topicRaw && topicRaw !== "all" ? topicRaw : "";
      const label = String(el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60);
      out.push({ accent, topic, label, topicRaw, hasMediaTopicAttr: !!(topicRaw && topicRaw !== "all") });
    }
    return out;
  });

  const sections = [];
  const seen = new Set();
  for (const row of raw) {
    const key = row.accent + "|" + (row.topic || "");
    if (seen.has(key)) continue;
    seen.add(key);

    let kind = "tool";
    let expectTopic = row.topic || "";
    let headerFile = "";

    if (row.topic) {
      kind = "feed-topic";
      expectTopic = row.topic;
      headerFile = FEED_HEADER_BY_KEY[row.topic] || "";
    } else if (row.accent === "travel") {
      kind = "tool";
      expectTopic = "";
      headerFile = "";
    } else if (FEED_HEADER_BY_KEY[row.accent]) {
      kind = "feed-section";
      expectTopic = row.accent;
      headerFile = FEED_HEADER_BY_KEY[row.accent];
    } else if (row.accent === "media" || row.topicRaw === "all") {
      kind = "feed-hub";
      expectTopic = "";
      headerFile = "section-prehled-dne.jpg";
    }

    sections.push({
      accent: row.accent,
      topic: expectTopic,
      selectorTopic: row.hasMediaTopicAttr ? row.topic : "",
      label: row.label,
      kind,
      headerFile,
      skipScrollDown: kind === "tool",
    });
  }

  return sections;
}

async function scrollFeedDown(page) {
  await page.evaluate(async () => {
    const body = document.body;
    const root = body || document.documentElement;
    const maxY = Math.max(
      body ? body.scrollHeight - body.clientHeight : 0,
      document.documentElement.scrollHeight - window.innerHeight,
      1200
    );
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const y = Math.round((maxY * i) / steps);
      window.scrollTo(0, y);
      if (body) body.scrollTop = y;
      if (root && root !== body) root.scrollTop = y;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });
  await page.waitForTimeout(200);
}

async function waitSectionReady(page, sec, timeoutMs) {
  const t0 = Date.now();
  const metricsFn = readMetricsScript(DISTANCE_MAX_PX);
  while (Date.now() - t0 < timeoutMs) {
    const row = await page.evaluate(metricsFn);
    if (sec.kind === "tool") {
      if (row.distanceFromTargetTop <= DISTANCE_MAX_PX || row.scrollY <= TOOL_SCROLL_MAX_Y) {
        return { ok: true, ms: Date.now() - t0, row };
      }
    } else if (sec.kind === "feed-hub") {
      if (
        row.feedVisible &&
        row.ready === "true" &&
        row.switching !== "1" &&
        (!sec.headerFile || row.headerFile === sec.headerFile)
      ) {
        return { ok: true, ms: Date.now() - t0, row };
      }
    } else if (sec.kind === "feed-section") {
      const headerOk = !sec.headerFile || row.headerFile === sec.headerFile;
      const topicOk = !sec.topic || row.topic === sec.topic || row.topic === "cestovani";
      if (row.ready === "true" && row.switching !== "1" && headerOk && (topicOk || row.feedVisible)) {
        return { ok: true, ms: Date.now() - t0, row };
      }
    } else {
      const topicOk = !sec.topic || row.topic === sec.topic;
      const headerOk = !sec.headerFile || row.headerFile === sec.headerFile;
      if (row.ready === "true" && row.switching !== "1" && topicOk && headerOk) {
        return { ok: true, ms: Date.now() - t0, row };
      }
    }
    await page.waitForTimeout(16);
  }
  const row = await page.evaluate(metricsFn);
  return { ok: false, ms: Date.now() - t0, row };
}

async function measureSectionClick(page, sec, prevAccent) {
  const selector = `#iuLeftRail a.iu-leftNavItem[data-accent="${sec.accent}"]${
    sec.selectorTopic ? `[data-media-topic="${sec.selectorTopic}"]` : ""
  }`;
  await page.waitForSelector(selector, { timeout: 60000 });
  const metricsFn = readMetricsScript(DISTANCE_MAX_PX);
  const before = await page.evaluate(metricsFn);
  await page.click(selector);
  const immediate = await page.evaluate(metricsFn);
  const settled = await waitSectionReady(page, sec, SECTION_SETTLE_MS);
  await page.waitForTimeout(48);
  const after = settled.row || (await page.evaluate(metricsFn));

  let openedAtTop = after.openedAtTop;
  if (sec.kind === "tool") {
    openedAtTop = after.distanceFromTargetTop <= DISTANCE_MAX_PX || after.scrollY <= TOOL_SCROLL_MAX_Y;
  }

  const inheritedScroll =
    !sec.skipScrollDown &&
    before.scrollY >= INHERITED_SCROLL_MIN_BEFORE &&
    after.scrollY >= Math.round(before.scrollY * INHERITED_SCROLL_RATIO);

  return {
    clickedSection: sec.accent,
    topic: sec.topic,
    kind: sec.kind,
    label: sec.label,
    activeSection: after.topic || sec.topic || sec.accent,
    beforeScrollY: before.scrollY,
    afterClickImmediateScrollY: immediate.scrollY,
    afterSectionReadyScrollY: after.scrollY,
    targetSectionTop: after.targetSectionTop,
    distanceFromTargetTop: after.distanceFromTargetTop,
    openedAtTop,
    inheritedScroll,
    clickToReadyMs: settled.ms,
    headerFile: after.headerFile,
    ok: settled.ok && openedAtTop && !inheritedScroll,
    prevAccent,
  };
}

function buildEntryUrl() {
  const isLocal = BASE.indexOf("127.0.0.1") >= 0 || BASE.indexOf("localhost") >= 0;
  const isProd = /infouzel\.cz/i.test(BASE);
  const params = new URLSearchParams();
  params.set("section", "feed");
  if (isLocal) params.set("iuRobust", "1");
  if (isProd) params.set("nosw", "1");
  const glue = BASE.includes("?") ? "&" : "?";
  return BASE + glue + params.toString();
}

async function runSuite(page) {
  const entry = buildEntryUrl();

  await page.goto(entry, { waitUntil: "domcontentloaded", timeout: 90000 });
  try {
    await page.waitForLoadState("networkidle", { timeout: 25000 });
  } catch (_) {}
  await page.waitForSelector("#iuLeftRail .iu-leftNavItem[data-accent]", { timeout: 90000 });
  await page.waitForTimeout(isProdHost(BASE) ? 1200 : 600);

  const discovered = await discoverRailSections(page);
  const testRoute = discovered.filter((s) => s.kind !== "feed-hub");
  if (testRoute.length < MIN_SECTIONS_TO_TEST) {
    throw new Error("discovered too few sections: " + testRoute.length);
  }

  const start =
    testRoute.find((s) => s.accent === "zpravy" && s.kind === "feed-topic") || testRoute[0];
  const startSel = `#iuLeftRail a.iu-leftNavItem[data-accent="${start.accent}"]${
    start.selectorTopic ? `[data-media-topic="${start.selectorTopic}"]` : ""
  }`;
  await page.click(startSel);
  await waitSectionReady(page, start, SECTION_SETTLE_MS);
  await page.waitForTimeout(300);

  const results = [];
  let prev = start.accent;
  let maxCls = 0;
  const startKey = start.accent + "|" + (start.topic || "");
  const order = [start, ...testRoute.filter((s) => s.accent + "|" + (s.topic || "") !== startKey)];

  for (let i = 1; i < order.length; i++) {
    const sec = order[i];
    await page.evaluate(() => {
      window.__iuScrollGuardCls = 0;
    });
    if (!sec.skipScrollDown) {
      await scrollFeedDown(page);
    }
    const row = await measureSectionClick(page, sec, prev);
    const stepCls = await page.evaluate(() => Number(window.__iuScrollGuardCls || 0));
    row.stepCls = stepCls;
    maxCls = Math.max(maxCls, stepCls);
    results.push(row);
    if (!row.ok) break;
    prev = sec.accent;
  }

  return { sections: results, discovered, testRoute, maxCls };
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installClsObserver(context);
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(String(msg.text()));
  });
  page.on("pageerror", () => appErrors.push("pageerror"));

  const fails = [];
  try {
    const suite = await runSuite(page);
    const cls = suite.maxCls;
    const overflowX = await page.evaluate(() => {
      const d = document.documentElement;
      const b = document.body;
      return (d && d.scrollWidth > d.clientWidth + 1) || (b && b.scrollWidth > b.clientWidth + 1);
    });

    const report = {
      measuredAt: new Date().toISOString(),
      baseUrl: BASE,
      distanceMaxPx: DISTANCE_MAX_PX,
      discoveredCount: suite.discovered.length,
      discoveredSections: suite.discovered.map((s) => ({
        accent: s.accent,
        topic: s.topic,
        kind: s.kind,
        label: s.label,
      })),
      testRouteCount: suite.testRoute.length,
      sections: suite.sections,
      cls,
      overflowX,
      consoleErrorsCount: consoleErrors.length,
      appErrorsCount: appErrors.length,
      pass: false,
    };

    for (const row of suite.sections) {
      if (!row.openedAtTop) {
        fails.push(
          row.clickedSection +
            (row.topic ? "(" + row.topic + ")" : "") +
            ": not at top distance=" +
            row.distanceFromTargetTop +
            "px kind=" +
            row.kind
        );
      }
      if (row.inheritedScroll) {
        fails.push(
          row.clickedSection + ": inherited scroll before=" + row.beforeScrollY + " after=" + row.afterSectionReadyScrollY
        );
      }
      if (!row.ok) {
        fails.push(row.clickedSection + ": not ready or header/topic mismatch kind=" + row.kind);
      }
    }
    if (suite.sections.length < MIN_SECTIONS_TO_TEST) {
      fails.push("tested sections " + suite.sections.length + " < " + MIN_SECTIONS_TO_TEST);
    }
    if (cls > CLS_CAP) fails.push("CLS " + cls + " > " + CLS_CAP);
    if (overflowX) fails.push("overflowX");
    if (consoleErrors.length) fails.push("consoleErrors=" + consoleErrors.length);
    if (appErrors.length) fails.push("appErrors=" + appErrors.length);

    report.pass = fails.length === 0;

    console.log(JSON.stringify(report, null, 2));
    if (!report.pass) {
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
