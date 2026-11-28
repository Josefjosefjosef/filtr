#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  verifiedGrowthCandidate,
} from "./iu-cj-affiliate-phase3z-verification-pipeline-v51-8.mjs";
import { planAdaptiveBatch } from "./iu-cj-affiliate-phase3z-adaptive-growth-controller-v51-8.mjs";

const named = verifiedGrowthCandidate({
  key: "1|P|v",
  advertiserId: "1",
  productId: "P",
  productVariant: "v",
  verifiedEligible: true,
});
assert.equal(named.productVariant, "v");
assert.equal(named.key, "1|P|v");
assert.equal(named.verificationState, "VERIFIED_ELIGIBLE");

const bare = verifiedGrowthCandidate({
  key: "1|P",
  advertiserId: "1",
  productId: "P",
  verifiedEligible: true,
});
assert.equal(Object.hasOwn(bare, "productVariant"), false);

const disarmed = planAdaptiveBatch({
  candidates: [named],
  health: { ok: true, stop: false, throttle: false },
  remainingCumulative: 10,
  uncappedGate: false,
  executeArmed: false,
});
assert.equal(disarmed.allowed, 0);
assert.equal(disarmed.reason, "OWNER_GATES_DISARMED");
assert.equal(disarmed.selected.length, 0);

const localShape = planAdaptiveBatch({
  candidates: [named],
  health: { ok: true, stop: false, throttle: false },
  remainingCumulative: 10,
  uncappedGate: true,
  executeArmed: true,
});
assert.equal(localShape.selected[0].productVariant, "v");
assert.notEqual(process.env.IU_CJ_PUBLIC_GROWTH_UNCAPPED, "1");

console.log(JSON.stringify({
  VERIFIED_GROWTH_VARIANT_SELFTEST: "PASS",
  variant: named.productVariant,
  bareHasVariant: Object.hasOwn(bare, "productVariant"),
  disarmed: disarmed.reason,
  localSelected: localShape.selected[0].productVariant,
}));
