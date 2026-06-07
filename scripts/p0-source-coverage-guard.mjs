/**
 * p0_source_coverage_guard — P0 sources must appear in release articles.json (not just inventory).
 *
 * Hard FAIL only when the bundle is dead or majority P0 coverage is missing without pipeline content.
 * PASS_WITH_WARN when pipeline publishes new content but isolated P0 slots lack a 4h article
 * (same contract as production-liveness-guard batch mode).
 *
 * Run: node scripts/p0-source-coverage-guard.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  P0_CONTENT_SOURCES,
  articleMatchesP0Source,
  effectivePublishedMs,
  loadArticlesDoc,
} from "./content-freshness-guard-lib.mjs";
import { countContentNewerThanGenerated } from "./production-liveness-guard.mjs";

/** When 4h window is empty but newest P0 article is within this age, warn only. */
export const P0_COVERAGE_SOFT_NEWEST_HOURS = 8;

function log(msg) {
  console.log(`[p0-source-coverage-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[p0-source-coverage-guard] FAIL: ${msg}`);
}

export function measureP0SourceCoverage(articles, options = {}) {
  const maxAgeH = Number(options.maxAgeHours ?? options.maxAgeH ?? 4);
  const minArticles = Number(options.minArticles ?? 1);
  const nowMs = options.nowMs ?? Date.now();
  const cutoff = nowMs - maxAgeH * 3_600_000;
  const maxFutureMs = 3_600_000;

  const rows = [];
  for (const def of P0_CONTENT_SOURCES) {
    let count = 0;
    let newestInWindow = null;
    let newestEver = null;
    for (const a of articles) {
      if (!articleMatchesP0Source(a, def)) continue;
      const t = effectivePublishedMs(a);
      if (t === null || t > nowMs + maxFutureMs) continue;
      if (!newestEver || t > newestEver) newestEver = t;
      if (t < cutoff) continue;
      count++;
      if (!newestInWindow || t > newestInWindow) newestInWindow = t;
    }
    const newestAgeMin = newestInWindow ? (nowMs - newestInWindow) / 60_000 : null;
    const newestEverAgeMin = newestEver ? (nowMs - newestEver) / 60_000 : null;
    rows.push({
      id: def.id,
      label: def.label,
      count,
      newestInWindow,
      newestEver,
      newestAgeMin,
      newestEverAgeMin,
      ok: count >= minArticles,
    });
  }
  return rows;
}

/**
 * Decide PASS / PASS_WITH_WARN / FAIL for per-source 4h coverage in articles.json.
 */
