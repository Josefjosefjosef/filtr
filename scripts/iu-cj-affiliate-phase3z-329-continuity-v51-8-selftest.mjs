#!/usr/bin/env node
import {
  reconstruct329Continuity,
  assertPopulationNotEquated,
  CONTINUITY_STATUS,
} from "./iu-cj-affiliate-phase3z-329-continuity-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const original329 = {
  rows: [
    { compoundIdentity: "1|a", advertiserId: "1", productId: "a", decision: "RECOVERED", cause: "CAUSE_NOT_YET_VERIFIED" },
    { compoundIdentity: "1|b", advertiserId: "1", productId: "b", decision: "KEEP_PENDING", cause: "CAUSE_NOT_YET_VERIFIED" },
    { compoundIdentity: "2|c", advertiserId: "2", productId: "c", decision: "HOLD_COLLISION", cause: "IDENTITY_OR_MAPPING_ERROR" },
  ],
};
const liveDoc = {
  sections: [
    {
      products: [
        { advertiserId: "1", productId: "a", publicationReady: true, currentPrice: 1, affiliateUrl: "https://www.kqzyfj.com/click-1" },
      ],
    },
  ],
};
const currentMiss = {
  rows: [{ sourceIdentity: "2|c", advertiserId: "2", productId: "c", decision: "HOLD_COLLISION" }],
};
const out = reconstruct329Continuity({
  original329,
  liveDoc,
  currentMiss,
  historicalMissLedgers: [
    {
      name: "old305",
      purpose: "other_miss_window",
      doc: { rows: [{ sourceIdentity: "1|b", decision: "KEEP_PENDING" }] },
    },
  ],
});
assert(out.summary.originalCount === 3, "count");
assert(out.timelines.find((t) => t.compoundIdentity === "1|a").continuityStatus === CONTINUITY_STATUS.CURRENT_LIVE, "live");
assert(
  out.timelines.find((t) => t.compoundIdentity === "2|c").continuityStatus === CONTINUITY_STATUS.IDENTITY_COLLISION,
  "collision"
);
assert(out.timelines.find((t) => t.compoundIdentity === "1|b").continuityStatus !== CONTINUITY_STATUS.UNKNOWN, "hist miss");

const popEq = assertPopulationNotEquated(
  { purpose: "historical_problem_set", uniqueIdentities: 329 },
  { purpose: "current_miss_window", uniqueIdentities: 305 }
);
assert(popEq.ok === false, "must refuse equating populations");

console.log(
  JSON.stringify({
    IU_CJ_329_CONTINUITY_SELFTEST: "PASS",
    byStatus: out.summary.byStatus,
    populationGuard: popEq.reason,
  })
);
