#!/usr/bin/env node
/**
 * V34 — capacity model for published-offer refresh vs discovery.
 * CJ GraphQL calls are spaced by CJ_CALL_MIN_INTERVAL_MS (~2.6s ≈ 23 req/min).
 *
 * Honest conclusion: 1–3h published refresh is achievable for ~28–40 advertisers
 * with a refresh-priority schedule; full inventory + deep discovery remains daily.
 */
import { CJ_CALL_MIN_INTERVAL_MS } from "./iu-cj-affiliate-phase1-lib.mjs";

export const REFRESH_CAPACITY_SCHEMA = "iu-cj-affiliate-phase3z-refresh-capacity-v34";

export function estimateRefreshCapacity(input = {}) {
  const publishedProducts = Math.max(0, Number(input.publishedProducts) || 0);
  const advertisers = Math.max(0, Number(input.advertisersWithPublished) || 0);
  const pageSize = Math.max(1, Number(input.refreshPageSize) || 100);
  const maxPages = Math.max(1, Number(input.refreshMaxPages) || 3);
  const intervalMs = Math.max(1, Number(input.callIntervalMs) || CJ_CALL_MIN_INTERVAL_MS);
  const callsPerAdvertiser = maxPages;
  const gqlCalls = advertisers * callsPerAdvertiser;
  const seconds = (gqlCalls * intervalMs) / 1000;
  const minutes = seconds / 60;
  const reqPerMin = 60000 / intervalMs;
  // Target 1–3h: use 3h ceiling as "met" only if refresh finishes with headroom.
  const targetMaxMinutes = Number(input.targetMaxMinutes) || 180;
  const achievableEveryHours = Math.max(1, Math.ceil(minutes / 60) + (minutes > 5 ? 1 : 0));
  const meets1to3h = minutes <= targetMaxMinutes && achievableEveryHours <= 3;
  return {
    schema: REFRESH_CAPACITY_SCHEMA,
    publishedProducts,
    advertisersWithPublished: advertisers,
    refreshPageSize: pageSize,
    refreshMaxPages: maxPages,
    gqlCalls,
    callIntervalMs: intervalMs,
    approxReqPerMin: Number(reqPerMin.toFixed(2)),
    estimatedRefreshMinutes: Number(minutes.toFixed(2)),
    achievableCadenceHours: achievableEveryHours,
    meetsTarget1to3h: meets1to3h,
    caveat:
      "CJ shoppingProducts scan is partner-window based (not per-productId GET). Published keys outside the scanned window are notFoundThisPass until discovery rotates. Feed lastUpdated may be daily — cannot claim merchant-side price freshness faster than source.",
    recommendation: meets1to3h
      ? "Schedule refresh_priority every 3h; keep daily full inventory/discovery."
      : "Reduce advertiser batching or raise interval; do not claim 1–3h if capacity insufficient.",
  };
}

export function describeRefreshDiscoverySeparation() {
  return {
    refresh: "Prioritized scan of published product keys; does not advance discovery checkpoints.",
    discovery: "Continueable offset/page checkpoints; presentation budget rotates independently.",
    schedule: {
      dailyFullCron: "17 3 * * *",
      refreshPriorityCrons: "17 0,6,9,12,15,18,21 * * *",
    },
  };
}
