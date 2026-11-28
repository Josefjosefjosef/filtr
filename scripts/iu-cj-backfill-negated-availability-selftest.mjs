import assert from "node:assert/strict";
import { backfillAvailabilityFromPrevious } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const nowMs = Date.parse("2026-11-26T12:00:00.000Z");

function freshDurable(availability) {
  const doc = {
    sections: [{ products: [{ advertiserId: "111", productId: "p", availability: null, currency: "EUR" }] }],
  };
  const result = backfillAvailabilityFromPrevious(doc, { sections: [] }, {
    nowMs,
    durableCatalog: {
      products: {
        "111|p": { availability, currency: "EUR", lastSourceMatchAt: "2026-11-26T11:00:00.000Z" },
      },
    },
  });
  return { result, availability: doc.sections[0].products[0].availability, currency: doc.sections[0].products[0].currency };
}

for (const availability of ["not in stock", "not available", "unavailable", "není skladem", "neni skladem", "out of stock"]) {
  const row = freshDurable(availability);
  assert.equal(row.result.backfilledFromDurable, 0, availability);
  assert.equal(row.availability, null, availability);
  assert.equal(row.currency, "EUR", availability);
}

for (const availability of ["in stock", "preorder", "backorder"]) {
  const row = freshDurable(availability);
  assert.equal(row.result.backfilledFromDurable, 1, availability);
  assert.equal(row.availability, availability);
  assert.equal(row.currency, "EUR");
}

const retainedDoc = {
  sections: [{ products: [{ advertiserId: "111", productId: "p", availability: "", currency: "EUR" }] }],
};
const retained = backfillAvailabilityFromPrevious(
  retainedDoc,
  { sections: [{ products: [{ advertiserId: "111", productId: "p", availability: "not in stock", currency: "EUR" }] }] },
  { nowMs }
);
assert.equal(retained.backfilled, 1);
assert.equal(retainedDoc.sections[0].products[0].availability, "not in stock");
assert.equal(retainedDoc.sections[0].products[0].currency, "EUR");

process.stdout.write("IU_CJ_BACKFILL_NEGATED_AVAILABILITY_SELFTEST PASS\n");
