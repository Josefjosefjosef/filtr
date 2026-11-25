#!/usr/bin/env node
import {
  collectProdMetaFromOffersJson,
  assertCompleteProdMeta,
} from "./iu-cj-affiliate-phase3z-prod-meta-collect-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const baseDoc = {
  snapshotId: "snap-1",
  updatedAt: "2026-01-01T00:00:00.000Z",
  liveEnabled: true,
  publicGrowthBudget: {
    publicEligibleAfter: 10,
    cumulativeAddedSinceBaseline: 0,
    exceptionalGrowthRequiresOwner: true,
  },
  stats: { coupons: 1, actions: 2, partners: 3, products: 4, uniquePublicEligible: 10 },
};

// 1) deferredNew missing in growth budget -> numeric 0
const m0 = collectProdMetaFromOffersJson(baseDoc, { utf8ObjectStart: true });
assert(typeof m0.DEFERRED_NEW === "number", "DEFERRED_NEW is number when gb.deferredNew missing");
assert(m0.DEFERRED_NEW === 0, "DEFERRED_NEW defaults to 0");
assert(assertCompleteProdMeta(m0).ok === true, "meta complete with default DEFERRED_NEW");

// 2) deferredNew present -> numeric passthrough
const m7 = collectProdMetaFromOffersJson(
  { ...baseDoc, publicGrowthBudget: { ...baseDoc.publicGrowthBudget, deferredNew: 7 } },
  { utf8ObjectStart: true },
);
assert(m7.DEFERRED_NEW === 7, "DEFERRED_NEW passthrough");

// 3) no publicGrowthBudget at all -> still numeric 0
const { publicGrowthBudget: _drop, ...noGb } = baseDoc;
const mNoGb = collectProdMetaFromOffersJson(noGb, { utf8ObjectStart: true });
assert(mNoGb.DEFERRED_NEW === 0, "DEFERRED_NEW 0 without growth budget");

// 4) DEFERRED_NEW is required
const stripped = { ...m7 };
delete stripped.DEFERRED_NEW;
const chk = assertCompleteProdMeta(stripped);
assert(chk.ok === false && chk.missing.includes("DEFERRED_NEW"), "DEFERRED_NEW required");

console.log(JSON.stringify({ IU_CJ_PROD_META_COLLECT_SELFTEST: "PASS" }));
