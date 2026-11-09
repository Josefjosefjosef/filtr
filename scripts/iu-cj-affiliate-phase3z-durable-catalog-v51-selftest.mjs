#!/usr/bin/env node
/**
 * V51.8-final — durable catalog vs public selection selftest.
 */
import {
  emptyDurableCatalog,
  mergeIntoDurableCatalog,
  selectPublicProductsFromDurableCatalog,
  evaluatePublicPopulationGates,
  seedDurableCatalogFromOffersPublic,
  summarizeDurableCatalog,
} from "./iu-cj-affiliate-phase3z-durable-catalog-v51.mjs";
import { PUBLICATION_ELIGIBILITY } from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const now = new Date().toISOString();
const seed = seedDurableCatalogFromOffersPublic({
  liveEnabled: true,
  sections: [
    {
      sectionKey: "aff-elektro",
      advertiserId: "1",
      partnerName: "A",
      products: [
        {
          advertiserId: "1",
          productId: "a",
          title: "A",
          currentPrice: 10,
          currency: "CZK",
          affiliateUrl: "https://www.kqzyfj.com/click-1-1",
          publicationReady: true,
          imageUrl: "https://example.com/a.jpg",
        },
        {
          advertiserId: "1",
          productId: "b",
          title: "B",
          currentPrice: 20,
          currency: "CZK",
          affiliateUrl: "https://www.kqzyfj.com/click-1-2",
          publicationReady: true,
          imageUrl: "https://example.com/b.jpg",
        },
      ],
    },
  ],
}, { nowIso: now });

assert(seed.stats.catalogUnique === 2, "seed 2");
assert(seed.stats.publicEligible === 2, "seed public 2");

const windowOnlyA = [
  {
    advertiserId: "1",
    productId: "a",
    title: "A2",
    currentPrice: 11,
    currency: "CZK",
    affiliateUrl: "https://www.kqzyfj.com/click-1-1",
    imageUrl: "https://example.com/a.jpg",
  },
  {
    advertiserId: "1",
    productId: "c",
    title: "C",
    currentPrice: 30,
    currency: "CZK",
    affiliateUrl: "https://www.kqzyfj.com/click-1-3",
    imageUrl: "https://example.com/c.jpg",
  },
];

const merged = mergeIntoDurableCatalog(seed.doc, windowOnlyA, {
  nowIso: now,
  incompleteAdvertisers: new Set(["1"]),
  staleAfterHours: 72,
  livePublicKeys: new Set(["1|a", "1|b"]),
});
assert(merged.stats.catalogUnique === 3, "catalog retains b + adds c");
assert(merged.doc.products["1|b"].publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE, "b kept public");
assert(merged.doc.products["1|b"].freshnessStatus === "LAST_KNOWN_PENDING_REVERIFY", "b pending");
assert(merged.doc.products["1|a"].freshnessStatus === "SOURCE_VERIFIED", "a verified");
assert(merged.doc.products["1|a"].currentPrice === 11, "price updated");
assert(merged.stats.publicEligible === 3, "a+b keep-live + c verified eligible");

// Never-LIVE unseen must HOLD (catalog retain ≠ public eligible).
const neverLive = mergeIntoDurableCatalog(seed.doc, windowOnlyA, {
  nowIso: now,
  incompleteAdvertisers: new Set(["1"]),
  staleAfterHours: 72,
  livePublicKeys: new Set(["1|a"]), // b was in catalog seed but NOT in current LIVE keys
});
assert(
  neverLive.doc.products["1|b"].publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD,
  "never-live unseen held"
);
assert(neverLive.doc.products["1|b"].publicOffer === false, "never-live not publicOffer");
assert(neverLive.doc.products["1|c"].freshnessStatus === "SOURCE_VERIFIED", "c still verified");

const selected = selectPublicProductsFromDurableCatalog(merged.doc, { publishPerPartner: 2 });
assert(selected.length === 2, "presentation budget 2");
assert(selected.every((p) => Number(p.currentPrice) > 0), "prices present");

const prevPublic = {
  sections: [
    {
      products: [
        { advertiserId: "1", productId: "a", publicationReady: true, currentPrice: 10, affiliateUrl: "https://www.kqzyfj.com/click-1-1" },
        { advertiserId: "1", productId: "b", publicationReady: true, currentPrice: 20, affiliateUrl: "https://www.kqzyfj.com/click-1-2" },
      ],
    },
  ],
};
const nextPublic = {
  sections: [
    {
      products: selected.map((p) => ({
        ...p,
        publicationReady: true,
      })),
    },
  ],
};
const gates = evaluatePublicPopulationGates(prevPublic, nextPublic, {
  incompleteFeeds: true,
  maxDropAbs: 50,
  maxDropRatio: 0.03,
});
assert(gates.ok === true, "public population ok under incomplete");

const empty = emptyDurableCatalog(now);
assert(summarizeDurableCatalog(empty).catalogUnique === 0, "empty");

console.log(
  JSON.stringify({
    IU_CJ_DURABLE_CATALOG_V51_SELFTEST: "PASS",
    catalogUnique: merged.stats.catalogUnique,
    publicEligible: merged.stats.publicEligible,
    presentationSelected: selected.length,
    bFreshness: merged.doc.products["1|b"].freshnessStatus,
    aPrice: merged.doc.products["1|a"].currentPrice,
    gates: gates.reason,
  })
);
