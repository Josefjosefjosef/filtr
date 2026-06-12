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
  evaluateContentFreshnessPolicy,
  extractItems,
  fetchFeedXml,
  filterRssCandidatesForBundleSnapshot,
  loadArticlesDoc,
  measureP0ContentGaps,
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
const freshnessWarnMin = Number(process.env.CONTENT_FRESHNESS_WARN_MINUTES || "60");
const freshnessFailMin = Number(process.env.CONTENT_FRESHNESS_FAIL_MINUTES || "120");
const freshnessFailMs = freshnessFailMin * 60_000;
const maxFutureMs = 3_600_000;
const dataRoot = path.join(__guardDir, "..", "projects", "data");
const poolManifestPath =
  process.env.ARTICLE_POOL_MANIFEST_PATH || path.join(dataRoot, "article_pool_manifest.json");
const schedulerStatePath =
  process.env.SCHEDULER_STATE_PATH || path.join(dataRoot, "scheduler_state.json");

function log(msg) {
  console.log(`[active-article-trace-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[active-article-trace-guard] FAIL: ${msg}`);
}

function warn(msg) {
  console.log(`[active-article-trace-guard] WARN: ${msg}`);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Ingest + rotation batch context for stale_source downgrade (aligned with content-freshness policy). */
export function loadTraceIngestContext(options = {}) {
  const poolPath = options.poolManifestPath || poolManifestPath;
  const schedPath = options.schedulerStatePath || schedulerStatePath;
  const pool = readJsonFile(poolPath);
  const scheduler = readJsonFile(schedPath);
  const ingestRef = pool && typeof pool.ingest_manifest_ref === "object" ? pool.ingest_manifest_ref : null;
  const batchKeys = new Set(
    Array.isArray(ingestRef?.sourceBatchKeys)
      ? ingestRef.sourceBatchKeys.map((k) => String(k).toLowerCase())
      : [],
  );
  const tick = scheduler && typeof scheduler.last_scheduler_tick === "object" ? scheduler.last_scheduler_tick : null;
  const selectedIds = new Set(
    Array.isArray(tick?.selected_source_ids) ? tick.selected_source_ids.map((id) => String(id)) : [],
  );
  return {
    sourceBatchKeys: batchKeys,
    selectedSourceIds: selectedIds,
    ingestManifestPresent: Boolean(ingestRef),
    schedulerStatePresent: Boolean(scheduler),
  };
}

export function p0InIngestBatch(def, context) {
  if (!def || !context?.ingestManifestPresent) return false;
  const slot = String(def.slotKey || "").toLowerCase();
  if (!slot || context.sourceBatchKeys.size === 0) return false;
  return context.sourceBatchKeys.has(slot);
}

export function p0InRotationBatch(def, context) {
  if (!def || !context?.schedulerStatePresent) return false;
  const feedIds = Array.isArray(def.feedIds) ? def.feedIds : [];
  if (feedIds.length === 0 || context.selectedSourceIds.size === 0) return false;
  return feedIds.some((id) => context.selectedSourceIds.has(String(id)));
}

/** Mirrors content-freshness-guard-lib gap>failMin downgrade when pipeline is alive. */
export function wouldContentFreshnessWarnForP0(def, report, verdict, options = {}) {
  if (!def || !report || !verdict?.pipelineAlive || verdict.failed) return false;
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const row = rows.find((r) => r.sourceId === def.id);
  if (!row || row.fetchError) return false;
  const failMin = options.failMin ?? freshnessFailMin;
  const totalSources = rows.length || P0_CONTENT_SOURCES.length;
  const sourcesWithProduction = rows.filter((r) => r.productionLatest && !r.fetchError).length;
  const majorityWithProduction = sourcesWithProduction >= Math.ceil(totalSources / 2);
  if (!majorityWithProduction) return false;
  if (row.gapMinutes === null) return false;
  if (row.gapMinutes === Infinity) {
    const infinityGapRows = rows.filter((r) => !r.fetchError && r.gapMinutes === Infinity);
    return infinityGapRows.length <= 2;
  }
  return row.gapMinutes > failMin;
}

/**
 * stale_source: FAIL by default; WARN when off ingest+rotation batch and content-freshness would WARN.
 * Returns { failed, action: "pass"|"warn"|"fail", reason? }.
 */
export function resolveStaleSourceTraceOutcome(traceResult, def, context, freshnessReport, freshnessVerdict, options = {}) {
  if (traceResult.pass || traceResult.matchMode !== "stale_source") {
    return { failed: false, action: "pass" };
  }
  if (p0InIngestBatch(def, context)) {
    return { failed: true, action: "fail", reason: "stale_source_in_ingest_batch" };
  }
  if (p0InRotationBatch(def, context)) {
    return { failed: true, action: "fail", reason: "stale_source_in_rotation_batch" };
  }
  if (!freshnessVerdict?.pipelineAlive) {
    return { failed: true, action: "fail", reason: "pipeline_not_alive" };
  }
  if (!wouldContentFreshnessWarnForP0(def, freshnessReport, freshnessVerdict, options)) {
    return { failed: true, action: "fail", reason: "stale_source_no_freshness_warn" };
  }
  return { failed: false, action: "warn", reason: "stale_source_off_batch_pipeline_alive" };
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
  let warned = false;
  const ingestContext = loadTraceIngestContext();
  const freshnessReport = await measureP0ContentGaps();
  const freshnessVerdict = evaluateContentFreshnessPolicy(freshnessReport, {
    warnMin: freshnessWarnMin,
    failMin: freshnessFailMin,
  });
  log(
    `pipeline_alive=${freshnessVerdict.pipelineAlive ? "YES" : "NO"} ingest_batch_keys=${ingestContext.sourceBatchKeys.size} rotation_selected=${ingestContext.selectedSourceIds.size}`,
  );

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
        const staleOutcome = resolveStaleSourceTraceOutcome(
          result,
          def,
          ingestContext,
          freshnessReport,
          freshnessVerdict,
          { failMin: freshnessFailMin },
        );
        const staleMsg = `stale P0 source in articles.json: [${item.source}] production=${trace.production_ts || "none"} older than ${freshnessFailMin}m`;
        if (staleOutcome.action === "warn") {
          warn(`${staleMsg} (off ingest/rotation batch, pipeline_alive)`);
          trace.dedupe_result = "stale_source_warn";
          trace.match_mode = "stale_source_warn";
          warned = true;
        } else {
          fail(staleMsg);
          failed = true;
        }
      } else {
        fail(`missing P0 source in articles.json: [${item.source}] ${item.title.slice(0, 80)}`);
        failed = true;
      }
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
        pipelineAlive: freshnessVerdict.pipelineAlive,
        ingestBatchKeys: [...ingestContext.sourceBatchKeys],
        rotationSelectedIds: [...ingestContext.selectedSourceIds],
        warned,
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
  log(`RESULT=${warned ? "PASS_WITH_WARN" : "PASS"}`);
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
