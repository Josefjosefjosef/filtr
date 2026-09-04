#!/usr/bin/env node
/**
 * PC (â‰Ą901px): opened article shows green read checkmark under relative time.
 * Also covers mobile/tablet 22px gap + return scroll/section (PR #7498).
 * Run: npm run iu-desktop-article-read-mark-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-desktop-article-read-mark-guard
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
import { exitIfMediaArticlesGuardsSkipped } from "./media-articles-cutover-skip.mjs";
import {
  installProofGuardNetworkStubs,
  createIgnorableResourceTracker,
  installLocalDataProtectionAccepted,
} from "./proofs/open_meteo_guard_stub.cjs";
import { ensureGuardLocalDataProtection } from "./guards/desktop-nav-targets.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(REPO, "package.json"));
const { chromium } = require("playwright");

const PORT = parseInt(process.env.IU_GUARD_PORT || "8906", 10);
const BASE = process.env.IU_GUARD_BASE_URL
  ? String(process.env.IU_GUARD_BASE_URL).replace(/\/?$/, "/")
  : `http://127.0.0.1:${PORT}/projects/`;
const USE_LOCAL_SERVER = !process.env.IU_GUARD_BASE_URL;
const READ_KEY = "iuReadArticles_v1";

function isProdHost(base) {
  return /infouzel\.cz/i.test(base);
}

function waitForPort(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      /* GET: some static servers answer slowly / oddly on HEAD under CI load. */
      const req = http.request({ host, port, path: "/projects/", method: "GET", timeout: 2000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("timeout", () => {
        try { req.destroy(); } catch {}
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 200);
      });
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("server not up"));
        else setTimeout(tryOnce, 200);
      });
      req.end();
    };
    tryOnce();
  });
}

function buildUrl(params) {
  const isLocal = BASE.indexOf("127.0.0.1") >= 0 || BASE.indexOf("localhost") >= 0;
  const p = new URLSearchParams(params || {});
  if (isLocal) p.set("iuRobust", "1");
  if (isProdHost(BASE)) p.set("nosw", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
}

async function installFeedTitleClickGuard(page) {
  await page.evaluate(() => {
    if (window.__iuGuardFeedTitleClickGuard) return;
    window.__iuGuardFeedTitleClickGuard = 1;
    document.addEventListener(
      "click",
      (e) => {
        const t = e.target;
        const el = t && t.nodeType === 3 && t.parentElement ? t.parentElement : t;
        if (!el || typeof el.closest !== "function") return;
        const a = el.closest("#feed a.news-titleLink");
        if (a) e.preventDefault();
      },
      true
    );
  });
}
async function waitFeedArticles(page, timeoutMs) {
  await page.waitForFunction(
    () => {
      const feed = document.getElementById("feed");
      if (!feed) return false;
      const ready = String(feed.getAttribute("data-feed-ready") || "") === "true";
      const count = feed.querySelectorAll("article.iuTimelineItem[data-feed-type='article']").length;
      return ready && count > 0;
    },
    { timeout: timeoutMs }
  );
}

async function findUnreadArticle(page) {
  return page.evaluate(() => {
    const arts = document.getElementById("feed").querySelectorAll("article.iuTimelineItem[data-feed-type='article']");
    for (let i = 0; i < arts.length; i++) {
      const art = arts[i];
      if (art.querySelector(".iuTimelineReadMark")) continue;
      const id = String(art.getAttribute("data-iu-article-id") || "").trim();
      if (!id) continue;
      return { id, index: i };
    }
    return null;
  });
}

async function readArticleState(page, articleId) {
  return page.evaluate((id) => {
    const arts = document.getElementById("feed").querySelectorAll('article.iuTimelineItem[data-feed-type="article"]');
    let art = null;
    for (let i = 0; i < arts.length; i++) {
      if (String(arts[i].getAttribute("data-iu-article-id") || "").trim() === id) {
        art = arts[i];
        break;
      }
    }
    const mark = art ? art.querySelector(".iuTimelineReadMark") : null;
    const clock = art ? art.querySelector(".iuTimelineClock") : null;
    let stored = false;
    try {
      const raw = localStorage.getItem("iuReadArticles_v1");
      const list = raw ? JSON.parse(raw) : [];
      stored = Array.isArray(list) && list.indexOf(id) >= 0;
    } catch (_) {}
    const cs = mark ? getComputedStyle(mark) : null;
    const rect = mark ? mark.getBoundingClientRect() : null;
    const clockRect = clock ? clock.getBoundingClientRect() : null;
    const markVisible =
      !!mark &&
      mark.textContent.trim() === "âś“" &&
      !!cs &&
      cs.display !== "none" &&
      cs.visibility !== "hidden" &&
      parseFloat(cs.opacity) > 0 &&
      !!rect &&
      rect.width > 0 &&
      rect.height > 0;
    const markUnderTime =
      !!rect &&
      !!clockRect &&
      rect.top >= clockRect.bottom - 1 &&
      rect.left <= clockRect.right + 2;
    return {
      hasArt: !!art,
      hasReadClass: !!(art && art.classList.contains("iuTimelineItem--read")),
      markVisible,
      markUnderTime,
      stored,
    };
  }, articleId);
}

async function markFirstUnreadArticleByTitleClick(page) {
  return page.evaluate(() => {
    const arts = document.getElementById("feed").querySelectorAll("article.iuTimelineItem[data-feed-type='article']");
    for (let i = 0; i < arts.length; i++) {
      const art = arts[i];
      if (art.querySelector(".iuTimelineReadMark")) continue;
      const articleId = String(art.getAttribute("data-iu-article-id") || "").trim();
      if (!articleId) continue;
      const link = art.querySelector(".news-titleLink");
      if (!link) continue;
      link.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, cancelable: true, view: window, composed: true })
      );
      return articleId;
    }
    return null;
  });
}

