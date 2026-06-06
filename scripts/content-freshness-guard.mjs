/**
 * content_freshness_guard — P0 RSS latest vs production latest (NOT generatedAt).
 *
 * Run: node scripts/content-freshness-guard.mjs
 *
 * Env:
 *   CONTENT_FRESHNESS_WARN_MINUTES — default 60
 *   CONTENT_FRESHNESS_FAIL_MINUTES — default 120
 *   ARTICLES_JSON_PATH / ARTICLES_JSON_URL
 */
import fs from "fs";
import path from "path";
import { evaluateContentFreshnessPolicy, measureP0ContentGaps } from "./content-freshness-guard-lib.mjs";

const warnMin = Number(process.env.CONTENT_FRESHNESS_WARN_MINUTES || "60");
const failMin = Number(process.env.CONTENT_FRESHNESS_FAIL_MINUTES || "120");
const failOnGeneratedOnly =
  String(process.env.CONTENT_FRESHNESS_FAIL_GENERATED_ONLY || "1").toLowerCase() !== "0";

function log(msg) {
  console.log(`[content-freshness-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[content-freshness-guard] FAIL: ${msg}`);
}

async function main() {
  const report = await measureP0ContentGaps();

  log(`generatedAt=${report.generatedAt} articles=${report.articleCount}`);
  log(`content_newer_than_generatedAt=${report.contentNewerThanGenerated}`);

  for (const row of report.rows) {
    if (row.fetchError) {
      log(`source=${row.source} rss_fetch_error=${row.fetchError}`);
      continue;
    }
    const gap =
      row.gapMinutes === null
        ? "n/a"
        : row.gapMinutes === Infinity
          ? "inf"
          : row.gapMinutes.toFixed(1);
    log(
      `source=${row.source} rss_latest=${row.rssLatest?.iso || "none"} production_latest=${row.productionLatest?.iso || "none"} gap_minutes=${gap}`,
    );
  }

  const verdict = evaluateContentFreshnessPolicy(report, { warnMin, failMin, failOnGeneratedOnly });
  log(`pipeline_alive=${verdict.pipelineAlive ? "YES" : "NO"} sources_with_production=${verdict.sourcesWithProduction}`);

  for (const msg of verdict.hardFailReasons) {
    fail(msg);
  }
  for (const msg of verdict.softWarnReasons) {
    log(`WARN: ${msg}`);
  }

  const outPath = path.join(
    process.env.TEMP || process.env.TMP || ".",
    "iu_content_freshness_guard_report.json",
  );
  fs.writeFileSync(outPath, JSON.stringify({ ...report, verdict }, null, 2));
  log(`report=${outPath}`);

  if (verdict.failed) {
    console.error("[content-freshness-guard] RESULT=FAIL");
    process.exit(1);
  }
  log(`RESULT=${verdict.result}`);
}

main().catch((e) => {
  console.error("[content-freshness-guard] ERROR:", e.message || e);
  process.exit(1);
});
