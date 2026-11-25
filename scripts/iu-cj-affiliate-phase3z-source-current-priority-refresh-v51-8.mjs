#!/usr/bin/env node
/**
 * V51.8 F-FRESHNESS-SOURCE-CURRENT — READ-ONLY audit + priority refresh planner.
 *
 * 1) SOURCE_CURRENT honesty: only authoritative CJ sourceUpdatedAt (PROVIDED) within policy
 *    counts as SOURCE_CURRENT (= SOURCE_FRESH). Fetch/check time is never source time.
 *    Rows that claim CURRENT without proof are reported as dishonest.
 * 2) Priority refresh planner: ranks published products for the next refresh batch and merges the
 *    durable retry queue (dueFromQueue / deferredNotDue) via the existing V51.8 helper.
 *
 * No network, no CJ credentials, no writes to the offers doc or queue. Optional --out report only
 * (default: %TEMP%). Does not touch growth caps, email publish, D1 nonce, or R2.
 */
import fs from "node:fs";
import path from "node:path";
import {
  FRESHNESS_POLICY_V32,
  FRESHNESS_STATUS,
  SOURCE_UPDATED_AT_STATUS,
  classifyProductFreshness,
  resolveSourceUpdatedAtProvenance,
} from "./iu-cj-affiliate-phase3z-offers-freshness-v32.mjs";
import {
  mergeTargetsWithRetryQueue,
  readRetryQueueFile,
} from "./iu-cj-affiliate-phase3z-lkg-missing-refresh-attempt-v51-8.mjs";

export const SOURCE_CURRENT_AUDIT_SCHEMA = "iu-cj-affiliate-phase3z-source-current-priority-refresh-v51-8";

export const REFRESH_TIER = Object.freeze({
  P0_HIDDEN_OR_DISHONEST: "P0_HIDDEN_OR_DISHONEST",
  P1_STALE: "P1_STALE",
  P1_QUEUE_DUE: "P1_QUEUE_DUE",
  P2_UNVERIFIED: "P2_UNVERIFIED",
  P3_SOURCE_AGE_UNKNOWN_AGING: "P3_SOURCE_AGE_UNKNOWN_AGING",
  NOT_DUE: "NOT_DUE",
});

const TIER_BASE = Object.freeze({
  P0_HIDDEN_OR_DISHONEST: 1000,
  P1_STALE: 800,
  P1_QUEUE_DUE: 750,
  P2_UNVERIFIED: 700,
  P3_SOURCE_AGE_UNKNOWN_AGING: 400,
  NOT_DUE: 0,
});

/** Labels a card may carry that assert "current". Only SOURCE_FRESH (with PROVIDED source) is honest. */
const CURRENT_CLAIMS = new Set(["SOURCE_FRESH", "FRESH", "SOURCE_CURRENT", "CURRENT"]);

function productKey(p) {
  return `${String(p?.advertiserId ?? "").trim()}|${String(p?.productId ?? "").trim()}`;
}

function hasIdentity(p) {
  return String(p?.advertiserId ?? "").trim() !== "" && String(p?.productId ?? "").trim() !== "";
}

/** Honesty verdict for one product card. */
export function classifySourceCurrentHonesty(p, nowMs = Date.now(), policy = FRESHNESS_POLICY_V32) {
  const fr = classifyProductFreshness(p, nowMs, policy);
  const prov = resolveSourceUpdatedAtProvenance(p, { treatEqualCheckAsLegacy: true });
  const claimed = p?.freshnessStatus != null ? String(p.freshnessStatus) : null;
  const claimedVerif = p?.verificationClass != null ? String(p.verificationClass) : null;
  const reasons = [];
  const claimsCurrent =
    (claimed != null && CURRENT_CLAIMS.has(claimed)) ||
    (claimedVerif != null && CURRENT_CLAIMS.has(claimedVerif));
  const provedCurrent = fr.freshnessStatus === FRESHNESS_STATUS.SOURCE_FRESH;
  if (claimsCurrent && !provedCurrent) reasons.push("CLAIMED_CURRENT_WITHOUT_AUTHORITATIVE_SOURCE");
  if (prov.sourceUpdatedAtStatus === SOURCE_UPDATED_AT_STATUS.LEGACY_FETCH_AS_SOURCE) {
    reasons.push("SOURCE_TIMESTAMP_EQUALS_FETCH_CLOCK");
  }
  if (prov.untrustedRaw) reasons.push("UNTAGGED_SOURCE_TIMESTAMP");
  return {
    key: productKey(p),
    claimedStatus: claimed,
    provenStatus: fr.freshnessStatus,
    sourceCurrent: provedCurrent,
    sourceUpdatedAtStatus: prov.sourceUpdatedAtStatus,
    ageMs: fr.ageMs,
    hidePublicPrice: fr.hidePublicPrice === true,
    dishonest: reasons.length > 0,
    reasons,
  };
}

