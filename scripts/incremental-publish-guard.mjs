/**
 * incremental_publish_guard — bundle generatedAt + ingest telemetry show publish path is live.
 * Run: node scripts/incremental-publish-guard.mjs
 */
import fs from "fs";
import path from "path";
import { root } from "./source-rotation-guard-lib.mjs";
import {
  describeMediaArticleAggregationState,
  isMediaArticleAggregationEnabled,
  MEDIA_ARTICLE_CUTOVER_REL,
} from "./media-article-aggregation-state.mjs";

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

/**
 * @param {object} options
 * @param {boolean} [options.aggregationEnabled]
 * @param {object} [options.articlesDoc]
 * @param {number} [options.nowMs]
 * @param {number} [options.maxGeneratedAgeH]
 * @param {boolean} [options.requireIncrementalPublishEnv]
 * @param {string} [options.updateArticlesWorkflowText]
 */
export function evaluateIncrementalPublishGuard(options = {}) {
  const aggregationEnabled =
    options.aggregationEnabled ?? isMediaArticleAggregationEnabled(options.root ?? root);
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeH = options.maxGeneratedAgeH ?? maxGeneratedAgeH;
  const failures = [];

  if (!aggregationEnabled) {
    return {
      ok: true,
      skipped: true,
      aggregationEnabled: false,
      mediaArticleAggregation: "DISABLED",
      mediaArticleFreshnessCheck: "NOT_APPLICABLE",
      authoritativePath: MEDIA_ARTICLE_CUTOVER_REL,
      failures: [],
    };
  }

  const doc = options.articlesDoc;
  if (!doc || typeof doc !== "object") {
    failures.push("articles_doc_missing");
    return { ok: false, skipped: false, aggregationEnabled: true, failures };
  }

  const genTs = parseTs(doc.generatedAt);
  const arts = Array.isArray(doc.articles) ? doc.articles : [];

  if (!genTs) {
    failures.push("articles.json missing valid generatedAt");
  } else {
    const ageH = (nowMs - genTs) / 3_600_000;
    if (ageH > maxAgeH) {
      failures.push(`generatedAt older than ${maxAgeH}h`);
    }
    if (arts.length === 0) {
      failures.push("articles.json empty while media aggregation enabled");
    }
  }

  if (options.requireIncrementalPublishEnv) {
    const wf = options.updateArticlesWorkflowText ?? "";
    if (!/IU_INCREMENTAL_PUBLISH:\s*["']?1/.test(wf)) {
      failures.push("update-articles.yml missing IU_INCREMENTAL_PUBLISH=1 on ingest");
    }
  }

  return {
    ok: failures.length === 0,
    skipped: false,
    aggregationEnabled: true,
    mediaArticleAggregation: "ENABLED",
    mediaArticleFreshnessCheck: "ACTIVE",
    articlesCount: arts.length,
    generatedAt: doc.generatedAt || null,
    failures,
  };
}

function main() {
  const state = describeMediaArticleAggregationState();
  log(`MEDIA_ARTICLE_AGGREGATION=${state.mediaArticleAggregation}`);
  log(`AUTHORITATIVE_FEATURE_STATE=${state.authoritativePath}`);

  if (!state.enabled) {
    log(`MEDIA_ARTICLE_FRESHNESS_CHECK=${state.freshnessCheck}`);
    log("incremental_publish_freshness NOT_APPLICABLE_BECAUSE_FEATURE_DISABLED");
    log("RESULT=PASS");
    return;
  }

  log(`MEDIA_ARTICLE_FRESHNESS_CHECK=${state.freshnessCheck}`);

  if (!fs.existsSync(articlesPath)) {
    fail(`missing ${articlesPath}`);
    process.exit(1);
  }
  const doc = JSON.parse(fs.readFileSync(articlesPath, "utf8"));
  const arts = Array.isArray(doc.articles) ? doc.articles : [];
  log(`articles=${arts.length} generatedAt=${doc.generatedAt || "n/a"}`);

  let wfText = "";
  if (process.env.REQUIRE_INCREMENTAL_PUBLISH_ENV === "1") {
    wfText = fs.readFileSync(path.join(root, ".github", "workflows", "update-articles.yml"), "utf8");
  }

  const result = evaluateIncrementalPublishGuard({
    aggregationEnabled: true,
    articlesDoc: doc,
    requireIncrementalPublishEnv: process.env.REQUIRE_INCREMENTAL_PUBLISH_ENV === "1",
    updateArticlesWorkflowText: wfText,
  });

  if (doc.generatedAt) {
    const genTs = parseTs(doc.generatedAt);
    if (genTs) {
      const ageH = (Date.now() - genTs) / 3_600_000;
      log(`generatedAt age_hours=${ageH.toFixed(2)}`);
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

  if (process.env.REQUIRE_INCREMENTAL_PUBLISH_ENV === "1" && result.ok) {
    log("workflow incremental publish env PASS");
  }

  if (!result.ok) {
    for (const msg of result.failures) {
      fail(msg);
    }
    console.error("[incremental-publish-guard] RESULT=FAIL");
    process.exit(1);
  }
  log("generatedAt freshness PASS");
  log("RESULT=PASS");
}

main();
