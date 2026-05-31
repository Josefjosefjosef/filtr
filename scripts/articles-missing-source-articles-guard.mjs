/**
 * Missing source articles guard — fails when today's RSS items are absent from articles.json
 * without a valid documented reason (inactive feed, fetch error, feed not RSS).
 *
 * Run: node scripts/articles-missing-source-articles-guard.mjs
 *
 * Env:
 *   ARTICLES_JSON_PATH — local file (default projects/data/articles.json)
 *   ARTICLES_JSON_URL — fetch URL instead of file
 *   SOURCE_REGISTRY_PATH — registry (default projects/data/source_registry.json)
 *   MAX_SAMPLE_MISSING — max missing rows in report (default 25)
 *   MIN_TODAY_PER_SECTION — min today articles expected per main section when feed has them (default 1)
 *   ALLOW_INACTIVE_SOURCE_IDS — comma list extra allowed inactive ids
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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

const TOPIC_TO_SECTION = { zpravy: "aktualne", aktualne: "aktualne" };
const localArticles = process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const remoteArticles = (process.env.ARTICLES_JSON_URL || "").trim();
const registryPath = process.env.SOURCE_REGISTRY_PATH || path.join(root, "projects", "data", "source_registry.json");
const maxSample = Number(process.env.MAX_SAMPLE_MISSING || "25");
const minTodayPerSection = Number(process.env.MIN_TODAY_PER_SECTION || "1");

function pragueTodayIsoDate(now = new Date()) {
  return now.toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });
}

function canonicalUrl(u) {
  if (!u) return "";
  try {
    const x = new URL(String(u).trim());
    x.hash = "";
    let p = x.pathname.replace(/\/+$/, "") || "/";
    x.pathname = p;
    return x.toString().toLowerCase();
  } catch {
    return String(u).trim().toLowerCase();
  }
}

function parseRssDate(s) {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

function pragueDayFromTs(ts) {
  if (!ts) return null;
  return new Date(ts).toLocaleDateString("sv-SE", { timeZone: "Europe/Prague" });
}

function extractItems(xml) {
  const items = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const chunk = block.split(/<\/item>/i)[0] || block;
    const title = (chunk.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1]?.trim() || "";
    const link =
      (chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1]?.trim() ||
      (chunk.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1]?.trim() ||
      "";
    const pub =
      (chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1]?.trim() ||
      (chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1]?.trim() ||
      (chunk.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i) || [])[1]?.trim() ||
      "";
    items.push({ title: title.replace(/<[^>]+>/g, ""), link, pubDate: pub });
  }
  if (items.length === 0) {
    const entries = xml.split(/<entry[\s>]/i).slice(1);
    for (const block of entries) {
      const chunk = block.split(/<\/entry>/i)[0] || block;
      const title = (chunk.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i) || [])[1]?.trim() || "";
      const link = (chunk.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1]?.trim() || "";
      const pub =
        (chunk.match(/<published[^>]*>([\s\S]*?)<\/published>/i) || [])[1]?.trim() ||
        (chunk.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) || [])[1]?.trim() ||
        "";
      items.push({ title: title.replace(/<[^>]+>/g, ""), link, pubDate: pub });
    }
  }
  return items;
}

function looksLikeFeedXml(text) {
  if (!text) return false;
  const s = text.trim().replace(/^\uFEFF/, "");
  const low = s.slice(0, 240).toLowerCase();
  return low.startsWith("<?xml") || low.startsWith("<rss") || low.startsWith("<feed") || low.startsWith("<rdf:");
}

async function loadArticlesDoc() {
  if (remoteArticles) {
    const res = await fetch(remoteArticles, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!res.ok) throw new Error(`articles fetch failed ${res.status}`);
    return res.json();
  }
  if (!fs.existsSync(localArticles)) throw new Error(`missing ${localArticles}`);
  return JSON.parse(fs.readFileSync(localArticles, "utf8"));
}

async function fetchFeed(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "infoUzelBot/1.0 (+https://infouzel.cz/projects/bot/)",
        From: "admin@infouzel.cz",
        Accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
        "Accept-Language": "cs-CZ,cs;q=0.9",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    return { status: res.status, text, error: null };
  } catch (e) {
    return { status: 0, text: "", error: String(e.message || e) };
  }
}

async function main() {
  const todayPrague = pragueTodayIsoDate();
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const articlesDoc = await loadArticlesDoc();
  const articles = Array.isArray(articlesDoc.articles) ? articlesDoc.articles : [];
  const urlIndex = new Set(
    articles.map((a) => canonicalUrl(a.url || a.sources?.[0]?.url || "")).filter(Boolean),
  );

  const allowedInactive = new Set(
    String(process.env.ALLOW_INACTIVE_SOURCE_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const entries = (registry.entries || []).filter((e) => e && typeof e === "object");
  const report = {
    todayPrague,
    generatedAt: articlesDoc.generatedAt || null,
    checkedSources: 0,
    checkedFeeds: 0,
    feedTodayTotal: 0,
    articlesPresentInFeed: 0,
    articlesMissingFromFeed: 0,
    articlesRemovedByDedupe: 0,
    articlesRemovedByFilter: 0,
    articlesRemovedByDate: 0,
    articlesHiddenByUiLimit: 0,
    feedErrors: [],
    feedNotInRss: [],
    missingArticles: [],
    sectionTodayInJson: Object.fromEntries(MAIN_SECTIONS.map((s) => [s, 0])),
    sectionTodayInFeed: Object.fromEntries(MAIN_SECTIONS.map((s) => [s, 0])),
  };

  for (const a of articles) {
    const sec = String(a.topic || a.section || "").trim().toLowerCase();
    const pub = String(a.publishedAt || "").slice(0, 10);
    if (pub === todayPrague && report.sectionTodayInJson[sec] !== undefined) {
      report.sectionTodayInJson[sec] += 1;
    }
  }

  for (const entry of entries) {
    report.checkedSources++;
    if (entry.blocked) continue;
    if (entry.active === false) {
      if (!allowedInactive.has(entry.id)) allowedInactive.add(entry.id);
      continue;
    }
    const feedUrl = String(entry.feed_url || "").trim();
    if (!feedUrl) continue;

    report.checkedFeeds++;
    const topic = entry.topic || entry.section_primary || "aktualne";
    const section = TOPIC_TO_SECTION[topic] || topic;
    const fetched = await fetchFeed(feedUrl);

    if (fetched.status !== 200 || !fetched.text) {
      report.feedErrors.push({
        id: entry.id,
        feed_url: feedUrl,
        status: fetched.status,
        error: fetched.error,
        failure_stage: "fetch",
        exact_reason: fetched.error || `http_${fetched.status}`,
      });
      continue;
    }

    if (!looksLikeFeedXml(fetched.text)) {
      report.feedNotInRss.push({
        id: entry.id,
        source_name: entry.label || entry.id,
        feed_url: feedUrl,
        failure_stage: "feed_not_rss",
        exact_reason: "source_publishes_on_web_but_feed_returns_html",
      });
      continue;
    }

    const items = extractItems(fetched.text);
    const todayItems = items.filter((it) => {
      const ts = parseRssDate(it.pubDate);
      return ts && pragueDayFromTs(ts) === todayPrague;
    });

    for (const it of todayItems) {
      report.feedTodayTotal++;
      if (report.sectionTodayInFeed[section] !== undefined) report.sectionTodayInFeed[section] += 1;

      const canon = canonicalUrl(it.link);
      const inJson = canon && urlIndex.has(canon);
      if (inJson) {
        report.articlesPresentInFeed++;
        continue;
      }

      report.articlesMissingFromFeed++;
      const row = {
        source_name: entry.label || entry.id,
        source_id: entry.id,
        source_url: entry.domain || "",
        feed_url: feedUrl,
        title: it.title.slice(0, 160),
        published_at_source: it.pubDate,
        published_at_parsed: parseRssDate(it.pubDate) ? new Date(parseRssDate(it.pubDate)).toISOString() : null,
        category_expected: section,
        present_in_feed: true,
        parsed: true,
        normalized: true,
        removed_by_dedupe: false,
        removed_by_filter: false,
        removed_by_age: false,
        removed_by_category: false,
        written_to_articles_json: false,
        visible_in_ui_section: false,
        failure_stage: "pipeline_or_publish_lag",
        exact_reason:
          "feed_contains_today_item_but_missing_from_articles_json_likely_stale_pipeline_or_broken_aggregate",
      };
      report.missingArticles.push(row);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  let failed = false;
  const bundleAgeMs = articlesDoc.generatedAt ? Date.now() - Date.parse(articlesDoc.generatedAt) : Infinity;
  const bundleAgeHours = bundleAgeMs / 3_600_000;

  console.log(
    `[articles-missing-source-articles-guard] today=${todayPrague} generatedAt=${articlesDoc.generatedAt} bundle_age_hours=${Number.isFinite(bundleAgeHours) ? bundleAgeHours.toFixed(1) : "n/a"}`,
  );
  console.log(
    `[articles-missing-source-articles-guard] feedToday=${report.feedTodayTotal} present=${report.articlesPresentInFeed} missing=${report.articlesMissingFromFeed} feedErrors=${report.feedErrors.length} notRss=${report.feedNotInRss.length}`,
  );

  for (const sec of MAIN_SECTIONS) {
    const inFeed = report.sectionTodayInFeed[sec] || 0;
    const inJson = report.sectionTodayInJson[sec] || 0;
    console.log(
      `[articles-missing-source-articles-guard] section=${sec} today_in_feed=${inFeed} today_in_json=${inJson}`,
    );
    if (inFeed >= minTodayPerSection && inJson < minTodayPerSection && bundleAgeHours > 2) {
      console.error(
        `[articles-missing-source-articles-guard] FAIL: section=${sec} feed has today items but json has ${inJson} (bundle age ${bundleAgeHours.toFixed(1)}h)`,
      );
      failed = true;
    }
  }

  // Hard fail: many missing today items when bundle is older than 2h (pipeline should have caught up)
  if (report.articlesMissingFromFeed >= 10 && bundleAgeHours > 2) {
    console.error(
      `[articles-missing-source-articles-guard] FAIL: ${report.articlesMissingFromFeed} today feed items missing from articles.json (bundle age ${bundleAgeHours.toFixed(1)}h)`,
    );
    failed = true;
  }

  if (report.missingArticles.length) {
    console.error("[articles-missing-source-articles-guard] sample missing:");
    for (const m of report.missingArticles.slice(0, maxSample)) {
      console.error(
        `  - [${m.category_expected}] ${m.source_name}: ${m.title.slice(0, 70)} | ${m.exact_reason}`,
      );
    }
  }

  for (const n of report.feedNotInRss) {
    console.log(
      `[articles-missing-source-articles-guard] INFO feed_not_rss id=${n.id} url=${n.feed_url} reason=${n.exact_reason}`,
    );
  }

  const outPath = path.join(process.env.TEMP || process.env.TMP || root, "iu_missing_source_articles_guard_report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`[articles-missing-source-articles-guard] report=${outPath}`);

  if (failed) {
    console.error("[articles-missing-source-articles-guard] RESULT=FAIL");
    process.exit(1);
  }
  console.log("[articles-missing-source-articles-guard] RESULT=PASS");
}

main().catch((e) => {
  console.error("[articles-missing-source-articles-guard] ERROR:", e.message || e);
  process.exit(1);
});
