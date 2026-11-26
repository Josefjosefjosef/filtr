import assert from "node:assert/strict";
import {
  applyCatalogCheckResult,
  planCatalogFreshnessBatch,
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

console.log(JSON.stringify({
  IU_CJ_CATALOG_FRESHNESS_SCHEDULER_SELFTEST: "PASS",
  drained: seen,
  couponPrioritized: true,
  failureKeepsDueClock: true,
}));
