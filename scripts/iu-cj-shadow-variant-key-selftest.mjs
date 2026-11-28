import assert from "node:assert/strict";
import {
  shadowIdentityKey,
  validateShadowCandidate,
} from "./iu-cj-affiliate-phase3z-growth-shadow-mode-v51-8.mjs";

const url = "https://www.kqzyfj.com/click-101883843-1001";
const variantV = {
  advertiserId: "111",
  productId: "SAME",
  productVariant: "v",
  currentPrice: 9,
  currency: "EUR",
  availability: "in stock",
  availabilityClass: "IN_STOCK",
  affiliateUrl: url,
  publicationReady: true,
  publicOffer: true,
};
const variantW = {
  ...variantV,
  productVariant: "w",
  currentPrice: 2,
  availability: "preorder",
  availabilityClass: "PREORDER",
};
const only = {
  ...variantV,
  productId: "ONLY",
  productVariant: "",
  currentPrice: 4,
  availability: "backorder",
  availabilityClass: "BACKORDER",
};
assert.equal(shadowIdentityKey(variantV), "111|SAME|v");
assert.equal(shadowIdentityKey(variantW), "111|SAME|w");
assert.equal(shadowIdentityKey(only), "111|ONLY");
assert.notEqual(shadowIdentityKey(variantV), shadowIdentityKey(variantW));

const first = validateShadowCandidate(variantV);
const second = validateShadowCandidate(variantW);
const plain = validateShadowCandidate(only);
assert.equal(first.ok, true);
assert.equal(first.key, "111|SAME|v");
assert.equal(second.ok, true);
assert.equal(second.key, "111|SAME|w");
assert.equal(plain.ok, true);
assert.equal(plain.key, "111|ONLY");
assert.equal(variantV.currency, "EUR");
assert.equal(variantW.currency, "EUR");
assert.equal(variantW.availability, "preorder");
assert.equal(only.availability, "backorder");

process.stdout.write("IU_CJ_SHADOW_VARIANT_KEY_SELFTEST PASS\n");
