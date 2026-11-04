#!/usr/bin/env node
/**
 * V38 — miss product decisions + omitPartnerIds query builder (offline).
 */
import {
  MISS_CAUSE,
  MISS_DECISION,
  buildMissProductAudit,
  decideMissProduct,
  summarizeMissCauses,
} from "./iu-cj-affiliate-phase3z-miss-products-v38.mjs";
import { buildPublisherProductsQuery } from "./iu-cj-affiliate-phase2-product-api.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const keep = decideMissProduct({ consecutiveMisses: 1, lastSuccessfulRefreshAt: "2026-11-04T08:00:00.000Z" }, {
  nowMs: Date.parse("2026-11-04T10:00:00.000Z"),
  hideAfterHours: 24,
  hideAfterConsecutiveMisses: 3,
});
assert(keep.decision === MISS_DECISION.KEEP_PENDING, "low streak keep pending");
assert(keep.hidePrice === false, "do not hide on first miss");

const hide = decideMissProduct(
  { consecutiveMisses: 3, lastSuccessfulRefreshAt: "2026-11-01T00:00:00.000Z" },
  { nowMs: Date.parse("2026-11-04T12:00:00.000Z"), hideAfterHours: 24, hideAfterConsecutiveMisses: 3 }
);
assert(hide.decision === MISS_DECISION.TEMPORARILY_HIDE, "hide after streak/age");
assert(hide.hidePrice === true, "hide price");

const recovered = decideMissProduct({ consecutiveMisses: 5, recovered: true });
assert(recovered.decision === MISS_DECISION.RECOVERED, "recovered");

const repair = decideMissProduct({
  consecutiveMisses: 2,
  identityRepair: { newAdvertiserId: "999", newProductId: "abc" },
});
assert(repair.decision === MISS_DECISION.REPAIR_IDENTITY, "identity repair");
assert(repair.cause === MISS_CAUSE.IDENTITY_CHANGED, "identity cause");

const holdCollision = decideMissProduct({
  consecutiveMisses: 2,
  collision: { oldAdvertiserId: "1", newAdvertiserId: "2", oldProductId: "x", newProductId: "x" },
  identityRepairVerdict: { decision: "HOLD_COLLISION", applyRemap: false },
});
assert(holdCollision.decision === MISS_DECISION.HOLD_COLLISION, "v40 hold collision");
assert(holdCollision.hidePrice === false, "collision keeps LKG price visible policy");

const ended = decideMissProduct({ partnerEnded: true, consecutiveMisses: 1 });
assert(ended.decision === MISS_DECISION.REMOVE_CONFIRMED, "ended only with explicit flag");
assert(ended.cause === MISS_CAUSE.PARTNER_ENDED, "ended cause");

// Bare miss must NOT become REMOVE_CONFIRMED
const bare = decideMissProduct({ consecutiveMisses: 10 });
assert(bare.decision !== MISS_DECISION.REMOVE_CONFIRMED, "never auto-delete");

const audit = buildMissProductAudit({
  nowIso: "2026-11-04T12:00:00.000Z",
  runId: "test",
  products: [
    {
      advertiserId: "A",
      productId: "1",
      refreshResult: "NOT_IN_SCAN_WINDOW",
      refreshReason: "advertiser_productIds_query_miss_not_deleted",
      lastSuccessfulRefreshAt: "2026-11-04T08:00:00.000Z",
      currentPrice: 10,
      title: "t1",
      sectionKey: "aff-x",
    },
    {
      advertiserId: "B",
      productId: "2",
      refreshResult: "SUCCESSFULLY_REFRESHED",
      refreshReason: "productId_matched_by_productIds_query",
    },
  ],
  probeByKey: new Map([["A|1", { recovered: true, apiResult: "productIds_hit" }]]),
  hideAfterHours: 24,
  hideAfterConsecutiveMisses: 3,
});
assert(audit.counts.uniqueMisses === 1, "only miss rows");
assert(audit.rows[0].decision === MISS_DECISION.RECOVERED, "probe recovered");
const sum = summarizeMissCauses(audit);
assert(sum.byDecision.RECOVERED === 1, "summary recovered");

const qScoped = buildPublisherProductsQuery("1", "2", "3", 10, { productIds: ["x"] });
assert(/partnerIds/.test(qScoped), "scoped keeps partnerIds");
const qProbe = buildPublisherProductsQuery("1", "2", "3", 10, { productIds: ["x"], omitPartnerIds: true });
assert(!/partnerIds/.test(qProbe), "probe omits partnerIds");
assert(/productIds:\s*\["x"\]/.test(qProbe), "probe keeps productIds");

console.log(
  JSON.stringify({
    IU_CJ_MISS_PRODUCTS_V38_SELFTEST: "PASS",
    decisions: { keep: keep.decision, hide: hide.decision, recovered: recovered.decision, repair: repair.decision },
    auditCounts: audit.counts,
  })
);
