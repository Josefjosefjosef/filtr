#!/usr/bin/env node
import { findConfirmedProduct, landingBatchKey } from "./iu-cj-affiliate-phase2-publication-pipeline.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const products = [
  { productId: "same", productVariant: "v", title: "V" },
  { productId: "same", productVariant: "w", title: "W" },
  { productId: "plain", title: "P" },
];
assert(findConfirmedProduct(products, "same", "w").title === "W", "requested variant is selected");
assert(findConfirmedProduct(products, "same", "missing") == null, "unknown variant is not the other variant");
assert(findConfirmedProduct(products, "same").title === "V", "omitted variant keeps the first product id match");
assert(findConfirmedProduct(products, "plain").title === "P", "product without a variant still matches");
assert(landingBatchKey("link", "same") === "link:same", "old batch key stays");
assert(landingBatchKey("link", "same", "w") === "link:same:w", "variant batch key");
assert(landingBatchKey("link", "same", "") === "link:same", "empty variant does not change the key");

console.log(JSON.stringify({ IU_CJ_PUBLICATION_PIPELINE_VARIANT_SELFTEST: "PASS" }));
