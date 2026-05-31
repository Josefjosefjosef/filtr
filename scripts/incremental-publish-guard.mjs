/**
 * incremental_publish_guard — bundle generatedAt + ingest telemetry show publish path is live.
 * Run: node scripts/incremental-publish-guard.mjs
 */
import fs from "fs";
import path from "path";
import { root } from "./source-rotation-guard-lib.mjs";

const articlesPath =
  process.env.ARTICLES_JSON_PATH || path.join(root, "projects", "data", "articles.json");
const telemetryPath =
  process.env.INGEST_TELEMETRY_PATH ||
  path.join(root, "projects", "data", "ingest_telemetry", "latest.json");
const maxGeneratedAgeH = Number(process.env.MAX_INCREMENTAL_GENERATED_AGE_HOURS || "72");

function log(msg) {
  console.log(`[incremental-publish-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[incremental-publish-guard] FAIL: ${msg}`);
}

function parseTs(v) {
  if (!v || typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function main() {
  let failed = false;

  if (!fs.existsSync(articlesPath)) {
    fail(`missing ${articlesPath}`);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(articlesPath, "utf8"));
  const genTs = parseTs(doc.generatedAt);
  const arts = Array.isArray(doc.articles) ? doc.articles : [];
  log(`articles=${arts.length} generatedAt=${doc.generatedAt || "n/a"}`);

  if (!genTs) {
    fail("articles.json missing valid generatedAt");
    failed = true;
  } else {
    const ageH = (Date.now() - genTs) / 3_600_000;
    log(`generatedAt age_hours=${ageH.toFixed(2)}`);
    if (ageH > maxGeneratedAgeH) {
      fail(`generatedAt older than ${maxGeneratedAgeH}h`);
      failed = true;
    } else {
      log("generatedAt freshness PASS");
    }
  }

  if (fs.existsSync(telemetryPath)) {
    const tel = JSON.parse(fs.readFileSync(telemetryPath, "utf8"));
    const last = tel.lastIngestAt || tel.ingestedAt || tel.updatedAt;
    log(`ingest_telemetry last=${last || "n/a"}`);
    if (!last) {
      log("WARN: ingest telemetry without timestamp (non-fatal)");
    } else {
      log("ingest telemetry present PASS");
    }
  } else {
    log("ingest telemetry missing (optional locally)");
  }

  if (process.env.REQUIRE_INCREMENTAL_PUBLISH_ENV === "1") {
    const wf = fs.readFileSync(
      path.join(root, ".github", "workflows", "update-articles.yml"),
      "utf8",
    );
    if (!/IU_INCREMENTAL_PUBLISH:\s*["']?1/.test(wf)) {
      fail("update-articles.yml missing IU_INCREMENTAL_PUBLISH=1 on ingest");
      failed = true;
    } else {
      log("workflow incremental publish env PASS");
    }
  }

  if (failed) {
    console.error("[incremental-publish-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("RESULT=PASS");
}

main();
