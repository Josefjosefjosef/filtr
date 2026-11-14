#!/usr/bin/env node
import assert from "node:assert/strict";
import { resolveCjCallMinIntervalMs } from "./iu-cj-affiliate-phase1-lib.mjs";
import { clampProductSearchLimit } from "./iu-cj-affiliate-phase2-product-api.mjs";
import { selectPartnersForProgressiveInventory } from "./iu-cj-affiliate-phase3z-feed-inventory-v40.mjs";
import { refreshPublishedProductsFromCj } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

assert.equal(clampProductSearchLimit(1000), 1000);
assert.equal(clampProductSearchLimit(100), 100);
assert.equal(clampProductSearchLimit(50000), 10000);
assert.equal(resolveCjCallMinIntervalMs({}), 2600);
assert.equal(resolveCjCallMinIntervalMs({ IU_CJ_GRAPHQL_MIN_INTERVAL_MS: "1500" }), 1500);
assert.equal(resolveCjCallMinIntervalMs({ IU_CJ_GRAPHQL_MIN_INTERVAL_MS: "100" }), 800);
assert.equal(resolveCjCallMinIntervalMs({ IU_CJ_GRAPHQL_MIN_INTERVAL_MS: "99999" }), 10000);

const partners = [{ advertiserId: "1", active: true }, { advertiserId: "2", active: true }];
const prevComplete = {
  partners: [
    { advertiserId: "1", inventoryStatus: "INVENTORIED_HAS_FEED" },
    { advertiserId: "2", inventoryStatus: "INVENTORIED_HAS_FEED" },
  ],
};
const probe = selectPartnersForProgressiveInventory(partners, prevComplete, {
  limit: 30,
  retryErrors: true,
});
assert.equal(probe.needingInventory, 0);
assert.equal(probe.alreadyInventoried, 2);

const empty = await refreshPublishedProductsFromCj({
  env: {},
  pageSize: 1000,
  maxPages: 2,
  prevPublic: { liveEnabled: true, sections: [] },
});
assert.equal(empty.meta?.pageSize, 1000, "refresh must honor pageSize 1000 (no Math.min(100) cap)");
assert.equal(clampProductSearchLimit(100), 100);
assert.notEqual(clampProductSearchLimit(1000), 100);

console.log(
  JSON.stringify({
    IU_CJ_PAGE_SIZE_PERF_V51_8_SELFTEST: "PASS",
    pageSize: 1000,
    throttleFloorMs: 800,
    inventoryReuseProbe: "needing=0",
  })
);
