#!/usr/bin/env node
/**
 * Pexels initial import queue — dry-run proof only.
 * Does NOT call Pexels API, does NOT download photos, does NOT require API key.
 * Run: npm run pexels-initial-import-queue-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_PATH = path.join(REPO, "docs", "pexels-initial-import-plan.json");
const QUEUE_PATH = path.join(REPO, "docs", "pexels-initial-import-queue.json");
const BUILD_SCRIPT = path.join(REPO, "scripts", "iu-pexels-initial-import-queue-build.mjs");
const REPORT_PATH = path.join(REPO, "scripts", "iu-pexels-initial-import-queue-proof-report.json");

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

const QUEUE_EXCLUDE_NAMES = [
  "pexels-initial-import-plan-proof",
  "pexels-initial-import-queue-proof",
  "pexels-initial-import-queue-build",
];

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

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
    if (QUEUE_EXCLUDE_NAMES.some((ex) => name.includes(ex))) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const pat of FORBIDDEN_CRON_PATTERNS) {
      if (pat.test(text)) {
        hits.push(path.relative(REPO, full));
        break;
      }
    }
  }
}

function validateQueue(queue) {
  const errors = [];
  if (!queue.dryRunOnly) errors.push("dryRunOnly must be true");
  if (queue.status !== "planned") errors.push("status must be planned");
  if (!Array.isArray(queue.items) || queue.items.length === 0) errors.push("items empty");

  let sumRequests = 0;
  for (const item of queue.items || []) {
    if (item.status !== "planned") errors.push(`item ${item.id}: status not planned`);
    if (item.dryRunOnly !== true) errors.push(`item ${item.id}: dryRunOnly not true`);
    if (!item.galleryId) errors.push(`item ${item.id}: missing galleryId`);
    if (!item.galleryType) errors.push(`item ${item.id}: missing galleryType`);
    if (!item.query) errors.push(`item ${item.id}: missing query`);
    if (typeof item.estimatedRequests !== "number") errors.push(`item ${item.id}: missing estimatedRequests`);
    sumRequests += item.estimatedRequests;
  }

  const rl = queue.rateLimit || {};
  if (rl.estimatedQueueRequests !== sumRequests) {
    errors.push(`estimatedQueueRequests mismatch: ${rl.estimatedQueueRequests} vs ${sumRequests}`);
  }

  const hourlyLimit = rl.pexelsDefaultHourlyLimit || 200;
  const monthlyLimit = rl.pexelsDefaultMonthlyLimit || 20000;
  const withinHourly = sumRequests <= hourlyLimit;
  const withinMonthly = sumRequests <= monthlyLimit;
  const batchingRequired = sumRequests > hourlyLimit;

  if (rl.estimatedWithinHourlyLimit !== withinHourly) {
    errors.push("estimatedWithinHourlyLimit mismatch");
  }
  if (rl.estimatedWithinMonthlyLimit !== withinMonthly) {
    errors.push("estimatedWithinMonthlyLimit mismatch");
  }
  if (rl.importBatchingRequired !== batchingRequired) {
    errors.push("importBatchingRequired mismatch");
  }
  if (batchingRequired && rl.maxRequestsPerBatch !== hourlyLimit) {
    errors.push("maxRequestsPerBatch must equal hourly limit when batching required");
  }
  if (rl.rateLimitBypassAllowed !== false) {
    errors.push("rateLimitBypassAllowed must be false");
  }

  return { errors, sumRequests, withinHourly, withinMonthly, batchingRequired };
}

function main() {
  if (!fs.existsSync(QUEUE_PATH)) {
    const build = spawnSync(process.execPath, [BUILD_SCRIPT], { encoding: "utf8" });
    if (build.status !== 0) {
      console.log("IMPORT_QUEUE_CREATED=NO");
      console.log("FINAL_VERDICT=FAIL");
      process.exit(1);
    }
  }

  const queue = loadJson(QUEUE_PATH);
  const plan = loadJson(PLAN_PATH);
  const validation = validateQueue(queue);
  const pexelsGuard = checkFrontendPexels();
  const cronHits = scanForCronImport();
  const gov = queue.governance || {};
  const rl = queue.rateLimit || {};

  const pass =
    validation.errors.length === 0 &&
    queue.dryRunOnly === true &&
    pexelsGuard.FRONTEND_PEXELS_API_CALL_FOUND === "NO" &&
    gov.pexelsManualInitialImportOnly === true &&
    gov.automaticDailyRefill === false &&
    gov.automaticWeeklyRefill === false &&
    gov.automaticGalleryTopup === false &&
    gov.automaticPexelsSync === false &&
    gov.cronImportAllowed === false &&
    gov.imageRemovedAfterUse === false &&
    gov.imageReusedAllowed === true &&
    gov.usageCountSupported === true &&
    gov.lastUsedAtSupported === true &&
    gov.feedImageLabelAlwaysVisible === true &&
    gov.feedImageLabelText === "Ilustrační foto" &&
    rl.rateLimitBypassAllowed === false &&
    rl.stopOnRateLimitReached === true &&
    rl.stopOnMonthlyBudgetReached === true &&
    cronHits.length === 0 &&
    validation.withinMonthly;

  const report = {
    PEXELS_MANUAL_INITIAL_IMPORT_ONLY: gov.pexelsManualInitialImportOnly ? "YES" : "NO",
    AUTOMATIC_DAILY_REFILL: gov.automaticDailyRefill ? "YES" : "NO",
    AUTOMATIC_WEEKLY_REFILL: gov.automaticWeeklyRefill ? "YES" : "NO",
    AUTOMATIC_GALLERY_TOPUP: gov.automaticGalleryTopup ? "YES" : "NO",
    AUTOMATIC_PEXELS_SYNC: gov.automaticPexelsSync ? "YES" : "NO",
    CRON_IMPORT_ALLOWED: gov.cronImportAllowed ? "YES" : "NO",
    PEXELS_API_CALLED: "NO",
    PHOTOS_DOWNLOADED: "NO",
    API_KEY_REQUIRED_NOW: "NO",
    REAL_PHOTOS_ADDED: "NO",
    IMPORT_QUEUE_CREATED: fs.existsSync(QUEUE_PATH) ? "YES" : "NO",
    QUEUE_DRY_RUN_ONLY: queue.dryRunOnly ? "YES" : "NO",
    QUEUE_ITEMS_COUNT: queue.items?.length ?? 0,
    ESTIMATED_QUEUE_REQUESTS: validation.sumRequests,
    ESTIMATED_WITHIN_HOURLY_LIMIT: validation.withinHourly ? "YES" : "NO",
    ESTIMATED_WITHIN_MONTHLY_LIMIT: validation.withinMonthly ? "YES" : "NO",
    IMPORT_BATCHING_REQUIRED: validation.batchingRequired ? "YES" : "NO",
    MAX_REQUESTS_PER_BATCH: validation.batchingRequired ? rl.maxRequestsPerBatch : validation.sumRequests,
    RATE_LIMIT_BYPASS_ALLOWED: rl.rateLimitBypassAllowed === false ? "NO" : "YES",
    STOP_ON_RATE_LIMIT_REACHED: rl.stopOnRateLimitReached ? "YES" : "NO",
    STOP_ON_MONTHLY_BUDGET_REACHED: rl.stopOnMonthlyBudgetReached ? "YES" : "NO",
    IMAGE_REMOVED_AFTER_USE: gov.imageRemovedAfterUse ? "YES" : "NO",
    IMAGE_REUSED_ALLOWED: gov.imageReusedAllowed ? "YES" : "NO",
    USAGE_COUNT_SUPPORTED: gov.usageCountSupported ? "YES" : "NO",
    LAST_USED_AT_SUPPORTED: gov.lastUsedAtSupported ? "YES" : "NO",
    FEED_IMAGE_LABEL_ALWAYS_VISIBLE: gov.feedImageLabelAlwaysVisible ? "YES" : "NO",
    FEED_IMAGE_LABEL_TEXT: gov.feedImageLabelText,
    FRONTEND_PEXELS_API_CALL_FOUND: pexelsGuard.FRONTEND_PEXELS_API_CALL_FOUND,
    USER_PAGE_LOAD_PEXELS_CALL: pexelsGuard.USER_PAGE_LOAD_PEXELS_CALL,
    CRON_IMPORT_SCHEDULER_FOUND: cronHits.length ? "YES" : "NO",
    PEXELS_DEFAULT_HOURLY_LIMIT: rl.pexelsDefaultHourlyLimit || 200,
    PEXELS_DEFAULT_MONTHLY_LIMIT: rl.pexelsDefaultMonthlyLimit || 20000,
    validationErrors: validation.errors,
    cronScanHits: cronHits,
    FINAL_VERDICT: pass ? "PASS" : "FAIL",
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("PEXELS_INITIAL_IMPORT_QUEUE_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "validationErrors" || k === "cronScanHits") continue;
    console.log(`${k}=${v}`);
  }
  if (validation.errors.length) {
    for (const e of validation.errors) console.log("VALIDATION_ERROR:" + e);
  }
  if (cronHits.length) {
    for (const h of cronHits) console.log("CRON_HIT:" + h);
  }
  console.log("FINAL_VERDICT=" + (pass ? "PASS" : "FAIL"));
  process.exit(pass ? 0 : 1);
}

main();
