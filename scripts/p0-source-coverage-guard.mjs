/**
 * p0_source_coverage_guard — P0 sources must appear in production articles.json (not just inventory).
 *
 * Run: node scripts/p0-source-coverage-guard.mjs
 */
import {
  P0_CONTENT_SOURCES,
  articleMatchesP0Source,
  effectivePublishedMs,
  loadArticlesDoc,
} from "./content-freshness-guard-lib.mjs";

const maxAgeH = Number(process.env.P0_COVERAGE_MAX_AGE_HOURS || "4");
const minArticles = Number(process.env.P0_COVERAGE_MIN_ARTICLES || "1");

function log(msg) {
  console.log(`[p0-source-coverage-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[p0-source-coverage-guard] FAIL: ${msg}`);
}

async function main() {
  let failed = false;
  const doc = await loadArticlesDoc();
  const articles = Array.isArray(doc.articles) ? doc.articles : [];
  const cutoff = Date.now() - maxAgeH * 3_600_000;
  const now = Date.now();
  const maxFutureMs = 3_600_000;

  for (const def of P0_CONTENT_SOURCES) {
    let count = 0;
    let newest = null;
    for (const a of articles) {
      if (!articleMatchesP0Source(a, def)) continue;
      const t = effectivePublishedMs(a);
      if (t === null || t > now + maxFutureMs || t < cutoff) continue;
      count++;
      if (!newest || t > newest) newest = t;
    }
    log(
      `source=${def.label} recent_articles=${count} newest=${newest ? new Date(newest).toISOString() : "none"} window_h=${maxAgeH}`,
    );
    if (count < minArticles) {
      fail(`${def.label}: only ${count} articles in last ${maxAgeH}h (min ${minArticles})`);
      failed = true;
    }
  }

  if (failed) {
    console.error("[p0-source-coverage-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main().catch((e) => {
  console.error("[p0-source-coverage-guard] ERROR:", e.message || e);
  process.exit(1);
});
