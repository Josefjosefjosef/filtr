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

/** One retry when client navigation races domcontentloaded (e.g. /projects/?section=media vs /projects/). */
async function gotoDomContentLoaded(page, url) {
  try {
    return await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (/interrupted/i.test(msg)) {
      await page.waitForTimeout(500);
      return await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    }
    throw e;
  }
}

async function runSmoke() {
  const { chromium } = await import("playwright");

  await startServer();

  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
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
          await page.waitForURL((u) => u.pathname.includes("/projects"), { timeout: 10000 });
        } catch (e) {
          fail(`Root redirect did not settle on /projects/: ${e && e.message ? e.message : String(e)}`);
        }
      }
      await page.waitForTimeout(500);
    }

    // Click test on /projects/?section=media
    await gotoDomContentLoaded(page, `${BASE}/projects/?section=media`);
    await page.waitForTimeout(800);

    try {
      await page.waitForSelector('[data-iu-news-preview-card="1"]', { timeout: 10000 });
    } catch (e) {
      fail(`News preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    try {
      await page.waitForSelector('[data-iu-sport-preview-card="1"]', { timeout: 10000 });
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
      await page.waitForSelector("#iuFinancePreviewCard", { timeout: 10000 });
    } catch (e) {
      fail(`Finance preview card missing: ${e && e.message ? e.message : String(e)}`);
    }
    try {
      await page.waitForSelector("#iuHealthPreviewCard", { timeout: 10000 });
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
      await page.waitForSelector("#iuTravelPreviewCard", { timeout: 10000 });
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
      await page.waitForSelector("#iuGamesPreviewCard", { timeout: 10000 });
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
      await page.waitForSelector("#iuCulturePreviewCard", { timeout: 10000 });
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
      await page.waitForSelector("#iuScienceHistoryPreviewCard", { timeout: 10000 });
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
      await page.waitForSelector("#iuEducationPreviewCard", { timeout: 10000 });
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
    await page.click("#iuFinancePreviewCard");
    await page.waitForTimeout(500);
    const afterFinanceClick = page.url();
    if (afterFinanceClick.indexOf("topic=finance") === -1) {
      fail(`Finance preview click did not set topic=finance: ${afterFinanceClick}`);
    }

    await gotoDomContentLoaded(page, `${BASE}/projects/?section=media`);
    await page.waitForTimeout(800);
    await page.waitForSelector("#iuHealthPreviewCard", { timeout: 10000 });
    await page.click("#iuHealthPreviewCard");
    await page.waitForTimeout(500);
    const afterHealthClick = page.url();
    if (afterHealthClick.indexOf("topic=zdravi") === -1) {
      fail(`Health preview click did not set topic=zdravi: ${afterHealthClick}`);
    }

    await gotoDomContentLoaded(page, `${BASE}/projects/?section=media`);
    await page.waitForTimeout(800);
    await page.waitForSelector("#iuTravelPreviewCard", { timeout: 10000 });
    await page.click("#iuTravelPreviewCard");
    await page.waitForTimeout(500);
    const afterTravelClick = page.url();
    if (afterTravelClick.indexOf("section=travel") === -1 || afterTravelClick.indexOf("mode=media") === -1) {
      fail(`Travel preview click did not set section=travel&mode=media: ${afterTravelClick}`);
    }

    await gotoDomContentLoaded(page, `${BASE}/projects/?section=media`);
    await page.waitForTimeout(800);
    await page.waitForSelector("#iuGamesPreviewCard", { timeout: 10000 });
    await page.click("#iuGamesPreviewCard");
    await page.waitForTimeout(500);
    const afterGamesClick = page.url();
    if (afterGamesClick.indexOf("section=hry") === -1) {
      fail(`Games preview click did not set section=hry: ${afterGamesClick}`);
    }

    await gotoDomContentLoaded(page, `${BASE}/projects/?section=media`);
    await page.waitForTimeout(800);
    await page.waitForSelector("#iuCulturePreviewCard", { timeout: 10000 });
    await page.click("#iuCulturePreviewCard");
    await page.waitForTimeout(500);
    const afterCultureClick = page.url();
    if (afterCultureClick.indexOf("section=kultura") === -1) {
      fail(`Culture preview click did not set section=kultura: ${afterCultureClick}`);
    }

    await gotoDomContentLoaded(page, `${BASE}/projects/?section=media`);
    await page.waitForTimeout(800);
    await page.waitForSelector("#iuScienceHistoryPreviewCard", { timeout: 10000 });
    await page.click("#iuScienceHistoryPreviewCard");
    await page.waitForTimeout(500);
    const afterScienceHistoryClick = page.url();
    if (afterScienceHistoryClick.indexOf("section=veda") === -1) {
      fail(`Science-history preview click did not set section=veda: ${afterScienceHistoryClick}`);
    }

    await gotoDomContentLoaded(page, `${BASE}/projects/?section=media`);
    await page.waitForTimeout(800);
    await page.waitForSelector("#iuEducationPreviewCard", { timeout: 10000 });
    await page.click("#iuEducationPreviewCard");
    await page.waitForTimeout(500);
    const afterEducationClick = page.url();
    if (afterEducationClick.indexOf("section=vzdelavani") === -1) {
      fail(`Education preview click did not set section=vzdelavani: ${afterEducationClick}`);
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
