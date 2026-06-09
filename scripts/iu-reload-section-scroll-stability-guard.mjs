#!/usr/bin/env node
/**
 * Reload CLS + section switch header/content stability + scroll sanity (Playwright, local server).
 * Run: npm run iu-reload-section-scroll-stability-guard
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium, webkit, firefox } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8893", 10);
const BASE = `http://127.0.0.1:${PORT}/projects/`;
const CLS_CAP = 0.043;
/** publishable_pool.json primary loader: first section switch may need longer while full pool parses. */
const SECTION_SWITCH_MAX_MS = 4000;
const STALE_HEADER_MAX_MS = 80;
const STALE_ARTICLES_MAX_MS = 150;

const SECTIONS = [
  { accent: "zpravy", visualKey: "zpravy", headerFile: "section-zpravy.jpg" },
  { accent: "sport", visualKey: "sport", headerFile: "section-sport.jpg" },
  { accent: "finance", visualKey: "finance", headerFile: "section-finance.jpg" },
  { accent: "zdravi", visualKey: "zdravi", headerFile: "section-zdravi.jpg" },
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
      window.__iuStabilityCls = 0;
      new PerformanceObserver(function (list) {
        const entries = list.getEntries();
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          if (!e.hadRecentInput && e.value) {
            window.__iuStabilityCls = (window.__iuStabilityCls || 0) + e.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch (_) {}
  });
}

function readFeedHeaderFile(page) {
  return page.evaluate(() => {
    const feed = document.getElementById("feed");
    const img =
      (feed && feed.querySelector(".iu-feed-section-header-img")) ||
      (feed && feed.querySelector("picture.iu-feed-section-header-picture img"));
    const src = img ? String(img.getAttribute("src") || img.currentSrc || "") : "";
    const file = src.split("/").pop() || "";
    const visualKey = feed ? String(feed.getAttribute("data-feed-visual-key") || "") : "";
    const ready = feed ? String(feed.getAttribute("data-feed-ready") || "") : "";
    const switching = feed ? String(feed.getAttribute("data-feed-switching") || "") : "";
    const pic = feed && feed.querySelector("picture.iu-feed-section-header-picture");
    const picKey = pic ? String(pic.getAttribute("data-feed-visual-key") || "") : "";
    const topic =
      (window.__iuFeedPipelineState && String(window.__iuFeedPipelineState.mediaTopicKey || "")) || "";
    const cards = feed
      ? feed.querySelectorAll("article.news-card[data-feed-type='article']").length
      : 0;
    return { file, visualKey, picKey, ready, switching, topic, cards };
  });
}

async function clickRail(page, accent) {
  await page.waitForSelector(`#iuLeftRail a[data-accent="${accent}"]`, { timeout: 60000 });
  await page.click(`#iuLeftRail a[data-accent="${accent}"]`);
}

async function waitFeedSettled(page, expect, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const row = await readFeedHeaderFile(page);
    if (
      row.ready === "true" &&
      row.switching !== "1" &&
      row.file === expect.headerFile &&
      (row.visualKey === expect.visualKey || row.picKey === expect.visualKey)
    ) {
      return { ok: true, ms: Date.now() - t0, row };
    }
    await page.waitForTimeout(16);
  }
  const row = await readFeedHeaderFile(page);
  return { ok: false, ms: Date.now() - t0, row };
}

async function runReloadClsGuard(page) {
  await page.goto(BASE + "?section=feed&topic=zpravy&iuRobust=1", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2200);
  const cls = await page.evaluate(() => Number(window.__iuStabilityCls || 0));
  const overflowX = await page.evaluate(() => {
    const d = document.documentElement;
    const b = document.body;
    return (
      (d && d.scrollWidth > d.clientWidth + 1) || (b && b.scrollWidth > b.clientWidth + 1)
    );
  });
  return { cls, overflowX, pass: cls <= CLS_CAP && !overflowX };
}

