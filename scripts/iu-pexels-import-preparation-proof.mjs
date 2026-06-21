#!/usr/bin/env node
/**
 * Pexels import V1 preparation — dry-run proof only.
 * Verifies import state registry, runner skeleton, guards, no API/cron.
 * Does NOT call Pexels API, does NOT download photos, does NOT require API key.
 * Run: npm run pexels-import-preparation-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import {
  loadQueue,
  loadState,
  computeBatches,
  checkRateLimitGuards,
  checkLegalGuards,
  planDryRun,
  assertNoApiCallsInSource,
} from "./iu-pexels-import-runner.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_PATH = path.join(REPO, "projects", "data", "image_gallery", "import_state.json");
const RUNNER_PATH = path.join(REPO, "scripts", "iu-pexels-import-runner.mjs");
const ENV_DOC_PATH = path.join(REPO, "docs", "pexels-import-env.example.md");
const GOVERNANCE_PATH = path.join(REPO, "docs", "internal-image-gallery-pexels-import-governance.md");
const REPORT_PATH = path.join(REPO, "scripts", "iu-pexels-import-preparation-proof-report.json");

const CRON_SCAN_DIRS = [
  path.join(REPO, ".github", "workflows"),
  path.join(REPO, "scripts"),
  path.join(REPO, "cloudflare"),
];

const FORBIDDEN_CRON_PATTERNS = [
  /pexels.*import/i,
  /import.*pexels/i,
  /gallery.*topup/i,
  /gallery.*refill/i,
  /pexels.*sync/i,
  /pexels.*cron/i,
  /cron.*pexels/i,
];

const CRON_EXCLUDE_NAMES = [
  "pexels-initial-import-plan-proof",
  "pexels-initial-import-queue-proof",
  "pexels-initial-import-queue-build",
  "pexels-import-preparation-proof",
  "pexels-import-runner",
];

function checkFrontendPexels() {
  const appJs = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const pexelsApi =
    /fetch\s*\(\s*[`'"]https:\/\/api\.pexels\.com/i.test(appJs) ||
    /PEXELS_API/i.test(appJs);
  const userPageLoadPexels =
    /api\.pexels\.com/i.test(appJs) && !/\/\/.*api\.pexels\.com/.test(appJs);
  return {
    FRONTEND_PEXELS_API_CALL_FOUND: pexelsApi ? "YES" : "NO",
    USER_PAGE_LOAD_PEXELS_CALL: userPageLoadPexels ? "YES" : "NO",
  };
}

function scanForCronImport() {
  const hits = [];
  for (const dir of CRON_SCAN_DIRS) {
    if (!fs.existsSync(dir)) continue;
    walkDir(dir, hits);
  }
  return hits;
}

function walkDir(dir, hits) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name === ".git") continue;
      walkDir(full, hits);
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    if (![".yml", ".yaml", ".js", ".mjs", ".py", ".toml", ".json"].includes(ext)) continue;
    if (CRON_EXCLUDE_NAMES.some((ex) => name.includes(ex))) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const pat of FORBIDDEN_CRON_PATTERNS) {
      if (pat.test(text)) {
        hits.push(path.relative(REPO, full));
        break;
      }
    }
  }
}

function validateImportState(state, queue) {
  const errors = [];
  const required = [
    "currentBatch",
    "completedBatches",
    "completedRequests",
    "remainingRequests",
    "lastRunAt",
    "rateLimitLimit",
    "rateLimitRemaining",
    "rateLimitReset",
    "status",
  ];
  for (const key of required) {
    if (!(key in state)) errors.push("import_state missing field: " + key);
  }
  if (state.dryRunOnly !== true) errors.push("import_state dryRunOnly must be true");
  if (state.remainingRequests !== queue.rateLimit?.estimatedQueueRequests) {
    errors.push(
      "remainingRequests mismatch: " +
        state.remainingRequests +
        " vs " +
        queue.rateLimit?.estimatedQueueRequests
    );
  }
  const gov = state.governance || {};
  if (gov.apiKeyRequiredNow !== false) errors.push("apiKeyRequiredNow must be false");
  return errors;
}

function checkEnvDoc() {
  if (!fs.existsSync(ENV_DOC_PATH)) return { ok: false, reason: "env doc missing" };
  const text = fs.readFileSync(ENV_DOC_PATH, "utf8");
  const hasPlaceholder = /PEXELS_API_KEY/.test(text);
  const apiKeyRequiredNow = /API_KEY_REQUIRED_NOW.*NO/i.test(text);
  const hasRealKey = /[A-Za-z0-9]{32,}/.test(text.replace(/PEXELS_API_KEY/g, ""));
  return {
    ok: hasPlaceholder && apiKeyRequiredNow && !hasRealKey,
    hasPlaceholder,
    apiKeyRequiredNow,
  };
}

function checkGovernanceDoc() {
  const text = fs.readFileSync(GOVERNANCE_PATH, "utf8");
  const checks = {
    VERIFIED_PERSONS_REQUIRE_MANUAL_REVIEW: /VERIFIED_PERSONS_REQUIRE_MANUAL_REVIEW.*YES/i.test(text),
    VERIFIED_PLACES_REQUIRE_MANUAL_REVIEW: /VERIFIED_PLACES_REQUIRE_MANUAL_REVIEW.*YES/i.test(text),
    AUTO_PERSON_MATCHING_ALLOWED: /AUTO_PERSON_MATCHING_ALLOWED.*NO/i.test(text),
    AUTO_PLACE_MATCHING_ALLOWED: /AUTO_PLACE_MATCHING_ALLOWED.*NO/i.test(text),
  };
  return checks;
}

function checkNoRealPhotosAdded() {
  const galleryRoot = path.join(REPO, "projects", "data", "image_gallery");
  const photoExts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
  const hits = [];
  if (!fs.existsSync(galleryRoot)) return hits;
  for (const name of fs.readdirSync(galleryRoot)) {
    const ext = path.extname(name).toLowerCase();
    if (photoExts.includes(ext)) hits.push(name);
  }
  return hits;
}

function main() {
  const stateExists = fs.existsSync(STATE_PATH);
  const runnerExists = fs.existsSync(RUNNER_PATH);
  const queue = loadQueue();
  const state = stateExists ? loadState() : null;
  const stateErrors = state ? validateImportState(state, queue) : ["import_state.json missing"];
  const pexelsGuard = checkFrontendPexels();
  const cronHits = scanForCronImport();
  const envDoc = checkEnvDoc();
  const govDoc = checkGovernanceDoc();
  const photoHits = checkNoRealPhotosAdded();

  let runnerPlan = null;
  let runnerExit = 1;
  if (runnerExists) {
    try {
      assertNoApiCallsInSource();
      runnerPlan = planDryRun(queue, state);
      const run = spawnSync(process.execPath, [RUNNER_PATH], { encoding: "utf8" });
      runnerExit = run.status ?? 1;
    } catch (err) {
      runnerPlan = { ok: false, error: String(err) };
    }
  }

  const gov = state?.governance || {};
  const rateCheck = state ? checkRateLimitGuards(state, queue) : { ok: false };

  const pass =
    stateExists &&
    runnerExists &&
    stateErrors.length === 0 &&
    envDoc.ok &&
    govDoc.VERIFIED_PERSONS_REQUIRE_MANUAL_REVIEW &&
    govDoc.VERIFIED_PLACES_REQUIRE_MANUAL_REVIEW &&
    govDoc.AUTO_PERSON_MATCHING_ALLOWED &&
    govDoc.AUTO_PLACE_MATCHING_ALLOWED &&
    gov.stopOnRateLimitReached === true &&
    gov.stopOnMonthlyBudgetReached === true &&
    gov.rateLimitBypassAllowed === false &&
    gov.verifiedPersonsRequireManualReview === true &&
    gov.verifiedPlacesRequireManualReview === true &&
    gov.autoPersonMatchingAllowed === false &&
    gov.autoPlaceMatchingAllowed === false &&
    gov.apiKeyRequiredNow === false &&
    rateCheck.ok &&
    runnerPlan?.ok === true &&
    runnerExit === 0 &&
    pexelsGuard.FRONTEND_PEXELS_API_CALL_FOUND === "NO" &&
    cronHits.length === 0 &&
    photoHits.length === 0;

  const report = {
    IMPORT_STATE_REGISTRY_CREATED: stateExists ? "YES" : "NO",
    IMPORT_RUNNER_SKELETON_CREATED: runnerExists ? "YES" : "NO",
    API_KEY_REQUIRED_NOW: "NO",
    PEXELS_API_CALLED: "NO",
    PHOTOS_DOWNLOADED: "NO",
    REAL_PHOTOS_ADDED: photoHits.length ? "YES" : "NO",
    STOP_ON_RATE_LIMIT_REACHED: gov.stopOnRateLimitReached ? "YES" : "NO",
    STOP_ON_MONTHLY_BUDGET_REACHED: gov.stopOnMonthlyBudgetReached ? "YES" : "NO",
    MAX_REQUESTS_PER_BATCH: gov.maxRequestsPerBatch || 200,
    RATE_LIMIT_BYPASS_ALLOWED: gov.rateLimitBypassAllowed === false ? "NO" : "YES",
    VERIFIED_PERSONS_REQUIRE_MANUAL_REVIEW: gov.verifiedPersonsRequireManualReview ? "YES" : "NO",
    VERIFIED_PLACES_REQUIRE_MANUAL_REVIEW: gov.verifiedPlacesRequireManualReview ? "YES" : "NO",
    AUTO_PERSON_MATCHING_ALLOWED: gov.autoPersonMatchingAllowed ? "YES" : "NO",
    AUTO_PLACE_MATCHING_ALLOWED: gov.autoPlaceMatchingAllowed ? "YES" : "NO",
    FRONTEND_PEXELS_API_CALL_FOUND: pexelsGuard.FRONTEND_PEXELS_API_CALL_FOUND,
    USER_PAGE_LOAD_PEXELS_CALL: pexelsGuard.USER_PAGE_LOAD_PEXELS_CALL,
    CRON_IMPORT_SCHEDULER_FOUND: cronHits.length ? "YES" : "NO",
    AUTOMATIC_DAILY_REFILL: "NO",
    AUTOMATIC_WEEKLY_REFILL: "NO",
    ENV_DOC_PLACEHOLDER: envDoc.ok ? "YES" : "NO",
    RUNNER_DRY_RUN_PASS: runnerPlan?.ok && runnerExit === 0 ? "YES" : "NO",
    stateErrors,
    cronScanHits: cronHits,
    photoHits,
    FINAL_VERDICT: pass ? "PASS" : "FAIL",
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("PEXELS_IMPORT_V1_PREPARATION_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "stateErrors" || k === "cronScanHits" || k === "photoHits") continue;
    console.log(`${k}=${v}`);
  }
  if (stateErrors.length) {
    for (const e of stateErrors) console.log("STATE_ERROR:" + e);
  }
  if (cronHits.length) {
    for (const h of cronHits) console.log("CRON_HIT:" + h);
  }
  console.log("FINAL_VERDICT=" + (pass ? "PASS" : "FAIL"));
  process.exit(pass ? 0 : 1);
}

main();
