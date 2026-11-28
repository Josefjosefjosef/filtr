import assert from "node:assert/strict";
import { evaluateProductShrinkageGate } from "./iu-cj-affiliate-phase3z-publication-lkg-v51-8.mjs";

function product(productId, availability) {
  return {
    advertiserId: "111",
    productId,
    publicationReady: true,
    availability,
    currency: "EUR",
  };
}

function doc(products) {
  return { sections: [{ sectionKey: "aff-nabytek", products }] };
}

const kept = product("keep", "in stock");
const opts = { maxDropAbs: 0, maxDropRatio: 0 };

for (const availability of ["not in stock", "not available", "unavailable", "není skladem", "neni skladem", "out of stock"]) {
  const gate = evaluateProductShrinkageGate(
    doc([kept, product("gone", availability)]),
    doc([kept]),
    opts
  );
  assert.equal(gate.oosRemediationRemoved, 1, availability);
  assert.equal(gate.effectiveDrop, 0, availability);
  assert.equal(gate.ok, true, availability);
}

const stockDrop = evaluateProductShrinkageGate(doc([kept, product("gone", "in stock")]), doc([kept]), opts);
assert.equal(stockDrop.oosRemediationRemoved, 0);
assert.equal(stockDrop.ok, false);

const preorderDrop = evaluateProductShrinkageGate(doc([kept, product("gone", "preorder")]), doc([kept]), opts);
assert.equal(preorderDrop.oosRemediationRemoved, 0);
assert.equal(preorderDrop.ok, false);

process.stdout.write("IU_CJ_SHRINK_NEGATED_AVAILABILITY_SELFTEST PASS\n");
