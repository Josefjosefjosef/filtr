#!/usr/bin/env node
import assert from "node:assert/strict";
import { mapPool } from "./iu-cj-affiliate-offers-live-sync-v1.mjs";

const started = [];
const items = [1, 2, 3, 4, 5, 6];
const out = await mapPool(items, 3, async (n) => {
  started.push(Date.now());
  await new Promise((r) => setTimeout(r, 20));
  return n * 10;
});
assert.deepEqual(out, [10, 20, 30, 40, 50, 60]);
assert.equal(await mapPool([], 3, async (x) => x).then((r) => r.length), 0);
console.log(JSON.stringify({ IU_CJ_MAP_POOL_V51_8_SELFTEST: "PASS", concurrency: 3, items: items.length }));
