import assert from "node:assert/strict";
import {
  applyCatalogCheckResult,
  estimateFreshnessCapacity,
  planCatalogFreshnessBatch,
  propagateIdentityVerification,
  selectRefreshGroupsByFreshness,
} from "./iu-cj-affiliate-phase3z-catalog-freshness-scheduler-v51-8.mjs";

const now = Date.parse("2026-11-26T19:00:00.000Z");

function product(advertiserId, itemId, nextCheckAt, extra = {}) {
  return { kind: "product", advertiserId, itemId, nextCheckAt, ...extra };
}

const crowded = [];
for (let i = 0; i < 5; i += 1) {
  crowded.push(product("A", "a" + i, "2026-11-26T08:00:00.000Z"));
}
crowded.push(product("B", "b1", "2026-11-26T10:00:00.000Z"));
crowded.push(product("C", "c1", "2026-11-26T07:00:00.000Z"));
crowded.push(product("D", "d1", "2026-11-26T09:00:00.000Z"));
crowded.push({
  kind: "coupon",
  advertiserId: "E",
  itemId: "offer-1",
  nextCheckAt: "2026-11-26T18:30:00.000Z",
  validTo: "2026-11-26T20:00:00.000Z",
});
crowded.push(product("A", "a0", "2026-11-26T11:00:00.000Z", { sectionKey: "aff-other" }));

const first = planCatalogFreshnessBatch(crowded, { nowMs: now, limit: 4, maxPerPartner: 1 });
assert.equal(first.extraPlacements, 1);
assert.equal(first.batch.length, 4);
assert.equal(new Set(first.batch.map((row) => row.advertiserId)).size, 4);
assert.equal(first.batch.some((row) => row.kind === "coupon"), true);
assert.equal(first.executeArmed, false);

const failed = applyCatalogCheckResult(
  { kind: "product", advertiserId: "A", itemId: "a0", nextCheckAt: "2026-11-26T08:00:00.000Z", lastSuccessfulVerificationAt: "2026-11-26T08:00:00.000Z" },
  { ok: false },
  now,
);
assert.equal(failed.lastSuccessfulVerificationAt, "2026-11-26T08:00:00.000Z");
assert.equal(failed.nextCheckAt, "2026-11-26T08:00:00.000Z");
assert.equal(failed.sourceUpdatedAt, null);
assert.equal(failed.lkgKept, true);
assert.equal(typeof failed.lastFailedAttemptAt, "string");

const succeeded = applyCatalogCheckResult(
  { kind: "coupon", advertiserId: "E", itemId: "offer-1", nextCheckAt: "2026-11-26T08:00:00.000Z" },
  { ok: true },
  now,
);
assert.equal(succeeded.lastSuccessfulVerificationAt, "2026-11-26T19:00:00.000Z");
assert.equal(succeeded.sourceUpdatedAt, null);
assert.equal(Date.parse(succeeded.nextCheckAt) > now, true);

const queue = [];
for (let i = 0; i < 20; i += 1) {
  queue.push(product("P" + (i % 4), "id" + i, "2026-11-26T08:00:00.000Z"));
}
let open = queue;
let seen = 0;
for (let pass = 0; pass < 5; pass += 1) {
  const plan = planCatalogFreshnessBatch(open, { nowMs: now, limit: 4, maxPerPartner: 1 });
  assert.equal(plan.batch.length, 4);
  const done = new Set(plan.batch.map((row) => row.key));
  seen += done.size;
  open = open.map((row) => {
    if (!done.has("product|" + row.advertiserId + "|" + row.itemId)) return row;
    return applyCatalogCheckResult(row, { ok: true }, now);
  });
}
const after = planCatalogFreshnessBatch(open, { nowMs: now, limit: 4, maxPerPartner: 1 });
assert.equal(seen, 20);
assert.equal(after.due, 0);

const failedRetry = applyCatalogCheckResult(
  product("A", "a0", "2026-11-26T08:00:00.000Z"),
  { ok: false, httpStatus: 429, retryAfterSeconds: 30 },
  now,
);
assert.equal(failedRetry.failureClass, "TEMPORARY");
assert.equal(Date.parse(failedRetry.retryNotBefore) - now, 30000);
assert.equal(failedRetry.nextCheckAt, "2026-11-26T08:00:00.000Z");
const skipped = planCatalogFreshnessBatch([failedRetry], { nowMs: now, limit: 4, maxPerPartner: 1 });
assert.equal(skipped.batch.length, 0);
assert.equal(skipped.due, 1);
assert.equal(skipped.heldForRetry, 1);

