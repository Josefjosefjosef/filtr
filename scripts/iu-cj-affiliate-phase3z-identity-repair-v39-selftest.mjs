#!/usr/bin/env node
import {
  IDENTITY_REPAIR_DECISION,
  decideIdentityRepair,
  evaluateIdentityRepairBatch,
  titleSimilarity,
} from "./iu-cj-affiliate-phase3z-identity-repair-v39.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(titleSimilarity("Diablo X-Eye Prime Pink", "Diablo X-Eye Prime Pink Chair") > 0.4, "sim");

const collision = decideIdentityRepair({
  advertiserId: "7149746",
  productId: "952",
  title: "Ergonomischer Bürostuhl Diablo V-Basic",
  identityRepair: { oldAdvertiserId: "7149746", newAdvertiserId: "5154182", newProductId: "952" },
});
assert(collision.decision === IDENTITY_REPAIR_DECISION.HOLD_COLLISION, "bare collision hold");
assert(collision.applyRemap === false, "no remap");

const verified = decideIdentityRepair(
  {
    advertiserId: "111",
    productId: "abc",
    title: "Organic Kombucha Ginger 330 ml",
    identityRepair: { oldAdvertiserId: "111", newAdvertiserId: "222", newProductId: "abc" },
  },
  {
    joinedAdvertiserIds: new Set(["222"]),
    probeTitle: "Organic Kombucha Ginger 330 ml bottle",
    minTitleSimilarity: 0.5,
  }
);
assert(verified.decision === IDENTITY_REPAIR_DECISION.APPLY_REMAP, "verified remap");
assert(verified.applyRemap === true, "apply");

const batch = evaluateIdentityRepairBatch([
  {
    sourceIdentity: "7149746|952",
    advertiserId: "7149746",
    productId: "952",
    title: "Chair A",
    probe: { identityRepair: { oldAdvertiserId: "7149746", newAdvertiserId: "5154182", newProductId: "952" } },
  },
  {
    sourceIdentity: "A|1",
    advertiserId: "A",
    productId: "1",
    title: "Same Title Product Extra",
    probe: { identityRepair: { oldAdvertiserId: "A", newAdvertiserId: "B", newProductId: "1" } },
  },
], { joinedAdvertiserIds: ["B"], probeTitle: "Same Title Product Extra", minTitleSimilarity: 0.5 });

assert(batch.counts.HOLD_COLLISION >= 1, "batch holds collisions");
assert(batch.counts.input === 2, "batch size");

console.log(
  JSON.stringify({
    IU_CJ_IDENTITY_REPAIR_V39_SELFTEST: "PASS",
    collision: collision.decision,
    verified: verified.decision,
    batchCounts: batch.counts,
  })
);
