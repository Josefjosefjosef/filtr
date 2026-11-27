#!/usr/bin/env node
import { landingBatchDiagnosticRow } from "./iu-cj-affiliate-phase2-landing-batch-diagnostic.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const binding = { linkId: "17365257" };
const variant = landingBatchDiagnosticRow(binding, {
  productId: "same",
  productVariant: "v",
  landingSource: "batch",
  landingBatchVerify: { reason: "matched", linkageLayer: "sku" },
});
const plain = landingBatchDiagnosticRow(binding, {
  productId: "same",
  landingSource: "batch",
});
assert(variant.productVariant === "v", "variant stays on the diagnostic");
assert(variant.productId === "same", "product id stays");
assert(variant.linkId === "17365257", "link id stays");
assert(variant.landingBatchReason === "matched", "reason stays");
assert(plain.productVariant == null, "missing variant stays absent");
assert(plain.productId === "same", "plain product id stays");

console.log(JSON.stringify({ IU_CJ_LANDING_BATCH_DIAGNOSTIC_SELFTEST: "PASS" }));
