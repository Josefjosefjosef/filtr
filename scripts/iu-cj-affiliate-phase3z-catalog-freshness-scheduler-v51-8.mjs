/**
 * Catalog freshness scheduler.
 * Selects due product, coupon, action, partner, and link checks.
 * A failed attempt does not move nextCheckAt and does not set lastSuccessfulVerificationAt.
 * sourceUpdatedAt stays empty unless the source record itself contains it.
 */
import { FRESHNESS_POLICY_V32 } from "./iu-cj-affiliate-phase3z-offers-freshness-v32.mjs";

export const CATALOG_FRESHNESS_SCHEMA = "iu-cj-affiliate-phase3z-catalog-freshness-scheduler-v51-8";

const KINDS = new Set(["product", "coupon", "action", "partner", "link"]);

export function catalogIdentity(item) {
  const kind = String(item && item.kind ? item.kind : "product");
  const advertiserId = String(item && item.advertiserId != null ? item.advertiserId : "").trim();
  const itemId = String(
    item && item.itemId != null
      ? item.itemId
      : item && item.productId != null
        ? item.productId
        : item && item.offerId != null
          ? item.offerId
          : ""
  ).trim();
  return { kind, advertiserId, itemId, key: kind + "|" + advertiserId + "|" + itemId };
}

function dueMs(item, nowMs) {
  if (!item || !item.nextCheckAt) return nowMs;
  const at = Date.parse(String(item.nextCheckAt));
  if (!Number.isFinite(at)) return nowMs;
  return Math.max(0, nowMs - at);
}

function expiryBoost(item, nowMs) {
  if (!item || !item.validTo) return 0;
  const end = Date.parse(String(item.validTo).replace(" ", "T"));
  if (!Number.isFinite(end)) return 0;
  const left = end - nowMs;
  if (left <= 0) return FRESHNESS_POLICY_V32.productPriceAvailabilityMs;
  if (left <= 24 * 60 * 60 * 1000) return 12 * 60 * 60 * 1000;
  return 0;
}

/**
 * Collapse section placements to one identity. The earliest due clock wins.
 */
export function dedupeCatalogItems(items) {
  const byKey = new Map();
  let inputRows = 0;
  let dropped = 0;
  for (const item of items || []) {
    inputRows += 1;
    const id = catalogIdentity(item);
    if (!KINDS.has(id.kind) || !id.advertiserId || !id.itemId) {
      dropped += 1;
      continue;
    }
    const prev = byKey.get(id.key);
    if (!prev) {
      byKey.set(id.key, { ...item, ...id, placements: 1 });
      continue;
    }
    prev.placements += 1;
    const prevDue = Date.parse(String(prev.nextCheckAt || ""));
    const nextDue = Date.parse(String(item.nextCheckAt || ""));
    if (!Number.isFinite(prevDue) || (Number.isFinite(nextDue) && nextDue < prevDue)) {
      prev.nextCheckAt = item.nextCheckAt || null;
    }
  }
  return {
    inputRows,
    unique: byKey.size,
    dropped,
    extraPlacements: inputRows - dropped - byKey.size,
    items: [...byKey.values()],
  };
}

