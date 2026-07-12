#!/usr/bin/env node
/**
 * PC (≥901px): opened article shows green read checkmark under relative time.
 * Run: npm run iu-desktop-article-read-mark-guard
 * Prod: IU_GUARD_BASE_URL=https://infouzel.cz/projects/ npm run iu-desktop-article-read-mark-guard
 */
import { createRequire } from "module";
import path from "path";
import { spawn } from "child_process";
import http from "http";
import { fileURLToPath } from "url";
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

function buildUrl(params) {
  const isLocal = BASE.indexOf("127.0.0.1") >= 0 || BASE.indexOf("localhost") >= 0;
  const p = new URLSearchParams(params || {});
  if (isLocal) p.set("iuRobust", "1");
  if (isProdHost(BASE)) p.set("nosw", "1");
  const qs = p.toString();
  return qs ? BASE + (BASE.includes("?") ? "&" : "?") + qs : BASE;
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
    const arts = document.querySelectorAll("article.iuTimelineItem[data-feed-type='article']");
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
    const art = document.querySelector(
      'article.iuTimelineItem[data-feed-type="article"][data-iu-article-id="' + id + '"]'
    );
    const mark = art ? art.querySelector(".iuTimelineReadMark") : null;
    let stored = false;
    try {
      const raw = localStorage.getItem("iuReadArticles_v1");
      const list = raw ? JSON.parse(raw) : [];
      stored = Array.isArray(list) && list.indexOf(id) >= 0;
    } catch (_) {}
    const cs = mark ? getComputedStyle(mark) : null;
    const rect = mark ? mark.getBoundingClientRect() : null;
    const markVisible =
      !!mark &&
      mark.textContent.trim() === "✓" &&
      !!cs &&
      cs.display !== "none" &&
      cs.visibility !== "hidden" &&
      parseFloat(cs.opacity) > 0 &&
      !!rect &&
      rect.width > 0 &&
      rect.height > 0;
    return {
      hasArt: !!art,
      hasReadClass: !!(art && art.classList.contains("iuTimelineItem--read")),
      markVisible,
      stored,
    };
  }, articleId);
}

async function markFirstUnreadArticleByTitleClick(page) {
  const id = await page.evaluate(() => {
    const arts = document.querySelectorAll("article.iuTimelineItem[data-feed-type='article']");
    for (let i = 0; i < arts.length; i++) {
      const art = arts[i];
      if (art.querySelector(".iuTimelineReadMark")) continue;
      const articleId = String(art.getAttribute("data-iu-article-id") || "").trim();
      if (!articleId) continue;
      const link = art.querySelector(".news-titleLink");
      if (!link) continue;
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return articleId;
    }
    return null;
  });
  if (!id) return null;
  return id;
}

async function testDesktopReadMark(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await ensureGuardLocalDataProtection(page);
  await waitFeedArticles(page, 90000);
  const articleId = await markFirstUnreadArticleByTitleClick(page);
  if (!articleId) throw new Error("desktop: no unread article found");
  await page.waitForTimeout(300);
  const st = await readArticleState(page, articleId);
  if (!st.hasArt) throw new Error("desktop: article node missing after click");
  if (!st.markVisible) throw new Error("desktop: green read mark not visible");
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
  await page.goto(buildUrl(), { waitUntil: "domcontentloaded", timeout: 120000 });
  await ensureGuardLocalDataProtection(page);
  await waitFeedArticles(page, 90000);
  const result = await page.evaluate(() => {
    const arts = document.querySelectorAll("article.iuTimelineItem[data-feed-type='article']");
    for (let i = 0; i < arts.length; i++) {
      const art = arts[i];
      if (art.querySelector(".iuTimelineReadMark")) continue;
      const articleId = String(art.getAttribute("data-iu-article-id") || "").trim();
      if (!articleId) continue;
      const link = art.querySelector(".news-titleLink");
      if (!link) continue;
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      const artAfter = document.querySelector(
        'article.iuTimelineItem[data-feed-type="article"][data-iu-article-id="' + articleId + '"]'
      );
      const mark = artAfter ? artAfter.querySelector(".iuTimelineReadMark") : null;
      const cs = mark ? getComputedStyle(mark) : null;
      let stored = false;
      try {
        const raw = localStorage.getItem("iuReadArticles_v1");
        const list = raw ? JSON.parse(raw) : [];
        stored = Array.isArray(list) && list.indexOf(articleId) >= 0;
      } catch (_) {}
      return {
        articleId,
        hasReadClass: !!(artAfter && artAfter.classList.contains("iuTimelineItem--read")),
        hasMark: !!mark,
        markDisplay: cs ? cs.display : null,
        stored,
      };
    }
    return { error: "no unread article" };
  });
  if (result.error) throw new Error("mobile: " + result.error);
  if (!result.hasReadClass) throw new Error("mobile regression: iuTimelineItem--read missing");
  if (!result.hasMark) throw new Error("mobile regression: read mark node missing");
  if (result.markDisplay === "none") throw new Error("mobile regression: read mark display none");
  if (!result.stored) throw new Error("mobile regression: article id not stored");
  return "mobile-read-mark";
}

async function main() {
  let serverProc = null;
  if (USE_LOCAL_SERVER) {
    serverProc = spawn("npx", ["serve", REPO, "-l", String(PORT)], {
      cwd: REPO,
      stdio: "ignore",
      shell: true,
    });
    await waitForPort("127.0.0.1", PORT, 45000);
  }

  const ignorable = createIgnorableResourceTracker();
  const browser = await chromium.launch({ headless: true });
  const passes = [];
  const failures = [];

  try {
    for (const fn of [testDesktopReadMark, testDesktopSaveDoesNotMark, testMobileReadMarkRegression]) {
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
