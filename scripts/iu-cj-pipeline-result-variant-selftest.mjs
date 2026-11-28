#!/usr/bin/env node
import assert from "node:assert/strict";
import { runProductPublicationPipeline } from "./iu-cj-affiliate-phase2-publication-pipeline.mjs";

const base = {
  bindingRow: { linkId: "L", offerText: "" },
  linkMeta: { destination: null },
  scope: { scopeType: "unknown" },
  couponEval: { czCouponPublishEligibility: "ineligible" },
  productEval: { eligibility: "unknown", productId: "P" },
  fetchLanding: false,
};

const named = await runProductPublicationPipeline({
  ...base,
  product: { productId: "P", productVariant: "v" },
});
assert.equal(named.productVariant, "v");
assert.equal(named.productId, "P");

const bare = await runProductPublicationPipeline({
  ...base,
  product: { productId: "P" },
});
assert.equal(Object.hasOwn(bare, "productVariant"), false);
assert.equal(bare.publicationGatesTextOnly.publicationReady, false);

console.log(JSON.stringify({
  PIPELINE_RESULT_VARIANT_SELFTEST: "PASS",
  variant: named.productVariant,
  bareHasVariant: Object.hasOwn(bare, "productVariant"),
  ready: bare.publicationGatesTextOnly.publicationReady,
}));
