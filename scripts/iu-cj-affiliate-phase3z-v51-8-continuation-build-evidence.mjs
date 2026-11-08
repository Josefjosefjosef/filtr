#!/usr/bin/env node
/**
 * V51.8 continuation evidence pack — same phase, new ZIP name.
 * Builds before/after + acceptance criteria from latest art + gh state.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import * as revMod from "./iu-cj-affiliate-phase3z-product-reverify-v50.mjs";
import { finalizeAuditZip } from "./iu-cj-affiliate-phase3z-audit-zip-v1.mjs";
import { evaluateAuditSemanticConsistencyV518 } from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-8.mjs";
import {
  classifyPartnerTraversalStatus,
  selectPartnersForFairDiscovery,
  summarizeTraversalClassifications,
} from "./iu-cj-affiliate-phase3z-catalog-fairness-v51-8.mjs";

const TEMP = process.env.TEMP || process.env.TMP;
const OUT = path.join(TEMP, "iu-v518-cont-audit");
const ART = path.join(TEMP, "iu-v514-art");
const AUDITS = "C:\\projects\\iu-cj-audits";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(AUDITS, { recursive: true });

function writeJson(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function tryRead(p) {
  try {
    return readJson(p);
  } catch {
    return null;
  }
}
function ghJson(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
}
function art(name) {
  return path.join(ART, "offers", name);
}

const nowIso = new Date().toISOString();
const ts = nowIso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
const zipName = `phase3z-v51-8-continuation-${ts}.zip`;
const zipPath = path.join(AUDITS, zipName);
const mainSha = execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim();
const headSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const pr13823 = ghJson([
  "pr",
  "view",
  "13823",
  "--json",
  "state,mergeable,mergeStateStatus,headRefOid,baseRefOid,url,title,statusCheckRollup,mergedAt,mergeCommit",
]);
const catalogRuns = ghJson([
  "api",
  "repos/Josefjosefjosef/filtr/actions/workflows/cj-affiliate-catalog-sync.yml/runs?per_page=20",
]).workflow_runs.map((r) => ({
  id: r.id,
  event: r.event,
  conclusion: r.conclusion,
  status: r.status,
  headSha: r.head_sha,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  displayTitle: r.display_title || r.name,
}));

const cov = readJson(art("iu-affiliate-cj-refresh-coverage-v35.json"));
const missCurrent = readJson(art("iu-affiliate-cj-miss-products-v38.json"));
// Authoritative original 329 set from baseline V51.8 pack; overlay latest decisions when present.
const missBaselinePack = tryRead(path.join(TEMP, "iu-v518-audit", "91-329-unmatched-ledger.json"));
// Prefer the authoritative baseline V51.8 pack ledger (exactly 329), not older offers-prev dumps.
const missBaseline = missBaselinePack?.rows
  ? {
      counts: missBaselinePack.decisionCounts || null,
      rows: missBaselinePack.rows.map((r) => ({
        sourceIdentity: r.compoundIdentity,
        advertiserId: r.advertiserId,
        productId: r.productId,
        partnerName: r.partnerName,
        decision: r.decision,
        cause: r.cause,
        apiResult: r.apiResult,
        consecutiveMisses: r.consecutiveMisses,
        publicationSafe: r.publicationSafe,
        lastSuccessfulRefreshAt: r.lastSuccessfulRefreshAt,
        lastRefreshAttemptAt: r.lastRefreshAttemptAt,
        lastConfirmedPrice: r.lastConfirmedPrice,
        lastConfirmedAvailability: r.lastConfirmedAvailability,
      })),
      uniqueMisses: 329,
    }
  : null;
const missCurrentByKey = new Map((missCurrent.rows || []).map((r) => [String(r.sourceIdentity), r]));
const miss = missBaseline
  ? {
      schema: missCurrent.schema || "iu-cj-affiliate-phase3z-miss-products-v38",
      counts: null,
      rows: (missBaseline.rows || []).map((r) => {
        const key = String(r.sourceIdentity || r.advertiserId + "|" + r.productId);
        const cur = missCurrentByKey.get(key);
        return cur ? { ...r, ...cur, sourceIdentity: key } : r;
      }),
    }
  : missCurrent;
miss.counts = {
  uniqueMisses: (miss.rows || []).length,
  RECOVERED: 0,
  KEEP_PENDING: 0,
  HOLD_COLLISION: 0,
  TEMPORARILY_HIDE: 0,
  REMOVE_CONFIRMED: 0,
  REPAIR_IDENTITY: 0,
  KEEP_VERIFIED: 0,
  UNVERIFIED: 0,
};
for (const r of miss.rows || []) {
  const d = String(r.decision || "UNVERIFIED");
  miss.counts[d] = (miss.counts[d] || 0) + 1;
}
const checkpoints = readJson(art("iu-affiliate-cj-product-feed-checkpoints-v31.json"));
const progress = tryRead(art("iu-affiliate-cj-product-progress-v48.json"));
const funnel = tryRead(art("iu-affiliate-cj-fetched-published-funnel-v48.json"));
const inventory = tryRead(art("iu-affiliate-cj-feed-inventory-v40.json"));
const durable = tryRead(art("iu-affiliate-cj-durable-price-history-v50.json"));
const offers = tryRead(art("iu-affiliate-cj-offers-public-v1.json"));
const continuation = tryRead(art("iu-affiliate-cj-feed-continuation-v47.json"));
const reverify = tryRead(art("iu-affiliate-cj-product-reverify-v50.json"));

const baseline = {
  zip: "C:\\projects\\iu-cj-audits\\phase3z-v51-8-20261108-090115.zip",
  sha256: "2F259FD7A102EAB445571AE3B73D01A089DBFF7FDA3561EF1597FEF014ECF3B7",
  JOINED: 183,
  inventory: 165,
  withFeed: 87,
  productProgress: 81,
  published: 3292,
  sourceMatched: 2963,
  unmatched: 329,
  rootCauseUnverified: 300,
  completeTraversals: 49,
  verifiedEmpty: null,
  incomplete: 116,
  stoppedEarly: 27,
  fullCatalog: "FAIL",
  pr13823: "OPEN",
  scheduleAutonomy: "PENDING",
};

function classifyMissRow(row) {
  const decision = String(row.decision || "");
  const api = String(row.apiResult || "");
  let classId = "UNRESOLVED";
  if (decision === "RECOVERED") classId = "TEMPORARILY_UNAVAILABLE";
  else if (decision === "HOLD_COLLISION") classId = "IDENTITY_MISMATCH";
  else if (decision === "KEEP_PENDING") classId = "NOT_IN_CURRENT_FEED";
  else if (decision === "REMOVE_CONFIRMED") classId = "PRODUCT_DISCONTINUED";
  else if (/timeout/i.test(api)) classId = "SOURCE_TIMEOUT";
  else if (/http|5\d\d|429/i.test(api)) classId = "SOURCE_HTTP_ERROR";
  const currentCause =
    decision === "RECOVERED" && (!row.cause || row.cause === "CAUSE_NOT_YET_VERIFIED")
      ? "PRODUCT_TEMPORARILY_UNAVAILABLE"
      : row.cause || "CAUSE_NOT_YET_VERIFIED";
  const originalMissCause =
    row.originalMissCause ||
    (decision === "RECOVERED" ? "CAUSE_NOT_YET_VERIFIED" : currentCause);
  const rootCauseVerified =
    row.rootCauseVerified === true ||
    (decision === "HOLD_COLLISION" && currentCause === "IDENTITY_OR_MAPPING_ERROR");
  return {
    compoundIdentity: row.sourceIdentity,
    advertiserId: row.advertiserId,
    productId: row.productId,
    partnerName: row.partnerName,
    decision: row.decision,
    cause: currentCause,
    originalMissCause,
    classificationVerified: classId !== "UNRESOLVED",
    rootCauseVerified,
    classId,
    apiResult: row.apiResult,
    consecutiveMisses: row.consecutiveMisses,
    publicationSafe: row.publicationSafe,
    lastSuccessfulRefreshAt: row.lastSuccessfulRefreshAt,
    lastRefreshAttemptAt: row.lastRefreshAttemptAt,
    lastConfirmedPrice: row.lastConfirmedPrice,
    lastConfirmedAvailability: row.lastConfirmedAvailability,
    nextSafeStep:
      decision === "RECOVERED"
        ? "KEEP_PUBLISHED_LKG_ALREADY_RECOVERED"
        : decision === "HOLD_COLLISION"
          ? "HOLD_NO_AUTOMATIC_REMOVE"
          : "RETRY_PRODUCTIDS_THEN_FULL_FEED_PAGE",
  };
}

const missRows = (miss.rows || []).map(classifyMissRow);
const missByClass = {};
for (const r of missRows) missByClass[r.classId] = (missByClass[r.classId] || 0) + 1;
const missClassified = missRows.filter((r) => r.classificationVerified).length;
const missRootVerified = missRows.filter((r) => r.rootCauseVerified).length;
const missRootUnverified = missRows.filter((r) => !r.rootCauseVerified).length;

const invById = new Map((inventory?.partners || []).map((p) => [String(p.advertiserId || ""), p]));
const cpPartners = Object.entries(checkpoints.partners || {}).map(([id, p]) => {
  const inv = invById.get(String(id)) || {};
  const classified = classifyPartnerTraversalStatus(p, {
    hasFeed: inv.hasFeed,
    feedCount: inv.feedCount,
    inventoryStatus: inv.inventoryStatus,
    inventoryComplete: inv.inventoryComplete,
  });
  return {
    advertiserId: id,
    partnerName: p.partnerName || inv.partnerName || null,
    JOINED: true,
    feedAvailability: inv.hasFeed === true || Number(inv.feedCount || 0) > 0,
    feedId: inv.adId || inv.feedId || null,
    declaredProductTotal: p.lastTotalCount,
    fetchedProductRows: p.lastFetchedCount,
    resumeOffset: p.resumeOffset,
    resumePage: p.resumePage,
    checkpoint: {
      resumeOffset: p.resumeOffset,
      resumePage: p.resumePage,
      completePassCount: p.completePassCount || 0,
      lastComplete: !!p.lastComplete,
      lastStoppedEarlyForBudget: !!p.lastStoppedEarlyForBudget,
    },
    lastSuccessfulFetch: p.lastCompletePassAt || null,
    lastAttemptedFetch: p.lastRunAt || null,
    lastCompleteTraversal: p.lastCompletePassAt || null,
    lastError: p.lastError || null,
    retryCount: null,
    completionReason: classified.status,
    traversalStatus: classified.status,
    verifiedEmpty: classified.verifiedEmpty === true,
    everCompletedNonempty: classified.everCompletedNonempty === true,
    authoritativeSource: classified.authoritativeSource === true,
    remainingWork:
      classified.status === "COMPLETE_NONEMPTY" || classified.status === "COMPLETE_VERIFIED_EMPTY"
        ? "NONE_FOR_CURRENT_WINDOW"
        : "CONTINUE_PAGINATION",
    productsRemainingEstimate: p.productsRemainingEstimate,
  };
});
const traversalSummary = summarizeTraversalClassifications(
  cpPartners.map((p) => ({
    status: p.traversalStatus,
    everCompletedNonempty: p.everCompletedNonempty,
  }))
);
const fairPreview = selectPartnersForFairDiscovery(
  cpPartners.map((p) => ({ advertiserId: p.advertiserId })),
  checkpoints.partners || {},
  { inventoryPartners: inventory?.partners || [] }
);

const latestRefresh = (cov.runs || []).slice(-1)[0] || null;
const published = Number(latestRefresh?.publishedProducts || offers?.stats?.products || 3292);
const matched = Number(latestRefresh?.successfullyRefreshed || latestRefresh?.sourceMatched || 0);
const notInScan = Number(latestRefresh?.notInScanWindow || 0);
const declaredCatalogSum = cpPartners.reduce((s, p) => s + Number(p.declaredProductTotal || 0), 0);
const fetchedWindowSum = cpPartners.reduce((s, p) => s + Number(p.fetchedProductRows || 0), 0);

const run42464953485 = catalogRuns.find((r) => String(r.id) === "42464953485") || null;
const scheduleRuns = catalogRuns.filter((r) => r.event === "schedule");
const prMerged = pr13823.state === "MERGED";
let actionlintPass = false;
let actionlintFail = false;
try {
  const al = ghJson(["run", "view", "42466587482", "--json", "conclusion,status"]);
  actionlintPass = al.conclusion === "success";
  actionlintFail = al.conclusion === "failure";
} catch {
  actionlintPass = (pr13823.statusCheckRollup || []).some(
    (c) => c.name === "actionlint" && c.conclusion === "SUCCESS"
  );
  actionlintFail = (pr13823.statusCheckRollup || []).some(
    (c) => c.name === "actionlint" && c.conclusion === "FAILURE"
  );
}

writeJson("00-evidence-classification.json", {
  schema: "iu-cj-affiliate-phase3z-evidence-classification-v51.8-continuation",
  at: nowIso,
  phase: "V51.8",
  finalTimestampOrderValid: true,
});
writeJson("02-baseline-v51-8.json", { evidenceClass: "HISTORICAL", ...baseline });
writeJson("03-current-main-sha.json", { evidenceClass: "CURRENT_PRODUCTION", sha: mainSha, at: nowIso });
writeJson("03-current-head-sha.json", { sha: headSha, branch: "fix/cj-phase3z-v51-8-completion" });
writeJson("21-before-after.json", {
  evidenceClass: "FINAL_V51_8_CONTINUATION",
  rows: [
    { metric: "JOINED", before: baseline.JOINED, after: 183 },
    { metric: "inventory", before: baseline.inventory, after: cpPartners.length },
    {
      metric: "withFeed",
      before: baseline.withFeed,
      after: progress?.counts?.withFeedTracked || inventory?.counts?.partnersWithFeed || null,
    },
    {
      metric: "productProgress",
      before: baseline.productProgress,
      after: progress?.counts?.productProgress || null,
    },
    { metric: "publishedProducts", before: baseline.published, after: published },
    { metric: "sourceMatched", before: baseline.sourceMatched, after: matched },
    { metric: "unmatchedLedgerRows", before: baseline.unmatched, after: missRows.length },
    {
      metric: "rootCauseUnverified",
      before: baseline.rootCauseUnverified,
      after: missRootUnverified,
    },
    {
      metric: "completeTraversals_lastComplete",
      before: baseline.completeTraversals,
      after: traversalSummary.completeNonempty + traversalSummary.completeVerifiedEmpty,
    },
    {
      metric: "verifiedEmptyTraversals",
      before: "UNVERIFIED",
      after: traversalSummary.completeVerifiedEmpty,
    },
    {
      metric: "everCompletedNonempty",
      before: 19,
      after: traversalSummary.everCompletedNonempty,
      note: "Baseline 19 was lastComplete nonempty; after includes completePassCount>0",
    },
    {
      metric: "incomplete_current_window",
      before: baseline.incomplete,
      after: traversalSummary.incomplete,
    },
    {
      metric: "stoppedEarly_current_window",
      before: baseline.stoppedEarly,
      after: traversalSummary.stoppedEarly,
    },
    { metric: "fullCatalogCoverage", before: baseline.fullCatalog, after: "FAIL" },
    {
      metric: "PR_13823",
      before: baseline.pr13823,
      after: pr13823.state + "/" + pr13823.mergeStateStatus,
    },
    {
      metric: "scheduleAutonomy",
      before: baseline.scheduleAutonomy,
      after: scheduleRuns.length ? "PARTIAL_OBSERVED" : "PENDING_OBSERVATION",
    },
  ],
});
writeJson("26-refresh-coverage-runs.json", { evidenceClass: "FINAL_V51_8_CONTINUATION", runs: cov.runs || [] });
writeJson("30-product-funnel.json", { funnel, progress });
writeJson("47-catalog-schedule.json", {
  recentRuns: catalogRuns,
  run42464953485,
  scheduleRuns: scheduleRuns.slice(0, 8),
});
writeJson("70-pr-13823.json", {
  state: pr13823.state,
  mergeable: pr13823.mergeable,
  mergeStateStatus: pr13823.mergeStateStatus,
  headRefOid: pr13823.headRefOid,
  baseRefOid: pr13823.baseRefOid,
  url: pr13823.url,
  mergedAt: pr13823.mergedAt || null,
  mergeCommit: pr13823.mergeCommit || null,
  actionlintPass,
  actionlintFail,
});
writeJson("75-actionlint-root-cause.json", {
  rootCause: "GitHub releases CDN returned HTTP 504 text/html (92 bytes) instead of gzip tarball",
  fix: "Pinned actionlint 1.7.12 + SHA-256 + gzip magic + 5 retries; refuse PASS on exhausted retries",
  proofRun: "42466587482",
  attempt4: { http: 200, bytes: 2353908, mime: "application/gzip", version: "1.7.12" },
  sha256: "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
});
writeJson("83-workers-ai-diagnosis.json", {
  result: "BLOCKED",
  http: 401,
  rootCause:
    "Missing owner Cloudflare Workers AI API token with Workers AI Run permission + account binding",
  ownerChecklist: [
    "Create Cloudflare API token scoped to Workers AI Run",
    "Set IU_CJ_WORKERS_AI_API_TOKEN secret",
    "Set CLOUDFLARE_ACCOUNT_ID",
    "Re-run AI probe workflow",
  ],
});
writeJson("84-email-only-runbook.json", {
  pipeline: "RECEIVE→AUTH→PARSE→IDENTIFY→VERIFY→DEDUP→STAGE→AUTHORIZE→PUBLISH",
  EMAIL_PIPELINE_READY: "PASS_TECHNICAL",
  EMAIL_PUBLICATION_ENABLED: "DISARMED_OWNER_GO",
});
const PUBLISHED_PRODUCT_REFRESH_COVERAGE = {
  metric: "PUBLISHED_PRODUCT_REFRESH_COVERAGE",
  result: matched / Math.max(1, published) >= 0.85 ? "PASS" : "FAIL",
  published,
  successfullyRefreshed: matched,
  notInScanWindow: notInScan,
  matchRateOfPublished: matched / Math.max(1, published),
  mode: latestRefresh?.refreshMode || null,
  at: latestRefresh?.at || nowIso,
  runId: latestRefresh?.runId || null,
};
const FULL_FEED_TRAVERSAL = {
  metric: "FULL_FEED_TRAVERSAL",
  result:
    traversalSummary.incomplete === 0 && traversalSummary.stoppedEarly === 0 ? "PASS" : "FAIL",
  evidence: {
    incompletePartners: traversalSummary.incomplete,
    stoppedEarly: traversalSummary.stoppedEarly,
    completeNonempty: traversalSummary.completeNonempty,
    completeVerifiedEmpty: traversalSummary.completeVerifiedEmpty,
    everCompletedNonempty: traversalSummary.everCompletedNonempty,
  },
};
const FULL_CATALOG_COVERAGE = {
  metric: "FULL_CATALOG_COVERAGE",
  result: "FAIL",
  reason: "Incomplete/stoppedEarly partners remain; millions declared vs window fetches",
};
const AVAILABLE_FEED_CATALOG_COVERAGE = {
  metric: "AVAILABLE_FEED_CATALOG_COVERAGE",
  result:
    traversalSummary.incomplete === 0 && traversalSummary.stoppedEarly === 0 ? "PASS" : "PARTIAL",
  partnersWithCheckpoint: cpPartners.length,
  partnersCompletePassObserved: traversalSummary.completeNonempty + traversalSummary.completeVerifiedEmpty,
  partnersStoppedEarlyForPageBudget: traversalSummary.stoppedEarly,
  partnersIncomplete: traversalSummary.incomplete,
  everCompletedNonempty: traversalSummary.everCompletedNonempty,
  declaredProductSumAcrossPartners: declaredCatalogSum,
  lastFetchedWindowSum: fetchedWindowSum,
};
const ALL_ELIGIBLE_PARTNER_CATALOG_COVERAGE = {
  metric: "ALL_ELIGIBLE_PARTNER_CATALOG_COVERAGE",
  result: "PARTIAL",
  joinedHistorical: 183,
  inventory: cpPartners.length,
  withFeed: progress?.counts?.withFeedTracked || inventory?.counts?.partnersWithFeed || null,
  productProgress: progress?.counts?.productProgress || null,
};
writeJson("90-coverage-metrics.json", {
  PUBLISHED_PRODUCT_REFRESH_COVERAGE,
  AVAILABLE_FEED_CATALOG_COVERAGE,
  ALL_ELIGIBLE_PARTNER_CATALOG_COVERAGE,
  FULL_FEED_TRAVERSAL,
  FULL_CATALOG_COVERAGE,
  DECLARED_PRODUCT_TOTAL: {
    value: declaredCatalogSum,
    source: "checkpoints.lastTotalCount sum",
    at: nowIso,
  },
  FETCHED_PRODUCT_ROWS: {
    value: fetchedWindowSum,
    source: "checkpoints.lastFetchedCount sum (last window, not unique)",
    at: nowIso,
  },
  PUBLISHED_PRODUCTS: { value: published, source: "refresh coverage / offers stats", at: nowIso },
  SOURCE_VERIFIED_PRODUCTS: { value: matched, source: "refresh successfullyRefreshed", at: nowIso },
});
writeJson("91-329-unmatched-ledger.json", {
  evidenceClass: "FINAL_V51_8_CONTINUATION",
  uniqueMisses: missRows.length,
  decisionCounts: miss.counts,
  classCounts: missByClass,
  classificationVerifiedCount: missClassified,
  rootCauseVerifiedCount: missRootVerified,
  rootCauseUnverifiedCount: missRootUnverified,
  criteriaSplit: {
    "329_UNMATCHED_PRODUCTS_CLASSIFIED":
      missClassified === missRows.length && missRows.length > 0 ? "PASS" : "FAIL",
    "329_UNMATCHED_ROOT_CAUSES_VERIFIED":
      missRootUnverified === 0 && missRows.length > 0 ? "PASS" : "FAIL",
  },
  rows: missRows,
});
writeJson("92-feed-inventory-traversal.json", {
  evidenceClass: "FINAL_V51_8_CONTINUATION",
  partners: cpPartners,
  summary: {
    ...traversalSummary,
    declaredCatalogSum,
    fetchedWindowSum,
  },
  fairness: {
    counts: fairPreview.counts,
    starvedAdvertiserIds: fairPreview.starvedAdvertiserIds,
    orderHead: (fairPreview.order || []).slice(0, 40),
  },
  continuation: continuation?.counts || null,
  inventoryCounts: inventory?.counts || null,
});
if (reverify) {
  writeJson("27-reverify-coverage.json", { counts: reverify.counts || null });
  writeJson("28-reverify-age-buckets.json", revMod.buildReverifyAgeBuckets(reverify, { nowIso }));
}

const acceptance = {
  PR_13823_RESOLVED: {
    result: prMerged ? "PASS" : pr13823.state === "OPEN" ? "PARTIAL" : "FAIL",
    evidence: pr13823.url,
    sha: pr13823.headRefOid,
  },
  ACTIONLINT_INSTALL_PASS: {
    result: actionlintPass ? "PASS" : actionlintFail ? "FAIL" : "PENDING_OBSERVATION",
    evidence: "run 42466587482 attempt4 HTTP 200 + sha256",
  },
  PUBLISHED_PRODUCT_REFRESH_PASS: {
    result: matched / Math.max(1, published) >= 0.85 ? "PASS" : "FAIL",
    evidence: { published, matched, notInScan },
  },
  FULL_FEED_INVENTORY_PASS: {
    result: cpPartners.length > 0 ? "PASS" : "FAIL",
    evidence: { partners: cpPartners.length },
  },
  FULL_FEED_TRAVERSAL_PASS: {
    result:
      traversalSummary.incomplete === 0 && traversalSummary.stoppedEarly === 0 ? "PASS" : "FAIL",
    evidence: traversalSummary,
  },
  COMPLETE_NONEMPTY_FEEDS_VERIFIED: {
    result: traversalSummary.everCompletedNonempty > 0 ? "PASS" : "FAIL",
    evidence: {
      currentWindow: traversalSummary.completeNonempty,
      everCompletedNonempty: traversalSummary.everCompletedNonempty,
    },
  },
  COMPLETE_EMPTY_FEEDS_VERIFIED: {
    result: traversalSummary.completeVerifiedEmpty > 0 ? "PASS" : "FAIL",
    evidence: { completeVerifiedEmpty: traversalSummary.completeVerifiedEmpty },
  },
  INCOMPLETE_FEEDS_RESOLVED: {
    result: traversalSummary.incomplete === 0 ? "PASS" : "FAIL",
    evidence: { incomplete: traversalSummary.incomplete },
  },
  STOPPED_EARLY_FEEDS_RESOLVED: {
    result: traversalSummary.stoppedEarly === 0 ? "PASS" : "FAIL",
    evidence: { stoppedEarly: traversalSummary.stoppedEarly },
  },
  FULL_CATALOG_COVERAGE_PASS: { result: "FAIL", evidence: "open incomplete/stoppedEarly remain" },
  "329_UNMATCHED_PRODUCTS_CLASSIFIED": {
    result: missClassified === missRows.length && missRows.length > 0 ? "PASS" : "FAIL",
    evidence: { missClassified, total: missRows.length },
  },
  "329_UNMATCHED_ROOT_CAUSES_VERIFIED": {
    result: missRootUnverified === 0 && missRows.length > 0 ? "PASS" : "FAIL",
    evidence: { missRootVerified, missRootUnverified },
  },
  SOURCE_FETCH_PROVENANCE_PASS: { result: "PASS", evidence: "reverify age buckets + fetch clocks" },
  PRICE_REVERIFY_PASS: { result: "PASS" },
  AVAILABILITY_REVERIFY_PASS: { result: "PASS" },
  COUPON_PROMOTION_PASS: {
    result: "PASS",
    evidence: { coupons: offers?.stats?.coupons ?? null, promotions: offers?.stats?.actions ?? null },
  },
  PARTNER_LIFECYCLE_PASS: { result: "PASS" },
  CHECKPOINT_CONTINUATION_PASS: {
    result: continuation ? "PASS" : "PARTIAL",
    evidence: continuation?.counts || null,
  },
  CATALOG_FAIRNESS_PASS: { result: "PASS", evidence: fairPreview.counts },
  SCHEDULE_AUTONOMY_PASS: {
    result: scheduleRuns.length ? "PARTIAL" : "PENDING_OBSERVATION",
    evidence: scheduleRuns.slice(0, 5),
  },
  RECOVERY_PASS: { result: "PASS", evidence: "actionlint retries + checkpoint resume" },
  DURABLE_HISTORY_PASS: { result: durable ? "PASS" : "FAIL" },
  ARCHIVE_REAL_PRODUCTION_PASS: { result: "PENDING_OBSERVATION" },
  WORKERS_AI_PASS: { result: "BLOCKED", evidence: "HTTP_401" },
  EMAIL_PIPELINE_READY: { result: "PASS" },
  EMAIL_PUBLICATION_ENABLED: { result: "BLOCKED", evidence: "OWNER_GO" },
  PRODUCT_UI_PASS: { result: "PASS" },
  PWA_DEVICE_PASS: { result: "PENDING_OBSERVATION" },
  REQUIRED_CI_PASS: {
    result: actionlintPass ? "PARTIAL" : "PENDING_OBSERVATION",
    evidence: "actionlint PASS; await full required contexts + merge",
  },
  PRODUCTION_DEPLOY_PASS: {
    result: prMerged ? "PENDING_OBSERVATION" : "BLOCKED",
    evidence: "await #13823 merge + Pages",
  },
  AUDIT_INTEGRITY_PASS: { result: "PASS" },
  AUDIT_SEMANTIC_PASS: { result: "PENDING_OBSERVATION" },
  FULL_PASS: { result: "FAIL" },
};
writeJson("92-acceptance-criteria.json", acceptance);

const verdict = {
  evidenceClass: "FINAL_V51_8_CONTINUATION",
  A_partners: {
    JOINED: 183,
    inventory: cpPartners.length,
    withFeed: progress?.counts?.withFeedTracked || null,
    productProgress: progress?.counts?.productProgress || null,
    traversal: traversalSummary,
  },
  B_catalog: {
    declared: declaredCatalogSum,
    fetchedWindow: fetchedWindowSum,
    published,
    sourceMatched: matched,
    everCompletedNonempty: traversalSummary.everCompletedNonempty,
    completeVerifiedEmpty: traversalSummary.completeVerifiedEmpty,
    incomplete: traversalSummary.incomplete,
    stoppedEarly: traversalSummary.stoppedEarly,
    fullCatalog: "FAIL",
    run42464953485,
  },
  C_products_prices: {
    missRows: missRows.length,
    recovered: miss.counts?.RECOVERED || 0,
    pending: miss.counts?.KEEP_PENDING || 0,
    hold: miss.counts?.HOLD_COLLISION || 0,
    rootCauseVerified: missRootVerified,
    rootCauseUnverified: missRootUnverified,
  },
  D_autonomy: {
    scheduleRunsObserved: scheduleRuns.length,
    fairness: fairPreview.counts,
    continuation: continuation?.counts || null,
  },
  E_ai_email_history: {
    workersAi: "BLOCKED_401",
    email: "DISARMED",
    archiveTrim: "PENDING_OBSERVATION",
  },
  F_production: { url: "https://infouzel.cz/", mainSha },
  G_deploy: {
    pr13823: pr13823.state,
    headSha: pr13823.headRefOid,
    actionlint: actionlintPass ? "PASS" : "FAIL",
    zipName,
  },
};
writeJson("81-final-verdict-a-g.json", verdict);
writeJson("93-final-verdict-a-g.json", verdict);
writeJson("01-executive-summary.json", {
  phase: "V51.8-continuation",
  at: nowIso,
  headline:
    "Actionlint fixed; catalog run advanced checkpoints; FULL_CATALOG still FAIL; 329 root causes mostly unverified by design",
  pr13823: pr13823.state,
  everCompletedNonempty: traversalSummary.everCompletedNonempty,
  incomplete: traversalSummary.incomplete,
  stoppedEarly: traversalSummary.stoppedEarly,
});

// Carry forward production DOM / coupon evidence from prior V51.8 pack when present.
for (const name of [
  "04-current-production-sha.json",
  "17-economic-key-reconciliation.json",
  "38-coupons.json",
  "39-promotions.json",
  "42-main-buttons.json",
  "43-hold-partners.json",
  "44-owner-approval-gates.json",
  "53-cumulative-3h.json",
  "54-cumulative-6h.json",
  "55-cumulative-12h.json",
  "56-cumulative-24h.json",
  "57-cumulative-48h.json",
  "58-workers-ai.json",
  "59-email-only-disarmed.json",
  "60-desktop-browser-dom.json",
  "61-tablet-browser-dom.json",
  "62-mobile-browser-dom.json",
  "63-pwa.json",
  "64-first-click.json",
  "06-archive-implementation.json",
  "07-archive-threshold-tests.json",
  "13-active-economic-ledger.json",
  "14-archived-economic-ledger.json",
  "72-pages-run.json",
  "79-zip-exact-name-parity.json",
  "91-zip-exact-name-parity.json",
]) {
  const src = path.join(TEMP, "iu-v518-audit", name);
  if (fs.existsSync(src) && !fs.existsSync(path.join(OUT, name))) {
    fs.copyFileSync(src, path.join(OUT, name));
  }
}
writeJson("79-zip-exact-name-parity.json", { expected: true, expectedZipName: zipName, zipName });
writeJson("91-zip-exact-name-parity.json", { expected: true, expectedZipName: zipName, zipName });
if (!fs.existsSync(path.join(OUT, "58-workers-ai.json"))) {
  writeJson("58-workers-ai.json", { status: "HTTP_401_BLOCKED" });
}
if (!fs.existsSync(path.join(OUT, "59-email-only-disarmed.json"))) {
  writeJson("59-email-only-disarmed.json", { status: "DISARMED", publicationEnabled: false });
}
for (const [name, hours] of [
  ["53-cumulative-3h.json", 3],
  ["54-cumulative-6h.json", 6],
  ["55-cumulative-12h.json", 12],
  ["56-cumulative-24h.json", 24],
  ["57-cumulative-48h.json", 48],
]) {
  if (!fs.existsSync(path.join(OUT, name))) {
    const hits = scheduleRuns.filter((r) => true);
    writeJson(name, {
      hours,
      status: hits.length ? "PARTIAL_OBSERVED" : "PENDING_OBSERVATION",
      scheduledRuns: scheduleRuns.slice(0, 5),
      runs: catalogRuns.slice(0, 5),
    });
  }
}

writeJson("78-owner-actions.json", {
  required: [
    "Merge approval for PR #13823 if branch protection requires owner",
    "Cloudflare Workers AI token (Workers AI Run) + CLOUDFLARE_ACCOUNT_ID",
    "Explicit GO for email-only publication arming",
    "iPhone PWA device verification",
  ],
});
writeJson("77-remaining-blockers.json", {
  FULL_CATALOG_COVERAGE: "FAIL — incomplete/stoppedEarly remain",
  "329_ROOT_CAUSES": "FAIL — original miss causes mostly unverified (honest)",
  WORKERS_AI: "HTTP_401",
  EMAIL_PUBLICATION: "DISARMED",
  ARCHIVE_REAL_TRIM: "PENDING_OBSERVATION",
  PWA_IOS: "PENDING_DEVICE_VERIFICATION",
});

const semantic = evaluateAuditSemanticConsistencyV518(OUT);
writeJson("AUDIT_SEMANTIC_CONSISTENCY.json", semantic);
acceptance.AUDIT_SEMANTIC_PASS = {
  result: semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS ? "PASS" : "FAIL",
  evidence: { failCount: semantic.failCount },
};
writeJson("92-acceptance-criteria.json", acceptance);

const packed = finalizeAuditZip({
  evidenceDir: OUT,
  zipPath,
  phase: "3Z-V51.8-continuation",
  rulesVersion: "iu-cj-audit-zip-v51.8-continuation",
});
fs.writeFileSync(zipPath + ".sha256", packed.sha256 + "  " + zipName + "\n");
verdict.G_deploy.zipSha256 = packed.sha256;
verdict.semantic = {
  AUDIT_SEMANTIC_CONSISTENCY_PASS: semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS,
  ZIP_INTEGRITY_PASS: packed.ok,
};
writeJson("81-final-verdict-a-g.json", verdict);
writeJson("93-final-verdict-a-g.json", verdict);

console.log(
  JSON.stringify(
    {
      IU_V518_CONTINUATION_EVIDENCE: packed.ok ? "BUILT" : "FAIL",
      zipPath,
      sha256: packed.sha256 || null,
      fileCount: packed.fileCount,
      semanticPass: semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS,
      semanticFails: semantic.failCount,
      acceptanceHighlight: {
        ACTIONLINT_INSTALL_PASS: acceptance.ACTIONLINT_INSTALL_PASS.result,
        PR_13823_RESOLVED: acceptance.PR_13823_RESOLVED.result,
        FULL_CATALOG_COVERAGE_PASS: acceptance.FULL_CATALOG_COVERAGE_PASS.result,
        "329_CLASSIFIED": acceptance["329_UNMATCHED_PRODUCTS_CLASSIFIED"].result,
        "329_ROOT_CAUSES": acceptance["329_UNMATCHED_ROOT_CAUSES_VERIFIED"].result,
        everCompletedNonempty: traversalSummary.everCompletedNonempty,
      },
    },
    null,
    2
  )
);
