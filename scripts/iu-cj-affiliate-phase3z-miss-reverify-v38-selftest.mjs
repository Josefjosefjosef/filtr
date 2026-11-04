#!/usr/bin/env node
/**
 * V38 — miss reverify apply + decision application (offline; no live CJ HTTP).
 */
import {
  MISS_DECISION,
  buildMissProductAudit,
} from "./iu-cj-affiliate-phase3z-miss-products-v38.mjs";
import { applyMissDecisionsToDoc } from "./iu-cj-affiliate-phase3z-miss-reverify-v38.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const nowIso = "2026-11-04T14:00:00.000Z";
const missAudit = buildMissProductAudit({
  nowIso,
  runId: "selftest",
  hideAfterHours: 24,
  hideAfterConsecutiveMisses: 3,
  products: [
    {
      advertiserId: "100",
      productId: "p1",
      title: "keep pending",
      currentPrice: 99,
      lastSuccessfulRefreshAt: "2026-11-04T12:00:00.000Z",
      refreshResult: "NOT_IN_SCAN_WINDOW",
      sectionKey: "aff-a",
    },
    {
      advertiserId: "100",
      productId: "p2",
      title: "hide stale",
      currentPrice: 50,
      lastSuccessfulRefreshAt: "2026-11-01T00:00:00.000Z",
      refreshResult: "NOT_IN_SCAN_WINDOW",
      sectionKey: "aff-a",
    },
    {
      advertiserId: "200",
      productId: "p3",
      title: "identity",
      currentPrice: 10,
      lastSuccessfulRefreshAt: "2026-11-04T10:00:00.000Z",
      refreshResult: "NOT_IN_SCAN_WINDOW",
      sectionKey: "aff-b",
    },
  ],
  probeByKey: new Map([
    ["100|p1", { recovered: false, apiResult: "omitPartner_productIds_miss" }],
    ["100|p2", { recovered: false, apiResult: "omitPartner_productIds_miss" }],
    [
      "200|p3",
      {
        recovered: false,
        apiResult: "omitPartner_hit_different_advertiser",
        identityRepair: { oldAdvertiserId: "200", newAdvertiserId: "999", newProductId: "p3" },
      },
    ],
  ]),
  prevMissByKey: new Map([
    ["100|p2", { consecutiveMisses: 2 }],
  ]),
});

assert(missAudit.rows.length === 3, "three miss rows");
const byId = Object.fromEntries(missAudit.rows.map((r) => [r.productId, r]));
assert(byId.p1.decision === MISS_DECISION.KEEP_PENDING, "p1 pending");
assert(byId.p2.decision === MISS_DECISION.TEMPORARILY_HIDE, "p2 hide");
assert(byId.p3.decision === MISS_DECISION.REPAIR_IDENTITY, "p3 repair");

const doc = {
  liveEnabled: true,
  sections: [
    {
      sectionKey: "aff-a",
      products: [
        { advertiserId: "100", productId: "p1", currentPrice: 99, publicationReady: true },
        { advertiserId: "100", productId: "p2", currentPrice: 50, publicationReady: true },
      ],
    },
    {
      sectionKey: "aff-b",
      products: [{ advertiserId: "200", productId: "p3", currentPrice: 10, publicationReady: true }],
    },
  ],
};

const applied = applyMissDecisionsToDoc(doc, missAudit);
assert(applied.stats.hidden === 1, "one hidden");
assert(applied.stats.pending === 1, "one pending");
assert(applied.stats.repair === 1, "one repair");
const p2 = applied.doc.sections[0].products.find((p) => p.productId === "p2");
assert(p2.priceHidden === true, "p2 price hidden");
assert(p2.publicationReady === false, "p2 not publicationReady");
assert(p2.freshnessStatus === "HIDDEN_STALE", "p2 HIDDEN_STALE");
const p1 = applied.doc.sections[0].products.find((p) => p.productId === "p1");
assert(p1.publicationReady !== false || p1.priceHidden !== true, "p1 kept");
const p3 = applied.doc.sections[1].products.find((p) => p.productId === "p3");
assert(p3.missDecision === MISS_DECISION.REPAIR_IDENTITY, "p3 tagged repair");
assert(p3.identityRepair?.newAdvertiserId === "999", "p3 identityRepair retained");

// Mass-delete guard: apply never drops products from sections
const before = doc.sections.reduce((n, s) => n + s.products.length, 0);
const after = applied.doc.sections.reduce((n, s) => n + s.products.length, 0);
assert(before === after, "never mass-delete products");

console.log(
  JSON.stringify({
    IU_CJ_MISS_REVERIFY_V38_SELFTEST: "PASS",
    stats: applied.stats,
    decisions: missAudit.rows.map((r) => ({ id: r.productId, decision: r.decision })),
  })
);
