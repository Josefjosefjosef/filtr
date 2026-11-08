#!/usr/bin/env node
/**
 * V51.8-c2 — publication LKG merge + shrinkage gate selftest (offline).
 */
import {
  REMOVAL_CLASS,
  buildPublicationDeltaLedger,
  mergeLkgPublishedProducts,
  evaluateProductShrinkageGate,
  evaluateIdentityChurnGate,
  evaluateLkgGrowthGate,
  classifyMissingPublishedProduct,
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
});
assert(growthBad.ok === false, "unbounded LKG growth refused");
const growthRestore = evaluateLkgGrowthGate(3174, 6153, {
  maxGrowthAbs: 500,
  maxGrowthRatio: 0.2,
  carried: 3050,
  addedCount: 2979,
});
assert(growthRestore.ok === true, "LKG restore union growth allowed");

console.log(
  JSON.stringify({
    IU_CJ_PUBLICATION_LKG_V51_8_SELFTEST: "PASS",
    delta: { removed: delta.removedCount, added: delta.addedCount, net: delta.netUnique },
    carried: merged.carried,
    uniqueAfter: merged.uniqueAfter,
    churnBad: churnBad.reason,
    growthBad: growthBad.reason,
  })
);