async function runSectionSwitchGuard(page) {
  await page.goto(BASE + "?section=feed&iuRobust=1", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#feed a.iuCardTitle", { timeout: 120000 });
  await page.waitForFunction(
    () => {
      const f = document.getElementById("feed");
      return f && String(f.getAttribute("data-feed-ready") || "") === "true";
    },
    null,
    { timeout: 120000 }
  );
  const results = [];
  let prev = null;
  for (const sec of SECTIONS) {
    const tClick = Date.now();
    await clickRail(page, sec.accent);
    let staleMs = 0;
    let staleArticlesMs = 0;
    if (prev) {
      const staleDeadline = Date.now() + STALE_HEADER_MAX_MS;
      while (Date.now() < staleDeadline) {
        const snap = await readFeedHeaderFile(page);
        if (snap.file && snap.file !== prev.headerFile && snap.file !== sec.headerFile) {
          staleMs = Math.max(staleMs, Date.now() - tClick);
        }
        if (snap.file === sec.headerFile && snap.ready === "true") break;
        await page.waitForTimeout(8);
      }
      const artDeadline = Date.now() + STALE_ARTICLES_MAX_MS;
      while (Date.now() < artDeadline) {
        const snap = await readFeedHeaderFile(page);
        const staleTopic = snap.topic && snap.topic !== sec.accent;
        const staleHeader = snap.file === prev.headerFile;
        if (staleTopic && snap.switching !== "1" && snap.cards > 0) {
          staleArticlesMs = Math.max(staleArticlesMs, Date.now() - tClick);
        }
        if (staleHeader && snap.switching !== "1" && snap.cards > 0) {
          staleArticlesMs = Math.max(staleArticlesMs, Date.now() - tClick);
        }
        if (snap.topic === sec.accent && snap.file === sec.headerFile && snap.ready === "true") break;
        await page.waitForTimeout(8);
      }
    }
    const settled = await waitFeedSettled(page, sec, SECTION_SWITCH_MAX_MS);
    results.push({
      section: sec.accent,
      settledMs: settled.ms,
      ok: settled.ok,
      staleWrongHeaderMs: staleMs,
      staleWrongArticlesMs: staleArticlesMs,
      row: settled.row,
    });
    if (!settled.ok) break;
    prev = sec;
  }
  const pass = results.every((r) => r.ok && r.staleWrongHeaderMs === 0 && r.staleWrongArticlesMs === 0);
  return { pass, results };
}

async function runScrollGuard(page) {
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
  const consoleErrors = [];
  const onConsole = (msg) => {
    if (msg.type() === "error") consoleErrors.push(String(msg.text()));
  };
  page.on("console", onConsole);
  let appErrors = 0;
  page.on("pageerror", () => {
    appErrors += 1;
  });
  await page.evaluate(async () => {
    const steps = 12;
    const maxY = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    for (let i = 0; i <= steps; i++) {
      window.scrollTo(0, Math.round((maxY * i) / steps));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
  const overflowX = await page.evaluate(() => {
    const d = document.documentElement;
    const b = document.body;
    return (
      (d && d.scrollWidth > d.clientWidth + 1) || (b && b.scrollWidth > b.clientWidth + 1)
    );
  });
  return {
    pass: consoleErrors.length === 0 && appErrors === 0 && !overflowX,
    consoleErrorsCount: consoleErrors.length,
    appErrorsCount: appErrors,
    overflowX,
  };
}

async function runBrowserSuite(browserType, name) {
  const browser = await browserType.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installClsObserver(context);
  const page = await context.newPage();
  const fails = [];
  let reload = null;
  let sections = null;
  let scroll = null;
  try {
    reload = await runReloadClsGuard(page);
    if (!reload.pass) {
      fails.push(name + ": reload cls=" + reload.cls + " overflowX=" + reload.overflowX);
    }
    sections = await runSectionSwitchGuard(page);
    if (!sections.pass) {
      fails.push(name + ": section switch failed " + JSON.stringify(sections.results));
    }
    scroll = await runScrollGuard(page);
    if (!scroll.pass) {
      fails.push(
        name +
          ": scroll consoleErrors=" +
          scroll.consoleErrorsCount +
          " appErrors=" +
          scroll.appErrorsCount +
          " overflowX=" +
          scroll.overflowX
      );
    }
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
  return { name, fails, reload, sections, scroll };
}

const BROWSERS_ALL = process.env.IU_STABILITY_GUARD_BROWSERS === "all";

async function main() {
  const server = spawn(process.execPath, [path.join(REPO, "server", "projects-static-and-vin.mjs")], {
    cwd: REPO,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await waitForPort("127.0.0.1", PORT, 30000);

  const suites = [];
  const allFails = [];
  const skipped = [];
  try {
    suites.push(await runBrowserSuite(chromium, "chromium"));
    if (BROWSERS_ALL) {
      try {
        suites.push(await runBrowserSuite(webkit, "webkit"));
      } catch (e) {
        skipped.push("webkit: " + (e && e.message ? e.message : e));
      }
      try {
        suites.push(await runBrowserSuite(firefox, "firefox"));
      } catch (e) {
        skipped.push("firefox: " + (e && e.message ? e.message : e));
      }
    }
    for (const s of suites) {
      allFails.push(...s.fails);
    }
    console.log(JSON.stringify({ suites, skipped }, null, 2));
    if (allFails.length) {
      console.error("FAIL");
      for (const f of allFails) console.error(f);
      process.exitCode = 1;
    } else {
      console.log("PASS");
    }
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
