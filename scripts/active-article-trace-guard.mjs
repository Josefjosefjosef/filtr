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
  articleMatchesP0Source,
  buildArticleUrlIndex,
  bundleGeneratedAtMs,
  canonicalUrl,
  effectivePublishedMs,
  extractItems,
  fetchFeedXml,
  filterRssCandidatesForBundleSnapshot,
  loadArticlesDoc,
  parseRssDate,
  resolveFeedUrlForP0,
} from "./content-freshness-guard-lib.mjs";

const __guardDir = path.dirname(fileURLToPath(import.meta.url));
const topicDedupeSuppressedPath =
  process.env.TOPIC_DEDUPE_SUPPRESSED_PATH ||
  path.join(__guardDir, "..", "projects", "data", "topic_dedupe_suppressed.json");

const sampleCount = Math.max(1, Number(process.env.TRACE_SAMPLE_COUNT || "5"));
const maxAgeH = Number(process.env.TRACE_MAX_AGE_HOURS || "6");
const maxAgeMs = maxAgeH * 3_600_000;
const bundleSlackMin = Math.max(0, Number(process.env.TRACE_BUNDLE_SLACK_MINUTES || "3"));
const bundleSlackMs = bundleSlackMin * 60_000;
const freshnessFailMin = Number(process.env.CONTENT_FRESHNESS_FAIL_MINUTES || "120");
const freshnessFailMs = freshnessFailMin * 60_000;
const maxFutureMs = 3_600_000;

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

export function p0DefForSourceId(sourceId) {
  return P0_CONTENT_SOURCES.find((d) => d.id === sourceId) || null;
}

/** Canonical URLs of articles intentionally hidden by topic dedupe (suppressed report). */
export function loadTopicDedupeSuppressedUrls(filePath = topicDedupeSuppressedPath) {
  const out = new Set();
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rows = Array.isArray(raw) ? raw : raw.suppressed || [];
    for (const r of rows) {
      const u = canonicalUrl(r && r.url);
      if (u) out.add(u);
    }
  } catch {
    /* suppressed report optional */
  }
  return out;
}

/** Canonical URLs kept on cluster winners as alternativeSources (dedupe losers). */
export function buildDedupeAlternativeUrlSet(articles) {
  const out = new Set();
  for (const a of articles) {
    if (!a || !Array.isArray(a.alternativeSources)) continue;
    for (const alt of a.alternativeSources) {
      const u = canonicalUrl(alt && alt.url);
      if (u) out.add(u);
    }
  }
  return out;
}

/** Newest bundle article for a P0 source (optional freshness floor). */
export function newestArticleForP0Source(articles, def, referenceMs, minPublishedMs = null) {
  let best = null;
  const now = Date.now();
  for (const a of articles) {
    if (!articleMatchesP0Source(a, def)) continue;
    const t = effectivePublishedMs(a);
    if (t === null || t > now + maxFutureMs) continue;
    if (referenceMs - t > maxAgeMs) continue;
    if (minPublishedMs !== null && t < minPublishedMs) continue;
    if (!best || t > best.ts) best = { article: a, ts: t };
  }
  return best;
}

/**
 * Trace one sampled RSS item: exact URL OR fresh P0 source presence in bundle.
 * Returns { pass, matchMode, article?, productionTs? }.
 */
export function evaluateTraceSampleItem(item, articles, def, byUrl, referenceMs, dedupeSuppressedUrls = null) {
  if (!def) return { pass: false, matchMode: "unknown_source" };

  const urlHit = byUrl.get(canonicalUrl(item.url));
  if (urlHit) {
    return { pass: true, matchMode: "url", article: urlHit };
  }

  if (dedupeSuppressedUrls && dedupeSuppressedUrls.has(canonicalUrl(item.url))) {
    return { pass: true, matchMode: "dedupe_suppressed" };
  }

  const minFreshMs = referenceMs - freshnessFailMs;
  const fresh = newestArticleForP0Source(articles, def, referenceMs, minFreshMs);
  if (fresh) {
    return {
      pass: true,
      matchMode: "source_fresh",
      article: fresh.article,
      productionTs: fresh.ts,
    };
  }

  const any = newestArticleForP0Source(articles, def, referenceMs);
  if (any) {
    return {
      pass: false,
      matchMode: "stale_source",
      article: any.article,
      productionTs: any.ts,
    };
  }

  return { pass: false, matchMode: "missing_source" };
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

  const dedupeSuppressedUrls = loadTopicDedupeSuppressedUrls();
  for (const u of buildDedupeAlternativeUrlSet(articles)) dedupeSuppressedUrls.add(u);

  const allCandidates = await collectRecentRssCandidates();
  const bundleAligned = filterCandidatesForBundleSnapshot(allCandidates, generatedMs, bundleSlackMs);
  const excludedPostBundle = allCandidates.length - bundleAligned.length;
  const sample = pickSample(bundleAligned);

  log(
    `bundle_generatedAt=${new Date(generatedMs).toISOString()} bundle_slack_minutes=${bundleSlackMin} rss_candidates_recent=${allCandidates.length} rss_candidates_bundle_aligned=${bundleAligned.length} rss_excluded_post_bundle=${excludedPostBundle} dedupe_suppressed_urls=${dedupeSuppressedUrls.size} tracing=${sample.length}`,
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
    const def = p0DefForSourceId(item.sourceId);
    const result = evaluateTraceSampleItem(item, articles, def, byUrl, generatedMs, dedupeSuppressedUrls);
    const hit = result.article || null;
    const trace = {
      source: item.source,
      title: item.title,
      published_at: item.publishedAt,
      rss_found: true,
      crawler_found: Boolean(hit) || result.matchMode === "dedupe_suppressed",
      normalized: Boolean(hit && hit.title) || result.matchMode === "dedupe_suppressed",
      dedupe_result:
        result.matchMode === "dedupe_suppressed"
          ? "suppressed_duplicate"
          : result.pass
            ? "accepted"
            : result.matchMode,
      published: result.pass,
      in_articles_json: result.pass,
      match_mode: result.matchMode,
      production_url: hit?.url || null,
      production_ts: result.productionTs ? new Date(result.productionTs).toISOString() : null,
      url: item.url,
    };
    traces.push(trace);
    log(
      `trace source=${item.source} in_json=${trace.in_articles_json ? "yes" : "no"} match=${result.matchMode} title=${item.title.slice(0, 70)}`,
    );
    if (!result.pass) {
      if (result.matchMode === "stale_source") {
        fail(
          `stale P0 source in articles.json: [${item.source}] production=${trace.production_ts || "none"} older than ${freshnessFailMin}m`,
        );
      } else {
        fail(`missing P0 source in articles.json: [${item.source}] ${item.title.slice(0, 80)}`);
      }
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
