/**
 * Offline selftest for GROWTH_SHADOW_MODE — must not publish or unlock growth.
 */
import assert from "node:assert/strict";
import {
  runGrowthShadowMode,
  reconstructDeferredCandidatesFromDurable,
  validateShadowCandidate,
  GROWTH_SHADOW_MODE_SCHEMA,
} from "./iu-cj-affiliate-phase3z-growth-shadow-mode-v51-8.mjs";
import {
  applyPublicGrowthBudget,
  buildDeferredNewLedgerDocument,
  DEFERRED_NEW_LEDGER_FILENAME,
  DEFERRED_NEW_LEDGER_SCHEMA,
  compoundProductKey,
} from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

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
    publicOffer: opts.publicOffer !== false,
    publicationEligibility: opts.publicationEligibility || "PUBLICATION_ELIGIBLE",
    availability: opts.availability || "IN_STOCK",
    availabilityClass: opts.availabilityClass || "IN_STOCK",
    sectionKey: opts.sectionKey || "aff-elektro",
    partnerName: opts.partnerName || "PartnerA",
    czEligible: opts.czEligible,
  };
}

function makePrev(n = 10) {
  return {
    liveEnabled: true,
    sections: [
      {
        sectionKey: "aff-elektro",
        coupons: [{ id: "paid-c1", code: "SAVE", url: "https://www.kqzyfj.com/click-paid" }],
        actions: [{ id: "paid-a1", title: "Act", url: "https://www.kqzyfj.com/click-act" }],
        products: Array.from({ length: n }, (_, i) => makeProduct(1, `live-${i}`)),
      },
    ],
    publicGrowthBudget: { deferredNew: 42 },
  };
}

{
  const ok = validateShadowCandidate(makeProduct(1, "x"));
  assert.equal(ok.ok, true);
  const bad = validateShadowCandidate(
    makeProduct(1, "y", { affiliateUrl: "https://evil.example/click" }),
  );
  assert.equal(bad.rejectReason, "BAD_AFFILIATE_URL");
  const missingWww = validateShadowCandidate(
    makeProduct(1, "www", { affiliateUrl: "https://kqzyfj.com/click-101883843-1" }),
  );
  assert.equal(missingWww.rejectReason, "BAD_AFFILIATE_URL");
  const outsideHost = validateShadowCandidate(
    makeProduct(1, "host", { affiliateUrl: "https://www.pjatr.com/click-101883843-1", currency: "EUR" }),
  );
  assert.equal(outsideHost.rejectReason, "BAD_AFFILIATE_URL");
  assert.equal(outsideHost.ok, false);
  const notAClick = validateShadowCandidate(
    makeProduct(1, "path", { affiliateUrl: "https://www.kqzyfj.com/catalog/item" }),
  );
  assert.equal(notAClick.rejectReason, "BAD_AFFILIATE_URL");
}

{
  const prev = {
    sections: [
      {
        sectionKey: "s",
        products: Array.from({ length: 50 }, (_, i) => makeProduct(1, `l${i}`)),
      },
    ],
  };
  const next = {
    sections: [
      {
        sectionKey: "s",
        products: [
          ...Array.from({ length: 50 }, (_, i) => makeProduct(1, `l${i}`)),
          ...Array.from({ length: 30 }, (_, i) => makeProduct(2, `n${i}`)),
        ],
      },
    ],
  };
  const applied = applyPublicGrowthBudget(next, prev, {
    cumulativeAddedSinceBaseline: 500,
    maxCumulativeAbs: 500,
  });
  assert.equal(applied.keptNew.length, 0);
  assert.equal(applied.deferredNew.length, 30);
  assert.equal(applied.deferredLedger.schema, DEFERRED_NEW_LEDGER_SCHEMA);
  assert.equal(applied.deferredLedger.keys.length, 30);
  assert.equal(applied.doc.publicGrowthBudget.deferredNewLedgerFile, DEFERRED_NEW_LEDGER_FILENAME);
  assert.equal(applied.doc.publicGrowthBudget.deferredNewKeysPersistedInOffers, false);
  assert.equal(applied.doc.publicGrowthBudget.deferredNewKeys, undefined);
  const withKeys = applyPublicGrowthBudget(next, prev, {
    cumulativeAddedSinceBaseline: 500,
    attachDeferredNewKeys: true,
  });
  assert.equal(withKeys.doc.publicGrowthBudget.deferredNewKeys.length, 30);
}

{
  const offers = makePrev(10);
  const durable = {};
  for (let i = 0; i < 10; i++) durable[compoundProductKey(1, `live-${i}`)] = makeProduct(1, `live-${i}`);
  for (let i = 0; i < 12; i++) durable[compoundProductKey(2, `def-${i}`)] = makeProduct(2, `def-${i}`);
  const recon = reconstructDeferredCandidatesFromDurable({ offersDoc: offers, durableProducts: durable });
  assert.equal(recon.reconstructedNotInPublic, 12);
  assert.equal(recon.gap, 30); // reported deferredNew=42 from makePrev
  assert.ok(/GAP/i.test(recon.gapNote));
}

const joined = [
  { advertiserId: "1", cjStatus: "JOINED", name: "A" },
  { advertiserId: "2", cjStatus: "JOINED", name: "B" },
  { advertiserId: "9", cjStatus: "ENDED", name: "X" },
  { advertiserId: "7417963", cjStatus: "JOINED", name: "OnBuy EU" },
];

const durableProducts = {};
for (let i = 0; i < 40; i++) {
  durableProducts[`2|new-${i}`] = makeProduct(2, `new-${i}`);
}
durableProducts["2|bad-url"] = makeProduct(2, "bad-url", {
  affiliateUrl: "http://insecure.example/click",
});
durableProducts["2|oos"] = makeProduct(2, "oos", {
  availability: "out of stock",
  availabilityClass: "OUT_OF_STOCK",
});
durableProducts["7417963|onbuy-1"] = makeProduct(7417963, "onbuy-1", { czEligible: false });

const report = runGrowthShadowMode({
  offersDoc: makePrev(20),
  durableProducts,
  joinedPartners: joined,
  iterations: 3,
  batchSize: 15,
  uncappedShadow: true,
  reportedDeferredNew: 42,
});

assert.equal(report.schema, GROWTH_SHADOW_MODE_SCHEMA);
assert.equal(report.wroteProjectsData, false);
assert.equal(report.growthGateStillLocked, true);
assert.ok(report.iterations >= 3);
assert.equal(report.paidPositionsUntouched, true);
assert.equal(report.monotonicityOk, true);
assert.equal(report.ok, true);
assert.ok(report.validCandidates >= 1);
assert.ok(report.rejected >= 1);
assert.ok(report.hold >= 1);
assert.ok(report.rollbackPlan.restorePublicEligibleTo === 20);

const art = buildDeferredNewLedgerDocument(["2|a", "2|b"], {
  reason: "CUMULATIVE_BUDGET_EXHAUSTED",
});
assert.equal(art.deferredNewCount, 2);
assert.equal(art.growthGateLocked, true);
assert.equal(DEFERRED_NEW_LEDGER_FILENAME, "iu-affiliate-cj-deferred-new-ledger-v51.json");

console.log(
  JSON.stringify({
    IU_CJ_GROWTH_SHADOW_MODE_V51_8_SELFTEST: "PASS",
    ok: true,
    schema: report.schema,
    processed: report.processed,
    validCandidates: report.validCandidates,
    rejected: report.rejected,
    hold: report.hold,
    duplicates: report.duplicates,
    growthGateStillLocked: true,
  }),
);
