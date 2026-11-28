#!/usr/bin/env node
import { buildProductReverifyLedger } from "./iu-cj-affiliate-phase3z-product-reverify-v50.mjs";
import { collectChangeRowsFromOffersDoc } from "./iu-cj-affiliate-phase3z-product-progress-v48.mjs";

const failures = [];
function expect(id, cond) {
  if (!cond) failures.push(id);
}

function reverify(product) {
  const ledger = buildProductReverifyLedger({
    doc: { sections: [{ products: [product] }] },
    nowIso: "2026-11-28T10:00:00.000Z",
    runId: "probe",
  });
  return ledger.rows[0];
}

const ready = reverify({
  advertiserId: "1",
  productId: "ready",
  publicationReady: true,
});
expect("explicit_keep", ready.publicationDecision === "KEEP_PUBLISHED");

const pending = reverify({
  advertiserId: "1",
  productId: "pending",
  publicationReady: true,
  keepPending: true,
});
expect("pending_override", pending.publicationDecision === "KEEP_PENDING");

for (const value of [false, null, undefined, "", "true", "false", 0, 1]) {
  const product = { advertiserId: "1", productId: "probe-" + String(value) };
  if (value !== undefined) product.publicationReady = value;
  const row = reverify(product);
  expect("reverify_" + String(value), row.publicationDecision === "HOLD_OR_HIDE");
}

const nowIso = "2026-11-28T10:00:00.000Z";
function priceRow(publicationReady) {
  const product = {
    advertiserId: "1",
    productId: "price-" + String(publicationReady),
    previousPrice: "100.00",
    currentPrice: "110.00",
    currency: "CZK",
    priceChangedAt: nowIso,
  };
  if (publicationReady !== undefined) product.publicationReady = publicationReady;
  const rows = collectChangeRowsFromOffersDoc(
    { sections: [{ products: [product] }] },
    { nowIso, acceptAny: true, runId: "probe" }
  );
  return rows.priceChanges[0];
}

expect("price_true", priceRow(true).publicationResult === "PUBLISHED_CARD");
for (const value of [false, null, undefined, "", "true", "false", 0, 1]) {
  expect("price_" + String(value), priceRow(value).publicationResult === "NOT_READY");
}

console.log(
  JSON.stringify({
    IU_CJ_REVERIFY_PUBLICATION_DECISION_SELFTEST: failures.length === 0 ? "PASS" : "FAIL",
    failures,
  })
);
process.exitCode = failures.length === 0 ? 0 : 1;