function* iterProducts(doc) {
  for (const sec of doc?.sections || []) {
    for (const p of sec.products || []) yield { sec, p };
  }
}

/**
 * Audit published products: how many are really SOURCE_CURRENT vs only FETCH_RECENT.
 */
export function auditSourceCurrentHonesty(doc, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const policy = opts.policy || FRESHNESS_POLICY_V32;
  const counts = {
    products: 0,
    sourceCurrent: 0,
    fetchRecentSourceAgeUnknown: 0,
    stale: 0,
    hiddenStale: 0,
    unverified: 0,
    claimedCurrent: 0,
    dishonest: 0,
  };
  const byReason = {};
  const sample = [];
  const sampleLimit = Number(opts.sampleLimit) > 0 ? Number(opts.sampleLimit) : 20;
  for (const { p } of iterProducts(doc)) {
    counts.products += 1;
    const h = classifySourceCurrentHonesty(p, nowMs, policy);
    if (h.claimedStatus != null && CURRENT_CLAIMS.has(h.claimedStatus)) counts.claimedCurrent += 1;
    switch (h.provenStatus) {
      case FRESHNESS_STATUS.SOURCE_FRESH:
        counts.sourceCurrent += 1;
        break;
      case FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN:
        counts.fetchRecentSourceAgeUnknown += 1;
        break;
      case FRESHNESS_STATUS.STALE:
        counts.stale += 1;
        break;
      case FRESHNESS_STATUS.HIDDEN_STALE:
        counts.hiddenStale += 1;
        break;
      default:
        counts.unverified += 1;
    }
    if (h.dishonest) {
      counts.dishonest += 1;
      for (const r of h.reasons) byReason[r] = (byReason[r] || 0) + 1;
      if (sample.length < sampleLimit) sample.push({ key: h.key, reasons: h.reasons, claimed: h.claimedStatus });
    }
  }
  const pct = counts.products > 0 ? Math.round((counts.sourceCurrent / counts.products) * 10000) / 100 : 0;
  return {
    schema: SOURCE_CURRENT_AUDIT_SCHEMA,
    kind: "source_current_honesty_audit",
    readOnly: true,
    at: new Date(nowMs).toISOString(),
    counts,
    sourceCurrentPct: pct,
    // FETCH_RECENT_SOURCE_AGE_UNKNOWN is verified-recent, never CURRENT.
    verifiedRecentNotCurrent: counts.fetchRecentSourceAgeUnknown,
    byReason,
    honest: counts.dishonest === 0,
    sourceCurrentProven: counts.sourceCurrent > 0,
    sample,
    note:
      "SOURCE_CURRENT requires authoritative CJ sourceUpdatedAt (PROVIDED) within policy. Fetch/check time is never source time.",
  };
}

/** Tier + score for one product (higher score = refresh sooner). */
export function scoreRefreshPriority(p, nowMs = Date.now(), policy = FRESHNESS_POLICY_V32) {
  const h = classifySourceCurrentHonesty(p, nowMs, policy);
  const ageH = h.ageMs != null ? h.ageMs / 3600000 : 0;
  let tier = REFRESH_TIER.NOT_DUE;
  if (h.provenStatus === FRESHNESS_STATUS.HIDDEN_STALE || h.dishonest) {
    tier = REFRESH_TIER.P0_HIDDEN_OR_DISHONEST;
  } else if (h.provenStatus === FRESHNESS_STATUS.STALE) {
    tier = REFRESH_TIER.P1_STALE;
  } else if (h.provenStatus === FRESHNESS_STATUS.UNVERIFIED) {
    tier = REFRESH_TIER.P2_UNVERIFIED;
  } else if (
    h.provenStatus === FRESHNESS_STATUS.FETCH_RECENT_SOURCE_AGE_UNKNOWN &&
    h.ageMs != null &&
    h.ageMs >= policy.productPriceAvailabilityMs * 0.5
  ) {
    tier = REFRESH_TIER.P3_SOURCE_AGE_UNKNOWN_AGING;
  }
  return {
    tier,
    score: tier === REFRESH_TIER.NOT_DUE ? 0 : TIER_BASE[tier] + Math.min(ageH, 999),
    ageHours: h.ageMs != null ? Math.round(ageH * 100) / 100 : null,
    reasons: h.reasons,
  };
}

