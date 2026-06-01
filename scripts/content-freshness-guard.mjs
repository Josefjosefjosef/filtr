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
import { measureP0ContentGaps } from "./content-freshness-guard-lib.mjs";

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
  let failed = false;
  let warned = false;
  const report = await measureP0ContentGaps();

  log(`generatedAt=${report.generatedAt} articles=${report.articleCount}`);
  log(`content_newer_than_generatedAt=${report.contentNewerThanGenerated}`);

  if (failOnGeneratedOnly && report.generatedAtTs) {
    const genAgeMin = (Date.now() - report.generatedAtTs) / 60_000;
    if (genAgeMin < 180 && report.contentNewerThanGenerated === 0) {
      fail(
        `generatedAt fresh (${genAgeMin.toFixed(1)}m) but zero articles with publishedAt newer than generatedAt — content stale`,
      );
      failed = true;
    }
  }

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

    if (row.gapMinutes === Infinity) {
      fail(`${row.source}: RSS has items but none matched in production`);
      failed = true;
      continue;
    }
    if (row.gapMinutes !== null && row.gapMinutes > failMin) {
      fail(`${row.source}: freshness gap ${row.gapMinutes.toFixed(1)}m > ${failMin}m`);
      failed = true;
    } else if (row.gapMinutes !== null && row.gapMinutes > warnMin) {
      log(`WARN: ${row.source} freshness gap ${row.gapMinutes.toFixed(1)}m > ${warnMin}m`);
      warned = true;
    }
  }

  const outPath = path.join(
    process.env.TEMP || process.env.TMP || ".",
    "iu_content_freshness_guard_report.json",
  );
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  log(`report=${outPath}`);

  if (failed) {
    console.error("[content-freshness-guard] RESULT=FAIL");
    process.exit(1);
  }
  if (warned) {
    log("RESULT=PASS_WITH_WARN");
  } else {
    log("RESULT=PASS");
  }
}

main().catch((e) => {
  console.error("[content-freshness-guard] ERROR:", e.message || e);
  process.exit(1);
});