const serverError = applyCatalogCheckResult(product("A", "a1", "2026-11-26T08:00:00.000Z"), { ok: false, httpStatus: 503 }, now);
assert.equal(serverError.failureClass, "TEMPORARY");
assert.equal(serverError.retryable, true);
const gone = applyCatalogCheckResult(product("A", "a2", "2026-11-26T08:00:00.000Z"), { ok: false, httpStatus: 404 }, now);
assert.equal(gone.failureClass, "PERMANENT");
assert.equal(gone.retryable, false);
const gonePlan = planCatalogFreshnessBatch([gone], { nowMs: now, limit: 4, maxPerPartner: 1 });
assert.equal(gonePlan.batch.length, 0);

const busy = planCatalogFreshnessBatch(
  [product("A", "a0", "2026-11-26T08:00:00.000Z"), product("B", "b1", "2026-11-26T08:00:00.000Z")],
  { nowMs: now, limit: 4, maxPerPartner: 1, checkpoint: { inFlight: { "product|A|a0": true }, circuitOpen: {} } },
);
assert.deepEqual(busy.batch.map((row) => row.advertiserId), ["B"]);

const many = [];
for (let i = 0; i < 100000; i += 1) many.push(product("S" + (i % 50), "n" + i, "2026-11-26T08:00:00.000Z"));
const started = Date.now();
const wide = planCatalogFreshnessBatch(many, { nowMs: now, limit: 50, maxPerPartner: 1 });
const elapsedMs = Date.now() - started;
assert.equal(wide.unique, 100000);
assert.equal(wide.batch.length, 50);
assert.equal(wide.partnersInBatch, 50);
assert.equal(elapsedMs < 5000, true);

const placed = propagateIdentityVerification(
  [
    { advertiserId: "1", productId: "p", sectionKey: "a", currentPrice: 1, currency: "EUR", availability: "in stock" },
    { advertiserId: "1", productId: "p", sectionKey: "b", currentPrice: 1, currency: "EUR", availability: "in stock" },
    { advertiserId: "2", productId: "p", sectionKey: "a", currentPrice: 9, currency: "CZK", availability: "in stock" },
    { advertiserId: "1", productId: "p", productVariant: "blue", sectionKey: "a", currentPrice: 4, currency: "CZK", availability: "in stock" },
  ],
  { advertiserId: "1", productId: "p", currentPrice: 10, currency: "CZK", availability: "preorder", relationshipStatus: "joined" },
);
assert.equal(placed.updated, 2);
assert.equal(placed.rows[0].currentPrice, 10);
assert.equal(placed.rows[0].availability, "preorder");
assert.equal(placed.rows[1].sectionKey, "b");
assert.equal(placed.rows[2].advertiserId, "2");
assert.equal(placed.rows[2].currentPrice, 9);
assert.equal(placed.rows[3].productVariant, "blue");
assert.equal(placed.rows[3].currentPrice, 4);

const capacity = estimateFreshnessCapacity({ uniqueIdentities: 3657 });
assert.equal(capacity.requests, 37);
assert.equal(capacity.measured, false);
assert.equal(capacity.withinThreeHours, true);

const heldPlan = planCatalogFreshnessBatch([
  product("A", "due", "2026-11-26T08:00:00.000Z"),
  product("A", "later", "2026-11-26T22:00:00.000Z"),
  product("A", "held", "2026-11-26T08:00:00.000Z", { retryNotBefore: "2026-11-27T00:00:00.000Z" }),
], { nowMs: now, limit: 10, maxPerPartner: 10 });
const selected = selectRefreshGroupsByFreshness([
  { advertiserId: "A", keys: [{ productId: "due" }, { productId: "later" }, { productId: "held" }] },
  { advertiserId: "B", keys: [{ productId: "other" }] },
], heldPlan);
assert.equal(selected.groups.length, 1);
assert.equal(selected.groups[0].keys.length, 1);
assert.equal(selected.groups[0].keys[0].productId, "due");
assert.equal(selected.skippedProducts, 3);
assert.equal(heldPlan.executeArmed, false);

console.log(JSON.stringify({
  IU_CJ_CATALOG_FRESHNESS_SCHEDULER_SELFTEST: "PASS",
  drained: seen,
  scaleIdentities: 100000,
  scaleMs: elapsedMs,
  requestsFor3657: capacity.requests,
  couponPrioritized: true,
  failureKeepsDueClock: true,
}));