export function planCatalogFreshnessBatch(items, opts = {}) {
  const nowMs = opts.nowMs != null ? Number(opts.nowMs) : Date.now();
  const limit = Math.max(1, Math.floor(Number(opts.limit) || 25));
  const maxPerPartner = Math.max(1, Math.floor(Number(opts.maxPerPartner) || 3));
  const checkpoint = opts.checkpoint || { completed: {}, nextAttemptAt: {} };
  const deduped = dedupeCatalogItems(items);
  const byPartner = new Map();
  let due = 0;
  for (const item of deduped.items) {
    const retryAt = checkpoint.nextAttemptAt && checkpoint.nextAttemptAt[item.key];
    if (retryAt != null && Number(retryAt) > nowMs) continue;
    const overdue = dueMs(item, nowMs);
    const missingClock = !item.nextCheckAt;
    if (!missingClock && overdue <= 0 && expiryBoost(item, nowMs) === 0 && item.relationshipStatus !== "ended") {
      continue;
    }
    due += 1;
    const score =
      overdue +
      expiryBoost(item, nowMs) +
      (item.priceChanged === true ? 60 * 60 * 1000 : 0) +
      (item.availabilityChanged === true ? 60 * 60 * 1000 : 0) +
      (item.relationshipStatus === "ended" ? 2 * 60 * 60 * 1000 : 0);
    const row = { ...item, score, overdueMs: overdue };
    if (!byPartner.has(row.advertiserId)) byPartner.set(row.advertiserId, []);
    byPartner.get(row.advertiserId).push(row);
  }
  for (const queue of byPartner.values()) queue.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const partners = [...byPartner.keys()].sort((a, b) => {
    const aScore = byPartner.get(a)[0] ? byPartner.get(a)[0].score : 0;
    const bScore = byPartner.get(b)[0] ? byPartner.get(b)[0].score : 0;
    if (aScore !== bScore) return bScore - aScore;
    return a.localeCompare(b);
  });
  const batch = [];
  const taken = {};
  let guard = 0;
  while (batch.length < limit && guard < limit * Math.max(partners.length, 1) + 5) {
    guard += 1;
    let progressed = false;
    for (const partner of partners) {
      if (batch.length >= limit) break;
      const used = taken[partner] || 0;
      if (used >= maxPerPartner) continue;
      const queue = byPartner.get(partner) || [];
      if (!queue.length) continue;
      batch.push(queue.shift());
      taken[partner] = used + 1;
      progressed = true;
    }
    if (!progressed) break;
  }
  return {
    schema: CATALOG_FRESHNESS_SCHEMA,
    unique: deduped.unique,
    extraPlacements: deduped.extraPlacements,
    due,
    batch,
    partnersInBatch: new Set(batch.map((row) => row.advertiserId)).size,
    debtAfterBatch: Math.max(0, due - batch.length),
    executeArmed: false,
    publicationExecute: false,
  };
}

/**
 * Record one check. Failure keeps the previous success clock and the previous due time.
 */
export function applyCatalogCheckResult(item, result, nowMs) {
  const nowIso = new Date(nowMs).toISOString();
  const interval = FRESHNESS_POLICY_V32.productPriceAvailabilityMs;
  const base = {
    ...item,
    sourceUpdatedAt: item && item.sourceUpdatedAt ? item.sourceUpdatedAt : null,
    lastSuccessfulVerificationAt: item && item.lastSuccessfulVerificationAt ? item.lastSuccessfulVerificationAt : null,
    nextCheckAt: item && item.nextCheckAt ? item.nextCheckAt : null,
  };
  if (!result || result.ok !== true) {
    const attempt = Math.max(0, Math.floor(Number(item && item.attempt) || 0)) + 1;
    const backoff = Math.min(interval, 1000 * 2 ** Math.min(attempt, 8));
    return {
      ...base,
      ok: false,
      attempt,
      lastFailedAttemptAt: nowIso,
      nextAttemptAt: new Date(nowMs + backoff).toISOString(),
      lkgKept: true,
      sourceVerified: false,
    };
  }
  const sourceUpdatedAt = result.sourceUpdatedAt ? String(result.sourceUpdatedAt) : null;
  return {
    ...base,
    ok: true,
    fetchedAt: nowIso,
    lastCheckedAt: nowIso,
    lastVerifiedAt: nowIso,
    lastSuccessfulVerificationAt: nowIso,
    sourceUpdatedAt,
    sourceUpdatedAtStatus: sourceUpdatedAt ? "PROVIDED" : "NOT_PROVIDED",
    nextCheckAt: new Date(nowMs + interval).toISOString(),
    lkgKept: false,
    sourceVerified: true,
  };
}
