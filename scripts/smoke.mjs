#!/usr/bin/env node
/**
 * Smoke test for infoUzel — catches SEV1 scope crashe before merge.
 * Runs against local static server.
 * FAIL on: ReferenceError/TypeError, pageerror, unhandledrejection, broken nav click, route reset.
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PORT = 8080;
const BASE = `http://127.0.0.1:${PORT}`;

/** Preview cards mount async after app init + Silver tall shell; CI runners need headroom (not a weaker assertion). */
const PREVIEW_SELECTOR_TIMEOUT_MS = 30000;
/** Root `index.html` → `/projects/` redirect must settle before the next navigation (avoid racing `?section=media`). */
const ROOT_REDIRECT_TIMEOUT_MS = 20000;
/** `page.goto` — large `app.js` / client nav can delay `domcontentloaded` on cold runs (match preview-tier headroom). */
const GOTO_DOM_CONTENT_LOADED_TIMEOUT_MS = 30000;

let server = null;
let failed = false;
const errors = [];

function fail(msg) {
  failed = true;
  errors.push(msg);
  console.error("[SMOKE FAIL]", msg);
}

// Minimal static server (0 extra deps)
function serveFile(urlPath) {
  let filePath = path.join(ROOT, (urlPath === "/" || urlPath === "") ? "index.html" : urlPath.replace(/^\//, "").replace(/\/$/, "") || "index.html");
  if (urlPath && urlPath !== "/" && !urlPath.startsWith("/projects")) {
    const lastSeg = (urlPath.split("?")[0] || "").split("/").filter(Boolean).pop() || "";
    if (!path.extname(lastSeg)) {
      const p = path.join(ROOT, urlPath.replace(/^\//, "").split("/")[0]);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) filePath = path.join(p, "index.html");
    }
  }
  if (!path.resolve(filePath).startsWith(path.resolve(ROOT)) && !filePath.includes(ROOT)) return null;
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] || "/";
      const data = serveFile(urlPath);
      if (data) {
        const ext = path.extname(urlPath);
        const ct = ext === ".css" ? "text/css" : ext === ".js" ? "application/javascript" : ext === ".json" ? "application/json" : ext === ".ico" ? "image/x-icon" : "text/html";
        res.writeHead(200, { "Content-Type": ct });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve());
  });
}

/** Projects global hub: wait for Silver tall viewport (mount targets exist) before preview assertions. */
async function gotoProjectsMediaForSmoke(page) {
  await gotoDomContentLoaded(page, `${BASE}/projects/?section=media`);
  // Locator re-resolves after DOM swaps; page.waitForSelector can time out when the same id is
  // detach/replaced during Silver shell paint — CI logs showed "visible" + 20s timeout on #iuSilverTallScrollViewport.
  const tallViewport = page.locator("#iuSilverTallScrollViewport").first();
  await tallViewport.waitFor({ state: "visible", timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
  await page.waitForFunction(
    () => {
      const el = document.getElementById("iuSilverTallScrollViewport");
      if (!el || !document.documentElement.contains(el)) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 2 && r.height >= 2;
    },
    { timeout: 10000 }
  );
  await page.waitForTimeout(600);
}

/** Retries when client navigation races domcontentloaded (same-URL interrupt can recur on the retry goto). */
async function gotoDomContentLoaded(page, url) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await page.goto(url, { waitUntil: "domcontentloaded", timeout: GOTO_DOM_CONTENT_LOADED_TIMEOUT_MS });
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message ? e.message : e);
      if (/interrupted/i.test(msg)) {
        await page.waitForTimeout(500 + attempt * 200);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function runSmoke() {
  const { chromium } = await import("playwright");

  await startServer();

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();

    page.on("pageerror", (err) => {
      fail(`pageerror: ${err.message}`);
    });

    page.on("console", (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === "error") {
        if (/\/favicon\.ico/.test(text)) return; // whitelist: ignore favicon 404
        if (/ReferenceError|TypeError/.test(text)) fail(`console error: ${text}`);
        if (/app\.js|app\.css|\.json/.test(text) && !/i\.ytimg\.com|thumbnail/.test(text)) {
          fail(`console error (our asset): ${text}`);
        }
      }
    });

    const urls = [
      `${BASE}/`,
      `${BASE}/projects/?section=media`,
      `${BASE}/projects/?debug=1`,
    ];

    for (const url of urls) {
      const res = await gotoDomContentLoaded(page, url);
      // Playwright may return null when navigation commits without a main-frame Response (client redirect / race).
      const st = res ? res.status() : null;
      if (st !== null && st >= 400) fail(`HTTP ${st} for ${url}`);
      // Root index.html runs location.replace("/projects/") after parse; domcontentloaded can return
      // before that navigation commits — next goto would race and interrupt (?section=media) with /projects/.
      if (url === `${BASE}/`) {
        try {
          await page.waitForURL((u) => u.pathname.includes("/projects"), { timeout: ROOT_REDIRECT_TIMEOUT_MS });
        } catch (e) {
          fail(`Root redirect did not settle on /projects/: ${e && e.message ? e.message : String(e)}`);
        }
      }
      await page.waitForTimeout(500);
    }

    // Click test on /projects/?section=media
    await gotoProjectsMediaForSmoke(page);

    try {
      await page.waitForSelector('[data-iu-news-preview-card="1"]', { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    } catch (e) {
      fail(`News preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    try {
      await page.waitForSelector('[data-iu-sport-preview-card="1"]', { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    } catch (e) {
      fail(`Sport preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    const newsSportBadgeProbe = await page.evaluate(() => {
      const news = document.querySelector('[data-iu-news-preview-card="1"]');
      const sport = document.querySelector('[data-iu-sport-preview-card="1"]');
      if (!news || !sport) return { ok: false, reason: "missing_card" };
      const nb = news.querySelector("[data-iu-news-preview-badge]");
      const sb = sport.querySelector("[data-iu-sport-preview-live]");
      if (!nb || String(nb.textContent || "").trim() !== "Zprávy") {
        return { ok: false, reason: "news_badge", t: nb ? String(nb.textContent || "").trim() : "" };
      }
      if (!sb || String(sb.textContent || "").trim() !== "Sport") {
        return { ok: false, reason: "sport_badge", t: sb ? String(sb.textContent || "").trim() : "" };
      }
      if (String(nb.textContent || "").indexOf("NOVÉ") >= 0) return { ok: false, reason: "nové_in_badge" };
      if (String(sb.textContent || "").indexOf("LIVE") >= 0) return { ok: false, reason: "live_in_badge" };
      return { ok: true };
    });
    if (!newsSportBadgeProbe || !newsSportBadgeProbe.ok) {
      fail(`News/Sport first-row badge regression: ${JSON.stringify(newsSportBadgeProbe)}`);
    }
    try {
      await page.waitForSelector("#iuFinancePreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    } catch (e) {
      fail(`Finance preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    try {
      await page.waitForSelector("#iuHealthPreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    } catch (e) {
      fail(`Health preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    const financeProbe = await page.evaluate(() => {
      const card = document.getElementById("iuFinancePreviewCard");
      if (!card) return { ok: false, reason: "no_card" };
      if (card.tagName !== "BUTTON" || card.getAttribute("type") !== "button") return { ok: false, reason: "not_button" };
      const nBad = card.querySelectorAll(".iuNewsPreviewBadge, .iuSportPreviewLiveBadge").length;
      if (nBad !== 0) return { ok: false, reason: "extra_badge", nBad };
      const badge = card.querySelector(".iu-previewBadge--finance");
      if (!badge || String(badge.textContent || "").trim() !== "Finance") return { ok: false, reason: "badge" };
      const img = document.getElementById("iuFinancePreviewImage");
      const src = img ? String(img.getAttribute("src") || "") : "";
      if (src.indexOf("finance-default.jpg") < 0) return { ok: false, reason: "img", src };
      const titles = document.getElementById("iuFinancePreviewTitles");
      if (!titles) return { ok: false, reason: "titles_host" };
      const slots = titles.querySelectorAll("[data-iu-finance-preview-title-1], [data-iu-finance-preview-title-2]");
      if (slots.length !== 2) return { ok: false, reason: "title_slots", n: slots.length };
      if (card.getAttribute("data-iu-finance-route") !== "finance") return { ok: false, reason: "route" };
      return { ok: true };
    });
    if (!financeProbe || !financeProbe.ok) {
      fail(`Finance preview regression: ${JSON.stringify(financeProbe)}`);
    }
    const healthProbe = await page.evaluate(() => {
      const card = document.getElementById("iuHealthPreviewCard");
      if (!card) return { ok: false, reason: "no_card" };
      if (card.tagName !== "BUTTON" || card.getAttribute("type") !== "button") return { ok: false, reason: "not_button" };
      const nBad = card.querySelectorAll(".iuNewsPreviewBadge, .iuSportPreviewLiveBadge").length;
      if (nBad !== 0) return { ok: false, reason: "extra_badge", nBad };
      const badge = card.querySelector(".iu-previewBadge--health");
      if (!badge || String(badge.textContent || "").trim() !== "Zdraví") return { ok: false, reason: "badge" };
      const img = document.getElementById("iuHealthPreviewImage");
      const src = img ? String(img.getAttribute("src") || "") : "";
      if (src.indexOf("zdravi-default.jpg") < 0) return { ok: false, reason: "img", src };
      const titles = document.getElementById("iuHealthPreviewTitles");
      if (!titles) return { ok: false, reason: "titles_host" };
      const slots = titles.querySelectorAll("[data-iu-health-preview-title-1], [data-iu-health-preview-title-2]");
      if (slots.length !== 2) return { ok: false, reason: "title_slots", n: slots.length };
      if (card.getAttribute("data-iu-health-route") !== "zdravi") return { ok: false, reason: "route" };
      return { ok: true };
    });
    if (!healthProbe || !healthProbe.ok) {
      fail(`Health preview regression: ${JSON.stringify(healthProbe)}`);
    }
    try {
      await page.waitForSelector("#iuTravelPreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    } catch (e) {
      fail(`Travel preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    const travelProbe = await page.evaluate(() => {
      const card = document.getElementById("iuTravelPreviewCard");
      if (!card) return { ok: false, reason: "no_card" };
      if (card.tagName !== "BUTTON" || card.getAttribute("type") !== "button") return { ok: false, reason: "not_button" };
      const nBad = card.querySelectorAll(".iuNewsPreviewBadge, .iuSportPreviewLiveBadge").length;
      if (nBad !== 0) return { ok: false, reason: "extra_badge", nBad };
      const badge = card.querySelector(".iu-previewBadge--travel");
      if (!badge || String(badge.textContent || "").trim() !== "Cestování") return { ok: false, reason: "badge" };
      const img = document.getElementById("iuTravelPreviewImage");
      const src = img ? String(img.getAttribute("src") || "") : "";
      if (src.indexOf("cestovani-default.jpg") < 0) return { ok: false, reason: "img", src };
      const titles = document.getElementById("iuTravelPreviewTitles");
      if (!titles) return { ok: false, reason: "titles_host" };
      const slots = titles.querySelectorAll("[data-iu-travel-preview-title-1], [data-iu-travel-preview-title-2]");
      if (slots.length !== 2) return { ok: false, reason: "title_slots", n: slots.length };
      if (card.getAttribute("data-iu-travel-preview-route") !== "cestovani") return { ok: false, reason: "route" };
      return { ok: true };
    });
    if (!travelProbe || !travelProbe.ok) {
      fail(`Travel preview regression: ${JSON.stringify(travelProbe)}`);
    }
    try {
      await page.waitForSelector("#iuGamesPreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    } catch (e) {
      fail(`Games preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    const gamesProbe = await page.evaluate(() => {
      const card = document.getElementById("iuGamesPreviewCard");
      if (!card) return { ok: false, reason: "no_card" };
      if (card.tagName !== "BUTTON" || card.getAttribute("type") !== "button") return { ok: false, reason: "not_button" };
      const nBad = card.querySelectorAll(".iuNewsPreviewBadge, .iuSportPreviewLiveBadge").length;
      if (nBad !== 0) return { ok: false, reason: "extra_badge", nBad };
      const badge = card.querySelector(".iu-previewBadge--games");
      if (!badge || String(badge.textContent || "").trim() !== "Hry") return { ok: false, reason: "badge" };
      const img = document.getElementById("iuGamesPreviewImage");
      const src = img ? String(img.getAttribute("src") || "") : "";
      if (src.indexOf("hry-default.jpg") < 0) return { ok: false, reason: "img", src };
      const titles = document.getElementById("iuGamesPreviewTitles");
      if (!titles) return { ok: false, reason: "titles_host" };
      const slots = titles.querySelectorAll("[data-iu-games-preview-title-1], [data-iu-games-preview-title-2]");
      if (slots.length !== 2) return { ok: false, reason: "title_slots", n: slots.length };
      if (card.getAttribute("data-iu-games-route") !== "hry") return { ok: false, reason: "route" };
      return { ok: true };
    });
    if (!gamesProbe || !gamesProbe.ok) {
      fail(`Games preview regression: ${JSON.stringify(gamesProbe)}`);
    }
    try {
      await page.waitForSelector("#iuCulturePreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    } catch (e) {
      fail(`Culture preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    const cultureProbe = await page.evaluate(() => {
      const card = document.getElementById("iuCulturePreviewCard");
      if (!card) return { ok: false, reason: "no_card" };
      if (card.tagName !== "BUTTON" || card.getAttribute("type") !== "button") return { ok: false, reason: "not_button" };
      const nBad = card.querySelectorAll(".iuNewsPreviewBadge, .iuSportPreviewLiveBadge").length;
      if (nBad !== 0) return { ok: false, reason: "extra_badge", nBad };
      const badge = card.querySelector(".iu-previewBadge--culture");
      if (!badge || String(badge.textContent || "").trim() !== "Kultura / Akce") return { ok: false, reason: "badge" };
      const img = document.getElementById("iuCulturePreviewImage");
      const src = img ? String(img.getAttribute("src") || "") : "";
      if (src.indexOf("culture-default.jpg") < 0) return { ok: false, reason: "img", src };
      const titles = document.getElementById("iuCulturePreviewTitles");
      if (!titles) return { ok: false, reason: "titles_host" };
      const slots = titles.querySelectorAll("[data-iu-culture-preview-title-1], [data-iu-culture-preview-title-2]");
      if (slots.length !== 2) return { ok: false, reason: "title_slots", n: slots.length };
      if (card.getAttribute("data-iu-culture-route") !== "kultura") return { ok: false, reason: "route" };
      return { ok: true };
    });
    if (!cultureProbe || !cultureProbe.ok) {
      fail(`Culture preview regression: ${JSON.stringify(cultureProbe)}`);
    }
    try {
      await page.waitForSelector("#iuScienceHistoryPreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    } catch (e) {
      fail(`Science-history preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    const scienceHistoryProbe = await page.evaluate(() => {
      const card = document.getElementById("iuScienceHistoryPreviewCard");
      if (!card) return { ok: false, reason: "no_card" };
      if (card.tagName !== "BUTTON" || card.getAttribute("type") !== "button") return { ok: false, reason: "not_button" };
      const nBad = card.querySelectorAll(".iuNewsPreviewBadge, .iuSportPreviewLiveBadge").length;
      if (nBad !== 0) return { ok: false, reason: "extra_badge", nBad };
      const badge = card.querySelector(".iu-previewBadge--science-history");
      if (!badge || String(badge.textContent || "").trim() !== "Věda & Historie") return { ok: false, reason: "badge" };
      const img = document.getElementById("iuScienceHistoryPreviewImage");
      const src = img ? String(img.getAttribute("src") || "") : "";
      if (src.indexOf("veda-default.jpg") < 0) return { ok: false, reason: "img", src };
      const titles = document.getElementById("iuScienceHistoryPreviewTitles");
      if (!titles) return { ok: false, reason: "titles_host" };
      const slots = titles.querySelectorAll("[data-iu-science-history-preview-title-1], [data-iu-science-history-preview-title-2]");
      if (slots.length !== 2) return { ok: false, reason: "title_slots", n: slots.length };
      if (card.getAttribute("data-iu-science-history-route") !== "veda") return { ok: false, reason: "route" };
      return { ok: true };
    });
    if (!scienceHistoryProbe || !scienceHistoryProbe.ok) {
      fail(`Science-history preview regression: ${JSON.stringify(scienceHistoryProbe)}`);
    }
    try {
      await page.waitForSelector("#iuEducationPreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    } catch (e) {
      fail(`Education preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    const educationProbe = await page.evaluate(() => {
      const card = document.getElementById("iuEducationPreviewCard");
      if (!card) return { ok: false, reason: "no_card" };
      if (card.tagName !== "BUTTON" || card.getAttribute("type") !== "button") return { ok: false, reason: "not_button" };
      const nBad = card.querySelectorAll(".iuNewsPreviewBadge, .iuSportPreviewLiveBadge").length;
      if (nBad !== 0) return { ok: false, reason: "extra_badge", nBad };
      const badge = card.querySelector(".iu-previewBadge--education");
      if (!badge || String(badge.textContent || "").trim() !== "Vzdělávání") return { ok: false, reason: "badge" };
      const img = document.getElementById("iuEducationPreviewImage");
      const src = img ? String(img.getAttribute("src") || "") : "";
      if (src.indexOf("vzdelavani-default.jpg") < 0) return { ok: false, reason: "img", src };
      const titles = document.getElementById("iuEducationPreviewTitles");
      if (!titles) return { ok: false, reason: "titles_host" };
      const slots = titles.querySelectorAll("[data-iu-education-preview-title-1], [data-iu-education-preview-title-2]");
      if (slots.length !== 2) return { ok: false, reason: "title_slots", n: slots.length };
      if (card.getAttribute("data-iu-education-route") !== "vzdelavani") return { ok: false, reason: "route" };
      return { ok: true };
    });
    if (!educationProbe || !educationProbe.ok) {
      fail(`Education preview regression: ${JSON.stringify(educationProbe)}`);
    }

    // Počasí historical inline video must teardown (no background audio) when leaving the section
    await gotoDomContentLoaded(page, `${BASE}/projects/?section=pocasi`);
    await page.waitForFunction(
      () => document.body && document.body.dataset && document.body.dataset.section === "pocasi",
      { timeout: PREVIEW_SELECTOR_TIMEOUT_MS }
    );
    await page.evaluate(async () => {
      try {
        if (typeof window.iuWeatherLoadAndRender === "function") {
          await window.iuWeatherLoadAndRender();
        }
      } catch (_w) {}
      try {
        if (typeof window.iuInitWeatherHistory === "function") {
          window.iuInitWeatherHistory();
        }
      } catch (_h) {}
    });
    try {
      await page.waitForFunction(
        () => {
          const btn = document.getElementById("iuWeatherHistoryPlay");
          const card = document.getElementById("iuWeatherHistoryCard");
          const fb = document.getElementById("iuWeatherHistoryFallback");
          if (btn && card && !card.hidden) return true;
          if (fb && !fb.hidden) return true;
          return false;
        },
        { timeout: 45000 }
      );
    } catch (e) {
      const wxDiag = await page.evaluate(() => {
        const btn = document.getElementById("iuWeatherHistoryPlay");
        const card = document.getElementById("iuWeatherHistoryCard");
        const fb = document.getElementById("iuWeatherHistoryFallback");
        return {
          section: (document.body && document.body.dataset && document.body.dataset.section) || "",
          hasBtn: !!btn,
          cardHidden: card ? !!card.hidden : null,
          fallbackHidden: fb ? !!fb.hidden : null,
          initFlag: typeof window.__iu_weatherHistoryInit !== "undefined" ? window.__iu_weatherHistoryInit : null,
        };
      });
      fail(
        `Weather history card not ready for play: ${e && e.message ? e.message : String(e)} diag=${JSON.stringify(wxDiag)}`
      );
    }
    const wxCardReady = await page.evaluate(() => {
      const card = document.getElementById("iuWeatherHistoryCard");
      return !!(card && !card.hidden);
    });
    if (!wxCardReady) {
      fail("Weather history card hidden after init (dataset or history load unavailable in smoke)");
    }
    await page.click("#iuWeatherHistoryPlay");
    await page.waitForTimeout(900);
    try {
      await page.waitForSelector("#iuWeatherHistoryPlayerHost iframe.iuVideoIframe", { timeout: 20000 });
    } catch (e) {
      fail(`Weather inline iframe missing after play: ${e && e.message ? e.message : String(e)}`);
    }
    await page.click('.iu-leftNavItem[data-accent="media"][data-media-topic="all"]');
    await page.waitForTimeout(900);
    const wxAutopauseProbe = await page.evaluate(() => {
      const wv = document.getElementById("iuWeatherView");
      if (!wv) return { ok: false, reason: "no_weather_view" };
      const ifr = wv.querySelector("#iuWeatherHistoryPlayerHost iframe, .iu-weather-video-embed-host iframe");
      const host = document.getElementById("iuWeatherHistoryPlayerHost");
      const kids = host && typeof host.childElementCount === "number" ? host.childElementCount : -1;
      const src = ifr && ifr.getAttribute ? String(ifr.getAttribute("src") || "") : "";
      return { ok: !ifr && kids === 0, hasIframe: !!ifr, hostKids: kids, srcLen: src.length };
    });
    if (!wxAutopauseProbe || !wxAutopauseProbe.ok) {
      fail(`Weather video autopause regression: ${JSON.stringify(wxAutopauseProbe)}`);
    }

    await page.click("#iuFinancePreviewCard");
    await page.waitForTimeout(500);
    const afterFinanceClick = page.url();
    if (afterFinanceClick.indexOf("topic=finance") === -1) {
      fail(`Finance preview click did not set topic=finance: ${afterFinanceClick}`);
    }

    await gotoProjectsMediaForSmoke(page);
    await page.waitForSelector("#iuHealthPreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    await page.click("#iuHealthPreviewCard");
    await page.waitForTimeout(500);
    const afterHealthClick = page.url();
    if (afterHealthClick.indexOf("topic=zdravi") === -1) {
      fail(`Health preview click did not set topic=zdravi: ${afterHealthClick}`);
    }

    await gotoProjectsMediaForSmoke(page);
    await page.waitForSelector("#iuTravelPreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    await page.click("#iuTravelPreviewCard");
    await page.waitForTimeout(500);
    const afterTravelClick = page.url();
    if (afterTravelClick.indexOf("section=travel") === -1 || afterTravelClick.indexOf("mode=media") === -1) {
      fail(`Travel preview click did not set section=travel&mode=media: ${afterTravelClick}`);
    }

    await gotoProjectsMediaForSmoke(page);
    await page.waitForSelector("#iuGamesPreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    await page.click("#iuGamesPreviewCard");
    await page.waitForTimeout(500);
    const afterGamesClick = page.url();
    if (afterGamesClick.indexOf("section=hry") === -1) {
      fail(`Games preview click did not set section=hry: ${afterGamesClick}`);
    }

    await gotoProjectsMediaForSmoke(page);
    await page.waitForSelector("#iuCulturePreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    await page.click("#iuCulturePreviewCard");
    await page.waitForTimeout(500);
    const afterCultureClick = page.url();
    if (afterCultureClick.indexOf("section=kultura") === -1) {
      fail(`Culture preview click did not set section=kultura: ${afterCultureClick}`);
    }

    await gotoProjectsMediaForSmoke(page);
    await page.waitForSelector("#iuScienceHistoryPreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    await page.click("#iuScienceHistoryPreviewCard");
    await page.waitForTimeout(500);
    const afterScienceHistoryClick = page.url();
    if (afterScienceHistoryClick.indexOf("section=veda") === -1) {
      fail(`Science-history preview click did not set section=veda: ${afterScienceHistoryClick}`);
    }

    await gotoProjectsMediaForSmoke(page);
    await page.waitForSelector("#iuEducationPreviewCard", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    await page.click("#iuEducationPreviewCard");
    await page.waitForTimeout(500);
    const afterEducationClick = page.url();
    if (afterEducationClick.indexOf("section=vzdelavani") === -1) {
      fail(`Education preview click did not set section=vzdelavani: ${afterEducationClick}`);
    }

    await gotoProjectsMediaForSmoke(page);
    try {
      await page.waitForSelector("#iuSilverParcelWatchInput", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    } catch (e) {
      fail(`Silver parcel watch input missing: ${e && e.message ? e.message : String(e)}`);
    }
    await page.waitForFunction(
      () => !!(window.IU_SILVER_PARCEL_FACADE && window.IU_PARCEL_TRACKING_ENGINE),
      { timeout: 15000 }
    );
    await page.evaluate(() => {
      try {
        localStorage.removeItem("iu_silver_parcel_watch_v1");
      } catch (_) {}
    });
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const inp = document.getElementById("iuSilverParcelWatchInput");
      if (inp) {
        inp.value = "";
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await page.waitForTimeout(120);
    const mainSaveEmpty = await page.evaluate(() => {
      const b = document.getElementById("iuSilverParcelWatchSave");
      const inp = document.getElementById("iuSilverParcelWatchInput");
      return {
        disabled: !!(b && b.disabled),
        active: !!(b && b.classList.contains("iuSilverParcelWatch__mainSave--active")),
        fs: inp ? parseFloat(getComputedStyle(inp).fontSize) || 0 : 0,
      };
    });
    if (!mainSaveEmpty.disabled || mainSaveEmpty.active) {
      fail(`Silver parcel main save: must be disabled when empty (390): ${JSON.stringify(mainSaveEmpty)}`);
    }
    if (mainSaveEmpty.fs < 16) {
      fail(`Silver parcel main input font-size must be >=16px, got ${mainSaveEmpty.fs}`);
    }
    await page.fill("#iuSilverParcelWatchInput", "   ");
    await page.waitForTimeout(120);
    const mainSaveSpaces = await page.evaluate(() => {
      const b = document.getElementById("iuSilverParcelWatchSave");
      return {
        disabled: !!(b && b.disabled),
        active: !!(b && b.classList.contains("iuSilverParcelWatch__mainSave--active")),
      };
    });
    if (!mainSaveSpaces.disabled || mainSaveSpaces.active) {
      fail(`Silver parcel main save: must be disabled when spaces-only (390): ${JSON.stringify(mainSaveSpaces)}`);
    }
    await page.fill("#iuSilverParcelWatchInput", "Z0000000001");
    await page.waitForTimeout(120);
    const mainSaveHasText = await page.evaluate(() => {
      const b = document.getElementById("iuSilverParcelWatchSave");
      return {
        disabled: !!(b && b.disabled),
        active: !!(b && b.classList.contains("iuSilverParcelWatch__mainSave--active")),
      };
    });
    if (mainSaveHasText.disabled || !mainSaveHasText.active) {
      fail(`Silver parcel main save: must be active with text (390): ${JSON.stringify(mainSaveHasText)}`);
    }
    const mainBlue = await page.locator("#iuSilverParcelWatchSave").evaluate((el) => {
      const s = getComputedStyle(el);
      const bi = String(s.backgroundImage || "");
      const bc = String(s.backgroundColor || "");
      return (
        bi.indexOf("gradient") >= 0 ||
        bc.indexOf("30, 64, 175") >= 0 ||
        bc.indexOf("30,64,175") >= 0 ||
        bc.indexOf("37, 99, 235") >= 0
      );
    });
    if (!mainBlue) {
      fail("Silver parcel main save: expected dark blue CTA style when active (390)");
    }
    await page.fill("#iuSilverParcelWatchInput", "bad@@@");
    await page.click("#iuSilverParcelWatchSave");
    await page.waitForTimeout(400);
    const silverParcelBad = await page.evaluate(() => {
      const e = document.getElementById("iuSilverParcelWatchErr");
      const t = e ? String(e.textContent || "") : "";
      return { ok: !!(e && !e.hidden && t.indexOf("Neplatný formát") >= 0), t };
    });
    if (!silverParcelBad || !silverParcelBad.ok) {
      fail(`Silver parcel invalid format: ${JSON.stringify(silverParcelBad)}`);
    }
    await page.fill("#iuSilverParcelWatchInput", "Z9876543210");
    await page.click("#iuSilverParcelWatchSave");
    await page.waitForTimeout(600);
    const silverParcelOverlayClosed = await page.evaluate(() => {
      const m = document.getElementById("iuParcelsPopover");
      return !m || !m.classList.contains("is-open");
    });
    if (!silverParcelOverlayClosed) {
      fail("Silver parcel save must not open MindMenu parcels overlay");
    }
    const silverParcelSaved = await page.evaluate(() => {
      const list = document.getElementById("iuSilverParcelWatchList");
      const t = list ? String(list.textContent || "") : "";
      const ls = (() => {
        try {
          return localStorage.getItem("iu_silver_parcel_watch_v1") || "";
        } catch (_) {
          return "";
        }
      })();
      return {
        ok: t.indexOf("Z9876543210") >= 0 && t.indexOf("Zásilkovna") >= 0 && ls.indexOf("Z9876543210") >= 0,
        t: t.slice(0, 240),
        lsLen: ls.length,
      };
    });
    if (!silverParcelSaved || !silverParcelSaved.ok) {
      fail(`Silver parcel save + localStorage: ${JSON.stringify(silverParcelSaved)}`);
    }
    const silverParcelCardRemoveUx = await page.evaluate(() => {
      const hosts = [
        document.getElementById("iuSilverParcelWatchList"),
        document.getElementById("iuSilverParcelWatchCompleted"),
      ];
      var blob = "";
      for (var i = 0; i < hosts.length; i++) {
        if (hosts[i]) blob += hosts[i].textContent || "";
      }
      const rm = document.querySelector(".iuSilverParcelWatch__btnRemoveParcel");
      var red = false;
      if (rm) {
        var s = getComputedStyle(rm);
        var c = String(s.color || "");
        red =
          c.indexOf("185, 28, 28") >= 0 ||
          c.indexOf("220, 38, 38") >= 0 ||
          c.indexOf("rgb(185") >= 0;
      }
      return {
        hasSkryt: blob.indexOf("Skrýt") >= 0,
        hasOdstranit: blob.indexOf("Odstranit") >= 0,
        rmText: rm ? String(rm.textContent || "").trim() : "",
        red,
        rmExists: !!rm,
      };
    });
    if (silverParcelCardRemoveUx.hasSkryt) {
      fail("Silver parcel card: must not show label Skrýt");
    }
    if (!silverParcelCardRemoveUx.rmExists || silverParcelCardRemoveUx.rmText !== "Odstranit") {
      fail(`Silver parcel card: expected Odstranit remove button: ${JSON.stringify(silverParcelCardRemoveUx)}`);
    }
    if (!silverParcelCardRemoveUx.red) {
      fail("Silver parcel card: Odstranit must use destructive red styling");
    }
    await page.fill("#iuSilverParcelWatchInput", "Z9876543210");
    await page.click("#iuSilverParcelWatchSave");
    await page.waitForTimeout(350);
    const silverParcelDup = await page.evaluate(() => {
      const e = document.getElementById("iuSilverParcelWatchErr");
      const t = e ? String(e.textContent || "") : "";
      return { ok: !!(e && !e.hidden && t.indexOf("už v seznamu") >= 0), t };
    });
    if (!silverParcelDup || !silverParcelDup.ok) {
      fail(`Silver parcel duplicate guard: ${JSON.stringify(silverParcelDup)}`);
    }

    await page.evaluate(() => {
      try {
        var raw = localStorage.getItem("iu_silver_parcel_watch_v1");
        var j = JSON.parse(raw || "[]");
        if (j.length && j[0]) {
          j[0].purgeAfterAt = 1;
          localStorage.setItem("iu_silver_parcel_watch_v1", JSON.stringify(j));
        }
      } catch (_) {}
    });
    await gotoDomContentLoaded(page, `${BASE}/projects/?section=media`);
    await gotoProjectsMediaForSmoke(page);
    await page.waitForSelector("#iuSilverParcelWatchInput", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    await page.waitForFunction(
      () => !!(window.IU_SILVER_PARCEL_FACADE && window.IU_PARCEL_TRACKING_ENGINE),
      { timeout: 15000 },
    );
    await page.waitForTimeout(400);
    const silverParcelPurgeImmune = await page.evaluate(() => {
      const list = document.getElementById("iuSilverParcelWatchList");
      const t = list ? String(list.textContent || "") : "";
      return { hasZ: t.indexOf("Z9876543210") >= 0 };
    });
    if (!silverParcelPurgeImmune.hasZ) {
      fail("Silver parcel: stale purgeAfterAt must not remove item after reload");
    }

    const smsSample =
      "Nyni k vydeji! Heslo 1369168. Zasilka Z1904219183.Po-Ne 00:05-23:55; 01.05.2026 00:05-23:55. Cerpaci stanice MEDOS, Ceskobrodska 831.";

    async function assertDetailSaveMicroUx(label) {
      await page.locator(".iuSilverParcelWatch__btnDetailAdd").first().click();
      await page.waitForTimeout(280);
      const ta = page.locator(".iuSilverParcelWatch__detailTextarea").first();
      await ta.waitFor({ state: "visible", timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
      const expectedDetailPh =
        "Vlož SMS od dopravce, že je zásilka připravena k vyzvednutí, nebo přidej vlastní poznámku";
      const phVal = await ta.getAttribute("placeholder");
      if (phVal !== expectedDetailPh) {
        fail(`Silver parcel detail placeholder mismatch (${label}): ${JSON.stringify(phVal)}`);
      }
      const saveBtn = page.locator(".iuSilverParcelWatch__detailSave").first();
      if (!(await saveBtn.isDisabled())) {
        fail(`Silver parcel detail save: must be disabled when empty (${label})`);
      }
      await ta.fill("   ");
      await page.waitForTimeout(120);
      if (!(await saveBtn.isDisabled())) {
        fail(`Silver parcel detail save: must be disabled when spaces-only (${label})`);
      }
      await ta.fill("x");
      await page.waitForTimeout(120);
      if (await saveBtn.isDisabled()) {
        fail(`Silver parcel detail save: must be enabled with real text (${label})`);
      }
      const activeOk = await page.locator(".iuSilverParcelWatch__detailSave--active").count();
      if (activeOk < 1) {
        fail(`Silver parcel detail save: expected --active with text (${label})`);
      }
      const greenish = await saveBtn.evaluate((el) => {
        const s = getComputedStyle(el);
        const bi = String(s.backgroundImage || "");
        const bc = String(s.backgroundColor || "");
        return bi.indexOf("gradient") >= 0 || bc.indexOf("rgb(21, 128, 61)") >= 0 || bc.indexOf("rgb(22,163,74)") >= 0;
      });
      if (!greenish) {
        fail(`Silver parcel detail save: expected green gradient when active (${label})`);
      }
      await page.locator(".iuSilverParcelWatch__detailEditActions .iuSilverParcelWatch__btnGhost").filter({ hasText: "Zrušit" }).click();
      await page.waitForTimeout(250);
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    const overflow390 = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (overflow390) {
      fail("Silver parcel detail: mobile overflowX must be false before detail edit");
    }
    const silverMainShell390 = await page.evaluate(() => {
      const shell = document.querySelector(".iuSilverParcelWatch__mainShell");
      const watch = document.getElementById("iuSilverParcelWatch");
      const inp = document.getElementById("iuSilverParcelWatchInput");
      const sav = document.getElementById("iuSilverParcelWatchSave");
      if (!shell || !watch || !inp || !sav) return { ok: false, reason: "missing" };
      if (!shell.contains(inp) || !shell.contains(sav)) return { ok: false, reason: "children" };
      const sh = shell.getBoundingClientRect();
      const wh = watch.getBoundingClientRect();
      if (sh.left < wh.left - 2 || sh.right > wh.right + 2) return { ok: false, reason: "bounds" };
      if (sh.bottom > wh.bottom + 3 || sh.top < wh.top - 3) return { ok: false, reason: "clip" };
      const inpR = inp.getBoundingClientRect();
      const savR = sav.getBoundingClientRect();
      if (inpR.bottom > sh.bottom + 2 || savR.bottom > sh.bottom + 2) return { ok: false, reason: "shell_clip" };
      const bg = getComputedStyle(shell).backgroundColor || "";
      const hasShellBg =
        bg.indexOf("88, 100, 116") >= 0 ||
        bg.indexOf("88,100,116") >= 0 ||
        bg.indexOf("74, 85, 104") >= 0 ||
        bg.indexOf("74,85,104") >= 0;
      if (!hasShellBg) return { ok: false, reason: "bg", bg };
      inp.focus();
      return { ok: true };
    });
    if (!silverMainShell390.ok) {
      fail(`Silver parcel main shell (390): ${JSON.stringify(silverMainShell390)}`);
    }
    await page.waitForTimeout(280);
    await page.locator("#iuSilverParcelWatchInput").focus();
    await page.waitForTimeout(80);
    const silverMainShellGlow390 = await page.evaluate(() => {
      const shell = document.querySelector(".iuSilverParcelWatch__mainShell");
      const inp = document.getElementById("iuSilverParcelWatchInput");
      if (!shell || !inp) return false;
      inp.focus();
      if (!shell.matches(":focus-within")) return false;
      const b = String(getComputedStyle(shell).boxShadow || "").replace(/\s+/g, " ");
      if (b.indexOf("99, 102, 241") >= 0 || b.indexOf("99,102,241") >= 0) return true;
      if (b.indexOf("99 102 241") >= 0) return true;
      if (b.indexOf("0 0 0 2px") >= 0 || b.indexOf("0px 0px 0px 2px") >= 0) return true;
      return false;
    });
    if (!silverMainShellGlow390) {
      fail("Silver parcel main shell: expected focus-within glow on input focus (390)");
    }
    const mainSaveDisabledBlue = await page.locator("#iuSilverParcelWatchSave").evaluate((el) => {
      const s = getComputedStyle(el);
      const bi = String(s.backgroundImage || "");
      const bc = String(s.backgroundColor || "");
      return (
        bi.indexOf("gradient") >= 0 ||
        bc.indexOf("30, 64, 175") >= 0 ||
        bc.indexOf("30,64,175") >= 0
      );
    });
    if (!mainSaveDisabledBlue) {
      fail("Silver parcel main save: expected dark blue CTA even when disabled (390)");
    }
    await page.evaluate(() => {
      try {
        window.__iuParcelSmokeCls = 0;
        if (window.__iuParcelSmokeClsPO) window.__iuParcelSmokeClsPO.disconnect();
        window.__iuParcelSmokeClsPO = new PerformanceObserver(function (list) {
          const entries = list.getEntries();
          for (let i = 0; i < entries.length; i++) {
            const e = entries[i];
            if (!e.hadRecentInput && e.value) {
              window.__iuParcelSmokeCls = (window.__iuParcelSmokeCls || 0) + e.value;
            }
          }
        });
        window.__iuParcelSmokeClsPO.observe({ type: "layout-shift", buffered: false });
      } catch (_) {}
    });
    await page.reload({ waitUntil: "domcontentloaded", timeout: GOTO_DOM_CONTENT_LOADED_TIMEOUT_MS });
    await gotoProjectsMediaForSmoke(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.waitForSelector("#iuSilverParcelWatchInput", { timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    const parcelReloadLayout390 = await page.evaluate(() => {
      const watch = document.getElementById("iuSilverParcelWatch");
      const shell = document.querySelector(".iuSilverParcelWatch__mainShell");
      const inp = document.getElementById("iuSilverParcelWatchInput");
      const sav = document.getElementById("iuSilverParcelWatchSave");
      const docEl = document.documentElement;
      const overflowX = docEl.scrollWidth > docEl.clientWidth + 1;
      function vis(el) {
        if (!el) return false;
        const st = getComputedStyle(el);
        if (st.display === "none" || st.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2;
      }
      let shellNotClipped = false;
      if (watch && shell && inp && sav) {
        const sh = shell.getBoundingClientRect();
        const wh = watch.getBoundingClientRect();
        const ir = inp.getBoundingClientRect();
        const br = sav.getBoundingClientRect();
        shellNotClipped =
          sh.bottom <= wh.bottom + 3 &&
          ir.bottom <= sh.bottom + 2 &&
          br.bottom <= sh.bottom + 2;
      }
      return {
        overflowX,
        parcelCardVisible: vis(watch),
        inputVisible: vis(inp),
        buttonVisible: vis(sav),
        shellNotClipped,
        cls: Number(window.__iuParcelSmokeCls || 0),
      };
    });
    if (
      parcelReloadLayout390.overflowX ||
      !parcelReloadLayout390.parcelCardVisible ||
      !parcelReloadLayout390.inputVisible ||
      !parcelReloadLayout390.buttonVisible ||
      !parcelReloadLayout390.shellNotClipped ||
      parcelReloadLayout390.cls > 0.001
    ) {
      fail(`Silver parcel reload layout guard (390): ${JSON.stringify(parcelReloadLayout390)}`);
    }
    await assertDetailSaveMicroUx("390x844");

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(200);
    const overflow768 = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (overflow768) {
      fail("Silver parcel detail: tablet overflowX must be false before detail edit");
    }
    const silverMainShell768 = await page.evaluate(() => {
      const shell = document.querySelector(".iuSilverParcelWatch__mainShell");
      const inp = document.getElementById("iuSilverParcelWatchInput");
      const sav = document.getElementById("iuSilverParcelWatchSave");
      return !!(shell && inp && sav && shell.contains(inp) && shell.contains(sav));
    });
    if (!silverMainShell768) {
      fail("Silver parcel main shell: input+save must live inside mainShell (768)");
    }
    await assertDetailSaveMicroUx("768x1024");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);

    await page.locator(".iuSilverParcelWatch__btnDetailAdd").first().click();
    await page.waitForTimeout(300);
    const detailTa = page.locator(".iuSilverParcelWatch__detailTextarea").first();
    await detailTa.waitFor({ state: "visible", timeout: PREVIEW_SELECTOR_TIMEOUT_MS });
    const detailFs = await detailTa.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) || 0);
    if (detailFs < 16) {
      fail(`Silver parcel detail textarea font-size must be >=16px, got ${detailFs}`);
    }
    await detailTa.fill(smsSample);
    await page.locator(".iuSilverParcelWatch__detailSave").filter({ hasText: "Uložit" }).click();
    await page.waitForTimeout(500);
    const silverParcelDetailProof = await page.evaluate(() => {
      const list = document.getElementById("iuSilverParcelWatchList");
      const t = list ? String(list.textContent || "") : "";
      const ov =
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      const ls = (() => {
        try {
          return localStorage.getItem("iu_silver_parcel_watch_v1") || "";
        } catch (_) {
          return "";
        }
      })();
      return {
        hasDetailLine: t.indexOf("Připraveno k vyzvednutí") >= 0,
        hasPassword: t.indexOf("1369168") >= 0,
        hasAddr: t.indexOf("MEDOS") >= 0,
        hasHours: t.indexOf("Po–Ne") >= 0 || t.indexOf("Po-Ne") >= 0,
        navCount: document.querySelectorAll(".iuSilverParcelWatch__btnDetailNav").length,
        lsHasDetail: ls.indexOf("detailRawText") >= 0,
        overflowX: ov,
      };
    });
    if (!silverParcelDetailProof.hasDetailLine) {
      fail("Silver parcel detail: expected parsed status line");
    }
    if (!silverParcelDetailProof.hasPassword) {
      fail("Silver parcel detail: expected password in card");
    }
    if (!silverParcelDetailProof.hasAddr) {
      fail("Silver parcel detail: expected address in card");
    }
    if (!silverParcelDetailProof.hasHours) {
      fail("Silver parcel detail: expected opening hours line");
    }
    if (silverParcelDetailProof.navCount < 1) {
      fail("Silver parcel detail: expected Navigovat for parsed address");
    }
    const navGreen = await page.locator(".iuSilverParcelWatch__btnDetailNav--address").first().evaluate((el) => {
      const s = getComputedStyle(el);
      const bi = String(s.backgroundImage || "");
      return bi.indexOf("gradient") >= 0 || String(s.backgroundColor || "").indexOf("128, 61") >= 0;
    });
    if (!navGreen) {
      fail("Silver parcel detail: Navigovat must use green success style when address parsed");
    }
    if (!silverParcelDetailProof.lsHasDetail) {
      fail("Silver parcel detail: expected detailRawText in localStorage");
    }
    if (silverParcelDetailProof.overflowX) {
      fail("Silver parcel detail: overflowX must be false");
    }
    const parserOk = await page.evaluate((sample) => {
      if (typeof globalThis.iuParseParcelUserDetail !== "function") return false;
      var p = globalThis.iuParseParcelUserDetail(sample);
      return !!(
        p &&
        p.statusHeadline === "Připraveno k vyzvednutí" &&
        p.password === "1369168" &&
        p.addressLine &&
        String(p.addressLine).indexOf("MEDOS") >= 0 &&
        p.openingHours
      );
    }, smsSample);
    if (!parserOk) {
      fail("Silver parcel detail: iuParseParcelUserDetail sample parse mismatch");
    }

    await page
      .locator(".iuSilverParcelWatch__btnDetailLink")
      .filter({ hasText: "Odstranit detail" })
      .click();
    await page.waitForTimeout(350);
    await page.locator(".iuSilverParcelWatch__btnDetailAdd").first().click();
    await page.waitForTimeout(280);
    await page.locator(".iuSilverParcelWatch__detailTextarea").first().fill("jen poznámka bez adresy a bez hesla");
    await page.locator(".iuSilverParcelWatch__detailSave").filter({ hasText: "Uložit" }).click();
    await page.waitForTimeout(450);
    const noAddrNav = await page.evaluate(() => {
      return document.querySelectorAll(".iuSilverParcelWatch__btnDetailNav--address").length;
    });
    if (noAddrNav !== 0) {
      fail("Silver parcel detail: Navigovat--address must not appear without parsed address");
    }

    await page
      .locator(".iuSilverParcelWatch__btnDetailLink")
      .filter({ hasText: "Odstranit detail" })
      .click();
    await page.waitForTimeout(400);
    const afterRemove = await page.evaluate(() => {
      var ls = "";
      try {
        ls = localStorage.getItem("iu_silver_parcel_watch_v1") || "";
      } catch (_) {}
      return {
        lsHasDetail: ls.indexOf("detailRawText") >= 0,
        hasAdd: !!document.querySelector(".iuSilverParcelWatch__btnDetailAdd"),
      };
    });
    if (afterRemove.lsHasDetail) {
      fail("Silver parcel detail: detailRawText must be removed after Odstranit");
    }
    if (!afterRemove.hasAdd) {
      fail("Silver parcel detail: Přidat detail must return after remove");
    }

    await page.locator(".iuSilverParcelWatch__btnRemoveParcel").first().click();
    await page.waitForTimeout(250);
    const silverParcelRemoveConfirmOpen = await page.evaluate(() => {
      const dlg = document.getElementById("iuSilverParcelWatchRemoveConfirm");
      var ls = "";
      try {
        ls = localStorage.getItem("iu_silver_parcel_watch_v1") || "";
      } catch (_) {}
      const list = document.getElementById("iuSilverParcelWatchList");
      const t = list ? String(list.textContent || "") : "";
      return {
        dialogOpen: !!(dlg && !dlg.hidden),
        lsHasZ: ls.indexOf("Z9876543210") >= 0,
        listHasZ: t.indexOf("Z9876543210") >= 0,
      };
    });
    if (!silverParcelRemoveConfirmOpen.dialogOpen) {
      fail(
        `Silver parcel: Odstranit must open confirm dialog: ${JSON.stringify(silverParcelRemoveConfirmOpen)}`,
      );
    }
    if (!silverParcelRemoveConfirmOpen.lsHasZ || !silverParcelRemoveConfirmOpen.listHasZ) {
      fail(
        `Silver parcel: must not delete before confirm: ${JSON.stringify(silverParcelRemoveConfirmOpen)}`,
      );
    }

    await page.locator("#iuSilverParcelWatchRemoveConfirmCancel").click();
    await page.waitForTimeout(250);
    const silverParcelRemoveCancel = await page.evaluate(() => {
      const dlg = document.getElementById("iuSilverParcelWatchRemoveConfirm");
      var ls = "";
      try {
        ls = localStorage.getItem("iu_silver_parcel_watch_v1") || "";
      } catch (_) {}
      const list = document.getElementById("iuSilverParcelWatchList");
      const t = list ? String(list.textContent || "") : "";
      return {
        dialogOpen: !!(dlg && !dlg.hidden),
        lsHasZ: ls.indexOf("Z9876543210") >= 0,
        listHasZ: t.indexOf("Z9876543210") >= 0,
      };
    });
    if (silverParcelRemoveCancel.dialogOpen) {
      fail(`Silver parcel: Zrušit must close confirm dialog: ${JSON.stringify(silverParcelRemoveCancel)}`);
    }
    if (!silverParcelRemoveCancel.lsHasZ || !silverParcelRemoveCancel.listHasZ) {
      fail(`Silver parcel: Zrušit must keep item: ${JSON.stringify(silverParcelRemoveCancel)}`);
    }

    await page.locator(".iuSilverParcelWatch__btnRemoveParcel").first().click();
    await page.waitForTimeout(250);
    await page.locator("#iuSilverParcelWatchRemoveConfirmOk").click();
    await page.waitForTimeout(450);
    const silverParcelManualRemove = await page.evaluate(() => {
      const dlg = document.getElementById("iuSilverParcelWatchRemoveConfirm");
      var ls = "";
      try {
        ls = localStorage.getItem("iu_silver_parcel_watch_v1") || "";
      } catch (_) {}
      const list = document.getElementById("iuSilverParcelWatchList");
      const t = list ? String(list.textContent || "") : "";
      return {
        dialogOpen: !!(dlg && !dlg.hidden),
        lsHasZ: ls.indexOf("Z9876543210") >= 0,
        listHasZ: t.indexOf("Z9876543210") >= 0,
      };
    });
    if (silverParcelManualRemove.dialogOpen) {
      fail(`Silver parcel: confirm Odstranit must close dialog: ${JSON.stringify(silverParcelManualRemove)}`);
    }
    if (silverParcelManualRemove.lsHasZ || silverParcelManualRemove.listHasZ) {
      fail(`Silver parcel: manual Odstranit must clear item: ${JSON.stringify(silverParcelManualRemove)}`);
    }

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.waitForTimeout(200);

    const parcelsBtn = await page.$("#iuParcelsBtn");
    if (parcelsBtn) {
      await parcelsBtn.click();
      await page.waitForTimeout(500);
      const silverParcelManual = await page.evaluate(() => {
        const m = document.getElementById("iuParcelsPopover");
        return !!(m && m.classList.contains("is-open"));
      });
      if (!silverParcelManual) {
        fail("Silver parcel smoke: manual MindMenu parcels overlay did not open");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(350);
    }

    const navSelectors = ["a.iu-leftNavItem", "a[data-rail]", ".iuLeftNav a", "nav a"];
    let navEl = null;
    for (const sel of navSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          navEl = el;
          break;
        }
      } catch {}
    }
    if (!navEl) fail("No nav link found (UI broken or overlay)");
    else {
      const beforeUrl = page.url();
      await navEl.click();
      await page.waitForTimeout(500);
      const afterUrl = page.url();
      const activeTag = await page.evaluate(() => document.activeElement?.tagName || "");
      const urlChanged = afterUrl !== beforeUrl;
      const hasFocus = /^A|BUTTON$/i.test(activeTag);
      if (!urlChanged && !hasFocus) fail("Click did not change URL or focus");
    }

    // Route reset: panel/radarOpen stripped on reload; section/topic/mode may persist (media nav deep links)
    await gotoDomContentLoaded(page, `${BASE}/projects/?section=media&panel=services`);
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(500);
    const finalUrl = page.url();
    let u;
    try {
      u = new URL(finalUrl);
    } catch (e) {
      fail(`Route reset: invalid URL ${finalUrl}`);
    }
    if (!u.pathname.includes("/projects")) fail(`Route reset: expected /projects path, got ${finalUrl}`);
    if (u.searchParams.has("panel") || u.searchParams.has("radarOpen")) {
      fail(`Route reset: stripped overlay params still present: ${finalUrl}`);
    }

    await browser.close();
  } finally {
    if (server) server.close();
  }

  if (failed) {
    console.error("\nErrors:", errors);
    process.exit(1);
  }
  console.log("SMOKE PASS");
}

runSmoke().catch((e) => {
  console.error(e);
  process.exit(1);
});
