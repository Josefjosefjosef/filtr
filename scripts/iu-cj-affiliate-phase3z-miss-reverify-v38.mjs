#!/usr/bin/env node
/**
 * V38 — authorized re-verify of productIds misses (no scraping).
 * 1) Retry scoped productIds+partnerIds
 * 2) Probe productIds without partnerIds (identity repair candidate)
 */
import {
  fetchShoppingProductsByProductIds,
  mapGraphqlProductRow,
} from "./iu-cj-affiliate-phase2-product-api.mjs";
import { isCjTrackingUrl } from "./iu-cj-affiliate-catalog-sync-publish-gate-v1.mjs";
import {
  stampProductFetchClocks,
  SOURCE_UPDATED_AT_STATUS,
} from "./iu-cj-affiliate-phase3z-offers-freshness-v32.mjs";
import { REFRESH_RESULT } from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";
import { MISS_DECISION } from "./iu-cj-affiliate-phase3z-miss-products-v38.mjs";
import { decideIdentityRepair } from "./iu-cj-affiliate-phase3z-identity-repair-v39.mjs";

/**
 * @param {object} opts
 * @param {Array<{advertiserId:string,productId:string}>} opts.missKeys
 * @param {object} opts.gqlEnv {pat,publisherCid,websitePid}
 * @param {Map} [opts.refreshedByKey] mutated on recover
 * @param {Set} [opts.matchedKeys] mutated on recover
 */
export async function reverifyMissProductsFromCj(opts = {}) {
  const missKeys = opts.missKeys || [];
  const gqlEnv = opts.gqlEnv;
  const websitePid = String(opts.websitePid || gqlEnv?.websitePid || "");
  const refreshedByKey = opts.refreshedByKey instanceof Map ? opts.refreshedByKey : new Map();
  const matchedKeys = opts.matchedKeys instanceof Set ? opts.matchedKeys : new Set();
  const nowIso = opts.nowIso || new Date().toISOString();
  const probeByKey = new Map();
  const meta = {
    missIn: missKeys.length,
    recoveredScoped: 0,
    recoveredIdentityProbe: 0,
    stillMissing: 0,
    identityRepairCandidates: 0,
    apiRequests: 0,
    errors: 0,
  };
  if (!gqlEnv?.pat || !gqlEnv?.publisherCid || missKeys.length === 0) {
    for (const k of missKeys) {
      probeByKey.set(k.advertiserId + "|" + k.productId, {
        recovered: false,
        apiResult: "skipped_no_credentials_or_empty",
      });
    }
    meta.stillMissing = missKeys.length;
    return { probeByKey, refreshedByKey, matchedKeys, meta };
  }

  const byAdv = new Map();
  for (const k of missKeys) {
    const adv = String(k.advertiserId || "");
    const pid = String(k.productId || "");
    if (!adv || !pid) continue;
    if (!byAdv.has(adv)) byAdv.set(adv, []);
    byAdv.get(adv).push(pid);
  }

  // Pass 1: scoped retry
  for (const [advertiserId, ids] of byAdv.entries()) {
    try {
      const fetched = await fetchShoppingProductsByProductIds(gqlEnv, advertiserId, ids, {
        batchSize: Math.min(100, Math.max(ids.length, 1)),
      });
      meta.apiRequests += (fetched.pageLog || []).length || 1;
      const found = new Set();
      for (const item of fetched.resultList || []) {
        const mapped = mapGraphqlProductRow(item, websitePid, {});
        if (!mapped.productId || !ids.includes(mapped.productId)) continue;
        found.add(mapped.productId);
        const key = advertiserId + "|" + mapped.productId;
        matchedKeys.add(key);
        meta.recoveredScoped += 1;
        const click = mapped.affiliateClickUrl;
        refreshedByKey.set(
          key,
          stampProductFetchClocks(
            {
              productId: mapped.productId,
              advertiserId,
              feedId: mapped.feedId,
              feedIdStatus: mapped.feedIdStatus,
              currentPrice: mapped.price != null ? Number(mapped.price) || mapped.price : null,
              originalPrice: null,
              currency: mapped.currency,
              availability: mapped.availability,
              imageUrl: mapped.imageUrl,
              affiliateUrl: isCjTrackingUrl(click) ? click : null,
              refreshResult: REFRESH_RESULT.SUCCESSFULLY_REFRESHED,
              refreshReason: "productId_recovered_on_reverify_scoped",
            },
            nowIso,
            { sourceUpdatedAt: null, sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.NOT_PROVIDED }
          )
        );
        probeByKey.set(key, { recovered: true, apiResult: "scoped_productIds_hit" });
      }
      for (const pid of ids) {
        const key = advertiserId + "|" + pid;
        if (!probeByKey.has(key)) {
          probeByKey.set(key, { recovered: false, apiResult: "scoped_productIds_miss" });
        }
      }
    } catch {
      meta.errors += 1;
      for (const pid of ids) {
        probeByKey.set(advertiserId + "|" + pid, { recovered: false, apiResult: "scoped_error" });
      }
    }
  }

  // Pass 2: omit partnerIds for remaining misses (identity / catalog drift)
  const still = [...probeByKey.entries()]
    .filter(([, v]) => !v.recovered)
    .map(([key]) => {
      const [advertiserId, productId] = key.split("|");
      return { key, advertiserId, productId };
    });
  if (still.length) {
    const allIds = [...new Set(still.map((s) => s.productId))];
    try {
      const fetched = await fetchShoppingProductsByProductIds(gqlEnv, "", allIds, {
        batchSize: Math.min(100, Math.max(allIds.length, 1)),
        omitPartnerIds: true,
      });
      meta.apiRequests += (fetched.pageLog || []).length || 1;
      const byPid = new Map();
      for (const item of fetched.resultList || []) {
        const mapped = mapGraphqlProductRow(item, websitePid, {});
        if (!mapped.productId) continue;
        byPid.set(String(mapped.productId), { mapped, rawAdvertiserId: String(item?.advertiserId || mapped.advertiserId || "") });
      }
      for (const s of still) {
        const hit = byPid.get(s.productId);
        if (!hit) {
          probeByKey.set(s.key, {
            recovered: false,
            apiResult: "omitPartner_productIds_miss",
            identityRepair: null,
          });
          continue;
        }
        const newAdv = hit.rawAdvertiserId || s.advertiserId;
        if (newAdv && newAdv !== s.advertiserId) {
          // V39: productId is not globally unique — bare cross-advertiser hit is usually a collision.
          const candidate = {
            oldAdvertiserId: s.advertiserId,
            newAdvertiserId: newAdv,
            newProductId: s.productId,
          };
          const publishedTitle =
            opts.titleByKey instanceof Map ? opts.titleByKey.get(s.key) : null;
          const verdict = decideIdentityRepair(
            {
              advertiserId: s.advertiserId,
              productId: s.productId,
              title: publishedTitle || null,
              identityRepair: candidate,
            },
            {
              joinedAdvertiserIds: opts.joinedAdvertiserIds,
              probeTitle: hit.mapped?.title || hit.mapped?.name || null,
              minTitleSimilarity: opts.minTitleSimilarity,
            }
          );
          meta.identityRepairCandidates += 1;
          if (verdict.applyRemap) {
            probeByKey.set(s.key, {
              recovered: false,
              apiResult: "omitPartner_hit_different_advertiser_verified",
              identityRepair: candidate,
              identityRepairVerdict: verdict,
            });
          } else {
            meta.identityCollisions = (meta.identityCollisions || 0) + 1;
            probeByKey.set(s.key, {
              recovered: false,
              apiResult: "omitPartner_productId_collision_hold",
              identityRepair: null,
              collision: candidate,
              identityRepairVerdict: verdict,
            });
          }
        } else {
          // Same advertiser found without partner filter — treat as recovered
          const mapped = hit.mapped;
          matchedKeys.add(s.key);
          meta.recoveredIdentityProbe += 1;
          const click = mapped.affiliateClickUrl;
          refreshedByKey.set(
            s.key,
            stampProductFetchClocks(
              {
                productId: mapped.productId,
                advertiserId: s.advertiserId,
                feedId: mapped.feedId,
                feedIdStatus: mapped.feedIdStatus,
                currentPrice: mapped.price != null ? Number(mapped.price) || mapped.price : null,
                originalPrice: null,
                currency: mapped.currency,
                availability: mapped.availability,
                imageUrl: mapped.imageUrl,
                affiliateUrl: isCjTrackingUrl(click) ? click : null,
                refreshResult: REFRESH_RESULT.SUCCESSFULLY_REFRESHED,
                refreshReason: "productId_recovered_on_reverify_omitPartner",
              },
              nowIso,
              { sourceUpdatedAt: null, sourceUpdatedAtStatus: SOURCE_UPDATED_AT_STATUS.NOT_PROVIDED }
            )
          );
          probeByKey.set(s.key, { recovered: true, apiResult: "omitPartner_productIds_hit" });
        }
      }
    } catch {
      meta.errors += 1;
    }
  }

  meta.stillMissing = [...probeByKey.values()].filter((v) => !v.recovered && !v.identityRepair).length;
  return { probeByKey, refreshedByKey, matchedKeys, meta };
}