export function evaluateP0SourceCoveragePolicy(articles, options = {}) {
  const maxAgeH = Number(options.maxAgeHours ?? options.maxAgeH ?? 4);
  const minArticles = Number(options.minArticles ?? 1);
  const nowMs = options.nowMs ?? Date.now();
  const softNewestHours = Number(options.softNewestHours ?? P0_COVERAGE_SOFT_NEWEST_HOURS);
  const batchMode = Boolean(options.batchMode);
  const generatedAtTs =
    options.generatedAtTs ??
    (options.generatedAt ? Date.parse(String(options.generatedAt)) : null);

  const rows = measureP0SourceCoverage(articles, { maxAgeH, minArticles, nowMs });
  const totalSources = rows.length || P0_CONTENT_SOURCES.length;
  const passing = rows.filter((r) => r.ok);
  const failing = rows.filter((r) => !r.ok);
  const majorityPass = passing.length >= Math.ceil(totalSources / 2);

  const contentNewerThanGenerated = countContentNewerThanGenerated(
    articles,
    Number.isFinite(generatedAtTs) ? generatedAtTs : null,
  );
  const pipelineAlive = articles.length > 0 && contentNewerThanGenerated > 0;

  const hardFailReasons = [];
  const softWarnReasons = [];
  let hardFail = false;
  let warned = false;

  if (articles.length === 0) {
    hardFail = true;
    hardFailReasons.push("articles_empty");
  }

  const genAgeMin = generatedAtTs ? (nowMs - generatedAtTs) / 60_000 : null;
  if (
    genAgeMin !== null &&
    genAgeMin < 180 &&
    contentNewerThanGenerated === 0
  ) {
    hardFail = true;
    hardFailReasons.push("generatedAt_without_content");
  }

  const classifyFailure = (row) => {
    if (row.newestEverAgeMin !== null && row.newestEverAgeMin <= softNewestHours * 60) {
      return "soft_newest";
    }
    return "hard";
  };

  const hardFailing = [];
  const softNewestFailing = [];
  for (const row of failing) {
    const kind = classifyFailure(row);
    if (kind === "soft_newest") softNewestFailing.push(row);
    else hardFailing.push(row);
  }

  if (hardFailing.length >= totalSources && totalSources > 0) {
    hardFail = true;
    hardFailReasons.push("all_p0_sources_without_recent_coverage");
  }

  if (!pipelineAlive && !majorityPass && hardFailing.length > 0) {
    hardFail = true;
    hardFailReasons.push("majority_p0_sources_without_recent_coverage");
  }

  if (!hardFail && hardFailing.length > 0) {
    const canDowngrade =
      (pipelineAlive && passing.length >= 2) || (batchMode && contentNewerThanGenerated > 0);
    if (canDowngrade) {
      warned = true;
      for (const row of hardFailing) {
        softWarnReasons.push(
          `${row.label}: only ${row.count} articles in last ${maxAgeH}h (min ${minArticles}) (pipeline_alive)`,
        );
      }
    } else {
      hardFail = true;
      for (const row of hardFailing) {
        hardFailReasons.push(
          `${row.label}: only ${row.count} articles in last ${maxAgeH}h (min ${minArticles})`,
        );
      }
    }
  }

  if (!hardFail && softNewestFailing.length > 0) {
    warned = true;
    for (const row of softNewestFailing) {
      softWarnReasons.push(
        `${row.label}: 4h=${row.count} but newest within ${softNewestHours}h (PASS_WITH_WARN)`,
      );
    }
  }

  let result = "PASS";
  if (hardFail) result = "FAIL";
  else if (warned) result = "PASS_WITH_WARN";

  return {
    failed: hardFail,
    warned,
    result,
    rows,
    pipelineAlive,
    contentNewerThanGenerated,
    majorityPass,
    hardFailReasons,
    softWarnReasons,
    batchMode,
    generatedAtTs: Number.isFinite(generatedAtTs) ? generatedAtTs : null,
  };
}

async function main() {
  const maxAgeH = Number(process.env.P0_COVERAGE_MAX_AGE_HOURS || "4");
  const minArticles = Number(process.env.P0_COVERAGE_MIN_ARTICLES || "1");
  const batchMode =
    String(process.env.P0_COVERAGE_BATCH_MODE || process.env.LIVENESS_BATCH_MODE || "1").toLowerCase() !==
    "0";

  const doc = await loadArticlesDoc();
  const articles = Array.isArray(doc.articles) ? doc.articles : [];
  const generatedAtTs = doc.generatedAt ? Date.parse(String(doc.generatedAt)) : null;

  const policy = evaluateP0SourceCoveragePolicy(articles, {
    maxAgeH,
    minArticles,
    batchMode,
    generatedAt: doc.generatedAt,
    generatedAtTs: Number.isFinite(generatedAtTs) ? generatedAtTs : null,
  });

  log(`batch_mode=${batchMode ? "YES" : "NO"}`);
  log(
    `articles=${articles.length} content_newer_than_generatedAt=${policy.contentNewerThanGenerated}`,
  );
  if (policy.pipelineAlive) {
    log("pipeline_alive=YES");
  }

  for (const row of policy.rows) {
    log(
      `source=${row.label} recent_articles=${row.count} newest=${row.newestInWindow ? new Date(row.newestInWindow).toISOString() : "none"} window_h=${maxAgeH}`,
    );
  }

  for (const msg of policy.softWarnReasons) {
    log(`WARN: ${msg}`);
  }

  if (policy.failed) {
    for (const msg of policy.hardFailReasons) {
      fail(msg);
    }
  }

  const outPath = path.join(
    process.env.TEMP || process.env.TMP || ".",
    "iu_p0_source_coverage_report.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(policy, null, 2));
  log(`report=${outPath}`);

  if (policy.failed) {
    console.error("[p0-source-coverage-guard] RESULT=FAIL");
    process.exit(1);
  }
  log(`RESULT=${policy.result}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error("[p0-source-coverage-guard] ERROR:", e.message || e);
    process.exit(1);
  });
}