async function testDesktopReadMark(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await ensureGuardLocalDataProtection(page);
  await installFeedTitleClickGuard(page);
  await waitFeedArticles(page, 90000);
  const articleId = await markFirstUnreadArticleByTitleClick(page);
  if (!articleId) throw new Error("desktop: no unread article found");
  const st = await readArticleState(page, articleId);
  if (!st.hasArt) throw new Error("desktop: article node missing after click");
  if (!st.markVisible) throw new Error("desktop: green read mark not visible");
  if (!st.markUnderTime) throw new Error("desktop: read mark not under article time");
  if (!st.hasReadClass) throw new Error("desktop: iuTimelineItem--read class missing");
  if (!st.stored) throw new Error("desktop: article id not stored in localStorage");
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await waitFeedArticles(page, 90000);
  const afterReload = await readArticleState(page, articleId);
  if (!afterReload.markVisible) throw new Error("desktop: read mark missing after reload");
  return "desktop-read-mark";
}

async function testDesktopSaveDoesNotMark(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await ensureGuardLocalDataProtection(page);
  await installFeedTitleClickGuard(page);
  await waitFeedArticles(page, 90000);
  const target = await findUnreadArticle(page);
  if (!target) throw new Error("desktop-save: no unread article found");
  const saveBtn = page
    .locator('article.iuTimelineItem[data-feed-type="article"]')
    .nth(target.index)
    .locator('.iuTimelineAction[data-iu-action="save"]');
  await saveBtn.click({ force: true, timeout: 30000 });
  await page.waitForTimeout(200);
  const st = await readArticleState(page, target.id);
  if (st.markVisible) throw new Error("desktop-save: save click falsely marked article read");
  return "desktop-save-no-mark";
}

async function testMobileReadMarkRegression(page) {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(buildUrl({ section: "media", topic: "zpravy" }), { waitUntil: "domcontentloaded", timeout: 120000 });
  await ensureGuardLocalDataProtection(page);
  await installFeedTitleClickGuard(page);
  await waitFeedArticles(page, 90000);
  const articleId = await markFirstUnreadArticleByTitleClick(page);
  if (!articleId) throw new Error("mobile: no unread article found");
  const result = await readArticleState(page, articleId);
  if (!result.hasReadClass) throw new Error("mobile regression: iuTimelineItem--read missing");
  if (!result.markVisible) throw new Error("mobile regression: read mark not visible");
  if (!result.stored) throw new Error("mobile regression: article id not stored");
  return "mobile-read-mark";
}

async function measureArticleGapPx(page) {
  return page.evaluate(() => {
    const feed = document.getElementById("feed");
    if (!feed) return null;
    const arts = feed.querySelectorAll("article.iuTimelineItem[data-feed-type='article']");
    if (arts.length < 2) return null;
    const mt = parseFloat(getComputedStyle(arts[1]).marginTop);
    if (!Number.isFinite(mt)) return null;
    return Math.round(mt);
  });
}

async function testMobileArticleGap22(page) {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(buildUrl({ section: "media", topic: "zpravy" }), { waitUntil: "domcontentloaded", timeout: 120000 });
  await ensureGuardLocalDataProtection(page);
  await waitFeedArticles(page, 90000);
  const gap = await measureArticleGapPx(page);
  if (gap == null) throw new Error("mobile-gap: fewer than 2 articles");
  if (Math.abs(gap - 22) > 1) throw new Error("mobile-gap: expected 22px got " + gap);
  return "mobile-gap-22";
}

