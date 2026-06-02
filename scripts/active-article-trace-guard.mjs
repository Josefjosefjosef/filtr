/**
 * active_article_trace_guard — trace recent P0 RSS items through to articles.json.
 *
 * Only RSS items published at or before articles.json generatedAt (+ slack) are traced,
 * so live RSS is not compared against an older ingest/aggregate bundle snapshot.
 *
 * Run: node scripts/active-article-trace-guard.mjs
 *
 * Env:
 *   TRACE_SAMPLE_COUNT — default 5
 *   TRACE_MAX_AGE_HOURS — default 6
 *   TRACE_BUNDLE_SLACK_MINUTES — default 3 (clock/skew tolerance after bundle generatedAt)
 *   ARTICLES_JSON_PATH / ARTICLES_JSON_URL
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  P0_CONTENT_SOURCES,
  buildArticleUrlIndex,
  bundleGeneratedAtMs,
  canonicalUrl,
  extractItems,
  fetchFeedXml,
  filterRssCandidatesForBundleSnapshot,
  loadArticlesDoc,
  parseRssDate,
  resolveFeedUrlForP0,
} from "./content-freshness-guard-lib.mjs";

const sampleCount = Math.max(1, Number(process.env.TRACE_SAMPLE_COUNT || "5"));
const maxAgeH = Number(process.env.TRACE_MAX_AGE_HOURS || "6");
const maxAgeMs = maxAgeH * 3_600_000;
const bundleSlackMin = Math.max(0, Number(process.env.TRACE_BUNDLE_SLACK_MINUTES || "3"));
const bundleSlackMs = bundleSlackMin * 60_000;

function log(msg) {
  console.log(`[active-article-trace-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[active-article-trace-guard] FAIL: ${msg}`);
}

export function bundleSnapshotCutoffMs(doc) {
  const generatedMs = bundleGeneratedAtMs(doc);
  if (generatedMs === null) return null;
  return generatedMs + bundleSlackMs;
}

export async function collectRecentRssCandidates() {
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

export function filterCandidatesForBundleSnapshot(candidates, bundleGeneratedAtMs, slackMs = bundleSlackMs) {
  return filterRssCandidatesForBundleSnapshot(candidates, bundleGeneratedAtMs, slackMs);
}

export function pickSample(candidates) {
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

export async function runActiveArticleTraceGuard() {
  let failed = false;
  const doc = await loadArticlesDoc();
  const articles = Array.isArray(doc.articles) ? doc.articles : [];
  const byUrl = buildArticleUrlIndex(articles);
  const generatedMs = bundleGeneratedAtMs(doc);
  if (generatedMs === null) {
    fail("articles.json missing or invalid generatedAt — cannot align trace with bundle snapshot");
    console.error("[active-article-trace-guard] RESULT=FAIL");
    return 1;
  }

  const allCandidates = await collectRecentRssCandidates();
  const bundleAligned = filterCandidatesForBundleSnapshot(allCandidates, generatedMs, bundleSlackMs);
  const excludedPostBundle = allCandidates.length - bundleAligned.length;
  const sample = pickSample(bundleAligned);

  log(
    `bundle_generatedAt=${new Date(generatedMs).toISOString()} bundle_slack_minutes=${bundleSlackMin} rss_candidates_recent=${allCandidates.length} rss_candidates_bundle_aligned=${bundleAligned.length} rss_excluded_post_bundle=${excludedPostBundle} tracing=${sample.length}`,
  );

  if (sample.length === 0) {
    fail(
      `no RSS candidates at or before bundle generatedAt (last ${maxAgeH}h, excluded ${excludedPostBundle} post-bundle) — cannot trace`,
    );
    console.error("[active-article-trace-guard] RESULT=FAIL");
    return 1;
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
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        traces,
        sampleCount: sample.length,
        bundleGeneratedAt: new Date(generatedMs).toISOString(),
        bundleSlackMinutes: bundleSlackMin,
        rssExcludedPostBundle: excludedPostBundle,
      },
      null,
      2,
    ),
  );
  log(`report=${outPath}`);

  if (failed) {
    console.error("[active-article-trace-guard] RESULT=FAIL");
    return 1;
  }
  log("RESULT=PASS");
  return 0;
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMain) {
  runActiveArticleTraceGuard()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error("[active-article-trace-guard] ERROR:", e.message || e);
      process.exit(1);
    });
}
