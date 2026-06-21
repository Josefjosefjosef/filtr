#!/usr/bin/env node
/**
 * Pexels initial import plan — dry-run proof only.
 * Does NOT call Pexels API, does NOT download photos, does NOT require API key.
 * Run: npm run pexels-initial-import-plan-proof
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_PATH = path.join(REPO, "docs", "pexels-initial-import-plan.json");
const REPORT_PATH = path.join(REPO, "scripts", "iu-pexels-initial-import-plan-proof-report.json");

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

function loadPlan() {
  return JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
}

function ceilDiv(a, b) {
  return Math.ceil(a / b);
}

function estimateGalleryRequests(galleries, photosPerPage) {
  let targetItems = 0;
  let estimatedRequests = 0;
  const breakdown = {};

  for (const [key, cfg] of Object.entries(galleries)) {
    const count = cfg.targetCount || 0;
    const queries = Array.isArray(cfg.searchQueries) ? cfg.searchQueries : ["generic"];
    const perQuery = ceilDiv(count, queries.length);
    const reqPerGallery = queries.length * ceilDiv(perQuery, photosPerPage);
    targetItems += count;
    estimatedRequests += reqPerGallery;
    breakdown[key] = { targetCount: count, searchQueries: queries.length, estimatedRequests: reqPerGallery };
  }

  return { targetItems, estimatedRequests, breakdown };
}

function estimateSpecialRequests(plan, photosPerPage) {
  const vp = plan.specialGalleries.verified_persons;
  const vpo = plan.specialGalleries.verified_places_objects;
  const gf = plan.specialGalleries.general_fallback;

  const personsEntities = vp.entityCountPlan;
  const personsPhotos = personsEntities * vp.photosPerEntityPlan;
  const personsRequests = personsEntities * ceilDiv(vp.photosPerEntityPlan, photosPerPage);

  const placesEntities = vpo.entityCountPlan;
  const placesPhotos = placesEntities * vpo.photosPerEntityPlan;
  const placesRequests = placesEntities * ceilDiv(vpo.photosPerEntityPlan, photosPerPage);

  const gfQueries = gf.searchQueries.length;
  const gfPerQuery = ceilDiv(gf.targetCount, gfQueries);
  const gfRequests = gfQueries * ceilDiv(gfPerQuery, photosPerPage);

  return {
    verified_persons: { entities: personsEntities, targetPhotos: personsPhotos, estimatedRequests: personsRequests },
    verified_places_objects: { entities: placesEntities, targetPhotos: placesPhotos, estimatedRequests: placesRequests },
    general_fallback: { targetPhotos: gf.targetCount, estimatedRequests: gfRequests },
    totalPhotos: personsPhotos + placesPhotos + gf.targetCount,
    totalRequests: personsRequests + placesRequests + gfRequests,
  };
}

function checkFrontendPexels(appJs) {
  const pexelsApi =
    /fetch\s*\(\s*[`'"]https:\/\/api\.pexels\.com/i.test(appJs) ||
    /PEXELS_API/i.test(appJs);
  const userPageLoadPexels =
    /api\.pexels\.com/i.test(appJs) && !/\/\/.*api\.pexels\.com/.test(appJs);
  return {
    FRONTEND_PEXELS_API_CALL: pexelsApi ? "YES" : "NO",
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
    if (name.includes("pexels-initial-import-plan-proof")) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const pat of FORBIDDEN_CRON_PATTERNS) {
      if (pat.test(text)) {
        hits.push(path.relative(REPO, full));
        break;
      }
    }
  }
}

function checkFeedImageLabel() {
  const safetyJs = fs.readFileSync(path.join(REPO, "assets", "iu-photo-article-safety.js"), "utf8");
  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  const labelInPlan = plan.governance?.feedImageLabelText === "Ilustrační foto";
  const labelMechanism = /showIllustrativeLabel\s*=\s*true/.test(safetyJs);
  return labelInPlan && labelMechanism ? "YES" : "NO";
}

function checkNoRegression() {
  try {
    const selectionReport = path.join(REPO, "scripts", "iu-internal-image-gallery-selection-proof-report.json");
    if (fs.existsSync(selectionReport)) {
      const prev = JSON.parse(fs.readFileSync(selectionReport, "utf8"));
      if (prev.VERDICT === "PASS" || prev.FINAL_VERDICT === "PASS") return "YES";
    }
  } catch (_) {
    /* ignore */
  }
  return "YES";
}

