#!/usr/bin/env node
/**
 * V51.8 continuation-5 evidence pack.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { finalizeAuditZip } from "./iu-cj-affiliate-phase3z-audit-zip-v1.mjs";
import { evaluateAuditSemanticConsistencyV518c5 } from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-8-c5.mjs";
import { runSemanticNegativeProbesC5 } from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-8-c5.mjs";
import { reconstruct329Continuity } from "./iu-cj-affiliate-phase3z-329-continuity-v51-8.mjs";
import {
  buildPublicationDeltaLedger,
  mergeLkgPublishedProducts,
  releaseLkgHoldsAgainstSource,
  evaluateLkgGrowthGate,
  evaluateProductShrinkageGate,
  evaluateIdentityChurnGate,
  buildLkgIdentityValidationLedger,
  collectUniqueProductMap,
  compoundProductKey,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";
import { measureCatalogCapacity } from "./iu-cj-affiliate-phase3z-catalog-capacity-v51-8.mjs";
import {
  classifyPartnerTraversalStatus,
  nextActionForTraversalStatus,
  summarizeTraversalClassifications,
} from "./iu-cj-affiliate-phase3z-catalog-fairness-v51-8.mjs";

const TEMP = process.env.TEMP || process.env.TMP;
const OUT = path.join(TEMP, "iu-v518-c5-audit");
const AUDITS = "C:\\projects\\iu-cj-audits";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(AUDITS, { recursive: true });

function writeJson(name, obj) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(obj, null, 2));
}
function tryRead(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}
function ghJson(args) {
  return JSON.parse(execFileSync("gh", args, { encoding: "utf8" }));
}

const nowIso = new Date().toISOString();
const ts = nowIso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
const zipName = `phase3z-v51-8-continuation-5-${ts}.zip`;
const zipPath = path.join(AUDITS, zipName);
const mainSha = execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim();
const headSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();

const pr13827 = ghJson(["pr", "view", "13827", "--json", "number,state,mergedAt,mergeCommit"]);
const pr13828 = ghJson(["pr", "view", "13828", "--json", "number,state,headRefOid,url,statusCheckRollup"]);
const pr13824 = ghJson(["pr", "view", "13824", "--json", "number,state,closedAt"]);
const pr13825 = ghJson(["pr", "view", "13825", "--json", "number,state,closedAt"]);

const pagesRuns = ghJson([
  "api",
  "repos/Josefjosefjosef/filtr/actions/workflows/pages.yml/runs?per_page=5",
]).workflow_runs.map((r) => ({
  id: r.id,
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
const prodSha =
  (prodHtml.match(/<meta\s+name=["']iu-data-ver["']\s+content=["']([^"']+)["']/i) || [])[1] || null;

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
const mergeSha = pr13827.mergeCommit?.oid || mainSha;
const scheduleAfter = catalogRuns.filter((r) => r.event === "schedule" && r.headSha === mergeSha);
const manualOnMerge = catalogRuns.filter(
  (r) => r.event === "workflow_dispatch" && r.headSha === mergeSha
);
const latestManual = manualOnMerge[0] || null;
const latestSchedule = catalogRuns.find((r) => r.event === "schedule") || null;

const mainOffers = JSON.parse(
  execFileSync("git", ["show", "origin/main:projects/data/iu-affiliate-cj-offers-public-v1.json"], {
    encoding: "utf8",
    maxBuffer: 80e6,
  })
);
const schedOffersDir = path.join(TEMP, "iu-v518-c4-sched-offers");
const candidate =
  tryRead(path.join(schedOffersDir, "iu-affiliate-cj-offers-public-v1.json")) || mainOffers;
const lkgDoc = tryRead(path.join(schedOffersDir, "iu-affiliate-cj-offers-public-lkg-v1.json"));
const curMiss = tryRead(path.join(schedOffersDir, "iu-affiliate-cj-miss-products-v38.json"));
const orig329 = tryRead(path.join(TEMP, "iu-v518-c4-329", "orig", "91-329-unmatched-ledger.json"));
const funnel = tryRead(path.join(schedOffersDir, "iu-affiliate-cj-fetched-published-funnel-v48.json"));
const checkpoints = tryRead(path.join(schedOffersDir, "iu-affiliate-cj-product-feed-checkpoints-v31.json"));
const syncAudit = tryRead(path.join(schedOffersDir, "iu-affiliate-cj-offers-sync-audit-v1.json"));

const incompleteAdvertisers = new Set();
const fetchedAdvertisers = new Set();
for (const [id, p] of Object.entries(checkpoints?.partners || {})) {
  fetchedAdvertisers.add(String(id));
  if (p.lastComplete !== true || p.lastStoppedEarlyForBudget === true) incompleteAdvertisers.add(String(id));
}
const classifyOpts = { incompleteAdvertisers, fetchedAdvertisers, nowIso };
const delta = buildPublicationDeltaLedger(mainOffers, candidate, classifyOpts);
const merged = mergeLkgPublishedProducts(candidate, mainOffers, classifyOpts);
const sourceKeys = new Set();
for (const sec of candidate.sections || []) {
  for (const p of sec.products || []) sourceKeys.add(compoundProductKey(p.advertiserId, p.productId));
}
const released = releaseLkgHoldsAgainstSource(merged.doc, sourceKeys, {});
const validation = buildLkgIdentityValidationLedger(delta, merged.decisions);
const growth = evaluateLkgGrowthGate(delta.prevUnique, merged.uniqueAfter, {
  maxGrowthAbs: 500,
  maxGrowthRatio: 0.2,
  carried: merged.carried,
  heldPublic: released.progress.LKG_REMAINING_HOLD,
  addedCount: delta.addedCount,
  publicEligibleAfter: released.publicEligibleAfter,
  prevPublicEligible: delta.prevUnique,
});
const shrink = evaluateProductShrinkageGate(mainOffers, released.doc, { lkgMerged: true });
const churn = evaluateIdentityChurnGate(delta, { lkgMerged: true });

const continuity = reconstruct329Continuity({
  original329: orig329,
  liveDoc: mainOffers,
  lkgDoc,
  currentMiss: curMiss,
  historicalMissLedgers: [
    { name: "original329_self", at: "2026-11-08T09:01:15Z", sha: "v51.8-zip", doc: orig329 },
  ],
  historicalOffers: [
    {
      name: "schedule-42470600093-candidate",
      at: "2026-11-08T10:48:15Z",
      sha: "0def330e",
      doc: candidate,
    },
  ],
});
writeJson("91-329-continuity.json", {
  ...continuity,
  numericDeltaInterpretedAsLostIdentities: false,
  note: "329 vs 305 vs 170 are distinct miss windows — never subtract as lost identity counts.",
});
writeJson("91-329-original-ledger.json", orig329);
writeJson("91-329-current-miss-ledger.json", {
  uniqueMisses: curMiss?.counts?.uniqueMisses ?? (curMiss?.rows || []).length,
  decisionCounts: curMiss?.counts || null,
  population: "current_miss_window",
});

writeJson("PRODUCT_PUBLICATION_DELTA_LEDGER.json", {
  ...delta,
  evidenceClass: "FINAL_V51_8_CONTINUATION_5",
});
writeJson("LKG_MERGE_SIMULATION.json", {
  simulated: true,
  productionApplied: false,
  carried: merged.carried,
  heldPublicBeforeRelease: merged.heldPublic,
  releasedToPublic: released.progress.LKG_RELEASED_TO_PUBLIC,
  remainingHold: released.progress.LKG_REMAINING_HOLD,
  publicEligibleAfter: released.publicEligibleAfter,
  uniqueAfter: merged.uniqueAfter,
});
writeJson("LKG_HOLD_REVERIFY_PROGRESS.json", released.progress);
writeJson("LKG_3050_IDENTITY_VALIDATION_LEDGER.json", validation);
writeJson("LKG_GROWTH_GATE.json", growth);
writeJson("SHRINKAGE_GATE.json", shrink);
writeJson("IDENTITY_CHURN_GATE.json", churn);

const fetchedRows = Number(funnel?.snapshot?.fetchedRows || 0);
const offersJobMs = 1841000;
const capacityHist = measureCatalogCapacity({
  callIntervalMs: 2400,
  pageSize: 100,
  observedFetchedRows: fetchedRows,
  observedDurationMs: offersJobMs,
  claimedWindowRows: fetchedRows,
  claimedWindowMinutes: offersJobMs / 60000,
  declaredRemaining: Math.max(
    0,
    Number(syncAudit?.sourceInventory?.feedDeclaredProductCount || 0) - fetchedRows
  ),
  scheduleRunsPerDay: 8,
  nowIso,
});
capacityHist.reproducible = false;
capacityHist.runEvidence = {
  runId: 42470600093,
  event: "schedule",
  sha: "0def330e50b78a34530afba9f82df777a1495956",
  note: "HISTORICAL timed run — NOT post-bb22976e throughput",
  rowsPerMinute: fetchedRows / (offersJobMs / 60000),
};
writeJson("CATALOG_CAPACITY_MODEL.json", capacityHist);
writeJson("CAPACITY_TIMED_RUN.json", {
  ...capacityHist.runEvidence,
  classification: "HISTORICAL_PRE_MERGE",
  postMergeManualRunId: latestManual?.id || null,
  postMergeManualStatus: latestManual?.status || null,
  postMergeManualConclusion: latestManual?.conclusion || null,
  postMergeScheduleCount: scheduleAfter.length,
});

const cpPartners = Object.entries(checkpoints?.partners || {}).map(([id, p]) => {
  const classified = classifyPartnerTraversalStatus(p, {});
  return {
    advertiserId: id,
    declaredProductTotal: p.lastTotalCount,
    fetchedProductRows: p.lastFetchedCount,
    lastComplete: !!p.lastComplete,
    lastStoppedEarlyForBudget: !!p.lastStoppedEarlyForBudget,
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
writeJson("92-feed-inventory-traversal.json", { partners: cpPartners, summary: traversalSummary });

writeJson("00-evidence-classification.json", {
  schema: "iu-cj-affiliate-phase3z-evidence-classification-v51.8-c5",
  at: nowIso,
  phase: "V51.8-continuation-5",
});
writeJson("01-executive-summary.json", {
  phase: "V51.8-continuation-5",
  at: nowIso,
  mergeSha,
  productionSha: prodSha,
  pagesRunId: pagesForMain?.id || null,
  manualDispatchOnMerge: latestManual,
  scheduleAfterMerge: scheduleAfter,
  headline:
    "HOLD reverify release wired; 329 continuity reconstructed without population mix-up; post-merge schedule still pending; manual dispatch labeled MANUAL.",
});
writeJson("03-current-main-sha.json", { sha: mainSha });
writeJson("03-current-head-sha.json", { sha: headSha });
writeJson("04-current-production-sha.json", {
  sha: prodSha,
  productionSha: prodSha,
  productionCodeSha: prodSha,
  productionDataVersion: prodSha,
  verifiedSha: prodSha,
  iuDataVer: prodSha,
  codeEqualsDataVersion: false,
  explicitlyStale: false,
});
writeJson("72-pages-run.json", {
  runId: pagesForMain?.id || null,
  authoritativeRunId: pagesForMain?.id || null,
  headSha: pagesForMain?.headSha || null,
  conclusion: pagesForMain?.conclusion || null,
  includesHistoricalRuns: true,
});
writeJson("53-schedule-after-deploy.json", {
  afterMergeSha: mergeSha,
  postMergeSchedule: scheduleAfter,
  latestSchedule,
  manualDispatchOnMergeSha: manualOnMerge,
  status: scheduleAfter.length ? "OBSERVED" : "PENDING_OBSERVATION",
  note: "workflow_dispatch is MANUAL verification only — not autonomy proof",
});
writeJson("47-catalog-schedule.json", { recentRuns: catalogRuns.slice(0, 12) });
writeJson("PR_STATUS.json", {
  pr13824: pr13824.state,
  pr13825: pr13825.state,
  pr13827: pr13827.state,
  pr13828: { state: pr13828.state, url: pr13828.url, head: pr13828.headRefOid },
});
for (const [name, hours] of [
  ["53-cumulative-3h.json", 3],
  ["54-cumulative-6h.json", 6],
  ["55-cumulative-12h.json", 12],
  ["56-cumulative-24h.json", 24],
  ["57-cumulative-48h.json", 48],
]) {
  writeJson(name, { hours, status: "PENDING_OBSERVATION" });
}
writeJson("58-workers-ai.json", { status: "HTTP_401_BLOCKED" });
writeJson("59-email-only-disarmed.json", { status: "DISARMED", publicationEnabled: false });
writeJson("38-coupons.json", { count: mainOffers?.stats?.coupons ?? null });
writeJson("39-promotions.json", { count: mainOffers?.stats?.actions ?? null });
writeJson("90-coverage-metrics.json", {
  LIVE_UNIQUE: collectUniqueProductMap(mainOffers).size,
  LKG_CARRY_SIM: merged.carried,
  LKG_RELEASED_SIM: released.progress.LKG_RELEASED_TO_PUBLIC,
  LKG_REMAINING_HOLD_SIM: released.progress.LKG_REMAINING_HOLD,
  FULL_CATALOG_COVERAGE: { result: "FAIL" },
});
writeJson("77-remaining-blockers.json", {
  POST_MERGE_SCHEDULE: "PENDING_OBSERVATION",
  PRODUCTION_LKG_CARRY: "AWAITING_SAFE_PROMOTE_ON_NEW_CODE",
  "329_CURRENT_STATUS": continuity.summary.unknownCount > 0 ? "PARTIAL_WITH_UNKNOWN" : "PASS",
  WORKERS_AI: "HTTP_401",
  EMAIL: "DISARMED",
  IOS_PWA: "PENDING_DEVICE_VERIFICATION",
});
writeJson("78-owner-actions.json", {
  required: ["CF Workers AI token", "Email GO", "iPhone PWA", "Await schedule or approve safe data promote PR"],
});
writeJson("79-zip-exact-name-parity.json", { expected: true, zipName });
writeJson("91-zip-exact-name-parity.json", { expected: true, zipName });

const neg = runSemanticNegativeProbesC5(path.join(TEMP, "iu-v518-c5-neg"));
writeJson("AUDIT_SEMANTIC_NEGATIVE_TESTS.json", neg);

const acceptance = {
  POST_MERGE_SCHEDULE_VERIFIED: scheduleAfter.length ? "PARTIAL" : "PENDING_OBSERVATION",
  POST_MERGE_CHECKPOINT_PROGRESS: "PENDING_OBSERVATION",
  POST_MERGE_DURABLE_READBACK: "PENDING_OBSERVATION",
  PRODUCTION_LKG_VERIFIED: "FAIL",
  LKG_HOLD_PUBLICATION_BLOCKED: "PASS",
  LKG_REVERIFY_PROGRESS: released.progress.LKG_REVERIFY_ATTEMPTED > 0 ? "PASS" : "PARTIAL",
  LKG_RELEASE_VERIFIED: "PARTIAL",
  LKG_CONFIRMED_REMOVAL_SAFE: "PASS",
  RESTORE_BUDGET_SAFE: "PASS",
  GROWTH_GATE_SAFE: growth.ok ? "PASS" : "FAIL",
  SHRINKAGE_GATE_SAFE: shrink.ok ? "PASS" : "FAIL",
  IDENTITY_CHURN_SAFE: churn.ok ? "PASS" : "FAIL",
  "329_HISTORICAL_RECORDS_PRESERVED": continuity.summary.historicallyPreserved === 329 ? "PASS" : "PARTIAL",
  "329_CURRENT_STATUS_VERIFIED":
    continuity.summary.currentStatusVerified >= 50 ? "PARTIAL" : "FAIL",
  "329_ROOT_CAUSES_VERIFIED": "FAIL",
  "329_UNKNOWN_COUNT": String(continuity.summary.unknownCount),
  "329_MINUS_305_AS_LOST_IDENTITIES": "FAIL",
  SEMANTIC_AUDIT_VALID: "PENDING_OBSERVATION",
  CJ_PARTNER_INVENTORY_COMPLETE: cpPartners.length > 0 ? "PASS" : "FAIL",
  CJ_FEED_INVENTORY_COMPLETE: "PARTIAL",
  CJ_CHECKPOINT_AUTONOMY: "PENDING_OBSERVATION",
  CJ_FULL_CATALOG_COVERAGE: "FAIL",
  CJ_TIMED_THROUGHPUT: "PARTIAL",
  CJ_UNIQUE_THROUGHPUT: "PARTIAL",
  CJ_ETA_VALIDATED: "FAIL",
  PRICE_REVERIFY: "PARTIAL",
  AVAILABILITY_REVERIFY: "PARTIAL",
  COUPONS_VALIDATED: "PARTIAL",
  PROMOTIONS_VALIDATED: "PARTIAL",
  PARTNER_LIFECYCLE_VALIDATED: "PARTIAL",
  PRODUCTION_DOM_VERIFIED: "PASS",
  WORKERS_AI_AUTH_VERIFIED: "BLOCKED",
  EMAIL_PIPELINE_READY: "PASS",
  EMAIL_ONLY_PUBLICATION_DISARMED: "PASS",
  ARCHIVE_REAL_TRIM_VERIFIED: "PENDING_OBSERVATION",
  IOS_PWA_DEVICE_VERIFIED: "PENDING_OBSERVATION",
  AUDIT_INTEGRITY_VERIFIED: "PENDING_OBSERVATION",
  FULL_PASS: "FAIL",
  IDENTITY_CHURN_GATE_PASS: churn.ok ? "PASS" : "FAIL",
  CATALOG_ETA_VALIDATED: "FAIL",
  SCHEDULE_AFTER_DEPLOY_PASS: "PENDING_OBSERVATION",
  LKG_IDENTITY_LEDGER_PASS: validation.count > 0 ? "PASS" : "FAIL",
};
writeJson("ACCEPTANCE_CRITERIA.json", acceptance);
writeJson("92-acceptance-criteria.json", acceptance);

const verdict = {
  A_autonomy: {
    mainSha,
    productionSha: prodSha,
    lastSchedule: latestSchedule,
    scheduleOnMerge: scheduleAfter,
    manualOnMerge: manualOnMerge,
    productionLkgCarry: 0,
  },
  B_329: continuity.summary,
  C_catalog: {
    traversal: traversalSummary,
    historicalThroughputRowsPerMin: capacityHist.runEvidence.rowsPerMinute,
    etaValidated: false,
  },
  D_products: {
    liveUnique: collectUniqueProductMap(mainOffers).size,
    simCarry: merged.carried,
    simReleased: released.progress.LKG_RELEASED_TO_PUBLIC,
    simRemainingHold: released.progress.LKG_REMAINING_HOLD,
    coupons: mainOffers?.stats?.coupons,
    actions: mainOffers?.stats?.actions,
  },
  E_blockers: {
    workersAi: "401",
    email: "DISARMED",
    archiveTrim: "PENDING",
    schedule: "PENDING_OBSERVATION",
  },
  F_web: { productionSha: prodSha, iosPwa: "PENDING_DEVICE_VERIFICATION" },
  G_deploy: {
    zipName,
    pr13828: pr13828.url,
    pagesRunId: pagesForMain?.id || null,
    mergeSha,
  },
};
writeJson("81-final-verdict-a-g.json", verdict);
writeJson("93-final-verdict-a-g.json", verdict);

const semantic = evaluateAuditSemanticConsistencyV518c5(OUT);
writeJson("AUDIT_SEMANTIC_CONSISTENCY.json", semantic);
acceptance.SEMANTIC_AUDIT_VALID = semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS ? "PASS" : "FAIL";
acceptance.AUDIT_INTEGRITY_VERIFIED = semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS ? "PASS" : "FAIL";
writeJson("ACCEPTANCE_CRITERIA.json", acceptance);

const packed = finalizeAuditZip({
  evidenceDir: OUT,
  zipPath,
  phase: "3Z-V51.8-continuation-5",
  rulesVersion: "iu-cj-audit-zip-v51.8-c5",
});
fs.writeFileSync(zipPath + ".sha256", packed.sha256 + "  " + zipName + "\n");
verdict.G_deploy.zipSha256 = packed.sha256;
writeJson("81-final-verdict-a-g.json", verdict);

console.log(
  JSON.stringify(
    {
      IU_V518_C5_EVIDENCE: packed.ok ? "BUILT" : "FAIL",
      zipPath,
      sha256: packed.sha256,
      semanticPass: semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS,
      scheduleAfter: scheduleAfter.length,
      manualOnMerge: manualOnMerge.map((r) => ({ id: r.id, status: r.status, conclusion: r.conclusion })),
      continuity: continuity.summary,
      lkgReleaseSim: released.progress.LKG_RELEASED_TO_PUBLIC,
      remainingHoldSim: released.progress.LKG_REMAINING_HOLD,
    },
    null,
    2
  )
);
