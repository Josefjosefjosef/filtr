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
  normalizePublicationAvailability,
  publicationEligibilityFromAvailability,
  applyAvailabilityPublicationHolds,
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

// Availability normalization + publication gate matrix
const availCases = [
  ["out of stock", "OUT_OF_STOCK", true],
  ["out_of_stock", "OUT_OF_STOCK", true],
  ["in stock", "IN_STOCK", false],
  ["in_stock", "IN_STOCK", false],
  ["preorder", "PREORDER", false],
  ["backorder", "BACKORDER", false],
  ["unknown-xyz", "UNKNOWN_UNRECOGNIZED", true],
  ["", "UNKNOWN_EMPTY", true],
  [null, "UNKNOWN_NULL", false],
];
for (const [raw, expectClass, expectHold] of availCases) {
  const n = normalizePublicationAvailability(raw);
  assert(n.class === expectClass, "avail class " + String(raw));
  const g = publicationEligibilityFromAvailability(raw, PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE);
  assert(Boolean(g.availabilityHoldReason) === expectHold, "avail hold " + String(raw));
}
const nullFailClosed = publicationEligibilityFromAvailability(
  null,
  PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE,
  { failClosedNullAvailability: true }
);
assert(nullFailClosed.availabilityHoldReason === "AVAILABILITY_NULL", "null fail-closed");

const oosMerge = mergeIntoDurableCatalog(emptyDurableCatalog(now), [
  {
    advertiserId: "9",
    productId: "oos1",
    title: "OOS",
    currentPrice: 10,
    currency: "CZK",
    availability: "out_of_stock",
    affiliateUrl: "https://www.kqzyfj.com/click-1-1",
  },
  {
    advertiserId: "9",
    productId: "pre1",
    title: "PRE",
    currentPrice: 20,
    currency: "CZK",
    availability: "preorder",
    affiliateUrl: "https://www.kqzyfj.com/click-1-2",
  },
  {
    advertiserId: "9",
    productId: "ok1",
    title: "OK",
    currentPrice: 30,
    currency: "CZK",
    availability: "in_stock",
    affiliateUrl: "https://www.kqzyfj.com/click-1-3",
  },
], { nowIso: now });
assert(
  oosMerge.doc.products["9|oos1"].publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD,
  "oos held"
);
assert(
  oosMerge.doc.products["9|pre1"].publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE,
  "preorder eligible"
);
assert(
  oosMerge.doc.products["9|ok1"].publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_ELIGIBLE,
  "in_stock eligible"
);
const oosSelected = selectPublicProductsFromDurableCatalog(oosMerge.doc, { publishPerPartner: 10 });
assert(oosSelected.every((p) => p.productId !== "oos1"), "oos excluded from public select");
assert(oosSelected.some((p) => p.productId === "pre1"), "preorder selectable");

const prevWithOos = {
  sections: [
    {
      products: [
        {
          advertiserId: "9",
          productId: "oos1",
          publicationReady: true,
          availability: "out of stock",
          currentPrice: 10,
          affiliateUrl: "https://www.kqzyfj.com/click-1-1",
        },
        {
          advertiserId: "9",
          productId: "ok1",
          publicationReady: true,
          availability: "in stock",
          currentPrice: 30,
          affiliateUrl: "https://www.kqzyfj.com/click-1-3",
        },
      ],
    },
  ],
};
const nextWithoutOos = {
  sections: [
    {
      products: [
        {
          advertiserId: "9",
          productId: "ok1",
          publicationReady: true,
          availability: "in stock",
          currentPrice: 30,
          affiliateUrl: "https://www.kqzyfj.com/click-1-3",
        },
      ],
    },
  ],
};
const remGate = evaluatePublicPopulationGates(prevWithOos, nextWithoutOos, {
  maxDropAbs: 0,
  maxDropRatio: 0,
});
assert(remGate.ok === true, "oos remediation does not trip shrinkage");
assert(remGate.oosRemediationRemoved === 1, "oos remediation counted");

const holdDoc = JSON.parse(JSON.stringify(prevWithOos));
const held = applyAvailabilityPublicationHolds(holdDoc);
assert(held.held === 1, "apply holds oos");
assert(holdDoc.sections[0].products[0].publicationReady === false, "oos not ready after hold");

// Availability change across runs: in_stock → out_of_stock must HOLD
const becameOos = mergeIntoDurableCatalog(oosMerge.doc, [
  {
    advertiserId: "9",
    productId: "ok1",
    title: "OK",
    currentPrice: 30,
    currency: "CZK",
    availability: "out_of_stock",
    affiliateUrl: "https://www.kqzyfj.com/click-1-3",
  },
], { nowIso: now, livePublicKeys: new Set(["9|ok1", "9|pre1"]) });
assert(
  becameOos.doc.products["9|ok1"].publicationEligibility === PUBLICATION_ELIGIBILITY.PUBLICATION_HOLD,
  "availability change to oos holds"
);

console.log(
  JSON.stringify({
    IU_CJ_DURABLE_CATALOG_V51_SELFTEST: "PASS",
    catalogUnique: merged.stats.catalogUnique,
    publicEligible: merged.stats.publicEligible,
    presentationSelected: selected.length,
    bFreshness: merged.doc.products["1|b"].freshnessStatus,
    aPrice: merged.doc.products["1|a"].currentPrice,
    gates: gates.reason,
    availabilityRemediation: remGate.reason,
    availabilityHoldApplied: held.held,
  })
);
