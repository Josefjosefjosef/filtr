#!/usr/bin/env node
/**
 * Build Pexels initial import queue from plan — dry-run only.
 * Does NOT call Pexels API, does NOT download photos, does NOT require API key.
 * Run: npm run pexels-initial-import-queue-build
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_PATH = path.join(REPO, "docs", "pexels-initial-import-plan.json");
const QUEUE_PATH = path.join(REPO, "docs", "pexels-initial-import-queue.json");

function ceilDiv(a, b) {
  return Math.ceil(a / b);
}

function loadPlan() {
  return JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
}

function makeItem({
  id,
  galleryId,
  galleryType,
  targetCount,
  query,
  locale,
  orientation,
  photosPerPage,
  estimatedRequests,
  entityIndex,
  note,
}) {
  const item = {
    id,
    galleryId,
    galleryType,
    targetCount,
    query,
    locale,
    orientation,
    photosPerPage,
    estimatedRequests,
    status: "planned",
    dryRunOnly: true,
  };
  if (entityIndex != null) item.entityIndex = entityIndex;
  if (note) item.note = note;
  return item;
}

function buildGalleryItems(galleryType, galleries, photosPerPage, locale, orientation) {
  const items = [];
  for (const [galleryId, cfg] of Object.entries(galleries)) {
    const count = cfg.targetCount || 0;
    const queries = Array.isArray(cfg.searchQueries) ? cfg.searchQueries : ["generic"];
    const perQuery = ceilDiv(count, queries.length);
    const reqPerQuery = ceilDiv(perQuery, photosPerPage);
    for (let i = 0; i < queries.length; i++) {
      const query = queries[i];
      const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      items.push(
        makeItem({
          id: `${galleryId}-${i}-${slug}`,
          galleryId,
          galleryType,
          targetCount: perQuery,
          query,
          locale,
          orientation,
          photosPerPage,
          estimatedRequests: reqPerQuery,
        })
      );
    }
  }
  return items;
}

function buildSpecialItems(plan, photosPerPage, locale, orientation) {
  const items = [];
  const vp = plan.specialGalleries.verified_persons;
  const vpo = plan.specialGalleries.verified_places_objects;
  const gf = plan.specialGalleries.general_fallback;

  for (let i = 1; i <= vp.entityCountPlan; i++) {
    items.push(
      makeItem({
        id: `verified_persons-entity-${i}`,
        galleryId: "verified_persons",
        galleryType: "special",
        targetCount: vp.photosPerEntityPlan,
        query: `__ENTITY_QUERY_PENDING__`,
        locale,
        orientation,
        photosPerPage,
        estimatedRequests: ceilDiv(vp.photosPerEntityPlan, photosPerPage),
        entityIndex: i,
        note: "Každá osoba = samostatný search dotaz při budoucím importu; placeholder query.",
      })
    );
  }

  for (let i = 1; i <= vpo.entityCountPlan; i++) {
    items.push(
      makeItem({
        id: `verified_places_objects-entity-${i}`,
        galleryId: "verified_places_objects",
        galleryType: "special",
        targetCount: vpo.photosPerEntityPlan,
        query: `__ENTITY_QUERY_PENDING__`,
        locale,
        orientation,
        photosPerPage,
        estimatedRequests: ceilDiv(vpo.photosPerEntityPlan, photosPerPage),
        entityIndex: i,
        note: "Každé místo/objekt = samostatný search dotaz při budoucím importu; placeholder query.",
      })
    );
  }

  const gfQueries = gf.searchQueries;
  const gfPerQuery = ceilDiv(gf.targetCount, gfQueries.length);
  for (let i = 0; i < gfQueries.length; i++) {
    const query = gfQueries[i];
    const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    items.push(
      makeItem({
        id: `general_fallback-${i}-${slug}`,
        galleryId: "general_fallback",
        galleryType: "special",
        targetCount: gfPerQuery,
        query,
        locale,
        orientation,
        photosPerPage,
        estimatedRequests: ceilDiv(gfPerQuery, photosPerPage),
      })
    );
  }

  return items;
}

function buildQueue(plan) {
  const photosPerPage = plan.rateLimit.photosPerPage || 80;
  const hourlyLimit = plan.rateLimit.pexelsDefaultHourlyLimit || 200;
  const monthlyLimit = plan.rateLimit.pexelsDefaultMonthlyLimit || 20000;
  const locale = "en-US";
  const orientation = null;

  const sectionItems = buildGalleryItems(
    "section",
    plan.sectionGalleries,
    photosPerPage,
    locale,
    orientation
  );
  const supplementalItems = buildGalleryItems(
    "supplemental",
    plan.supplementalGalleries,
    photosPerPage,
    locale,
    orientation
  );
  const specialItems = buildSpecialItems(plan, photosPerPage, locale, orientation);

  const items = [...sectionItems, ...supplementalItems, ...specialItems];
  const estimatedQueueRequests = items.reduce((sum, it) => sum + it.estimatedRequests, 0);
  const withinHourly = estimatedQueueRequests <= hourlyLimit;
  const withinMonthly = estimatedQueueRequests <= monthlyLimit;
  const batchingRequired = estimatedQueueRequests > hourlyLimit;

  return {
    version: 1,
    description:
      "Manuální Pexels initial import queue V1 — plánovaná fronta z plánu, dry-run only, bez API volání",
    dryRunOnly: true,
    status: "planned",
    sourcePlan: "docs/pexels-initial-import-plan.json",
    governance: {
      pexelsManualInitialImportOnly: true,
      automaticDailyRefill: false,
      automaticWeeklyRefill: false,
      automaticGalleryTopup: false,
      automaticPexelsSync: false,
      cronImportAllowed: false,
      imageRemovedAfterUse: false,
      imageReusedAllowed: true,
      usageCountSupported: true,
      lastUsedAtSupported: true,
      feedImageLabelAlwaysVisible: true,
      feedImageLabelText: plan.governance?.feedImageLabelText || "Ilustrační foto",
      frontendPexelsApiCall: false,
      userPageLoadPexelsCall: false,
    },
    rateLimit: {
      pexelsDefaultHourlyLimit: hourlyLimit,
      pexelsDefaultMonthlyLimit: monthlyLimit,
      estimatedQueueRequests,
      estimatedWithinHourlyLimit: withinHourly,
      estimatedWithinMonthlyLimit: withinMonthly,
      importBatchingRequired: batchingRequired,
      maxRequestsPerBatch: batchingRequired ? hourlyLimit : estimatedQueueRequests,
      rateLimitBypassAllowed: false,
      stopOnRateLimitReached: plan.rateLimit.stopOnRateLimitReached ?? true,
      stopOnMonthlyBudgetReached: plan.rateLimit.stopOnMonthlyBudgetReached ?? true,
      rateLimitHeadersLogged: plan.rateLimit.rateLimitHeadersLogged ?? true,
      recommendedPauseMsBetweenRequests:
        plan.rateLimit.recommendedPauseMsBetweenRequests ?? 500,
    },
    items,
  };
}

function main() {
  const plan = loadPlan();
  const queue = buildQueue(plan);
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2) + "\n", "utf8");
  console.log("IMPORT_QUEUE_CREATED=YES");
  console.log("QUEUE_PATH=" + path.relative(REPO, QUEUE_PATH));
  console.log("QUEUE_ITEMS_COUNT=" + queue.items.length);
  console.log("ESTIMATED_QUEUE_REQUESTS=" + queue.rateLimit.estimatedQueueRequests);
  console.log(
    "ESTIMATED_WITHIN_HOURLY_LIMIT=" + (queue.rateLimit.estimatedWithinHourlyLimit ? "YES" : "NO")
  );
  console.log(
    "ESTIMATED_WITHIN_MONTHLY_LIMIT=" +
      (queue.rateLimit.estimatedWithinMonthlyLimit ? "YES" : "NO")
  );
  console.log(
    "IMPORT_BATCHING_REQUIRED=" + (queue.rateLimit.importBatchingRequired ? "YES" : "NO")
  );
  if (queue.rateLimit.importBatchingRequired) {
    console.log("MAX_REQUESTS_PER_BATCH=" + queue.rateLimit.maxRequestsPerBatch);
  }
  console.log("QUEUE_DRY_RUN_ONLY=YES");
  console.log("PEXELS_API_CALLED=NO");
  console.log("PHOTOS_DOWNLOADED=NO");
}

main();
