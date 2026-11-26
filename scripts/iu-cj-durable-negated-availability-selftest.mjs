import assert from "node:assert/strict";
import {
  normalizePublicationAvailability,
  publicationEligibilityFromAvailability,
} from "./iu-cj-affiliate-phase3z-durable-catalog-v51.mjs";

const held = ["not in stock", "not available", "unavailable", "není skladem", "neni skladem", "out of stock"];
for (const raw of held) {
  const normalized = normalizePublicationAvailability(raw);
  assert.equal(normalized.class, "OUT_OF_STOCK", raw);
  const gate = publicationEligibilityFromAvailability(raw, "PUBLICATION_ELIGIBLE");
  assert.equal(gate.eligibility, "PUBLICATION_HOLD", raw);
}

assert.equal(normalizePublicationAvailability("in stock").class, "IN_STOCK");
assert.equal(normalizePublicationAvailability("preorder").class, "PREORDER");
assert.equal(normalizePublicationAvailability("backorder").class, "BACKORDER");
const stock = publicationEligibilityFromAvailability("in stock", "PUBLICATION_ELIGIBLE");
assert.equal(stock.eligibility, "PUBLICATION_ELIGIBLE");
const preorder = publicationEligibilityFromAvailability("preorder", "PUBLICATION_ELIGIBLE");
assert.equal(preorder.availabilityClass, "PREORDER");
assert.equal(preorder.eligibility, "PUBLICATION_ELIGIBLE");

process.stdout.write("IU_CJ_DURABLE_NEGATED_AVAILABILITY_SELFTEST PASS\n");