/**
 * Build the ordered refresh plan (read-only). Merges durable retry queue so backoff is honored.
 * opts: { nowMs, queue, limit, policy }
 */
export function planPriorityRefresh(doc, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const policy = opts.policy || FRESHNESS_POLICY_V32;
  const limit = Number(opts.limit) > 0 ? Number(opts.limit) : 200;
  const seen = new Set();
  const candidates = [];
  const tierCounts = {};
  for (const t of Object.values(REFRESH_TIER)) tierCounts[t] = 0;
  for (const { p } of iterProducts(doc)) {
    if (!hasIdentity(p)) continue;
    const key = productKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    const pr = scoreRefreshPriority(p, nowMs, policy);
    tierCounts[pr.tier] += 1;
    if (pr.tier === REFRESH_TIER.NOT_DUE) continue;
    candidates.push({
      key,
      advertiserId: String(p.advertiserId).trim(),
      productId: String(p.productId).trim(),
      feedId: p.feedId != null ? String(p.feedId) : null,
      title: p.title || null,
      tier: pr.tier,
      score: pr.score,
      ageHours: pr.ageHours,
      reasons: pr.reasons,
    });
  }
  const merged = mergeTargetsWithRetryQueue(candidates, opts.queue || null, { nowMs });
  const ranked = merged.targets
    .map((t) => {
      if (t.tier) return t;
      // Queue-only item (no stale/unverified signal from doc) — retry is due.
      return { ...t, tier: REFRESH_TIER.P1_QUEUE_DUE, score: TIER_BASE.P1_QUEUE_DUE, reasons: [] };
    })
    .sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const planned = ranked.slice(0, limit).map((t, i) => ({
    rank: i + 1,
    key: t.key,
    advertiserId: t.advertiserId,
    productId: t.productId,
    feedId: t.feedId || null,
    tier: t.tier,
    score: Math.round(t.score * 100) / 100,
    ageHours: t.ageHours ?? null,
    fromQueue: t.fromQueue === true,
    reasons: t.reasons || [],
  }));
  return {
    schema: SOURCE_CURRENT_AUDIT_SCHEMA,
    kind: "priority_refresh_plan",
    readOnly: true,
    writes: 0,
    at: new Date(nowMs).toISOString(),
    tierCounts,
    candidates: candidates.length,
    dueFromQueue: merged.dueFromQueue,
    deferredNotDue: merged.deferredNotDue,
    totalRanked: ranked.length,
    limit,
    truncatedByLimit: Math.max(0, ranked.length - planned.length),
    planned,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next != null && !next.startsWith("--")) {
      out[k] = next;
      i += 1;
    } else {
      out[k] = true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const docPath = path.resolve(
    String(args.doc || process.env.IU_CJ_OFFERS_PUBLIC_FILE || "projects/data/iu-affiliate-cj-offers-public-v1.json"),
  );
  if (!fs.existsSync(docPath)) {
    console.log(JSON.stringify({ ok: false, error: "offers_doc_not_found", docPath }));
    process.exitCode = 1;
    return;
  }
  const doc = JSON.parse(fs.readFileSync(docPath, "utf8"));
  const nowMs = args.now ? Date.parse(String(args.now)) : Date.now();
  if (!Number.isFinite(nowMs)) {
    console.log(JSON.stringify({ ok: false, error: "invalid_--now" }));
    process.exitCode = 1;
    return;
  }
  const queue = args.queue ? readRetryQueueFile(path.resolve(String(args.queue))) : null;
  const audit = auditSourceCurrentHonesty(doc, { nowMs });
  const plan = planPriorityRefresh(doc, { nowMs, queue, limit: args.limit });
  const outPath = path.resolve(
    String(args.out || path.join(process.env.TEMP || "/tmp", "iu-cj-source-current-priority-refresh-v51-8.json")),
  );
  fs.writeFileSync(outPath, JSON.stringify({ audit, plan }, null, 2) + "\n", "utf8");
  console.log(
    JSON.stringify({
      ok: true,
      readOnly: true,
      docPath,
      outPath,
      counts: audit.counts,
      sourceCurrentPct: audit.sourceCurrentPct,
      honest: audit.honest,
      tierCounts: plan.tierCounts,
      dueFromQueue: plan.dueFromQueue,
      deferredNotDue: plan.deferredNotDue,
      planned: plan.planned.length,
      truncatedByLimit: plan.truncatedByLimit,
    }),
  );
}

const isDirect =
  process.argv[1] &&
  process.argv[1]
    .replace(/\\/g, "/")
    .endsWith("iu-cj-affiliate-phase3z-source-current-priority-refresh-v51-8.mjs");
if (isDirect) main();
