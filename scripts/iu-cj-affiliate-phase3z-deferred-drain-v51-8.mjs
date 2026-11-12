/**
 * V51.8 — deferred-new drain analysis (offline; does NOT arm uncapped in production).
 * Explains batching remainder vs invalid/ineligible identities.
 */
import {
  applyPublicGrowthBudget,
  computePublicGrowthBudget,
  compoundProductKey,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

export const DEFERRED_DRAIN_SCHEMA = "iu-cj-affiliate-phase3z-deferred-drain-v51-8";

function makeProduct(advertiserId, productId, opts = {}) {
  return {
    advertiserId: String(advertiserId),
    productId: String(productId),
    title: opts.title || `P-${productId}`,
    imageUrl: opts.imageUrl || "https://example.com/p.jpg",
    currentPrice: opts.currentPrice != null ? opts.currentPrice : 99,
    currency: opts.currency || "CZK",
    affiliateUrl:
      opts.affiliateUrl ||
      `https://www.kqzyfj.com/click-101883843-${advertiserId}-${productId}`,
    publicationReady: opts.publicationReady !== false,
    availability: opts.availability || "IN_STOCK",
  };
}

function makeDoc(products) {
  return {
    liveEnabled: true,
    sections: [
      {
        sectionKey: "aff-elektro",
        advertiserId: "1",
        partnerName: "A",
        coupons: [],
        actions: [],
        products,
      },
    ],
  };
}

/**
 * Classify a deferred backlog into batching vs invalid/ineligible.
 */
export function classifyDeferredBacklog(opts = {}) {
  const prevLive = Math.max(0, Number(opts.prevLive) || 3421);
  const deferredKeys = Array.isArray(opts.deferredKeys) ? opts.deferredKeys : [];
  const invalidKeys = new Set(opts.invalidKeys || []);
  const endedAdvertisers = new Set((opts.endedAdvertisers || []).map(String));
  const badUrlKeys = new Set(opts.badUrlKeys || []);

  let batchingOnly = 0;
  let invalid = 0;
  let endedPartner = 0;
  let badUrl = 0;
  for (const key of deferredKeys) {
    const adv = String(key).split("|")[0];
    if (invalidKeys.has(key)) {
      invalid += 1;
      continue;
    }
    if (endedAdvertisers.has(adv)) {
      endedPartner += 1;
      continue;
    }
    if (badUrlKeys.has(key)) {
      badUrl += 1;
      continue;
    }
    batchingOnly += 1;
  }

  // Simulate uncapped drip until batching-only queue empties (or cap rounds).
  let live = prevLive;
  let remaining = batchingOnly;
  let rounds = 0;
  let kept = 0;
  while (remaining > 0 && rounds < 200) {
    const b = computePublicGrowthBudget(live, {
      uncappedMode: true,
      newCandidatesCount: remaining,
    });
    if (b.allowedNew < 1) break;
    const take = Math.min(b.allowedNew, remaining);
    kept += take;
    live += take;
    remaining -= take;
    rounds += 1;
  }

  return {
    schema: DEFERRED_DRAIN_SCHEMA,
    at: new Date().toISOString(),
    prevLive,
    deferredTotal: deferredKeys.length,
    classification: {
      batchingOnly,
      invalid,
      endedPartner,
      badUrl,
      holdPermanent: invalid + endedPartner + badUrl,
    },
    drip: {
      rounds,
      kept,
      remainingAfterDrip: remaining,
      drained: remaining === 0,
    },
    productionNote:
      "Production remains IU_CJ_PUBLIC_GROWTH_UNCAPPED=0; this drain proof is offline/uncapped simulation only.",
  };
}

export function runDeferredDrainScenarios() {
  const prevN = 200;
  const results = [];

  // Mix: 100 valid deferred + 5 invalid price + 3 ended + 2 bad URL
  const deferred = [];
  for (let i = 0; i < 100; i++) deferred.push(compoundProductKey(2, `d-${i}`));
  for (let i = 0; i < 5; i++) deferred.push(compoundProductKey(2, `bad-${i}`));
  for (let i = 0; i < 3; i++) deferred.push(compoundProductKey(9, `ended-${i}`));
  for (let i = 0; i < 2; i++) deferred.push(compoundProductKey(2, `url-${i}`));

  const report = classifyDeferredBacklog({
    prevLive: prevN,
    deferredKeys: deferred,
    invalidKeys: deferred.filter((k) => k.includes("|bad-")),
    endedAdvertisers: ["9"],
    badUrlKeys: deferred.filter((k) => k.includes("|url-")),
  });
  results.push({
    name: "mixed_deferred_class_and_drain",
    ok:
      report.classification.batchingOnly === 100 &&
      report.classification.invalid === 5 &&
      report.classification.endedPartner === 3 &&
      report.classification.badUrl === 2 &&
      report.drip.drained === true &&
      report.drip.kept === 100,
    report,
  });

  // 3058 remainder after early rounds must drain
  const rem = classifyDeferredBacklog({
    prevLive: 200 + 46942,
    deferredKeys: Array.from({ length: 3058 }, (_, i) => compoundProductKey(2, `r-${i}`)),
  });
  results.push({
    name: "round30_remainder_3058_drains",
    ok: rem.drip.drained === true && rem.drip.kept === 3058 && rem.classification.batchingOnly === 3058,
    report: rem,
  });

  // applyPublicGrowthBudget invalid price never enters deferred
  const prev = makeDoc(Array.from({ length: prevN }, (_, i) => makeProduct(1, `live-${i}`)));
  const next = makeDoc([
    ...Array.from({ length: prevN }, (_, i) => makeProduct(1, `live-${i}`)),
    makeProduct(2, "badprice", { currentPrice: 0 }),
    makeProduct(2, "ok"),
  ]);
  const applied = applyPublicGrowthBudget(next, prev, { uncappedMode: true });
  results.push({
    name: "invalid_not_deferred",
    ok: applied.keptNew.includes(compoundProductKey(2, "ok")) && applied.deferredNew.length === 0,
    kept: applied.keptNew,
    deferred: applied.deferredNew,
  });

  const failed = results.filter((r) => r.ok !== true);
  return { ok: failed.length === 0, failed: failed.map((f) => f.name), results };
}
