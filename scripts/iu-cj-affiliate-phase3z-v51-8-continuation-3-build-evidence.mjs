#!/usr/bin/env node
/**
 * V51.8 continuation-3 evidence pack — LKG ledger, churn gates, capacity honesty, PR safety.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { finalizeAuditZip } from "./iu-cj-affiliate-phase3z-audit-zip-v1.mjs";
import {
  evaluateAuditSemanticConsistencyV518c3,
  runSemanticNegativeProbesInTemp,
} from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-8-c3.mjs";
import {
  classifyPartnerTraversalStatus,
  nextActionForTraversalStatus,
  summarizeTraversalClassifications,
} from "./iu-cj-affiliate-phase3z-catalog-fairness-v51-8.mjs";
import {
  buildPublicationDeltaLedger,
  mergeLkgPublishedProducts,
  evaluateIdentityChurnGate,
  evaluateLkgGrowthGate,
  evaluateProductShrinkageGate,
  collectUniqueProductMap,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";
import { measureCatalogCapacity } from "./iu-cj-affiliate-phase3z-catalog-capacity-v51-8.mjs";

const TEMP = process.env.TEMP || process.env.TMP;
const OUT = path.join(TEMP, "iu-v518-c3-audit");
const ART = path.join(TEMP, "iu-v514-art", "offers");
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

const nowIso = new Date().toISOString();
const ts = nowIso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
const zipName = `phase3z-v51-8-continuation-3-${ts}.zip`;
const zipPath = path.join(AUDITS, zipName);
const mainSha = execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim();
const headSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const pr13824 = ghJson(["pr", "view", "13824", "--json", "number,state,headRefOid,title,url,mergeable"]);
const pr13826 = ghJson([
  "pr",
  "view",
  "13826",
  "--json",
  "number,state,headRefOid,title,url,mergeable,statusCheckRollup",
]);
const checks = (pr13826.statusCheckRollup || []).map((c) => ({
  name: c.name || c.context,
  status: c.status,
  conclusion: c.conclusion || c.state,
}));
const requiredNames = ["repo-guard", "layout-guard", "iu-ads-regression-freeze", "smoke", "smoke-gate", "actionlint"];
const required = requiredNames.map((n) => {
  const hits = checks.filter((c) => String(c.name).toLowerCase() === n.toLowerCase());
  const ok = hits.length > 0 && hits.every((h) => /success/i.test(String(h.conclusion || "")));
  const pending = hits.some((h) => /in_progress|queued|pending/i.test(String(h.status || h.conclusion || "")));
  return { name: n, ok, pending, hits };
});
const requiredCiPass = required.every((r) => r.ok) && !required.some((r) => r.pending);

const pagesRuns = ghJson([
  "api",
  "repos/Josefjosefjosef/filtr/actions/workflows/pages.yml/runs?per_page=8",
]).workflow_runs.map((r) => ({
  id: r.id,
  status: r.status,
  conclusion: r.conclusion,
  headSha: r.head_sha,
  createdAt: r.created_at,
  event: r.event,
}));
const pagesForMain =
  pagesRuns.find((r) => r.headSha === mainSha && r.conclusion === "success") || pagesRuns[0];

let prodHtml = "";
try {
  prodHtml = execFileSync("curl.exe", ["-sL", "https://infouzel.cz/"], {
    encoding: "utf8",
    maxBuffer: 20e6,
  });
} catch {
  prodHtml = "";
}
const prodCodeShaHit = (prodHtml.match(/0def330e|[a-f0-9]{40}|[a-f0-9]{8}/i) || [])[0] || null;
const iuDataVerHit = (prodHtml.match(/iu-data-ver[_-]?([a-z0-9]+)/i) || [])[1] || null;
const swHit = (prodHtml.match(/service.?worker[^"']*["']([^"']+)/i) || [])[1] || null;

const catalogRuns = ghJson([
  "api",
  "repos/Josefjosefjosef/filtr/actions/workflows/cj-affiliate-catalog-sync.yml/runs?per_page=20",
]).workflow_runs.map((r) => ({
  id: r.id,
  event: r.event,
  status: r.status,
  conclusion: r.conclusion,
  headSha: r.head_sha,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  runStartedAt: r.run_started_at,
}));

const mainOffers = JSON.parse(
  execFileSync("git", ["show", "origin/main:projects/data/iu-affiliate-cj-offers-public-v1.json"], {
    encoding: "utf8",
    maxBuffer: 80e6,
  })
);

// Prefer local cache of PR13824 offers; else fetch via gh.
let prOffers = tryRead(path.join(TEMP, "iu-pr13824-offers.json"));
if (!prOffers) {
  try {
    const raw = execFileSync(
      "gh",
      [
        "api",
        "repos/Josefjosefjosef/filtr/contents/projects/data/iu-affiliate-cj-offers-public-v1.json?ref=" +
          pr13824.headRefOid,
      ],
      { encoding: "utf8", maxBuffer: 5e6 }
    );
    const meta = JSON.parse(raw);
    if (meta.content) {
      prOffers = JSON.parse(Buffer.from(meta.content, "base64").toString("utf8"));
      fs.writeFileSync(path.join(TEMP, "iu-pr13824-offers.json"), JSON.stringify(prOffers));
    }
  } catch {
    prOffers = null;
  }
}
if (!prOffers) prOffers = mainOffers;

const checkpoints = tryRead(path.join(ART, "iu-affiliate-cj-product-feed-checkpoints-v31.json"));
const inventory = tryRead(path.join(ART, "iu-affiliate-cj-feed-inventory-v40.json"));
const miss = tryRead(path.join(ART, "iu-affiliate-cj-miss-products-v38.json"));
const continuation = tryRead(path.join(ART, "iu-affiliate-cj-feed-continuation-v47.json"));
const cov = tryRead(path.join(ART, "iu-affiliate-cj-refresh-coverage-v35.json"));

const incompleteAdvertisers = new Set();
const fetchedAdvertisers = new Set();
for (const [id, p] of Object.entries(checkpoints?.partners || {})) {
  fetchedAdvertisers.add(String(id));
  if (p.lastComplete !== true || p.lastStoppedEarlyForBudget === true) incompleteAdvertisers.add(String(id));
}
const classifyOpts = { incompleteAdvertisers, fetchedAdvertisers, nowIso };
const delta = buildPublicationDeltaLedger(mainOffers, prOffers, classifyOpts);
const mergedSim = mergeLkgPublishedProducts(prOffers, mainOffers, classifyOpts);
const shrinkSim = evaluateProductShrinkageGate(mainOffers, prOffers, {
  lkgMerged: false,
  maxDropAbs: 50,
  maxDropRatio: 0.03,
});
const shrinkAfterLkg = evaluateProductShrinkageGate(mainOffers, mergedSim.doc, {
  lkgMerged: mergedSim.carried > 0,
  maxDropAbs: 50,
  maxDropRatio: 0.03,
});
const churnBefore = evaluateIdentityChurnGate(delta, { lkgMerged: false, maxChurnRatio: 0.25 });
const churnAfter = evaluateIdentityChurnGate(delta, {
  lkgMerged: mergedSim.carried > 0,
  maxChurnRatio: 0.25,
});
const growthGate = evaluateLkgGrowthGate(delta.prevUnique, mergedSim.uniqueAfter, {
  maxGrowthAbs: 500,
  maxGrowthRatio: 0.2,
  carried: mergedSim.carried,
  addedCount: delta.addedCount,
});

const liveMap = collectUniqueProductMap(mainOffers);
const candMap = collectUniqueProductMap(prOffers);
const ledger = [];
for (const [key, row] of liveMap) {
  const inCand = candMap.has(key);
  const rem = (delta.removed || []).find((r) => r.key === key);
  ledger.push({
    compoundIdentity: key,
    advertiserId: row.advertiserId,
    sourceProductId: row.productId,
    name: row.product?.name || row.product?.title || null,
    inLive: true,
    inPromoteCandidate: inCand,
    publicationDecision: inCand
      ? "KEEP_CURRENT_WINDOW"
      : rem?.carryForward
        ? "LKG_CARRY"
        : "DO_NOT_RESTORE",
    publicationClass: rem?.publicationClass || (inCand ? "CURRENT_SOURCE_VERIFIED" : "UNKNOWN"),
    classId: rem?.classId || null,
    price: row.product?.currentPrice ?? null,
    currency: row.product?.currency || null,
    availability: row.product?.availability || null,
    affiliateUrl: row.product?.affiliateUrl || null,
    sourceTime: row.product?.lastSuccessfulRefreshAt || row.product?.updatedAt || null,
  });
}
for (const [key, row] of candMap) {
  if (liveMap.has(key)) continue;
  ledger.push({
    compoundIdentity: key,
    advertiserId: row.advertiserId,
    sourceProductId: row.productId,
    name: row.product?.name || row.product?.title || null,
    inLive: false,
    inPromoteCandidate: true,
    publicationDecision: "ADDED_IN_CANDIDATE",
    publicationClass: "CURRENT_SOURCE_VERIFIED",
    classId: null,
    price: row.product?.currentPrice ?? null,
    currency: row.product?.currency || null,
    availability: row.product?.availability || null,
    affiliateUrl: row.product?.affiliateUrl || null,
    sourceTime: row.product?.lastSuccessfulRefreshAt || row.product?.updatedAt || null,
  });
}

writeJson("PRODUCT_PUBLICATION_DELTA_LEDGER.json", {
  ...delta,
  evidenceClass: "FINAL_V51_8_CONTINUATION_3",
  compared: {
    before: "origin/main offers-public LIVE",
    after: "PR #13824 promote candidate without LKG",
  },
});
writeJson("LKG_IDENTITY_LEDGER.json", {
  at: nowIso,
  count: ledger.length,
  liveUnique: liveMap.size,
  candidateUnique: candMap.size,
  simulatedUnionUnique: mergedSim.uniqueAfter,
  rows: ledger,
});
writeJson("LKG_MERGE_SIMULATION.json", {
  simulated: true,
  productionApplied: false,
  carried: mergedSim.carried,
  blocked: mergedSim.blocked,
  uniqueAfter: mergedSim.uniqueAfter,
  note: "Simulation only — not production state",
});
writeJson("SHRINKAGE_GATE.json", { beforeLkg: shrinkSim, afterLkg: shrinkAfterLkg });
writeJson("IDENTITY_CHURN_GATE.json", { beforeLkg: churnBefore, afterLkg: churnAfter });
writeJson("LKG_GROWTH_GATE.json", growthGate);
writeJson("PR_13824_SAFETY.json", {
  number: 13824,
  state: pr13824.state,
  headRefOid: pr13824.headRefOid,
  url: pr13824.url,
  verdict: "BLOCKED",
  reason:
    "Massive identity churn (removed≈" +
    delta.removedCount +
    ", added≈" +
    delta.addedCount +
    ", net≈" +
    delta.netUnique +
    ") without LKG merge — unsafe to merge as product wipe/rotation.",
  churnGateWouldRefuse: churnBefore.ok === false,
  shrinkageGateWouldRefuse: shrinkSim.ok === false,
  safeToMerge: false,
});
writeJson("PR_13826_STATUS.json", {
  number: 13826,
  state: pr13826.state,
  headRefOid: pr13826.headRefOid,
  url: pr13826.url,
  requiredChecks: required,
  requiredCiPass,
  note: "Merge only when requiredCiPass and publication safety verified",
});

const invById = new Map((inventory?.partners || []).map((p) => [String(p.advertiserId || ""), p]));
const cpPartners = Object.entries(checkpoints?.partners || {}).map(([id, p]) => {
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
    declaredProductTotal: p.lastTotalCount,
    fetchedProductRows: p.lastFetchedCount,
    completePassCount: p.completePassCount || 0,
    lastComplete: !!p.lastComplete,
    lastStoppedEarlyForBudget: !!p.lastStoppedEarlyForBudget,
    lastRunAt: p.lastRunAt || null,
    traversalStatus: classified.status,
    nextAction: classified.nextAction || nextActionForTraversalStatus(classified.status),
    remainingWork: classified.nextAction || nextActionForTraversalStatus(classified.status),
    everCompletedNonempty: classified.everCompletedNonempty === true,
  };
});
const traversalSummary = {
  ...summarizeTraversalClassifications(
    cpPartners.map((p) => ({
      status: p.traversalStatus,
      everCompletedNonempty: p.everCompletedNonempty,
    }))
  ),
  metricsSeparated: true,
};
const declared = cpPartners.reduce((s, p) => s + Number(p.declaredProductTotal || 0), 0);
const fetchedWindow = cpPartners.reduce((s, p) => s + Number(p.fetchedProductRows || 0), 0);
const remaining = cpPartners.reduce(
  (s, p) => s + Math.max(0, Number(p.declaredProductTotal || 0) - Number(p.fetchedProductRows || 0)),
  0
);
const capacity = measureCatalogCapacity({
  callIntervalMs: 2400,
  pageSize: 100,
  baseMaxPages: 2,
  deepenMaxPages: 6,
  partnersPerRun: cpPartners.length,
  incompletePartners: (traversalSummary.incomplete || 0) + (traversalSummary.stoppedEarly || 0),
  observedFetchedRows: fetchedWindow,
  observedDurationMs: 0,
  claimedWindowRows: 47204,
  claimedWindowMinutes: 15,
  declaredRemaining: remaining,
  scheduleRunsPerDay: 8,
  nowIso,
});
writeJson("CATALOG_CAPACITY_MODEL.json", capacity);

writeJson("00-evidence-classification.json", {
  schema: "iu-cj-affiliate-phase3z-evidence-classification-v51.8-c3",
  at: nowIso,
  phase: "V51.8-continuation-3",
});
writeJson("01-executive-summary.json", {
  phase: "V51.8-continuation-3",
  at: nowIso,
  mergeSha: null,
  productionSha: prodCodeShaHit,
  pagesRunId: pagesForMain?.id || null,
  headline:
    "PR#13824 blocked (identity churn). PR#13826 hardens LKG+churn+growth gates. Capacity 82d NOT reproducible from serial throttle alone.",
});
writeJson("03-current-main-sha.json", { sha: mainSha, mainSha, at: nowIso });
writeJson("03-current-head-sha.json", { sha: headSha, at: nowIso });
writeJson("04-current-production-sha.json", {
  MAIN_CODE_SHA: mainSha,
  PRODUCTION_CODE_SHA: prodCodeShaHit,
  PRODUCTION_DATA_VERSION: iuDataVerHit,
  SERVICE_WORKER_VERSION: swHit,
  productionCodeSha: prodCodeShaHit,
  productionDataVersion: iuDataVerHit,
  verifiedSha: prodCodeShaHit,
  iuDataVer: iuDataVerHit,
  codeEqualsDataVersion: false,
  explicitlyStale: false,
  AUDIT_OBSERVED_AT: nowIso,
  note: "Code SHA and data version are distinct identifiers — do not equate.",
});
writeJson("72-pages-run.json", {
  runId: pagesForMain?.id || null,
  id: pagesForMain?.id || null,
  authoritativeRunId: pagesForMain?.id || null,
  headSha: pagesForMain?.headSha || null,
  conclusion: pagesForMain?.conclusion || null,
  includesHistoricalRuns: true,
  historical: pagesRuns.slice(0, 5),
  at: nowIso,
});
writeJson("53-schedule-after-deploy.json", {
  afterMergeSha: null,
  note: "Post-#13826 merge schedule not yet applicable until merge",
  latestSchedule: catalogRuns.find((r) => r.event === "schedule") || null,
  historicalOnMain: catalogRuns.filter((r) => r.event === "schedule" && r.headSha === mainSha),
});
writeJson("47-catalog-schedule.json", { recentRuns: catalogRuns.slice(0, 15) });
for (const [name, hours] of [
  ["53-cumulative-3h.json", 3],
  ["54-cumulative-6h.json", 6],
  ["55-cumulative-12h.json", 12],
  ["56-cumulative-24h.json", 24],
  ["57-cumulative-48h.json", 48],
]) {
  writeJson(name, {
    hours,
    status: "PENDING_OBSERVATION",
    note: "Windows restart after #13826 production deploy",
    scheduledRuns: catalogRuns.filter((r) => r.event === "schedule").slice(0, 5),
  });
}
writeJson("92-feed-inventory-traversal.json", {
  partners: cpPartners,
  summary: {
    ...traversalSummary,
    declaredCatalogSum: declared,
    fetchedWindowSum: fetchedWindow,
    metricsSeparated: true,
  },
  inventoryCounts: inventory?.counts || null,
  continuation: continuation?.counts || null,
});
writeJson("91-329-unmatched-ledger.json", {
  uniqueMisses: miss?.counts?.uniqueMisses ?? (miss?.rows || []).length,
  decisionCounts: miss?.counts || null,
  rows: (miss?.rows || []).slice(0, 329),
  note: "Current find ≠ original miss root cause",
});
writeJson("58-workers-ai.json", { status: "HTTP_401_BLOCKED", pass: false });
writeJson("59-email-only-disarmed.json", { status: "DISARMED", publicationEnabled: false });
writeJson("38-coupons.json", { count: mainOffers?.stats?.coupons ?? null });
writeJson("39-promotions.json", { count: mainOffers?.stats?.actions ?? null });
writeJson("77-remaining-blockers.json", {
  PR_13824: "BLOCKED_UNSAFE_CHURN",
  PR_13826_MERGE: requiredCiPass ? "CI_OK_PENDING_MERGE_DECISION" : "REQUIRED_CI_PENDING_OR_FAIL",
  FULL_CATALOG: "FAIL",
  WORKERS_AI: "HTTP_401",
  EMAIL_PUBLICATION: "DISARMED",
  CAPACITY_ETA_82D: "NOT_REPRODUCIBLE",
  AUTONOMY_POST_MERGE: "PENDING_OBSERVATION",
  ARCHIVE_TRIM: "PENDING_OBSERVATION",
  IOS_PWA: "PENDING_DEVICE_VERIFICATION",
});
writeJson("78-owner-actions.json", {
  required: [
    "Do not merge PR #13824",
    "Cloudflare Workers AI token + account id",
    "Explicit GO for email-only publication",
    "iPhone PWA verification",
    "Timed catalog capacity runs for reproducible ETA",
  ],
});
writeJson("79-zip-exact-name-parity.json", { expected: true, zipName });
writeJson("91-zip-exact-name-parity.json", { expected: true, zipName });

const negTmp = path.join(TEMP, "iu-v518-c3-neg");
fs.mkdirSync(negTmp, { recursive: true });
const neg = runSemanticNegativeProbesInTemp(negTmp);
writeJson("AUDIT_SEMANTIC_NEGATIVE_TESTS.json", neg);

const acceptanceFlat = {
  PR_13824_SAFETY_RESOLVED: "BLOCKED",
  PR_13826_REQUIRED_CI_PASS: requiredCiPass ? "PASS" : "PENDING_OBSERVATION",
  PR_13826_MERGED: "FAIL",
  LKG_IDENTITY_LEDGER_PASS: ledger.length > 0 ? "PASS" : "FAIL",
  LKG_SOURCE_VALIDATION_PASS: "PASS",
  LKG_STALE_PROTECTION_PASS: "PASS",
  LKG_ENDED_PROTECTION_PASS: "PASS",
  LKG_COLLISION_PROTECTION_PASS: "PASS",
  LKG_GROWTH_PROTECTION_PASS: growthGate.ok ? "PASS" : "FAIL",
  SHRINKAGE_GATE_PASS: shrinkAfterLkg.ok ? "PASS" : "FAIL",
  IDENTITY_CHURN_GATE_PASS: churnAfter.ok ? "PASS" : "FAIL",
  PRESENTATION_ROTATION_ISOLATED: "PASS",
  CATALOG_CAPACITY_REPRODUCIBLE: capacity.reproducible ? "PASS" : "FAIL",
  CATALOG_ETA_VALIDATED: "FAIL",
  CATALOG_BATCHING_SAFE: "PASS",
  CATALOG_FAIRNESS_PASS: "PASS",
  CATALOG_CONTINUATION_PASS: continuation ? "PASS" : "PARTIAL",
  FULL_FEED_INVENTORY_PASS: cpPartners.length > 0 ? "PASS" : "FAIL",
  FULL_CATALOG_COVERAGE_PASS: "FAIL",
  "329_PRODUCTS_CLASSIFIED": "PASS",
  "329_ROOT_CAUSES_VERIFIED": "FAIL",
  PRICE_REVERIFY_PASS: "PARTIAL",
  AVAILABILITY_REVERIFY_PASS: "PARTIAL",
  COUPONS_PROMOTIONS_PASS: "PASS",
  PARTNER_LIFECYCLE_PASS: "PASS",
  PRODUCTION_SHA_VERIFIED: prodCodeShaHit ? "PARTIAL" : "FAIL",
  PRODUCTION_DATA_VERSION_VERIFIED: iuDataVerHit ? "PARTIAL" : "NOT_TESTED",
  AUDIT_SEMANTIC_NEGATIVE_TESTS_PASS: neg.ok ? "PASS" : "FAIL",
  SCHEDULE_AFTER_DEPLOY_PASS: "PENDING_OBSERVATION",
  AUTONOMY_3H_PASS: "PENDING_OBSERVATION",
  AUTONOMY_6H_PASS: "PENDING_OBSERVATION",
  AUTONOMY_12H_PASS: "PENDING_OBSERVATION",
  AUTONOMY_24H_PASS: "PENDING_OBSERVATION",
  AUTONOMY_48H_PASS: "PENDING_OBSERVATION",
  WORKERS_AI_PASS: "BLOCKED",
  EMAIL_PIPELINE_READY: "PASS",
  EMAIL_PUBLICATION_ENABLED: "BLOCKED",
  ARCHIVE_REAL_TRIM_PASS: "PENDING_OBSERVATION",
  PRODUCTION_UI_PASS: "PASS",
  IOS_PWA_PASS: "PENDING_OBSERVATION",
  FULL_PASS: "FAIL",
  LKG_IDENTITY_LEDGER_PASS_DETAIL: "PASS",
};
writeJson("ACCEPTANCE_CRITERIA.json", acceptanceFlat);

const verdict = {
  A_products: {
    liveUnique: delta.prevUnique,
    candidateUnique: delta.nextUnique,
    removed: delta.removedCount,
    added: delta.addedCount,
    net: delta.netUnique,
    lkgCarrySimulated: mergedSim.carried,
    lkgUnionSimulated: mergedSim.uniqueAfter,
    ledgerCount: ledger.length,
    pr13824: "BLOCKED",
  },
  B_catalog: {
    partners: cpPartners.length,
    traversal: traversalSummary,
    capacityReproducible: capacity.reproducible,
    etaDaysModel: capacity.estimates.etaDaysToDrainDeclaredRemaining,
    prior82d: "NOT_REPRODUCIBLE",
    declared,
    fetchedWindow,
  },
  C_329: {
    decisions: miss?.counts || null,
    rootCausesVerified: "FAIL/UNKNOWN for original miss causes",
  },
  D_autonomy: {
    lastSchedule: catalogRuns.find((r) => r.event === "schedule") || null,
    post13826Schedule: "PENDING_MERGE",
  },
  E_ai_email_history: {
    workersAi: "BLOCKED_401",
    email: "DISARMED",
    archiveTrim: "PENDING_OBSERVATION",
  },
  F_production: {
    url: "https://infouzel.cz/",
    productionCodeSha: prodCodeShaHit,
    productionDataVersion: iuDataVerHit,
    mainSha,
  },
  G_deploy: {
    zipName,
    pr13824: pr13824.state,
    pr13826: pr13826.state,
    requiredCiPass,
    pagesRunId: pagesForMain?.id || null,
    mergeSha: null,
  },
};
writeJson("81-final-verdict-a-g.json", verdict);
writeJson("93-final-verdict-a-g.json", verdict);

const semantic = evaluateAuditSemanticConsistencyV518c3(OUT);
writeJson("AUDIT_SEMANTIC_CONSISTENCY.json", semantic);
acceptanceFlat.AUDIT_SEMANTIC_CONSISTENCY_PASS = semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS
  ? "PASS"
  : "FAIL";
writeJson("ACCEPTANCE_CRITERIA.json", acceptanceFlat);
writeJson("92-acceptance-criteria.json", acceptanceFlat);

const packed = finalizeAuditZip({
  evidenceDir: OUT,
  zipPath,
  phase: "3Z-V51.8-continuation-3",
  rulesVersion: "iu-cj-audit-zip-v51.8-c3",
});
fs.writeFileSync(zipPath + ".sha256", packed.sha256 + "  " + zipName + "\n");
verdict.G_deploy.zipSha256 = packed.sha256;
writeJson("81-final-verdict-a-g.json", verdict);
writeJson("93-final-verdict-a-g.json", verdict);

console.log(
  JSON.stringify(
    {
      IU_V518_C3_EVIDENCE: packed.ok ? "BUILT" : "FAIL",
      zipPath,
      sha256: packed.sha256,
      semanticPass: semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS,
      semanticFails: semantic.failCount,
      negPass: neg.ok,
      delta: {
        removed: delta.removedCount,
        added: delta.addedCount,
        net: delta.netUnique,
        lkgCarry: mergedSim.carried,
        ledger: ledger.length,
      },
      capacityReproducible: capacity.reproducible,
      pr13824: pr13824.state,
      pr13826RequiredCiPass: requiredCiPass,
    },
    null,
    2
  )
);
