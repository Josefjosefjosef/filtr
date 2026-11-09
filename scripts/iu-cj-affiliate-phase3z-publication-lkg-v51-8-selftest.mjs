#!/usr/bin/env node
/**
 * V51.8-c4 — publication LKG merge + public/hold split + growth/restoreBudget selftest.
 */
import {
  REMOVAL_CLASS,
  PUBLICATION_ELIGIBILITY,
  LKG_VALIDATION_CLASS,
  buildPublicationDeltaLedger,
  mergeLkgPublishedProducts,
  evaluateProductShrinkageGate,
  evaluateIdentityChurnGate,
  evaluateLkgGrowthGate,
  applyPublicGrowthBudget,
  computePublicGrowthBudget,
  applyCumulativeGrowthLedger,
  emptyPublicGrowthBudgetLedger,
  classifyMissingPublishedProduct,
  buildLkgIdentityValidationLedger,
  isPublicOfferEligible,
  collectPublicEligibleProductMap,
  releaseLkgHoldsAgainstSource,
  compoundProductKey,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const prev = {
  liveEnabled: true,
  sections: [
    {
      sectionKey: "aff-elektro",
      advertiserId: "1",
      partnerName: "A",
      coupons: [],
      actions: [],
      products: [
        {
          advertiserId: "1",
          productId: "keep-missing",
          title: "LKG",
          imageUrl: "https://example.com/a.jpg",
          currentPrice: 10,
          currency: "CZK",
          affiliateUrl: "https://www.kqzyfj.com/click-101883843-1",
          publicationReady: true,
          lastSuccessfulRefreshAt: new Date().toISOString(),
        },
        {
          advertiserId: "1",
          productId: "stay",
          title: "Stay",
          imageUrl: "https://example.com/b.jpg",
          currentPrice: 11,
          currency: "CZK",
          affiliateUrl: "https://www.kqzyfj.com/click-101883843-2",
          publicationReady: true,
        },
      ],
    },
  ],
};

const nextShrunk = {
  liveEnabled: false,
  sections: [
    {
      sectionKey: "aff-elektro",
      advertiserId: "1",
      partnerName: "A",
      coupons: [],
      actions: [],
      products: [
        {
          advertiserId: "1",
          productId: "stay",
          title: "Stay",
          imageUrl: "https://example.com/b.jpg",
          currentPrice: 11,
          currency: "CZK",
          affiliateUrl: "https://www.kqzyfj.com/click-101883843-2",
          publicationReady: true,
        },
        {
          advertiserId: "1",
          productId: "new",
          title: "New",
          imageUrl: "https://example.com/c.jpg",
          currentPrice: 12,
          currency: "CZK",
          affiliateUrl: "https://www.kqzyfj.com/click-101883843-3",
          publicationReady: true,
        },
      ],
    },
  ],
};

const delta = buildPublicationDeltaLedger(prev, nextShrunk, {
  incompleteAdvertisers: new Set(["1"]),
  fetchedAdvertisers: new Set(["1"]),
});
assert(delta.removedCount === 1, "one removed");
assert(delta.addedCount === 1, "one added");
assert(delta.removed[0].classId === REMOVAL_CLASS.NOT_YET_SEEN, "not yet seen");
assert(delta.removed[0].carryForward === true, "carry");

const merged = mergeLkgPublishedProducts(nextShrunk, prev, {
  incompleteAdvertisers: new Set(["1"]),
  fetchedAdvertisers: new Set(["1"]),
});
assert(merged.carried === 1, "carried one");
assert(merged.uniqueAfter === 3, "unique restored to 3");
assert(merged.heldPublic === 0, "fresh NOT_YET_SEEN stays public-eligible (final)");
assert(merged.publicEligibleAfter === 3, "public eligible includes pending-reverify LKG");
const keptProd = merged.doc.sections[0].products.find((p) => p.productId === "keep-missing");
assert(
  keptProd.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE,
  "not-yet-seen keep public"
);
assert(isPublicOfferEligible(keptProd) === true, "pending-reverify still public-eligible");
assert(keptProd.freshnessStatus === "LAST_KNOWN_PENDING_REVERIFY", "pending freshness");
assert(keptProd.sourceFreshLabelForbidden === true, "no CURRENT label");
assert(collectPublicEligibleProductMap(merged.doc).size === 3, "public map size 3");

// Stale miss → HOLD
const stalePrev = JSON.parse(JSON.stringify(prev));
stalePrev.sections[0].products[0].lastSuccessfulRefreshAt = new Date(
  Date.now() - 100 * 3600 * 1000
).toISOString();
const staleMerged = mergeLkgPublishedProducts(nextShrunk, stalePrev, {
  incompleteAdvertisers: new Set(["1"]),
  fetchedAdvertisers: new Set(["1"]),
  staleAfterHours: 72,
});
const staleProd = staleMerged.doc.sections[0].products.find((p) => p.productId === "keep-missing");
assert(
  staleProd.publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD,
  "stale not-yet-seen → HOLD"
);
assert(isPublicOfferEligible(staleProd) === false, "stale held not public");

const nextOnlyStay = {
  liveEnabled: false,
  sections: [
    {
      sectionKey: "aff-elektro",
      products: [nextShrunk.sections[0].products[0]],
      coupons: [],
      actions: [],
    },
  ],
};
const gateFail = evaluateProductShrinkageGate(prev, nextOnlyStay, {
  maxDropAbs: 0,
  maxDropRatio: 0,
  lkgMerged: false,
});
assert(gateFail.ok === false, "shrink refused without merge");

const gatePass = evaluateProductShrinkageGate(prev, merged.doc, {
  maxDropAbs: 0,
  maxDropRatio: 0,
  lkgMerged: true,
});
assert(gatePass.ok === true, "shrink ok after merge flag");

const prevOos = {
  sections: [
    {
      products: [
        {
          advertiserId: "1",
          productId: "a",
          publicationReady: true,
          availability: "in stock",
          currentPrice: 10,
          affiliateUrl: "https://www.kqzyfj.com/click-1-1",
        },
        {
          advertiserId: "1",
          productId: "oos",
          publicationReady: true,
          availability: "out_of_stock",
          currentPrice: 20,
          affiliateUrl: "https://www.kqzyfj.com/click-1-2",
        },
      ],
    },
  ],
};
const nextNoOos = {
  sections: [
    {
      products: [
        {
          advertiserId: "1",
          productId: "a",
          publicationReady: true,
          availability: "in stock",
          currentPrice: 10,
          affiliateUrl: "https://www.kqzyfj.com/click-1-1",
        },
      ],
    },
  ],
};
const gateOosRemediation = evaluateProductShrinkageGate(prevOos, nextNoOos, {
  maxDropAbs: 0,
  maxDropRatio: 0,
  lkgMerged: false,
});
assert(gateOosRemediation.ok === true, "oos remediation shrink ok");
assert(gateOosRemediation.oosRemediationRemoved === 1, "oos remediation counted");

const churnBad = evaluateIdentityChurnGate(
  {
    prevUnique: 3174,
    removedCount: 3050,
    addedCount: 2979,
    netUnique: -71,
    removedByClass: { [REMOVAL_CLASS.NOT_YET_SEEN]: 3050 },
  },
  { lkgMerged: false, maxChurnRatio: 0.25 }
);
assert(churnBad.ok === false, "massive not-yet-seen churn refused");
const churnOk = evaluateIdentityChurnGate(
  {
    prevUnique: 3174,
    removedCount: 3050,
    addedCount: 2979,
    netUnique: -71,
    removedByClass: { [REMOVAL_CLASS.NOT_YET_SEEN]: 3050 },
  },
  { lkgMerged: true, maxChurnRatio: 0.25 }
);
assert(churnOk.ok === true, "churn allowed after LKG merge");

const ended = classifyMissingPublishedProduct(
  {
    key: "9|x",
    advertiserId: "9",
    product: {
      affiliateUrl: "https://www.kqzyfj.com/click-101883843-9",
      lastSuccessfulRefreshAt: new Date().toISOString(),
    },
  },
  { endedAdvertisers: new Set(["9"]) }
);
assert(ended.carryForward === false && ended.classId === REMOVAL_CLASS.PARTNER_ENDED, "ended blocked");

const badUrl = classifyMissingPublishedProduct(
  {
    key: "1|y",
    advertiserId: "1",
    product: { affiliateUrl: "https://evil.example/click" },
  },
  { incompleteAdvertisers: new Set(["1"]) }
);
assert(badUrl.carryForward === false, "bad affiliate url blocked");
const netUrl = classifyMissingPublishedProduct(
  {
    key: "1|z",
    advertiserId: "1",
    product: {
      affiliateUrl: "https://www.anrdoezrs.net/click-101883843-1",
      lastSuccessfulRefreshAt: new Date().toISOString(),
    },
  },
  { incompleteAdvertisers: new Set(["1"]) }
);
assert(netUrl.carryForward === true, "CJ .net click domains trusted");

const growthBad = evaluateLkgGrowthGate(100, 900, {
  maxGrowthAbs: 500,
  maxGrowthRatio: 0.2,
  carried: 0,
  addedCount: 0,
  publicEligibleAfter: 900,
});
assert(growthBad.ok === false, "unbounded public growth refused");

// 94% catalog union with HOLD must not inflate public-eligible.
const growth94 = evaluateLkgGrowthGate(3174, 6153, {
  maxGrowthAbs: 500,
  maxGrowthRatio: 0.2,
  carried: 3050,
  heldPublic: 3050,
  addedCount: 2979,
  publicEligibleAfter: 3103,
  prevPublicEligible: 3174,
});
assert(growth94.ok === true, "catalog retain + public hold OK");
assert(growth94.restoreBudgetScope === "CATALOG_RETENTION_ONLY", "restoreBudget not public bypass");

const growth94PublicBypass = evaluateLkgGrowthGate(3174, 6153, {
  maxGrowthAbs: 500,
  maxGrowthRatio: 0.2,
  carried: 3050,
  heldPublic: 0,
  addedCount: 2979,
  publicEligibleAfter: 6153,
  prevPublicEligible: 3174,
});
assert(growth94PublicBypass.ok === false, "94% public growth refused");

const forged = evaluateLkgGrowthGate(3174, 6153, {
  maxGrowthAbs: 500,
  maxGrowthRatio: 0.2,
  carried: 3050,
  heldPublic: 3050,
  addedCount: 2979,
  publicEligibleAfter: 3103,
  allowRestoreBudgetPublicBypass: true,
});
assert(forged.ok === false, "forged restoreBudget public bypass refused");

for (const ratio of [0.1, 0.2, 0.5, 0.94, 2.0]) {
  const after = Math.round(1000 * (1 + ratio));
  const g = evaluateLkgGrowthGate(1000, after, {
    maxGrowthAbs: 500,
    maxGrowthRatio: 0.2,
    publicEligibleAfter: after,
    prevPublicEligible: 1000,
  });
  const expectOk = after - 1000 <= 500 || (after - 1000) / 1000 <= 0.2;
  assert(g.ok === expectOk, "growth ratio " + ratio + " expected " + expectOk);
}

const ledger = buildLkgIdentityValidationLedger(delta, merged.decisions);
assert(ledger.count === 1, "ledger rows");
assert(
  ledger.rows[0].lkgValidationClass === LKG_VALIDATION_CLASS.LKG_ELIGIBLE_VERIFIED ||
    ledger.rows[0].lkgValidationClass === LKG_VALIDATION_CLASS.LKG_PENDING_REVERIFY,
  "eligible/pending class for fresh not-yet-seen"
);

const released = releaseLkgHoldsAgainstSource(
  staleMerged.doc,
  new Set([compoundProductKey("1", "keep-missing")]),
  {}
);
assert(released.progress.LKG_RELEASED_TO_PUBLIC === 1, "hold released on source match");
assert(released.publicEligibleAfter >= 3, "public eligible after release");
const stillHeld = releaseLkgHoldsAgainstSource(staleMerged.doc, new Set(), {});
assert(stillHeld.progress.LKG_RELEASED_TO_PUBLIC === 0, "no release without source");

const budgetMeta = computePublicGrowthBudget(3174, {
  maxGrowthAbs: 500,
  maxGrowthRatio: 0.2,
  cumulativeAddedSinceBaseline: 0,
  maxCumulativeAbs: 500,
});
assert(budgetMeta.allowedNew === 500, "auto budget 500");
const budgetExhausted = computePublicGrowthBudget(3174, {
  maxGrowthAbs: 500,
  maxGrowthRatio: 0.2,
  cumulativeAddedSinceBaseline: 500,
  maxCumulativeAbs: 500,
});
assert(budgetExhausted.allowedNew === 0, "cumulative blocks batching");
assert(budgetExhausted.exceptionalGrowthRequiresOwner === true, "owner required after cumulative cap");

const fatPrev = {
  sections: [
    {
      products: Array.from({ length: 10 }, (_, i) => ({
        advertiserId: "1",
        productId: "p" + i,
        publicationReady: true,
        currentPrice: 10 + i,
        currency: "CZK",
        affiliateUrl: "https://www.kqzyfj.com/click-1-" + i,
      })),
    },
  ],
};
const fatNext = {
  sections: [
    {
      products: [
        ...fatPrev.sections[0].products,
        ...Array.from({ length: 20 }, (_, i) => ({
          advertiserId: "2",
          productId: "n" + i,
          publicationReady: true,
          currentPrice: 100 + i,
          currency: i < 5 ? "CZK" : "EUR",
          affiliateUrl: "https://www.kqzyfj.com/click-2-" + i,
          lastSourceMatchAt: "2026-11-09T01:00:00.000Z",
        })),
      ],
    },
  ],
};
const capped = applyPublicGrowthBudget(fatNext, fatPrev, {
  maxGrowthAbs: 3,
  maxGrowthRatio: 1,
  preferredCurrency: "CZK",
  cumulativeAddedSinceBaseline: 0,
  maxCumulativeAbs: 3,
});
assert(capped.keptNew.length === 3, "kept 3 new");
assert(capped.deferredNew.length === 17, "deferred remainder");
assert(capped.publicGrowth === 3, "public growth capped");
assert(
  capped.keptNew.every((k) => k.startsWith("2|n") && Number(k.split("|")[1].slice(1)) < 5),
  "prefer CZK new slots"
);
const ledger1 = applyCumulativeGrowthLedger(emptyPublicGrowthBudgetLedger({ maxCumulativeAbs: 3 }), {
  keptNewCount: 3,
  nowIso: "2026-11-09T02:00:00.000Z",
});
assert(ledger1.cumulativeAddedSinceBaseline === 3, "ledger advanced");
const afterCum = applyPublicGrowthBudget(fatNext, fatPrev, {
  maxGrowthAbs: 3,
  maxGrowthRatio: 1,
  preferredCurrency: "CZK",
  cumulativeAddedSinceBaseline: ledger1.cumulativeAddedSinceBaseline,
  maxCumulativeAbs: 3,
});
assert(afterCum.keptNew.length === 0, "second batch blocked by cumulative");

console.log(
  JSON.stringify({
    IU_CJ_PUBLICATION_LKG_V51_8_SELFTEST: "PASS",
    delta: { removed: delta.removedCount, added: delta.addedCount, net: delta.netUnique },
    carried: merged.carried,
    heldPublic: merged.heldPublic,
    uniqueAfter: merged.uniqueAfter,
    publicEligibleAfter: merged.publicEligibleAfter,
    staleHeld: staleProd.publicationEligibility,
    releasedToPublic: released.progress.LKG_RELEASED_TO_PUBLIC,
    churnBad: churnBad.reason,
    growth94: growth94.reason,
    growth94PublicBypass: growth94PublicBypass.reason,
  })
);