/**
 * Apply miss decisions onto public doc products (hide stale price; never mass-delete).
 */
export function applyMissDecisionsToDoc(doc, missAudit) {
  const byKey = new Map((missAudit?.rows || []).map((r) => [r.sourceIdentity, r]));
  let hidden = 0;
  let pending = 0;
  let recovered = 0;
  let repair = 0;
  const sections = [];
  for (const sec of doc?.sections || []) {
    const products = [];
    for (const p of sec.products || []) {
      const key = String(p.advertiserId || "") + "|" + String(p.productId || "");
      const row = byKey.get(key);
      if (!row) {
        products.push(p);
        continue;
      }
      if (row.decision === MISS_DECISION.RECOVERED) {
        recovered += 1;
        products.push({ ...p, missDecision: row.decision, missCause: row.cause });
        continue;
      }
      if (row.decision === MISS_DECISION.REPAIR_IDENTITY) {
        repair += 1;
        products.push({
          ...p,
          missDecision: row.decision,
          missCause: row.cause,
          identityRepair: row.probe?.identityRepair || null,
        });
        continue;
      }
      if (row.hidePrice) {
        hidden += 1;
        products.push({
          ...p,
          missDecision: row.decision,
          missCause: row.cause,
          publicationReady: false,
          priceHidden: true,
          priceHiddenReason: "v38_productIds_miss_stale_policy",
          freshnessStatus: "HIDDEN_STALE",
        });
        continue;
      }
      pending += 1;
      products.push({
        ...p,
        missDecision: row.decision,
        missCause: row.cause,
      });
    }
    sections.push({ ...sec, products });
  }
  return {
    doc: { ...doc, sections },
    stats: { hidden, pending, recovered, repair },
  };
}
