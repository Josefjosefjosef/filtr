#!/usr/bin/env node
import assert from "node:assert/strict";
import { reconcileCatalogShrinkage } from "./iu-cj-affiliate-phase3z-catalog-shrinkage-reconcile-v51-8.mjs";

const prev = {
  updatedAt: "2026-11-23T08:00:00Z",
  stats: { uniqueProducts: 3 },
  sections: [
    {
      sectionKey: "s",
      products: [
        { advertiserId: "1", productId: "a", availability: true, lkgCarried: true },
        { advertiserId: "1", productId: "b", availability: true, lkgPublicHold: false },
        { advertiserId: "1", productId: "c", availability: false, lkgPublicHold: true },
      ],
    },
  ],
};
const next = {
  updatedAt: "2026-11-23T14:00:00Z",
  stats: { uniqueProducts: 3 },
  sections: [
    {
      sectionKey: "s",
      products: [
        { advertiserId: "1", productId: "a", availability: true, lkgCarried: false },
        { advertiserId: "1", productId: "b", availability: false, lkgPublicHold: true },
        { advertiserId: "1", productId: "d", availability: true },
      ],
    },
  ],
};
const doc = reconcileCatalogShrinkage(prev, next, {});
assert.equal(doc.deltas.added, 1);
assert.equal(doc.deltas.removed, 1);
assert.equal(doc.deltas.newlyHeld, 1);
assert.equal(doc.deltas.lkgCleared, 1);
assert.equal(doc.deltas.uniqueDelta, 0);
const negated = reconcileCatalogShrinkage(
  {
    sections: [
      {
        sectionKey: "s",
        products: [{ advertiserId: "9", productId: "n", availability: "not in stock" }],
      },
    ],
  },
  { sections: [{ sectionKey: "s", products: [] }] },
  {}
);
assert.equal(negated.removedReasons.REMOVED_WHILE_OUT_OF_STOCK_OR_UNAVAILABLE, 1);
const plain = reconcileCatalogShrinkage(
  {
    sections: [
      {
        sectionKey: "s",
        products: [{ advertiserId: "9", productId: "y", availability: "in stock" }],
      },
    ],
  },
  { sections: [{ sectionKey: "s", products: [] }] },
  {}
);
assert.equal(plain.removedReasons.REMOVED_WHILE_OUT_OF_STOCK_OR_UNAVAILABLE, undefined);
console.log(JSON.stringify({ ok: true, deltas: doc.deltas }));
