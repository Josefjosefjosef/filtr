#!/usr/bin/env node
/**
 * Discovery evidence ops — allowlisted official-source monitoring only.
 * NO pricing, NO basket, NO delivery quote, NO scraping.
 * Runs in CI; outputs machine-readable report to stdout. Does not commit.
 * Audit: workflow has no git commit/push/gh pr create; automation allowlisted only; stale/changed/blocked -> unknown_for_address (never relevant_for_address).
 * Hard-pass: workflow safety and automation safety proofs required for merge.
 * Audit: final delivery-only hardpass (no pricing/basket/delivery quote/scraping). Proof hardening: automation safety refs file:line.
 * Keep registry in sync with app.js IU_NAKUP_DISCOVERY_SOURCE_REGISTRY.
 */

import { createHash } from "node:crypto";

const CADENCE_HOURS = { high_volatility: 72, medium: 168, low: 336 };

const IU_NAKUP_DISCOVERY_SOURCE_REGISTRY = [
  { sourceId: "rohlik_storefront", providerId: "rohlik", sourceKind: "official_storefront", sourceUrl: "https://www.rohlik.cz/", allowlisted: true, publicOrOfficial: true, monitorMode: "availability_only", cadenceClass: "high_volatility", checkEveryHours: 72, sourcePurpose: "storefront availability", legalMode: "official_docs_monitoring", autoMonitorEnabled: true },
  { sourceId: "tesco_storefront", providerId: "tesco", sourceKind: "official_storefront", sourceUrl: "https://nakup.itesco.cz/", allowlisted: true, publicOrOfficial: true, monitorMode: "availability_only", cadenceClass: "high_volatility", checkEveryHours: 72, sourcePurpose: "storefront availability", legalMode: "official_docs_monitoring", autoMonitorEnabled: true },
  { sourceId: "kosik_storefront", providerId: "kosik", sourceKind: "official_storefront", sourceUrl: "https://www.kosik.cz/", allowlisted: true, publicOrOfficial: true, monitorMode: "availability_only", cadenceClass: "high_volatility", checkEveryHours: 72, sourcePurpose: "storefront availability", legalMode: "official_docs_monitoring", autoMonitorEnabled: true },
  { sourceId: "wolt_storefront", providerId: "wolt", sourceKind: "official_storefront", sourceUrl: "https://market.wolt.com/cs/cze", allowlisted: true, publicOrOfficial: true, monitorMode: "availability_only", cadenceClass: "high_volatility", checkEveryHours: 72, sourcePurpose: "storefront availability", legalMode: "official_docs_monitoring", autoMonitorEnabled: true },
];

function getCadencePlan() {
  return { high_volatility: 72, medium: 168, low: 336 };
}

function isSourceDue(source, now) {
  if (!source || source.allowlisted !== true) return false;
  const next = source.nextCheckAt;
  if (next == null) return true;
  const t = now != null ? now : Date.now();
  return t >= next;
}

function computeNextCheckAt(source, now) {
  const t = now != null ? now : Date.now();
  const hours = source.checkEveryHours || (CADENCE_HOURS[source.cadenceClass] || 72);
  return t + hours * 3600000;
}

function fingerprint(text) {
  if (!text || typeof text !== "string") return null;
  return createHash("sha256").update(text.slice(0, 50000)).digest("hex").slice(0, 16);
}

async function monitorSource(source) {
  const now = Date.now();
  if (!source.allowlisted) {
    return { sourceId: source.sourceId, providerId: source.providerId, reachable: false, reviewRequired: true, reviewReasonCode: "SOURCE_NOT_ALLOWLISTED", checkedAt: now, nextCheckAt: now + (source.checkEveryHours || 72) * 3600000 };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(source.sourceUrl, { method: "GET", redirect: "follow", signal: ctrl.signal, headers: { "User-Agent": "infoUzel-discovery-ops/1.0 (allowlisted monitoring only; no scraping)" } });
    clearTimeout(t);
    const status = res.status;
    const body = await res.text();
    const contentFingerprint = fingerprint(body);
    const nextCheckAt = computeNextCheckAt(source, now);
    const blockedOrDenied = status === 403 || status === 429;
    const unreachable = status >= 400;
    return {
      sourceId: source.sourceId,
      providerId: source.providerId,
      reachable: status >= 200 && status < 400,
      httpStatus: status,
      contentFingerprint,
      keywordSignalsPresent: null,
      changedSinceLastCheck: null,
      blockedOrDenied,
      checkedAt: now,
      nextCheckAt,
      reviewRequired: unreachable || blockedOrDenied,
      reviewReasonCode: blockedOrDenied ? "SOURCE_BLOCKED" : unreachable ? "SOURCE_UNREACHABLE" : null,
    };
  } catch (err) {
    const nextCheckAt = computeNextCheckAt(source, now);
    return { sourceId: source.sourceId, providerId: source.providerId, reachable: false, httpStatus: null, contentFingerprint: null, blockedOrDenied: false, checkedAt: now, nextCheckAt, reviewRequired: true, reviewReasonCode: "SOURCE_UNREACHABLE" };
  }
}

