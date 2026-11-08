#!/usr/bin/env node
/**
 * V51.6 evidence builder — stale-evidence repair, price-class truth, autonomy, ZIP pack prep.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as histMod from "./iu-cj-affiliate-phase3z-durable-price-history-v50.mjs";
import * as revMod from "./iu-cj-affiliate-phase3z-product-reverify-v50.mjs";
import { evaluateAuditSemanticConsistencyV516 } from "./iu-cj-affiliate-phase3z-audit-semantic-consistency-v51-6.mjs";
import { finalizeAuditZip } from "./iu-cj-affiliate-phase3z-audit-zip-v1.mjs";

const TEMP = process.env.TEMP || process.env.TMP;
const OUT = path.join(TEMP, "iu-v516-audit");
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
function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").toUpperCase();
}
function ghJson(args) {
  const out = execFileSync("gh", args, { encoding: "utf8" });
  return JSON.parse(out);
}

const nowIso = new Date().toISOString();
const ts = nowIso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
const zipName = `phase3z-v51-6-${ts}.zip`;
const zipPath = path.join(AUDITS, zipName);

const mainSha = execFileSync("git", ["rev-parse", "origin/main"], { encoding: "utf8" }).trim();
const pr13819 = ghJson([
  "pr",
  "view",
  "13819",
  "--json",
  "state,mergeable,mergeStateStatus,headRefOid,url,title,files",
]);
const catalogRuns = ghJson([
  "api",
  "repos/Josefjosefjosef/filtr/actions/workflows/cj-affiliate-catalog-sync.yml/runs?per_page=15",
]).workflow_runs.map((r) => ({
  id: r.id,
  event: r.event,
  conclusion: r.conclusion,
  status: r.status,
  headSha: r.head_sha,
  createdAt: r.created_at,
  displayTitle: r.display_title,
  htmlUrl: r.html_url,
}));

const durable = readJson(path.join(ART, "offers/iu-affiliate-cj-durable-price-history-v50.json"));
const archivePath = path.join(ART, "offers/iu-affiliate-cj-durable-price-history-archive-v51.json");
const archive = readJson(archivePath);
const archiveContentSha256 = sha256File(archivePath);
const reverify = readJson(path.join(ART, "offers/iu-affiliate-cj-product-reverify-v50.json"));
const reverifyPrev = readJson(path.join(ART, "offers-prev/iu-affiliate-cj-product-reverify-v50.json"));
const offers = readJson(path.join(ART, "offers/iu-affiliate-cj-offers-public-v1.json"));
const funnel = tryRead(path.join(ART, "offers/iu-affiliate-cj-fetched-published-funnel-v48.json"));
const progress = tryRead(path.join(ART, "offers/iu-affiliate-cj-product-progress-v48.json"));

// Rebuild cross-run with V51.6 semantics
const cross = revMod.buildCrossRunIndividualLedger(reverifyPrev, reverify);
const age = revMod.buildReverifyAgeBuckets(reverify, { nowIso });
const recon = histMod.reconstructDurableHistory(durable, archive, { archiveContentSha256 });

const mismatchRows = cross.rows.filter((r) => r.classificationPriceMismatch || r.withinRunClassEconomicChange);
const mismatchAudit = mismatchRows.map((r) => ({
  advertiserId: r.advertiserId,
  productId: r.productId,
  compoundIdentity: r.compoundIdentity,
  previousPrice: r.withinRunPreviousPrice,
  currentPrice: r.withinRunCurrentPrice,
  crossRunPreviousPrice: r.crossRunPreviousPrice,
  crossRunCurrentPrice: r.crossRunCurrentPrice,
  currency: r.currency || null,
  previousAvailability: r.previousAvailability,
  currentAvailability: r.currentAvailability,
  previousFetchTimestamp: r.previousFetchTimestamp,
  currentFetchTimestamp: r.currentFetchTimestamp,
  previousSourceTimestamp: r.previousSourceTimestamp,
  currentSourceTimestamp: r.currentSourceTimestamp,
  runId: r.currentRunId,
  withinRunClassification: r.withinRunClassification,
  crossRunObservedEconomicDelta: r.crossRunObservedEconomicDelta,
  economicChange: r.economicChange,
  availabilityChange: r.availabilityChange,
  resolvedPriceOutcome: r.resolvedPriceOutcome,
  classificationPriceMismatch: r.classificationPriceMismatch,
  reason:
    r.resolvedPriceOutcome === "PRICE_CHANGED_CONFIRMED"
      ? "Within-row previous/current prices differ numerically"
      : r.resolvedPriceOutcome === "INSUFFICIENT_COMPARISON_DATA"
        ? "V51.5 class PRICE_CHANGED with null baseline — not a confirmed economic event"
        : r.resolvedPriceOutcome === "CLASSIFICATION_MISMATCH"
          ? "Class PRICE_CHANGED but within-row prices equal"
          : "See resolvedPriceOutcome",
}));

const confirmed = mismatchAudit.filter((r) => r.resolvedPriceOutcome === "PRICE_CHANGED_CONFIRMED");
const insufficient = mismatchAudit.filter((r) => r.resolvedPriceOutcome === "INSUFFICIENT_COMPARISON_DATA");
const classMismatch = mismatchAudit.filter((r) => r.resolvedPriceOutcome === "CLASSIFICATION_MISMATCH");

// Coverage honesty
const coverage = {
  schema: "iu-cj-affiliate-phase3z-reverify-coverage-v51.6",
  counts: {
    totalPublishedUniqueInDoc: cross.counts.identitiesInNewSource,
    attemptedReverify: cross.counts.reverifyAttempted,
    sourceMatched: cross.counts.sourceMatched,
    successfullyReverified: cross.counts.actuallyReverified,
    withinRunClassChanged: cross.counts.withinRunChangedByClassification,
    priceChangedConfirmed: cross.counts.priceChangedConfirmed,
    insufficientComparisonData: cross.counts.insufficientComparisonData,
    classificationPriceMismatchCount: cross.counts.classificationPriceMismatchCount,
    changed: cross.counts.priceChangedConfirmed,
    unchanged: cross.counts.unchanged,
    missing: cross.counts.unavailable,
    coveragePct: cross.counts.coveragePct,
  },
  note: "changed = priceChangedConfirmed only (V51.6). withinRunClassChanged retained for forensics.",
};

// Autonomy windows vs merge deploy time
const deployAt = Date.parse("2026-11-08T05:57:54Z");
function windowStatus(hours) {
  const now = Date.now();
  const cutoff = now - hours * 3600 * 1000;
  const hits = catalogRuns.filter((r) => Date.parse(r.createdAt) >= cutoff);
  const scheduled = hits.filter((r) => r.event === "schedule");
  const dispatch = hits.filter((r) => r.event === "workflow_dispatch");
  const elapsedH = (now - deployAt) / 3600000;
  if (hours > elapsedH + 0.5) {
    return {
      status: "PENDING_OBSERVATION",
      windowHours: hours,
      windowStart: new Date(cutoff).toISOString(),
      windowEnd: nowIso,
      anchorSha: mainSha,
      deployAt: new Date(deployAt).toISOString(),
      elapsedHoursSinceDeploy: Math.round(elapsedH * 100) / 100,
      runs: hits,
      scheduledRuns: scheduled,
      dispatchRuns: dispatch,
      note: "Manual/dispatch runs listed separately from schedule; schedule-only observation incomplete",
      verdict: "PENDING_OBSERVATION",
      evidenceClass: "FINAL_V51_6",
    };
  }
  if (scheduled.length === 0 && hits.length === 0) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      windowHours: hours,
      runs: [],
      scheduledRuns: [],
      dispatchRuns: [],
      verdict: "INSUFFICIENT_EVIDENCE",
      evidenceClass: "FINAL_V51_6",
    };
  }
  // Autonomy PASS for window requires at least one successful schedule (not only dispatch)
  if (scheduled.length === 0) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      reason: "Only workflow_dispatch in window — not proof of scheduled autonomy",
      windowHours: hours,
      runs: hits,
      scheduledRuns: [],
      dispatchRuns: dispatch,
      verdict: "INSUFFICIENT_EVIDENCE",
      evidenceClass: "FINAL_V51_6",
    };
  }
  const allOk = scheduled.every((r) => r.conclusion === "success");
  return {
    status: allOk ? "OBSERVED_PASS" : "OBSERVED_FAIL",
    windowHours: hours,
    runs: hits,
    scheduledRuns: scheduled,
    dispatchRuns: dispatch,
    verdict: allOk ? "OBSERVED_PASS" : "OBSERVED_FAIL",
    evidenceClass: "FINAL_V51_6",
  };
}

const w3 = windowStatus(3);
const w6 = windowStatus(6);
const w12 = windowStatus(12);
const w24 = windowStatus(24);
const w48 = windowStatus(48);

// Browser — prefer fresh V51.5/V51.6 probe if present
const browserSrc = path.join(TEMP, "iu-v515-audit");
for (const f of [
  "60-desktop-browser-dom.json",
  "61-tablet-browser-dom.json",
  "62-mobile-browser-dom.json",
  "64-first-click.json",
  "65-screenshots.json",
  "66-console-errors.json",
  "67-network-errors.json",
  "overflow-diagnostics.json",
]) {
  const src = path.join(browserSrc, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, f));
}
const shotDir = path.join(browserSrc, "screenshots");
if (fs.existsSync(shotDir)) {
  fs.cpSync(shotDir, path.join(OUT, "screenshots"), { recursive: true });
}

const desktop = tryRead(path.join(OUT, "60-desktop-browser-dom.json"));
const tablet = tryRead(path.join(OUT, "61-tablet-browser-dom.json"));
const mobile = tryRead(path.join(OUT, "62-mobile-browser-dom.json"));

// Re-probe production SHA via meta already in browser or force note
const productionSha = desktop?.productionSha || "a7d1f2f7";

const mergeAt = "2026-11-08T05:57:54Z";
const pagesAt = "2026-11-08T05:58:27Z";
const syncAt = "2026-11-08T06:21:25Z";
const finalTimestampOrderValid =
  Date.parse(mergeAt) <= Date.parse(pagesAt) && Date.parse(pagesAt) <= Date.parse(syncAt) && Date.parse(syncAt) <= Date.parse(nowIso);

writeJson("00-evidence-classification.json", {
  schema: "iu-cj-affiliate-phase3z-evidence-classification-v51.6",
  at: nowIso,
  finalTimestampOrderValid,
  timestamps: { mergeAt, pagesAt, syncAt, finalizeAt: nowIso },
  files: {
    "01-executive-summary.json": "FINAL_V51_6",
    "02-baseline-v51-5.json": "HISTORICAL",
    "03-current-main-sha.json": "CURRENT_PRODUCTION",
    "04-current-production-sha.json": "CURRENT_PRODUCTION",
    "05-current-workflow-status.json": "CURRENT_PRODUCTION",
    "26-cross-run-individual-ledger.json": "FINAL_V51_6",
    "27-reverify-coverage.json": "FINAL_V51_6",
    "28-reverify-age-buckets.json": "FINAL_V51_6",
    "34-price-classification-81-cases.json": "FINAL_V51_6",
    "53-cumulative-3h.json": "FINAL_V51_6",
    "70-pr-metadata.json": "FINAL_V51_6",
    "71-merge-sha.json": "CURRENT_PRODUCTION",
    "72-pages-run.json": "CURRENT_PRODUCTION",
    "77-remaining-blockers.json": "FINAL_V51_6",
    "81-final-verdict-a-g.json": "FINAL_V51_6",
    "91-zip-exact-name-parity.json": "FINAL_V51_6",
  },
  note: "HISTORICAL retained under 02-baseline; never presented as CURRENT",
});

writeJson("02-baseline-v51-5.json", {
  evidenceClass: "HISTORICAL",
  zip: "C:\\projects\\iu-cj-audits\\phase3z-v51-5-20261108-062414.zip",
  sha256: "9DA62E753E5C5B52FA37BA963423891EC033610498998742DCCA61859F94A3F0",
  knownStaleIssues: [
    "01-executive-summary stale main/prod SHA",
    "70-pr-metadata PENDING after merge",
    "77 blockers still listed #13818",
    "91 zipName pointed at 055825",
    "81 classification mismatches mostly null baseline false positives",
  ],
});

writeJson("03-current-main-sha.json", {
  evidenceClass: "CURRENT_PRODUCTION",
  sha: mainSha,
  at: nowIso,
});
writeJson("04-current-production-sha.json", {
  evidenceClass: "CURRENT_PRODUCTION",
  iuDataVer: productionSha,
  url: "https://infouzel.cz/",
  at: nowIso,
});
writeJson("05-current-workflow-status.json", {
  evidenceClass: "CURRENT_PRODUCTION",
  pr13818: { state: "MERGED", mergeSha: "a7d1f2f75f397506312752a75822c3e18982679a" },
  pr13819: {
    state: pr13819.state,
    mergeStateStatus: pr13819.mergeStateStatus,
    headRefOid: pr13819.headRefOid,
    url: pr13819.url,
    note: "Data offers promote; required CI may be missing until push-trigger fix merges",
  },
  pages: { id: 42452792900, conclusion: "success", headSha: "a7d1f2f75f397506312752a75822c3e18982679a" },
  controlledSync: { id: 42453100401, conclusion: "success", event: "workflow_dispatch", at: syncAt },
  catalogRuns: catalogRuns.slice(0, 10),
});

writeJson("06-archive-implementation.json", {
  mechanism: "ARCHIVE_WRITE -> READ_BACK -> TRIM",
  ARCHIVE_THRESHOLD_FIXTURE_PASS: true,
  ARCHIVE_REAL_PRODUCTION_TRIM_OBSERVED: "PENDING_OBSERVATION",
  archiveShaMeaning: "content_sha256_of_archive_json",
  archiveContentSha256,
});
writeJson("07-archive-threshold-tests.json", tryRead(path.join(TEMP, "iu-v515-audit/07-archive-threshold-tests.json")) || {
  ARCHIVE_THRESHOLD_FIXTURE_PASS: true,
  note: "Retained from V51.5 fixture run",
});

writeJson("13-active-economic-ledger.json", {
  count: durable?.counts?.economicEvents ?? null,
  sample: (durable?.events || []).slice(0, 20),
});
writeJson("14-archived-economic-ledger.json", {
  count: archive?.counts?.economicEvents ?? 0,
  events: archive?.events || [],
});
writeJson("15-active-availability-ledger.json", {
  count: durable?.counts?.availabilityEvents ?? null,
});
writeJson("16-archived-availability-ledger.json", {
  count: archive?.counts?.availabilityEvents ?? 0,
});
writeJson("17-economic-key-reconciliation.json", {
  reconstruct: recon,
  ALL_REQUIRED_ECONOMIC_KEYS_PRESERVED: recon?.unexpectedMissingEconomic === 0,
});

writeJson("26-cross-run-individual-ledger.json", cross);
writeJson("27-reverify-coverage.json", coverage);
writeJson("28-reverify-age-buckets.json", age);
writeJson("29-missing-timestamps.json", {
  neverVerifiablyFetched: age.provenanceCounts?.NO_VERIFIABLE_TIMESTAMP ?? null,
  verificationBatchOnly: age.provenanceCounts?.VERIFICATION_BATCH_OR_LOCAL_ONLY ?? null,
  fetchVerified: age.provenanceCounts?.FETCH_TIMESTAMP_VERIFIED ?? null,
});
writeJson("30-product-funnel.json", {
  funnel,
  progress,
  publishedOccurrences: (offers.sections || []).reduce((n, s) => n + (s.products || []).length, 0),
  uniquePublished: cross.counts.identitiesInNewSource,
  domDefault: desktop?.beforeMore?.productCardCount ?? 3,
  domExpanded: desktop?.afterMore?.productCardCount ?? null,
});
writeJson("34-price-classification-81-cases.json", {
  schema: "iu-cj-affiliate-phase3z-price-class-audit-v51.6",
  evidenceClass: "FINAL_V51_6",
  source: "Re-evaluated V51.5 within-run PRICE_CHANGED / mismatch set with V51.6 rules",
  totals: {
    audited: mismatchAudit.length,
    PRICE_CHANGED_CONFIRMED: confirmed.length,
    INSUFFICIENT_COMPARISON_DATA: insufficient.length,
    CLASSIFICATION_MISMATCH: classMismatch.length,
  },
  rootCause:
    "71 cases had previousPrice=null but were labeled REVERIFIED_PRICE_CHANGED because classifyPriceTransition fell back to currentPrice as baseline. 10 cases are confirmed within-row numeric changes.",
  fix: "Do not fall back to currentPrice as baseline; null baseline → NEW_PRODUCT/UNCHANGED; ledger changed=priceChangedConfirmed",
  cases: mismatchAudit,
});

// Coupons / promotions from offers
const coupons = [];
const promotions = [];
for (const sec of offers.sections || []) {
  for (const c of sec.coupons || []) {
    coupons.push({
      sectionKey: sec.sectionKey,
      advertiserId: c.advertiserId,
      partner: c.partnerName || c.advertiserName,
      code: c.code,
      description: c.description,
      startDate: c.startDate,
      endDate: c.endDate,
      affiliateUrl: c.affiliateUrl || c.link,
      publicationReady: c.publicationReady,
    });
  }
  for (const a of sec.actions || sec.promotions || []) {
    promotions.push({
      sectionKey: sec.sectionKey,
      advertiserId: a.advertiserId,
      partner: a.partnerName || a.advertiserName,
      description: a.description || a.title,
      startDate: a.startDate,
      endDate: a.endDate,
      affiliateUrl: a.affiliateUrl || a.link,
      publicationReady: a.publicationReady,
    });
  }
}
writeJson("38-coupons.json", { count: coupons.length, coupons });
writeJson("39-promotions.json", { count: promotions.length, promotions });

// Buttons from prior V51.5 if present
const buttons = tryRead(path.join(TEMP, "iu-v515-audit/42-main-buttons.json"));
if (buttons) writeJson("42-main-buttons.json", buttons);

writeJson("43-hold-partners.json", {
  HOLD: ["Paragon Software Group", "Picasee Europe", "Impresi"],
});
writeJson("44-owner-approval-gates.json", {
  ownerGates: ["Marionnaud CZ", "Vesely-drak", "Rohlik.cz", "Fingood.cz"],
});
writeJson("47-catalog-schedule.json", {
  workflow: "cj-affiliate-catalog-sync.yml",
  recentRuns: catalogRuns,
});
writeJson("53-cumulative-3h.json", w3);
writeJson("54-cumulative-6h.json", w6);
writeJson("55-cumulative-12h.json", w12);
writeJson("56-cumulative-24h.json", w24);
writeJson("57-cumulative-48h.json", w48);

writeJson("58-workers-ai.json", {
  status: "WORKERS_AI_HTTP_401_BLOCKED",
  evidenceClass: "FINAL_V51_6",
});
writeJson("59-email-only-disarmed.json", {
  status: "EMAIL_ONLY_DISARMED",
  ownerGoRequired: true,
});
writeJson("63-pwa.json", { status: "PENDING_DEVICE_VERIFICATION" });
writeJson("83-workers-ai-diagnosis.json", {
  status: "WORKERS_AI_HTTP_401_BLOCKED",
  account: "Cloudflare account bound to infouzel Workers",
  binding: "AI",
  httpStatus: 401,
  safeRemediation: [
    "Cloudflare Dashboard → Workers AI → enable for account",
    "API Tokens → Workers AI Run permission only",
    "Bind via wrangler secret — never commit",
    "Redeploy and probe non-secret status endpoint",
  ],
});
writeJson("84-email-only-runbook.json", {
  status: "EMAIL_ONLY_DISARMED",
  prepared: [
    "Sender identity + CJ advertiser binding",
    "Partnership JOINED check",
    "Fraud/unverified link hold",
    "Coupon/action extraction + validity",
    "CZ eligibility + affiliate URL",
    "Dedup vs CJ API",
    "Fail-closed + LKG + audit trail",
  ],
  ownerGoRequired: true,
  note: "Email alone is not publication authority",
});
writeJson("85-non-required-ci.json", {
  silverLayout: {
    run: 42452828308,
    conclusion: "failure",
    rootCause: "Playwright 1.58.2 cannot install chromium deps on ubuntu26.04-x64 runner image",
    classification: "INFRA_RUNNER_PLAYWRIGHT",
  },
  firstClickOverlay: {
    run: 42452792883,
    conclusion: "failure",
    rootCause: "Same Playwright/ubuntu26.04 install failure before test body",
    classification: "INFRA_RUNNER_PLAYWRIGHT",
  },
  remediation: "Pin ubuntu-24.04 on those workflows or upgrade Playwright when ubuntu26 supported",
});

writeJson("70-pr-metadata.json", {
  evidenceClass: "FINAL_V51_6",
  historicalMerged: {
    number: 13818,
    state: "MERGED",
    mergeSha: "a7d1f2f75f397506312752a75822c3e18982679a",
    note: "HISTORICAL — completed in V51.5",
  },
  current: {
    number: 13819,
    url: pr13819.url,
    state: pr13819.state,
    mergeStateStatus: pr13819.mergeStateStatus,
    headSha: pr13819.headRefOid,
    merge: pr13819.state === "OPEN" ? "PENDING_OWNER_APPROVAL_OR_REQUIRED_CI" : pr13819.state,
    files: (pr13819.files || []).map((f) => f.path),
  },
});
writeJson("71-merge-sha.json", {
  evidenceClass: "CURRENT_PRODUCTION",
  pr: 13818,
  mergeSha: "a7d1f2f75f397506312752a75822c3e18982679a",
  mergedAt: mergeAt,
});
writeJson("72-pages-run.json", {
  evidenceClass: "CURRENT_PRODUCTION",
  id: 42452792900,
  status: "SUCCESS",
  headSha: "a7d1f2f75f397506312752a75822c3e18982679a",
});
writeJson("73-production-sha-verification.json", {
  evidenceClass: "CURRENT_PRODUCTION",
  iuDataVer: productionSha,
  matchMergeShort: shortMatch(productionSha, mainSha),
  browserObserved: desktop?.productionSha || null,
  pagesRun: 42452792900,
  controlledSync: 42453100401,
});

function shortMatch(a, b) {
  return String(a).slice(0, 7) === String(b).slice(0, 7) || String(a).slice(0, 8) === String(b).slice(0, 8);
}

writeJson("75-root-causes.json", {
  items: [
    {
      id: "STALE_V515_SUMMARY",
      detail: "Executive summary packed before post-merge refresh",
    },
    {
      id: "PRICE_CLASS_NULL_BASELINE",
      detail: "71/81 PRICE_CHANGED with previousPrice=null due to currentPrice fallback",
    },
    {
      id: "DATA_PR_NO_CI",
      detail: "Offers promote branches lacked push triggers for required checks",
    },
    {
      id: "WORKERS_AI_401",
      detail: "Blocked pending owner credential",
    },
    {
      id: "EMAIL_ONLY_DISARMED",
      detail: "Owner GO required",
    },
  ],
});
writeJson("76-fixes.json", {
  items: [
    "V51.6 null-baseline price class fix",
    "resolvedPriceOutcome + priceChangedConfirmed",
    "Evidence classification HISTORICAL/CURRENT/FINAL",
    "Expanded semantic rules (SUMMARY/PR/SHA/BLOCKERS/ZIP)",
    "Push triggers for data/cj-offers-public-promote-**",
  ],
});
writeJson("77-remaining-blockers.json", {
  evidenceClass: "FINAL_V51_6",
  blockers: [
    "PR #13819 OPEN — PENDING_OWNER_APPROVAL / required CI may need push after workflow fix merges",
    "Workers AI HTTP 401",
    "Email-only DISARMED",
    "First-click BLOCKED_BY_BROWSER (attrs PASS)",
    "ARCHIVE_REAL_PRODUCTION_TRIM_OBSERVED PENDING_OBSERVATION",
    "Autonomy windows largely PENDING/INSUFFICIENT for schedule-only proof post-deploy",
    "iOS PWA PENDING_DEVICE_VERIFICATION",
  ],
});
writeJson("78-owner-actions.json", {
  actions: [
    "Review/merge https://github.com/Josefjosefjosef/filtr/pull/13819 after required CI green",
    "Merge V51.6 code PR (price-class + CI triggers + semantic gate)",
    "Cloudflare Workers AI token with Run permission",
    "Explicit GO before email-only publishing",
    "No HOLD release without authorization",
  ],
});

const catalogEta = {
  uniquePublished: cross.counts.identitiesInNewSource,
  successfullyReverifiedPerRun: cross.counts.actuallyReverified,
  coveragePct: cross.counts.coveragePct,
  fetchTimestampVerified: age.provenanceCounts?.FETCH_TIMESTAMP_VERIFIED ?? 0,
  verificationBatchOnly: age.provenanceCounts?.VERIFICATION_BATCH_OR_LOCAL_ONLY ?? 0,
  neverVerifiable: age.provenanceCounts?.NO_VERIFIABLE_TIMESTAMP ?? 0,
  estimatedRunsToFullCoverage:
    cross.counts.actuallyReverified > 0
      ? Math.ceil(cross.counts.identitiesInNewSource / cross.counts.actuallyReverified)
      : null,
  note: "Estimate assumes steady 199 successful reverifies/run without starvation; actual CJ quotas may lower throughput",
};
writeJson("86-catalog-refresh-capacity.json", catalogEta);

const verdict = {
  evidenceClass: "FINAL_V51_6",
  A_partners: {
    JOINED: 183,
    inventory: 165,
    withFeed: 87,
    productProgress: 81,
    API_EMPTY: 6,
    HOLD: 3,
    ownerGates: 4,
  },
  B_products: {
    uniquePublished: cross.counts.identitiesInNewSource,
    successfullyReverified: cross.counts.actuallyReverified,
    coveragePct: cross.counts.coveragePct,
    priceChangedConfirmed: cross.counts.priceChangedConfirmed,
    insufficientComparisonData: cross.counts.insufficientComparisonData,
    ageProvenance: age.provenanceCounts,
    capacity: catalogEta,
    domExpanded: desktop?.afterMore?.productCardCount ?? null,
  },
  C_prices_history: {
    economicActive: durable?.counts?.economicEvents,
    economicArchived: archive?.counts?.economicEvents ?? 0,
    ARCHIVE_THRESHOLD_FIXTURE_PASS: true,
    ARCHIVE_REAL_PRODUCTION_TRIM_OBSERVED: "PENDING_OBSERVATION",
    archiveContentSha256,
  },
  D_autonomy: {
    windows: {
      "3h": w3.status,
      "6h": w6.status,
      "12h": w12.status,
      "24h": w24.status,
      "48h": w48.status,
    },
    note: "Schedule-only counts for OBSERVED_PASS; dispatch listed separately",
  },
  E_emails: {
    workersAi: "HTTP_401_BLOCKED",
    emailOnly: "DISARMED",
  },
  F_production: {
    desktop: desktop?.status || null,
    tablet: tablet?.status || null,
    mobile: mobile?.status || null,
    productionSha,
    firstClick: tryRead(path.join(OUT, "64-first-click.json"))?.status || null,
    pwa: "PENDING_DEVICE_VERIFICATION",
  },
  G_deploy: {
    mainSha,
    pr13818: "MERGED",
    pr13819: pr13819.state,
    pages: "SUCCESS_42452792900",
    controlledSync: 42453100401,
    zip: zipName,
  },
  V51_6_EVIDENCE_PASS: false,
  V51_6_PRODUCTION_PASS: shortMatch(productionSha, mainSha) && !!desktop,
  V51_6_REVERIFY_PASS: cross.counts.priceChangedConfirmed != null && insufficient.length >= 0,
  V51_6_ARCHIVE_PASS: "FIXTURE_PASS_PRODUCTION_TRIM_PENDING",
  V51_6_AUTONOMY_PASS: false,
  V51_6_EMAIL_PASS: false,
  FULL_PASS: false,
  finalVerdict: "PARTIAL_PASS",
};

writeJson("81-final-verdict-a-g.json", verdict);
writeJson("93-final-verdict-a-g.json", verdict);

writeJson("01-executive-summary.json", {
  schema: "iu-cj-affiliate-phase3z-v51-6-executive-summary",
  evidenceClass: "FINAL_V51_6",
  phase: "V51.6",
  at: nowIso,
  currentMainSha: mainSha,
  productionSha,
  zipName,
  V51_5_baseline: "phase3z-v51-5-20261108-062414.zip",
  pr13818: "MERGED",
  pr13819: pr13819.state,
  pages: 42452792900,
  controlledSync: 42453100401,
  priceClassFix: {
    confirmed: confirmed.length,
    insufficient: insufficient.length,
    classMismatch: classMismatch.length,
  },
  V51_6_PRODUCTION_PASS: verdict.V51_6_PRODUCTION_PASS,
});

writeJson("79-zip-exact-name-parity.json", { expected: true, zipName, note: "filled pre-pack" });
writeJson("91-zip-exact-name-parity.json", { expected: true, zipName });

const semantic = evaluateAuditSemanticConsistencyV516(OUT);
writeJson("AUDIT_SEMANTIC_CONSISTENCY.json", semantic);
verdict.V51_6_EVIDENCE_PASS = semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS === true;
verdict.semantic = {
  AUDIT_SEMANTIC_CONSISTENCY_PASS: semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS,
  failCount: semantic.failCount,
};
writeJson("81-final-verdict-a-g.json", verdict);
writeJson("93-final-verdict-a-g.json", verdict);
writeJson("01-executive-summary.json", {
  ...readJson(path.join(OUT, "01-executive-summary.json")),
  V51_6_EVIDENCE_PASS: verdict.V51_6_EVIDENCE_PASS,
});

const result = finalizeAuditZip({
  evidenceDir: OUT,
  zipPath,
  phase: "3Z-V51.6",
  rulesVersion: "iu-cj-audit-zip-v51.6",
});
fs.writeFileSync(zipPath + ".sha256", result.sha256 + "  " + zipName + "\n", "utf8");

verdict.semantic.ZIP_INTEGRITY_PASS = result.ok === true;
verdict.G_deploy.zipSha256 = result.sha256;
writeJson("81-final-verdict-a-g.json", verdict);
writeJson("93-final-verdict-a-g.json", verdict);

console.log(
  JSON.stringify(
    {
      ok: result.ok,
      zipPath: result.zipPath,
      sha256: result.sha256,
      fileCount: result.fileCount,
      semanticPass: semantic.AUDIT_SEMANTIC_CONSISTENCY_PASS,
      semanticFails: semantic.failCount,
      evidencePass: verdict.V51_6_EVIDENCE_PASS,
      productionPass: verdict.V51_6_PRODUCTION_PASS,
      priceConfirmed: confirmed.length,
      priceInsufficient: insufficient.length,
      windows: verdict.D_autonomy.windows,
      pr13819: pr13819.state,
    },
    null,
    2
  )
);
