/**
 * active_article_trace_guard — trace recent P0 RSS items through to articles.json.
 *
 * Run: node scripts/active-article-trace-guard.mjs
 *
 * Env:
 *   TRACE_SAMPLE_COUNT — default 5
 *   TRACE_MAX_AGE_HOURS — default 6
 *   ARTICLES_JSON_PATH / ARTICLES_JSON_URL
 */
import fs from "fs";
import path from "path";
import {
  P0_CONTENT_SOURCES,
  buildArticleUrlIndex,
  canonicalUrl,
  extractItems,
  fetchFeedXml,
  loadArticlesDoc,
  newestRssItem,
  parseRssDate,
  resolveFeedUrlForP0,
} from "./content-freshness-guard-lib.mjs";

const sampleCount = Math.max(1, Number(process.env.TRACE_SAMPLE_COUNT || "5"));
const maxAgeH = Number(process.env.TRACE_MAX_AGE_HOURS || "6");
const maxAgeMs = maxAgeH * 3_600_000;

function log(msg) {
  console.log(`[active-article-trace-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[active-article-trace-guard] FAIL: ${msg}`);
}

async function collectRecentRssCandidates() {
  const now = Date.now();
  const out = [];
  for (const def of P0_CONTENT_SOURCES) {
    const feedUrl = resolveFeedUrlForP0(def);
    try {
      const { ok, text } = await fetchFeedXml(feedUrl);
      if (!ok) continue;
      for (const it of extractItems(text)) {
        const t = parseRssDate(it.pubDate);
        if (t === null || now - t > maxAgeMs) continue;
        if (!it.link) continue;
        out.push({
          source: def.label,
          sourceId: def.id,
          title: it.title,
          url: it.link,
          publishedAt: new Date(t).toISOString(),
          ts: t,
        });
      }
    } catch {
      /* skip source */
    }
  }
  out.sort((a, b) => b.ts - a.ts);
  return out;
}

function pickSample(candidates) {
  const picked = [];
  const seenSource = new Set();
  for (const c of candidates) {
    if (seenSource.has(c.sourceId)) continue;
    picked.push(c);
    seenSource.add(c.sourceId);
    if (picked.length >= sampleCount) break;
  }
  if (picked.length < sampleCount) {
    for (const c of candidates) {
      if (picked.some((p) => canonicalUrl(p.url) === canonicalUrl(c.url))) continue;
      picked.push(c);
      if (picked.length >= sampleCount) break;
    }
  }
  return picked.slice(0, sampleCount);
}

async function main() {
  let failed = false;
  const doc = await loadArticlesDoc();
  const articles = Array.isArray(doc.articles) ? doc.articles : [];
  const byUrl = buildArticleUrlIndex(articles);
  const candidates = await collectRecentRssCandidates();
  const sample = pickSample(candidates);

  log(`rss_candidates_recent=${candidates.length} tracing=${sample.length}`);

  if (sample.length === 0) {
    fail(`no recent RSS candidates in last ${maxAgeH}h — cannot trace`);
    console.error("[active-article-trace-guard] RESULT=FAIL");
    process.exit(1);
  }

  const traces = [];
  for (const item of sample) {
    const key = canonicalUrl(item.url);
    const hit = byUrl.get(key);
    const trace = {
      source: item.source,
      title: item.title,
      published_at: item.publishedAt,
      rss_found: true,
      crawler_found: Boolean(hit),
      normalized: Boolean(hit && hit.title),
      dedupe_result: hit ? "accepted" : "missing",
      published: Boolean(hit),
      in_articles_json: Boolean(hit),
      url: item.url,
    };
    traces.push(trace);
    log(
      `trace source=${item.source} in_json=${trace.in_articles_json ? "yes" : "no"} title=${item.title.slice(0, 70)}`,
    );
    if (!hit) {
      fail(`missing in articles.json: [${item.source}] ${item.title.slice(0, 80)}`);
      failed = true;
    }
  }

  const outPath = path.join(process.env.TEMP || process.env.TMP || ".", "iu_active_article_trace_report.json");
  fs.writeFileSync(outPath, JSON.stringify({ traces, sampleCount: sample.length }, null, 2));
  log(`report=${outPath}`);

  if (failed) {
    console.error("[active-article-trace-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main().catch((e) => {
  console.error("[active-article-trace-guard] ERROR:", e.message || e);
  process.exit(1);
});
