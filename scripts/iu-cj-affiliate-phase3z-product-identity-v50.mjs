/**
 * V50 — product identity uniqueness ledger (compound advertiserId|productId).
 * Distinguishes in-run UNIQUE from catalog UNIQUE; never treats "rows processed" as UNIQUE.
 */
import { compoundIdentity } from "./iu-cj-affiliate-phase3z-durable-price-history-v50.mjs";

export const PRODUCT_IDENTITY_SCHEMA = "iu-cj-affiliate-phase3z-product-identity-v50";

/**
 * Build identity ledger from fetched/mapped rows + published doc.
 * each fetched row: { advertiserId, productId, feedId?, currency?, language?, categoryKey? }
 */
export function buildProductIdentityLedger(opts = {}) {
  const nowIso = opts.nowIso || new Date().toISOString();
  const fetchedRows = Array.isArray(opts.fetchedRows) ? opts.fetchedRows : [];
  const publishedDoc = opts.publishedDoc || null;
  const runId = opts.runId != null ? String(opts.runId) : null;

  const byCompound = new Map();
  let duplicateSameFeed = 0;
  let duplicateCrossFeedSamePartner = 0;
  let crossPartnerSameProductId = 0;

  const productIdOwners = new Map(); // productId -> Set(advertiserId)

  for (const row of fetchedRows) {
    const adv = row.advertiserId != null ? String(row.advertiserId) : "";
    const pid = row.productId != null ? String(row.productId) : "";
    if (!adv || !pid) continue;
    const key = compoundIdentity(adv, pid);
    const feedId = row.feedId != null ? String(row.feedId) : "";
    const entry = byCompound.get(key) || {
      advertiserId: adv,
      productId: pid,
      compoundIdentity: key,
      occurrenceCount: 0,
      feedIds: new Set(),
      currencies: new Set(),
      languages: new Set(),
      categories: new Set(),
    };
    entry.occurrenceCount += 1;
    if (feedId) {
      if (entry.feedIds.has(feedId) && entry.occurrenceCount > 1) duplicateSameFeed += 1;
      entry.feedIds.add(feedId);
    }
    if (row.currency) entry.currencies.add(String(row.currency));
    if (row.language) entry.languages.add(String(row.language));
    if (row.categoryKey) entry.categories.add(String(row.categoryKey));
    byCompound.set(key, entry);

    if (!productIdOwners.has(pid)) productIdOwners.set(pid, new Set());
    productIdOwners.get(pid).add(adv);
  }

  for (const entry of byCompound.values()) {
    if (entry.feedIds.size > 1) duplicateCrossFeedSamePartner += 1;
  }
  for (const owners of productIdOwners.values()) {
    if (owners.size > 1) crossPartnerSameProductId += 1;
  }

  const uniqueInRun = byCompound.size;
  const fetchedCount = fetchedRows.filter(
    (r) => r?.advertiserId != null && r?.productId != null
  ).length;
  const duplicateApiRows = Math.max(0, fetchedCount - uniqueInRun);

  const publishedKeys = new Set();
  const publishedOccurrences = [];
  for (const sec of publishedDoc?.sections || []) {
    for (const p of sec.products || []) {
      const adv = p.advertiserId != null ? String(p.advertiserId) : "";
      const pid = p.productId != null ? String(p.productId) : "";
      if (!adv || !pid) continue;
      const key = compoundIdentity(adv, pid);
      publishedOccurrences.push(key);
      publishedKeys.add(key);
    }
  }

  // Sample individual rows (cap for artifact size; deterministic order).
  const MAX_ROWS = Number(opts.maxRows || 500);
  const identityRows = [...byCompound.values()]
    .sort((a, b) => a.compoundIdentity.localeCompare(b.compoundIdentity))
    .slice(0, MAX_ROWS)
    .map((e) => ({
      advertiserId: e.advertiserId,
      productId: e.productId,
      compoundIdentity: e.compoundIdentity,
      occurrenceCount: e.occurrenceCount,
      feedIds: [...e.feedIds],
      currencies: [...e.currencies],
      languages: [...e.languages],
      categories: [...e.categories],
      published: publishedKeys.has(e.compoundIdentity),
    }));

  return {
    schema: PRODUCT_IDENTITY_SCHEMA,
    at: nowIso,
    runId,
    sha: opts.sha || null,
    note:
      "UNIQUE = distinct compoundIdentity(advertiserId|productId) in this fetch window. Same productId across partners is NOT a collision. UNIQUE ≠ fetchedRows unless zero duplicates.",
    accounting: {
      fetchedRowsWithIdentity: fetchedCount,
      uniqueIdentitiesInRun: uniqueInRun,
      duplicateApiRows,
      uniqueEqualsFetchedRows: uniqueInRun === fetchedCount,
      publishedUnique: publishedKeys.size,
      publishedOccurrences: publishedOccurrences.length,
      duplicateSameFeedSignals: duplicateSameFeed,
      duplicateCrossFeedSamePartner: duplicateCrossFeedSamePartner,
      crossPartnerSameProductIdCount: crossPartnerSameProductId,
    },
    presentationBudgetNote:
      "READY→PUBLISHED gap is driven by per-partner presentation budget (selectPresentationSlice), not by wiping UNIQUE identities.",
    rows: identityRows,
  };
}
