#!/usr/bin/env node
/**
 * V34 — refresh capacity + cadence selftest (offline).
 */
import {
  estimateRefreshCapacity,
  describeRefreshDiscoverySeparation,
  REFRESH_CAPACITY_SCHEMA,
} from "./iu-cj-affiliate-phase3z-refresh-capacity-v34.mjs";
import { CJ_CALL_MIN_INTERVAL_MS } from "./iu-cj-affiliate-phase1-lib.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sep = describeRefreshDiscoverySeparation();
assert(sep.schedule.dailyFullCron === "17 3 * * *", "daily cron");
assert(String(sep.schedule.refreshPriorityCrons).includes("0,6,9,12,15,18,21"), "3h cron");
assert(/does not advance discovery/i.test(sep.refresh), "refresh independence");

const v33ish = estimateRefreshCapacity({
  publishedProducts: 3594,
  advertisersWithPublished: 28,
  refreshPageSize: 100,
  refreshMaxPages: 5,
  callIntervalMs: CJ_CALL_MIN_INTERVAL_MS,
  targetMaxMinutes: 180,
});
assert(v33ish.schema === REFRESH_CAPACITY_SCHEMA, "schema");
assert(v33ish.gqlCalls === 140, "28*5 calls");
assert(v33ish.meetsTarget1to3h === true, "3h target met for ~28 advertisers");
assert(v33ish.estimatedRefreshMinutes < 30, "refresh finishes in minutes not hours");
assert(/cannot claim merchant-side/i.test(v33ish.caveat), "honest caveat");

const huge = estimateRefreshCapacity({
  publishedProducts: 500000,
  advertisersWithPublished: 2000,
  refreshPageSize: 100,
  refreshMaxPages: 5,
  callIntervalMs: CJ_CALL_MIN_INTERVAL_MS,
  targetMaxMinutes: 180,
});
assert(huge.meetsTarget1to3h === false, "2000 advertisers cannot meet 1–3h");

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: REFRESH_CAPACITY_SCHEMA,
      sample: v33ish,
      hugeBlocked: { meetsTarget1to3h: huge.meetsTarget1to3h, minutes: huge.estimatedRefreshMinutes },
      separation: sep,
    },
    null,
    2
  )
);
