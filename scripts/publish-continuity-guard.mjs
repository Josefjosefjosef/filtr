/**
 * publish_continuity_guard — incremental publish enabled; no long dead gaps in model.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const localArticles = (process.env.ARTICLES_JSON_PATH || "").trim();
const FRESHNESS_URL = (process.env.FRESHNESS_URL || "").trim();
const REQUIRE_PROD = String(process.env.REQUIRE_PROD_FRESHNESS || "").toLowerCase() === "1";
const MAX_GAP_MIN = Number(process.env.MAX_PUBLISH_GAP_MINUTES || "90");
const MAX_LOCAL_AGE_MIN = Number(process.env.MAX_LOCAL_GENERATED_AGE_MINUTES || "30");

function log(msg) {
  console.log(`[publish-continuity-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[publish-continuity-guard] FAIL: ${msg}`);
}

function parseTs(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

async function main() {
  let failed = false;
  const wf = fs.readFileSync(
    path.join(root, ".github/workflows/update-articles.yml"),
    "utf8",
  );
  if (!/IU_INCREMENTAL_PUBLISH:\s*["']?1/.test(wf)) {
    fail("update-articles.yml missing IU_INCREMENTAL_PUBLISH on ingest");
    failed = true;
  } else {
    log("incremental publish in workflow PASS");
  }
  if (/IU_BUILD_ALL_FEEDS:\s*["']?1/.test(wf)) {
    fail("IU_BUILD_ALL_FEEDS still enabled in default ingest");
    failed = true;
  } else {
    log("no default full-feed ingest PASS");
  }

  if (localArticles && fs.existsSync(localArticles)) {
    const doc = JSON.parse(fs.readFileSync(localArticles, "utf8"));
    const genTs = parseTs(doc.generatedAt);
    if (!genTs) {
      fail("local articles.json missing generatedAt");
      failed = true;
    } else {
      const ageMin = (Date.now() - genTs) / 60_000;
      log(`local generatedAt=${doc.generatedAt} age_min=${ageMin.toFixed(1)}`);
      if (ageMin > MAX_LOCAL_AGE_MIN) {
        fail(`local generatedAt age ${ageMin.toFixed(1)}m > ${MAX_LOCAL_AGE_MIN}m`);
        failed = true;
      } else {
        log("local publish bundle fresh PASS");
      }
    }
  }

  if (REQUIRE_PROD && FRESHNESS_URL) {
    const res = await fetch(FRESHNESS_URL, {
      headers: { Accept: "application/json", "Cache-Control": "no-cache" },
    });
    if (!res.ok) {
      fail(`prod freshness HTTP ${res.status}`);
      failed = true;
    } else {
      const doc = await res.json();
      const genTs = parseTs(doc.generatedAt);
      if (!genTs) {
        fail("missing generatedAt on prod bundle");
        failed = true;
      } else {
        const ageMin = (Date.now() - genTs) / 60_000;
        log(`prod generatedAt=${doc.generatedAt} age_min=${ageMin.toFixed(1)}`);
        if (ageMin > MAX_GAP_MIN) {
          fail(`prod generatedAt gap ${ageMin.toFixed(1)}m > ${MAX_GAP_MIN}m`);
          failed = true;
        } else {
          log("prod bundle freshness PASS");
        }
      }
    }
  } else if (FRESHNESS_URL) {
    log("prod freshness check skipped (REQUIRE_PROD_FRESHNESS!=1)");
  }

  if (failed) {
    console.error("[publish-continuity-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("publish_continuity=incremental_per_tick+watchdog_15m");
  log("RESULT=PASS");
}

main();
