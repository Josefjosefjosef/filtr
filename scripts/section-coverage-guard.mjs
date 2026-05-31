/**
 * section_coverage_guard — feed with today's vertical-native items must appear in articles.json.
 * Rubric/syndication feeds (Novinky/Seznam section RSS mirroring homepage) are excluded via URL heuristics.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pragueDayFromIso, pragueTodayIso } from "./iu-source-display.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const MAIN_SECTIONS = [
  "aktualne",
  "sport",
  "finance",
  "zdravi",
  "cestovani",
  "hry",
  "kultura",
  "veda",
  "vzdelavani",
];

const localArticles = process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const remoteArticles = (process.env.ARTICLES_JSON_URL || "").trim();
const registryPath = process.env.SOURCE_REGISTRY_PATH || path.join(root, "projects", "data", "source_registry.json");
const minToday = Number(process.env.MIN_TODAY_PER_SECTION || "1");
const minNativeFeedItems = Number(process.env.MIN_NATIVE_FEED_TODAY || "2");
const bundleGraceHours = Number(process.env.SECTION_COVERAGE_BUNDLE_GRACE_HOURS || "3");

/** URL path signals that item belongs in vertical (not homepage syndication). */
const NATIVE_URL_SIGNALS = {
  cestovani: ["/cestovani", "tipy-na-vylety", "letenk", "dovol"],
  hry: ["/hry", "zing.cz/article", "vortex.cz", "indian-tv.cz", "sector.sk", "nedd.cz", "games.cz"],
  vzdelavani: ["/skola", "/vzdelavani", "nespechej.cz", "betterlife.cz"],
  kultura: ["/kultura", "kinobox.cz", "vtelce.cz"],
  veda: ["/veda", "technet", "vtm.zive.cz"],
};

function canonicalUrl(u) {
  if (!u) return "";
  try {
    const x = new URL(String(u).trim());
    x.hash = "";
    x.pathname = x.pathname.replace(/\/+$/, "") || "/";
    return x.toString().toLowerCase();
  } catch {
    return String(u).trim().toLowerCase();
  }
}

function parseRssDate(s) {
  const t = Date.parse(s || "");
  return Number.isFinite(t) ? t : null;
}

function extractItems(xml) {
  const items = [];
  for (const block of xml.split(/<item[\s>]/i).slice(1)) {
    const chunk = block.split(/<\/item>/i)[0] || block;
    const title = (chunk.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1]?.trim() || "";
    const link =
      (chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]?.trim() ||
      (chunk.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1]?.trim() ||
      "";
    const pub =
      (chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1]?.trim() ||
      (chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1]?.trim() ||
      "";
    items.push({ title: title.replace(/<[^>]+>/g, ""), link, pubDate: pub });
  }
  return items;
}

function isNativeVerticalItem(topic, link, feedDomain) {
  const hay = String(link || "").toLowerCase();
  const signals = NATIVE_URL_SIGNALS[topic] || [];
  if (signals.some((s) => hay.includes(s))) return true;
  // Dedicated vertical domains (not novinky/seznam rubric mirrors)
  const dedicated = {
    cestovani: ["svetcestovatele.cz", "cestujlevne.com", "pelipecky.cz", "travelbible.cz"],
    hry: ["zing.cz", "vortex.cz", "indian-tv.cz", "sector.sk", "nedd.cz"],
    vzdelavani: ["nespechej.cz", "betterlife.cz"],
  };
  const dom = String(feedDomain || "").toLowerCase();
  return (dedicated[topic] || []).some((d) => dom.includes(d) || hay.includes(d));
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "infoUzelBot/1.0 (+https://infouzel.cz/projects/bot/)",
      Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
    },
    signal: AbortSignal.timeout(25000),
  });
  return { status: res.status, text: await res.text() };
}

async function loadArticlesDoc() {
  if (remoteArticles) {
    const res = await fetch(remoteArticles, { headers: { Accept: "application/json", "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    return res.json();
  }
  if (!fs.existsSync(localArticles)) throw new Error(`missing ${localArticles}`);
  return JSON.parse(fs.readFileSync(localArticles, "utf8"));
}

async function main() {
  const today = pragueTodayIso();
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const articlesDoc = await loadArticlesDoc();
  const articles = Array.isArray(articlesDoc.articles) ? articlesDoc.articles : [];
  const urlIndex = new Set(
    articles.map((a) => canonicalUrl(a.url || a.sources?.[0]?.url || "")).filter(Boolean),
  );

  const sectionTodayJson = Object.fromEntries(MAIN_SECTIONS.map((s) => [s, 0]));
  for (const a of articles) {
    const sec = String(a.topic || a.section || "").trim().toLowerCase();
    if (pragueDayFromIso(a.publishedAt) === today && sectionTodayJson[sec] !== undefined) {
      sectionTodayJson[sec] += 1;
    }
  }

  const sectionNativeFeedToday = Object.fromEntries(MAIN_SECTIONS.map((s) => [s, 0]));
  const sectionNativeMissing = Object.fromEntries(MAIN_SECTIONS.map((s) => [s, 0]));

  for (const entry of registry.entries || []) {
    if (!entry || entry.blocked || entry.active === false) continue;
    const topic = String(entry.topic || entry.section_primary || "").trim().toLowerCase();
    if (!MAIN_SECTIONS.includes(topic)) continue;
    const feedUrl = String(entry.feed_url || "").trim();
    if (!feedUrl) continue;
    const fetched = await fetchFeed(feedUrl);
    if (fetched.status !== 200) continue;
    const items = extractItems(fetched.text);
    for (const it of items) {
      const ts = parseRssDate(it.pubDate);
      if (!ts || new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" }) !== today) continue;
      if (!isNativeVerticalItem(topic, it.link, entry.domain)) continue;
      sectionNativeFeedToday[topic] += 1;
      const canon = canonicalUrl(it.link);
      if (canon && !urlIndex.has(canon)) sectionNativeMissing[topic] += 1;
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  const bundleAgeH = articlesDoc.generatedAt
    ? (Date.now() - Date.parse(articlesDoc.generatedAt)) / 3_600_000
    : Infinity;

  let failed = false;
  console.log(
    `[section-coverage-guard] today=${today} generatedAt=${articlesDoc.generatedAt} bundle_age_hours=${Number.isFinite(bundleAgeH) ? bundleAgeH.toFixed(1) : "n/a"}`,
  );

  for (const sec of MAIN_SECTIONS) {
    const nativeFeed = sectionNativeFeedToday[sec] || 0;
    const inJson = sectionTodayJson[sec] || 0;
    const missing = sectionNativeMissing[sec] || 0;
    console.log(
      `[section-coverage-guard] section=${sec} native_feed_today=${nativeFeed} json_today=${inJson} native_missing=${missing}`,
    );
    if (
      nativeFeed >= minNativeFeedItems &&
      inJson < minToday &&
      missing >= minNativeFeedItems &&
      bundleAgeH > bundleGraceHours
    ) {
      console.error(
        `[section-coverage-guard] FAIL: section=${sec} has ${nativeFeed} native feed items today but json_today=${inJson}`,
      );
      failed = true;
    }
  }

  if (failed) {
    console.error("[section-coverage-guard] RESULT=FAIL");
    process.exit(1);
  }
  console.log("[section-coverage-guard] RESULT=PASS");
}

main().catch((e) => {
  console.error("[section-coverage-guard] ERROR", e.message || e);
  process.exit(1);
});
