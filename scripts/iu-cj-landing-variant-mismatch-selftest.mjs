#!/usr/bin/env node
import { verifyLandingBatchProductIdentity } from "./iu-cj-affiliate-phase2-offer-landing-lib.mjs";

const batchBase = {
  productId: "P",
  landingIdentity: { status: "unknown" },
};

const mismatch = verifyLandingBatchProductIdentity(
  { ...batchBase, productVariant: "w" },
  { product: { productId: "P", productVariant: "v" } },
);
if (mismatch.ok !== false || mismatch.reason !== "batch_product_variant_mismatch") {
  console.error(JSON.stringify(mismatch));
  process.exit(1);
}

const same = verifyLandingBatchProductIdentity(
  { ...batchBase, productVariant: "v" },
  { product: { productId: "P", productVariant: "v" } },
);
if (same.reason === "batch_product_variant_mismatch") {
  console.error(JSON.stringify(same));
  process.exit(1);
}

const empty = verifyLandingBatchProductIdentity(
  batchBase,
  { product: { productId: "P", productVariant: "v" } },
);
if (empty.reason === "batch_product_variant_mismatch") {
  console.error(JSON.stringify(empty));
  process.exit(1);
}

console.log(JSON.stringify({
  LANDING_VARIANT_SELFTEST: "PASS",
  mismatch: mismatch.reason,
  same: same.reason,
  empty: empty.reason,
}));
