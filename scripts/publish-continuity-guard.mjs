/**
 * publish_continuity_guard — incremental publish enabled; no long dead gaps in model.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateLocalArtifactFreshness, parseGeneratedAtTs } from "./publish-continuity-guard-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const localArticles = (process.env.ARTICLES_JSON_PATH || "").trim();
const FRESHNESS_URL = (process.env.FRESHNESS_URL || "").trim();
const REQUIRE_PROD = String(process.env.REQUIRE_PROD_FRESHNESS || "").toLowerCase() === "1";
const MAX_GAP_MIN = Number(process.env.MAX_PUBLISH_GAP_MINUTES || "90");
const MAX_LOCAL_AGE_MIN = Number(process.env.MAX_LOCAL_GENERATED_AGE_MINUTES || "30");
const RUNTIME_TOLERANCE_MIN = Number(process.env.LOCAL_ARTIFACT_RUNTIME_TOLERANCE_MINUTES || "60");
const WORKFLOW_RUN_STARTED_AT = (process.env.WORKFLOW_RUN_STARTED_AT || "").trim();
const GITHUB_RUN_ID = (process.env.GITHUB_RUN_ID || "").trim();

function log(msg) {
  console.log(`[publish-continuity-guard] ${msg}`);
}

function fail(msg) {
  console.error(`[publish-continuity-guard] FAIL: ${msg}`);
}

function parseTs(v) {
  return parseGeneratedAtTs(v);
}

function readArtifactPipelineRunId(articlesPath) {
  try {
    const manifestPath = path.join(path.dirname(articlesPath), "release_manifest.json");
    if (!fs.existsSync(manifestPath)) return null;
    const doc = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return String(doc.pipelineRunId || doc.winningIngestRunId || "").trim() || null;
  } catch {
    return null;
  }
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
    const artifactRunId = readArtifactPipelineRunId(localArticles);
    const verdict = evaluateLocalArtifactFreshness({
      generatedAt: doc.generatedAt,
      maxAgeMin: MAX_LOCAL_AGE_MIN,
      runtimeToleranceMin: RUNTIME_TOLERANCE_MIN,
      workflowRunStartedAt: WORKFLOW_RUN_STARTED_AT || null,
      githubRunId: GITHUB_RUN_ID || null,
      artifactPipelineRunId: artifactRunId,
    });

    log(`local generatedAt=${doc.generatedAt} age_min=${verdict.localArtifactAgeMin?.toFixed(1)}`);
    log(`LOCAL_ARTIFACT_CURRENT_RUN=${verdict.localArtifactCurrentRun}`);
    log(`LOCAL_ARTIFACT_AGE_MIN=${verdict.localArtifactAgeMin?.toFixed(1)}`);
    log(`LOCAL_ARTIFACT_LIMIT_MIN=${verdict.localArtifactLimitMin}`);
    log(`LOCAL_ARTIFACT_RUNTIME_TOLERANCE_MIN=${verdict.localArtifactRuntimeToleranceMin}`);
    log(`LOCAL_ARTIFACT_EFFECTIVE_LIMIT_MIN=${verdict.localArtifactEffectiveLimitMin}`);
    log(`RELEASE_ALLOWED=${verdict.releaseAllowed}`);

    if (verdict.releaseAllowed !== "YES") {
      fail(verdict.failReason || "local artifact freshness check failed");
      failed = true;
    } else {
      log("local publish bundle fresh PASS");
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
