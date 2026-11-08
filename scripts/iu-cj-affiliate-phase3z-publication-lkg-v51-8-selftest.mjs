#!/usr/bin/env node
/**
 * V51.8-c2 — publication LKG merge + shrinkage gate selftest (offline).
 */
import {
  REMOVAL_CLASS,
  buildPublicationDeltaLedger,
  mergeLkgPublishedProducts,
  evaluateProductShrinkageGate,
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

console.log(
  JSON.stringify({
    IU_CJ_PUBLICATION_LKG_V51_8_SELFTEST: "PASS",
    delta: { removed: delta.removedCount, added: delta.addedCount, net: delta.netUnique },
    carried: merged.carried,
    uniqueAfter: merged.uniqueAfter,
  })
);