async function testTabletArticleGap22(page) {
  await page.setViewportSize({ width: 960, height: 900 });
  await page.goto(buildUrl({ section: "media", topic: "zpravy" }), { waitUntil: "domcontentloaded", timeout: 120000 });
  await ensureGuardLocalDataProtection(page);
  await waitFeedArticles(page, 90000);
  const gap = await measureArticleGapPx(page);
  if (gap == null) throw new Error("tablet-gap: fewer than 2 articles");
  if (Math.abs(gap - 22) > 1) throw new Error("tablet-gap: expected 22px got " + gap);
  return "tablet-gap-22";
}

async function testDesktopArticleGapUnchanged(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl({ section: "media", topic: "zpravy" }), { waitUntil: "domcontentloaded", timeout: 120000 });
  await ensureGuardLocalDataProtection(page);
  await waitFeedArticles(page, 90000);
  const gap = await measureArticleGapPx(page);
  if (gap == null) throw new Error("desktop-gap: fewer than 2 articles");
  if (Math.abs(gap - 0) > 1) throw new Error("desktop-gap: expected unchanged 0px sibling margin got " + gap);
  return "desktop-gap-unchanged";
}

async function testReturnKeepsScrollAndSection(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const url = buildUrl({ section: "media", topic: "zpravy" });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await ensureGuardLocalDataProtection(page);
  await waitFeedArticles(page, 90000);
  await page.evaluate(() => {
    window.scrollTo(0, 900);
    if (typeof window.iuScrollRestoreSaveNow === "function") window.iuScrollRestoreSaveNow();
  });
  const before = await page.evaluate(() => ({
    y: Math.round(window.scrollY || 0),
    section: new URLSearchParams(location.search).get("section"),
    count: document.querySelectorAll("#feed article.iuTimelineItem[data-feed-type='article']").length,
  }));
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    if (typeof window.iuScrollRestoreRequest === "function") window.iuScrollRestoreRequest();
  });
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({
    y: Math.round(window.scrollY || 0),
    section: new URLSearchParams(location.search).get("section"),
    count: document.querySelectorAll("#feed article.iuTimelineItem[data-feed-type='article']").length,
  }));
  if (after.section !== before.section) throw new Error("return: section changed");
  if (after.count < before.count) throw new Error("return: article count dropped");
  if (Math.abs(after.y - before.y) > 24) throw new Error("return: scroll position lost");
  return "return-scroll-section";
}

async function main() {
  exitIfMediaArticlesGuardsSkipped("iu-desktop-article-read-mark-guard-v1");
  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    const serverScript = path.join(REPO, "server", "projects-static.mjs");
    serverProc = spawn(process.execPath, [serverScript], {
      cwd: REPO,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let serverErr = "";
    serverProc.stderr.on("data", (c) => {
      serverErr += String(c);
    });
    serverProc.on("exit", (code) => {
      if (code && code !== 0 && !serverErr) serverErr = `static server exit ${code}`;
    });
    try {
      await waitForPort("127.0.0.1", PORT, 90000);
    } catch (err) {
      if (serverErr) console.error(serverErr.trim());
      throw err;
    }
  }

  const ignorable = createIgnorableResourceTracker();
  const browser = await chromium.launch({ headless: true });
  const passes = [];
  const failures = [];

  try {
    for (const fn of [
      testDesktopReadMark,
      testDesktopSaveDoesNotMark,
      testMobileReadMarkRegression,
      testMobileArticleGap22,
      testTabletArticleGap22,
      testDesktopArticleGapUnchanged,
      testReturnKeepsScrollAndSection,
    ]) {
      const ctx = await browser.newContext();
      await installProofGuardNetworkStubs(ctx, ignorable);
      await installLocalDataProtectionAccepted(ctx);
      const testPage = await ctx.newPage();
      try {
        passes.push(await fn(testPage));
      } catch (err) {
        failures.push((err && err.message ? err.message : String(err)) || "unknown");
      } finally {
        await ctx.close().catch(() => {});
      }
    }
  } finally {
    await browser.close().catch(() => {});
    if (serverProc) serverProc.kill("SIGTERM");
  }

  console.log(
    JSON.stringify(
      {
        pass: failures.length === 0,
        base: BASE,
        readKey: READ_KEY,
        passes,
        failures,
      },
      null,
      2
    )
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
