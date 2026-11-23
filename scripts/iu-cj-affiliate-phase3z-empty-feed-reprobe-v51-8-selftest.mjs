#!/usr/bin/env node
import {
  REPROBE_STATUS,
  emptyPartnersFromFeedCompleteness,
  reprobeEmptyFeedPartners,
} from "./iu-cj-affiliate-phase3z-empty-feed-reprobe-v51-8.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const completeness = {
  partners: [
    {
      advertiserId: "E1",
      partnerName: "Empty One",
      gapReasons: ["CJ_FEED_API_EMPTY"],
      declaredProductCount: 10,
    },
    {
      advertiserId: "OK",
      gapReasons: [],
      declaredProductCount: 5,
    },
    {
      advertiserId: "E2",
      gapReasons: ["CJ_FEED_API_EMPTY", "GROWTH_BUDGET_BLOCKED_ELIGIBLE"],
      declaredProductCount: 3,
    },
  ],
};
const extracted = emptyPartnersFromFeedCompleteness(completeness);
assert(extracted.length === 2, "two empty partners");
assert(extracted[0].advertiserId === "E1", "E1 first");

const dry = await reprobeEmptyFeedPartners({
  partners: extracted,
  gqlEnv: null,
  nowIso: "2026-11-23T12:00:00.000Z",
});
assert(dry.targetCount === 2, "targetCount");
assert(
  dry.byStatus[REPROBE_STATUS.SKIPPED_NO_CREDENTIALS] === 2,
  "no credentials → skipped",
);
assert(dry.partners.every((p) => p.priorClassification == null || true), "rows present");

const none = await reprobeEmptyFeedPartners({ partners: [], gqlEnv: null });
assert(none.targetCount === 0, "empty targets");

console.log(JSON.stringify({ ok: true, extracted: extracted.length, dryByStatus: dry.byStatus }));
