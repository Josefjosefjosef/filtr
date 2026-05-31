#!/usr/bin/env node
/**
 * Section switch scroll position guard — new section must open at top (header visible).
 * Run: npm run iu-section-switch-scroll-position-guard
 * Report: IU_SCROLL_GUARD_REPORT=scripts/section-switch-scroll-position-after-report.json
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

const PORT = parseInt(process.env.IU_GUARD_PORT || "8896", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;

const DISTANCE_MAX_PX = parseInt(process.env.IU_SCROLL_DISTANCE_MAX || "120", 10);
const INHERITED_SCROLL_MIN_BEFORE = 400;
const INHERITED_SCROLL_RATIO = 0.45;
/** Per-transition cap: scroll-to-section-start + feed minHeight release can register one shift (instant guard keeps 0.043). */
const CLS_CAP = 0.55;
const STALE_VISIBLE_MAX_MS = 150;
const CORRECT_HEADER_MAX_MS = 450;
const FIRST_ARTICLES_MAX_MS = 600;

const SECTIONS = [
  { accent: "zpravy", headerFile: "section-zpravy.jpg", topic: "zpravy" },
  { accent: "sport", headerFile: "section-sport.jpg", topic: "sport" },
  { accent: "finance", headerFile: "section-finance.jpg", topic: "finance" },
  { accent: "zdravi", headerFile: "section-zdravi.jpg", topic: "zdravi" },
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

function readMetricsScript() {
  return `(() => {
    const feed = document.getElementById("feed");
    const header =
      (feed && feed.querySelector("picture.iu-feed-section-header-picture")) ||
      (feed && feed.querySelector("img.iu-feed-section-header-img")) ||
      (feed && feed.querySelector(".iu-feed-section-header-img"));
    const sticky =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbarStackH")) || 68;
    const scrollY =
      (document.body && document.body.scrollTop) ||
      window.scrollY ||
      (document.documentElement && document.documentElement.scrollTop) ||
      0;
    const headerTop = header ? header.getBoundingClientRect().top : feed ? feed.getBoundingClientRect().top : 0;
    const targetSectionTop = header
      ? Math.round(header.getBoundingClientRect().top + scrollY)
      : feed
        ? Math.round(feed.getBoundingClientRect().top + scrollY)
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
    return {
      scrollY: Math.round(scrollY),
      headerTop: Math.round(headerTop),
      sticky: Math.round(sticky),
      targetSectionTop,
      distanceFromTargetTop,
      openedAtTop: distanceFromTargetTop <= ${DISTANCE_MAX_PX},
      topic,
      headerFile,
      ready,
      switching,
    };
  })()`;
}

async function scrollFeedDown(page) {
  await page.evaluate(async () => {
    const body = document.body;
    const root = body || document.documentElement;
    const maxY = Math.max(
      (body ? body.scrollHeight - body.clientHeight : 0),
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

async function waitSectionReady(page, expect, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const row = await page.evaluate(readMetricsScript());
    if (
      row.ready === "true" &&
      row.switching !== "1" &&
      row.headerFile === expect.headerFile &&
      row.topic === expect.topic
    ) {
      return { ok: true, ms: Date.now() - t0, row };
    }
    await page.waitForTimeout(16);
  }
  const row = await page.evaluate(readMetricsScript());
  return { ok: false, ms: Date.now() - t0, row };
}

async function measureSectionClick(page, sec, prevAccent) {
  await page.waitForSelector(`#iuLeftRail a[data-accent="${sec.accent}"]`, { timeout: 60000 });
  const before = await page.evaluate(readMetricsScript());
  const tClick = Date.now();
  await page.click(`#iuLeftRail a[data-accent="${sec.accent}"]`);
  const immediate = await page.evaluate(readMetricsScript());
  const settled = await waitSectionReady(page, sec, 5000);
  await page.waitForTimeout(32);
  const after = settled.row || (await page.evaluate(readMetricsScript()));
  const inheritedScroll =
    before.scrollY >= INHERITED_SCROLL_MIN_BEFORE &&
    after.scrollY >= Math.round(before.scrollY * INHERITED_SCROLL_RATIO);
  return {
    clickedSection: sec.accent,
    activeSection: after.topic || "",
    beforeScrollY: before.scrollY,
    afterClickImmediateScrollY: immediate.scrollY,
    afterSectionReadyScrollY: after.scrollY,
    targetSectionTop: after.targetSectionTop,
    distanceFromTargetTop: after.distanceFromTargetTop,
    openedAtTop: after.openedAtTop,
    inheritedScroll,
    clickToReadyMs: settled.ms,
    headerFile: after.headerFile,
    ok: settled.ok && after.openedAtTop && !inheritedScroll,
    prevAccent,
  };
}

async function runSuite(page) {
  await page.goto(BASE + "?section=feed&topic=zpravy&iuRobust=1", {
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

  const sections = [];
  let prev = "zpravy";
  let maxCls = 0;
  for (let i = 1; i < SECTIONS.length; i++) {
    const sec = SECTIONS[i];
    await page.evaluate(() => {
      window.__iuScrollGuardCls = 0;
    });
    await scrollFeedDown(page);
    const row = await measureSectionClick(page, sec, prev);
    const stepCls = await page.evaluate(() => Number(window.__iuScrollGuardCls || 0));
    row.stepCls = stepCls;
    maxCls = Math.max(maxCls, stepCls);
    sections.push(row);
    if (!row.ok) break;
    prev = sec.accent;
  }
  return { sections, maxCls };
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
    const sections = suite.sections;
    const cls = suite.maxCls;
    const overflowX = await page.evaluate(() => {
      const d = document.documentElement;
      const b = document.body;
      return (d && d.scrollWidth > d.clientWidth + 1) || (b && b.scrollWidth > b.clientWidth + 1);
    });

    const report = {
      measuredAt: new Date().toISOString(),
      distanceMaxPx: DISTANCE_MAX_PX,
      sections,
      cls,
      overflowX,
      consoleErrorsCount: consoleErrors.length,
      appErrorsCount: appErrors.length,
      pass: false,
    };

    for (const row of sections) {
      if (!row.openedAtTop) {
        fails.push(
          row.clickedSection + ": not at top distance=" + row.distanceFromTargetTop + "px"
        );
      }
      if (row.inheritedScroll) {
        fails.push(
          row.clickedSection +
            ": inherited scroll before=" +
            row.beforeScrollY +
            " after=" +
            row.afterSectionReadyScrollY
        );
      }
      if (!row.ok) fails.push(row.clickedSection + ": section not ready or header mismatch");
    }
    if (cls > CLS_CAP) fails.push("CLS " + cls + " > " + CLS_CAP);
    if (overflowX) fails.push("overflowX");
    if (consoleErrors.length) fails.push("consoleErrors=" + consoleErrors.length);
    if (appErrors.length) fails.push("appErrors=" + appErrors.length);

    report.pass = fails.length === 0 && sections.length >= 3;

    const outPath = process.env.IU_SCROLL_GUARD_REPORT;
    if (outPath) {
      const abs = path.isAbsolute(outPath) ? outPath : path.join(REPO, outPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, JSON.stringify(report, null, 2), "utf8");
    }

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
