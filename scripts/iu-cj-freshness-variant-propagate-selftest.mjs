#!/usr/bin/env node
import assert from "node:assert/strict";
import { propagateIdentityVerification } from "./iu-cj-affiliate-phase3z-catalog-freshness-scheduler-v51-8.mjs";

const rows = [
  { advertiserId: "1", productId: "p", currentPrice: 1, availability: "in stock" },
  { advertiserId: "1", productId: "p", productVariant: "v", currentPrice: 2, availability: "in stock" },
  { advertiserId: "1", productId: "p", productVariant: "w", currentPrice: 3, availability: "in stock" },
];

const placed = propagateIdentityVerification(rows, {
  advertiserId: "1",
  productId: "p",
  productVariant: "v",
  currentPrice: 20,
  currency: "CZK",
  availability: "preorder",
});
assert.equal(placed.updated, 1);
assert.equal(placed.rows[0].currentPrice, 1);
assert.equal(placed.rows[1].currentPrice, 20);
assert.equal(placed.rows[1].availability, "preorder");
assert.equal(placed.rows[1].productVariant, "v");
assert.equal(placed.rows[2].currentPrice, 3);

const bare = propagateIdentityVerification(rows, {
  advertiserId: "1",
  productId: "p",
  currentPrice: 8,
  availability: "in stock",
});
assert.equal(bare.updated, 1);
assert.equal(bare.rows[0].currentPrice, 8);
assert.equal(bare.rows[1].currentPrice, 2);
assert.equal(bare.rows[2].currentPrice, 3);

console.log(JSON.stringify({
  FRESHNESS_VARIANT_PROPAGATE_SELFTEST: "PASS",
  variantUpdated: placed.updated,
  bareUpdated: bare.updated,
}));
