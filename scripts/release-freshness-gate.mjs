/**
 * release_freshness_gate — block release when generatedAt is fresh but P0 content is stale.
 *
 * Run: node scripts/release-freshness-gate.mjs
 */
import { evaluateContentFreshnessPolicy, measureP0ContentGaps } from "./content-freshness-guard-lib.mjs";

const failMin = Number(process.env.RELEASE_FRESHNESS_FAIL_MINUTES || "120");
const warnMin = Number(process.env.RELEASE_FRESHNESS_WARN_MINUTES || "60");
const failOnGeneratedOnly =
  String(process.env.RELEASE_FRESHNESS_FAIL_GENERATED_ONLY || "1").toLowerCase() !== "0";

function log(msg) {
  console.log(`[release-freshness-gate] ${msg}`);
}

function fail(msg) {
  console.error(`[release-freshness-gate] FAIL: ${msg}`);
}

async function main() {
  const report = await measureP0ContentGaps();

  log(`generatedAt=${report.generatedAt} content_newer_than_generatedAt=${report.contentNewerThanGenerated}`);

  const verdict = evaluateContentFreshnessPolicy(report, { warnMin, failMin, failOnGeneratedOnly });
  log(`pipeline_alive=${verdict.pipelineAlive ? "YES" : "NO"} sources_with_production=${verdict.sourcesWithProduction}`);

  for (const msg of verdict.hardFailReasons) {
    fail(msg);
  }
  for (const msg of verdict.softWarnReasons) {
    log(`WARN: ${msg}`);
  }

  if (verdict.failed) {
    console.error("[release-freshness-gate] RESULT=FAIL");
    process.exit(1);
  }
  log(`RESULT=${verdict.result}`);
}

main().catch((e) => {
  console.error("[release-freshness-gate] ERROR:", e.message || e);
  process.exit(1);
});
