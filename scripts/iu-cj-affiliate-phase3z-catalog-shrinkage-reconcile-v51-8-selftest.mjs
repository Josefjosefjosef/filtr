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
console.log(JSON.stringify({ ok: true, deltas: doc.deltas }));