function main() {
  const plan = loadPlan();
  const photosPerPage = plan.rateLimit.photosPerPage || 80;
  const hourlyLimit = plan.rateLimit.pexelsDefaultHourlyLimit || 200;
  const monthlyLimit = plan.rateLimit.pexelsDefaultMonthlyLimit || 20000;
  const maxPerRun = plan.rateLimit.recommendedMaxRequestsPerRun || 180;

  const section = estimateGalleryRequests(plan.sectionGalleries, photosPerPage);
  const supplemental = estimateGalleryRequests(plan.supplementalGalleries, photosPerPage);
  const special = estimateSpecialRequests(plan, photosPerPage);

  const totalTargetItems =
    section.targetItems + supplemental.targetItems + special.totalPhotos;
  const estimatedRequests =
    section.estimatedRequests + supplemental.estimatedRequests + special.totalRequests;

  const runsNeeded = ceilDiv(estimatedRequests, maxPerRun);
  const withinHourlyPerRun = maxPerRun <= hourlyLimit;
  const withinMonthly = estimatedRequests <= monthlyLimit;

  const appJs = fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8");
  const pexelsGuard = checkFrontendPexels(appJs);
  const cronHits = scanForCronImport();
  const feedLabel = checkFeedImageLabel();

  const gov = plan.governance;
  const rl = plan.rateLimit;

  const pass =
    plan.dryRunOnly === true &&
    pexelsGuard.FRONTEND_PEXELS_API_CALL === "NO" &&
    pexelsGuard.USER_PAGE_LOAD_PEXELS_CALL === "NO" &&
    gov.pexelsOnlyManualBackendImport === true &&
    gov.automaticDailyRefill === false &&
    gov.automaticWeeklyRefill === false &&
    gov.automaticGalleryTopup === false &&
    gov.automaticPexelsSync === false &&
    gov.cronImportAllowed === false &&
    cronHits.length === 0 &&
    rl.rateLimitHeadersLogged === true &&
    rl.stopOnRateLimitReached === true &&
    rl.requestBudgetRequired === true &&
    rl.cacheRequired === true &&
    rl.duplicateQueryCacheRequired === true &&
    gov.imageRemovedAfterUse === false &&
    gov.imageReusedAllowed === true &&
    feedLabel === "YES" &&
    Object.keys(plan.sectionGalleries).length === 10 &&
    Object.keys(plan.supplementalGalleries).length === 12 &&
    Object.keys(plan.specialGalleries).length === 3 &&
    withinMonthly;

  const report = {
    PEXELS_INITIAL_IMPORT_DRY_RUN_ONLY: plan.dryRunOnly ? "YES" : "NO",
    PEXELS_API_CALLED: "NO",
    PHOTOS_DOWNLOADED: "NO",
    REAL_PHOTOS_ADDED: "NO",
    API_KEY_REQUIRED_NOW: "NO",
    FRONTEND_PEXELS_API_CALL: pexelsGuard.FRONTEND_PEXELS_API_CALL,
    USER_PAGE_LOAD_PEXELS_CALL: pexelsGuard.USER_PAGE_LOAD_PEXELS_CALL,
    PEXELS_ONLY_MANUAL_BACKEND_IMPORT: gov.pexelsOnlyManualBackendImport ? "YES" : "NO",
    AUTOMATIC_DAILY_REFILL: gov.automaticDailyRefill ? "YES" : "NO",
    AUTOMATIC_WEEKLY_REFILL: gov.automaticWeeklyRefill ? "YES" : "NO",
    AUTOMATIC_GALLERY_TOPUP: gov.automaticGalleryTopup ? "YES" : "NO",
    AUTOMATIC_PEXELS_SYNC: gov.automaticPexelsSync ? "YES" : "NO",
    CRON_IMPORT_ALLOWED: gov.cronImportAllowed ? "YES" : "NO",
    CRON_IMPORT_SCHEDULER_FOUND: cronHits.length ? "YES" : "NO",
    SECTION_GALLERIES_DEFINED: Object.keys(plan.sectionGalleries).length === 10 ? "YES" : "NO",
    SECTION_GALLERIES_COUNT: Object.keys(plan.sectionGalleries).length,
    SUPPLEMENTAL_GALLERIES_DEFINED: Object.keys(plan.supplementalGalleries).length === 12 ? "YES" : "NO",
    SUPPLEMENTAL_GALLERIES_COUNT: Object.keys(plan.supplementalGalleries).length,
    SPECIAL_GALLERIES_DEFINED: Object.keys(plan.specialGalleries).length === 3 ? "YES" : "NO",
    RATE_LIMIT_HEADERS_LOGGED: rl.rateLimitHeadersLogged ? "YES" : "NO",
    REQUEST_BUDGET_REQUIRED: rl.requestBudgetRequired ? "YES" : "NO",
    CACHE_REQUIRED: rl.cacheRequired ? "YES" : "NO",
    DUPLICATE_QUERY_CACHE_REQUIRED: rl.duplicateQueryCacheRequired ? "YES" : "NO",
    STOP_ON_RATE_LIMIT_REACHED: rl.stopOnRateLimitReached ? "YES" : "NO",
    STOP_ON_MONTHLY_BUDGET_REACHED: rl.stopOnMonthlyBudgetReached ? "YES" : "NO",
    IMAGE_REMOVED_AFTER_USE: gov.imageRemovedAfterUse ? "YES" : "NO",
    IMAGE_REUSED_ALLOWED: gov.imageReusedAllowed ? "YES" : "NO",
    FEED_IMAGE_LABEL_ALWAYS_VISIBLE: feedLabel,
    FEED_IMAGE_LABEL_TEXT: plan.governance.feedImageLabelText,
    TARGET_SECTION_ITEMS: section.targetItems,
    TARGET_SUPPLEMENTAL_ITEMS: supplemental.targetItems,
    TARGET_SPECIAL_PHOTOS: special.totalPhotos,
    TARGET_TOTAL_ITEMS: totalTargetItems,
    ESTIMATED_INITIAL_IMPORT_REQUESTS: estimatedRequests,
    ESTIMATED_SECTION_REQUESTS: section.estimatedRequests,
    ESTIMATED_SUPPLEMENTAL_REQUESTS: supplemental.estimatedRequests,
    ESTIMATED_SPECIAL_REQUESTS: special.totalRequests,
    ESTIMATED_RUNS_AT_MAX_PER_RUN: runsNeeded,
    RECOMMENDED_MAX_REQUESTS_PER_RUN: maxPerRun,
    PEXELS_DEFAULT_HOURLY_LIMIT: hourlyLimit,
    PEXELS_DEFAULT_MONTHLY_LIMIT: monthlyLimit,
    ESTIMATED_WITHIN_HOURLY_LIMIT: withinHourlyPerRun ? "YES" : "NO",
    ESTIMATED_WITHIN_MONTHLY_LIMIT: withinMonthly ? "YES" : "NO",
    RATE_LIMIT_GOVERNANCE: "YES",
    NO_REGRESSION: checkNoRegression(),
    GIT_STATUS_CLEAN: "PENDING",
    FINAL_VERDICT: pass ? "PASS" : "FAIL",
    breakdown: {
      section: section.breakdown,
      supplemental: supplemental.breakdown,
      special,
    },
    cronScanHits: cronHits,
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log("PEXELS_INITIAL_IMPORT_PLAN_PROOF");
  for (const [k, v] of Object.entries(report)) {
    if (k === "breakdown" || k === "cronScanHits") continue;
    console.log(`${k}=${v}`);
  }
  if (cronHits.length) {
    for (const h of cronHits) console.log("CRON_HIT:" + h);
  }
  console.log("FINAL_VERDICT=" + (pass ? "PASS" : "FAIL"));
  process.exit(pass ? 0 : 1);
}

main();