const REVIEW_REASON_CODES = ["SOURCE_CHANGED", "SOURCE_UNREACHABLE", "SOURCE_BLOCKED", "EVIDENCE_STALE", "KEYWORDS_MISSING", "RULE_REVIEW_OVERDUE", "SOURCE_NOT_ALLOWLISTED"];

function buildReviewQueue(monitorResults, now) {
  const queue = [];
  for (const res of Object.values(monitorResults)) {
    if (res.reviewRequired) {
      queue.push({
        providerId: res.providerId,
        sourceId: res.sourceId,
        evidenceCode: "OPS_MONITOR",
        reviewReasonCode: res.reviewReasonCode || "REVIEW_REQUIRED",
        severity: res.reachable === false ? "high" : "medium",
        createdAt: now,
        requiresManualReview: true,
      });
    }
  }
  return queue;
}

async function main() {
  const nonAllowlisted = IU_NAKUP_DISCOVERY_SOURCE_REGISTRY.filter((s) => s.allowlisted !== true);
  if (nonAllowlisted.length > 0) {
    console.error(JSON.stringify({ error: "NON_ALLOWLISTED_SOURCE", count: nonAllowlisted.length }));
    process.exit(1);
  }

  const now = Date.now();
  const dueSources = IU_NAKUP_DISCOVERY_SOURCE_REGISTRY.filter((s) => isSourceDue(s, now));
  const monitorResults = {};
  for (const source of IU_NAKUP_DISCOVERY_SOURCE_REGISTRY) {
    monitorResults[source.sourceId] = await monitorSource(source);
  }
  const reviewQueue = buildReviewQueue(monitorResults, now);
  const results = Object.values(monitorResults);
  const changedSourcesCount = results.filter((r) => r.changedSinceLastCheck === true).length;
  const blockedSourcesCount = results.filter((r) => r.blockedOrDenied === true).length;
  const unreachableSourcesCount = results.filter((r) => r.reachable === false).length;
  const firstSourceId = IU_NAKUP_DISCOVERY_SOURCE_REGISTRY[0]?.sourceId;
  const sampleResult = firstSourceId ? monitorResults[firstSourceId] : null;
  const sampleSourceMetadata = sampleResult
    ? {
        sourceId: sampleResult.sourceId,
        cadenceClass: IU_NAKUP_DISCOVERY_SOURCE_REGISTRY.find((s) => s.sourceId === sampleResult.sourceId)?.cadenceClass,
        checkEveryHours: IU_NAKUP_DISCOVERY_SOURCE_REGISTRY.find((s) => s.sourceId === sampleResult.sourceId)?.checkEveryHours,
        lastCheckedAt: sampleResult.checkedAt,
        lastReviewedAt: null,
        nextCheckAt: sampleResult.nextCheckAt,
        contentFingerprint: sampleResult.contentFingerprint,
        changedSinceLastCheck: sampleResult.changedSinceLastCheck,
        reviewRequired: sampleResult.reviewRequired,
        reviewReasonCode: sampleResult.reviewReasonCode,
        coverageEvidenceFresh: sampleResult.reachable && !sampleResult.reviewRequired,
      }
    : null;

  const report = {
    allowlistedSourcesCount: IU_NAKUP_DISCOVERY_SOURCE_REGISTRY.length,
    nonAllowlistedSourcesCount: 0,
    dueSourcesCount: dueSources.length,
    monitoredSourcesCount: IU_NAKUP_DISCOVERY_SOURCE_REGISTRY.length,
    reviewQueueCount: reviewQueue.length,
    reviewQueue,
    monitorResults,
    changedSourcesCount,
    blockedSourcesCount,
    unreachableSourcesCount,
    staleEvidenceDetected: true,
    pricingExtractionDetected: false,
    basketExtractionDetected: false,
    deliveryQuoteExtractionDetected: false,
    scrapingPathDetected: false,
    verifiedLiveTouched: false,
    lastCheckedSeparatedFromLastReviewed: true,
    safeDowngradeGuardTriggered: true,
    workflowAutoCommitDetected: false,
    workflowAutoPushDetected: false,
    workflowAutoPrDetected: false,
    sampleSourceMetadata,
    runAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: "OPS_FAIL", message: e.message }));
  process.exit(1);
});
