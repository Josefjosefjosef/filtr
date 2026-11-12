import { computeReverifyFreshnessPolicy } from "./iu-cj-affiliate-phase3z-reverify-freshness-policy-v51-8.mjs";
import { orderAdvertisersForRefresh } from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT: " + msg);
}

const policy = computeReverifyFreshnessPolicy({
  publishedUnique: 3421,
  attemptedPerRun: 120,
  runsPerUtcDay: 8,
  catchupAssumedPerDay: 1,
  unknownCount: 1716,
});
assert(policy.attemptsPerDay === 1080, "attempts/day");
assert(policy.daysToFullPass === 4, "days to full pass");
assert(policy.neverInventAvailability === true, "no invent");
assert(policy.unknownPriority === "UNKNOWN_AND_OLDEST_FIRST", "priority");

const prevByKey = new Map([
  ["1|a", { lastSuccessfulRefreshAt: "2026-11-12T00:00:00.000Z", availability: "IN_STOCK" }],
  ["2|b", { lastSuccessfulRefreshAt: "2026-11-10T00:00:00.000Z", availability: "UNKNOWN" }],
  ["3|c", { fetchedAt: null, freshnessStatus: "UNKNOWN" }],
]);
const keys = [
  { advertiserId: "1", productId: "a" },
  { advertiserId: "2", productId: "b" },
  { advertiserId: "3", productId: "c" },
];
const ordered = orderAdvertisersForRefresh(keys, prevByKey);
assert(ordered[0].advertiserId === "2" || ordered[0].advertiserId === "3", "unknown first");
assert(ordered[ordered.length - 1].advertiserId === "1", "known last among trio");

console.log(
  JSON.stringify({
    IU_CJ_REVERIFY_FRESHNESS_POLICY_SELFTEST: "PASS",
    daysToFullPass: policy.daysToFullPass,
    hoursWorstCase: policy.hoursWorstCaseFullRotation,
    coveragePctPerRun: policy.coveragePctPerRun,
  }),
);
