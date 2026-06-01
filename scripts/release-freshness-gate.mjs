/**
 * release_freshness_gate — block release when generatedAt is fresh but P0 content is stale.
 *
 * Run: node scripts/release-freshness-gate.mjs
 */
import { measureP0ContentGaps } from "./content-freshness-guard-lib.mjs";

const failMin = Number(process.env.RELEASE_FRESHNESS_FAIL_MINUTES || "120");
const warnMin = Number(process.env.RELEASE_FRESHNESS_WARN_MINUTES || "60");

function log(msg) {
  console.log(`[release-freshness-gate] ${msg}`);
}

function fail(msg) {
  console.error(`[release-freshness-gate] FAIL: ${msg}`);
}

async function main() {
  let failed = false;
  let warned = false;
  const report = await measureP0ContentGaps();

  log(`generatedAt=${report.generatedAt} content_newer_than_generatedAt=${report.contentNewerThanGenerated}`);

  const genAgeMin = report.generatedAtTs ? (Date.now() - report.generatedAtTs) / 60_000 : null;
  if (genAgeMin !== null && genAgeMin < 180) {
    const staleP0 = report.rows.filter(
      (r) => r.gapMinutes !== null && (r.gapMinutes === Infinity || r.gapMinutes > failMin),
    );
    if (staleP0.length > 0) {
      fail(
        `fresh generatedAt (${genAgeMin.toFixed(1)}m) but ${staleP0.length} P0 sources stale > ${failMin}m — content stale release blocked`,
      );
      failed = true;
    }
    if (report.contentNewerThanGenerated === 0 && staleP0.length === 0) {
      log("WARN: generatedAt updated but no articles newer than generatedAt");
      warned = true;
    }
  }

  for (const row of report.rows) {
    if (row.gapMinutes === null || row.fetchError) continue;
    if (row.gapMinutes > failMin) {
      fail(`${row.source}: gap ${row.gapMinutes.toFixed(1)}m > ${failMin}m`);
      failed = true;
    } else if (row.gapMinutes > warnMin) {
      log(`WARN: ${row.source} gap ${row.gapMinutes.toFixed(1)}m`);
      warned = true;
    }
  }

  if (failed) {
    console.error("[release-freshness-gate] RESULT=FAIL");
    process.exit(1);
  }
  log(warned ? "RESULT=PASS_WITH_WARN" : "RESULT=PASS");
}

main().catch((e) => {
  console.error("[release-freshness-gate] ERROR:", e.message || e);
  process.exit(1);
});
