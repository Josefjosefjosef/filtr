/**
 * V51.8 — reverify / product freshness policy (capacity-honest).
 * Computes worst-case time-to-recheck; prioritizes UNKNOWN without inventing availability.
 */
import {
  estimateFullCoverageHours,
  REFRESH_MODE,
} from "./iu-cj-affiliate-phase3z-refresh-coverage-v35.mjs";

export const REVERIFY_FRESHNESS_POLICY_SCHEMA =
  "iu-cj-affiliate-phase3z-reverify-freshness-policy-v51-8";

/**
 * @param {object} opts
 * @param {number} [opts.publishedUnique=3400]
 * @param {number} [opts.attemptedPerRun=120]
 * @param {number} [opts.runsPerUtcDay=8] catalog :17 slots (0/3/6/9/12/15/18/21)
 * @param {number} [opts.catchupAssumedPerDay=1]
 * @param {number} [opts.unknownCount=0]
 * @param {string} [opts.refreshMode]
 */
export function computeReverifyFreshnessPolicy(opts = {}) {
  const publishedUnique = Math.max(0, Number(opts.publishedUnique) || 3400);
  const attemptedPerRun = Math.max(1, Number(opts.attemptedPerRun) || 120);
  const runsPerUtcDay = Math.max(1, Number(opts.runsPerUtcDay) || 8);
  const catchupAssumedPerDay = Math.max(0, Number(opts.catchupAssumedPerDay) || 1);
  const unknownCount = Math.max(0, Number(opts.unknownCount) || 0);
  const effectiveRunsPerDay = runsPerUtcDay + catchupAssumedPerDay;
  const attemptsPerDay = attemptedPerRun * effectiveRunsPerDay;
  const daysToFullPass =
    publishedUnique > 0 ? Math.ceil(publishedUnique / attemptsPerDay) : 0;
  const hoursWorstCase = daysToFullPass * 24;
  const coveragePctPerRun =
    publishedUnique > 0
      ? Math.round((attemptedPerRun / publishedUnique) * 10000) / 100
      : 0;

  const capacity = estimateFullCoverageHours({
    mode: opts.refreshMode || REFRESH_MODE.PRODUCT_IDS,
    advertisers: Number(opts.advertisers) || 66,
    publishedProducts: publishedUnique,
    refreshPageSize: Number(opts.refreshPageSize) || 100,
    refreshMaxPages: Number(opts.refreshMaxPages) || 5,
  });

  const policyOk =
    hoursWorstCase <= Number(opts.maxAcceptableHours || 72) ||
    capacity.achievableFullCoverageHours <= Number(opts.maxAcceptableHours || 72);

  return {
    schema: REVERIFY_FRESHNESS_POLICY_SCHEMA,
    at: new Date().toISOString(),
    publishedUnique,
    attemptedPerRun,
    runsPerUtcDay,
    catchupAssumedPerDay,
    effectiveRunsPerDay,
    attemptsPerDay,
    coveragePctPerRun,
    daysToFullPass,
    hoursWorstCaseFullRotation: hoursWorstCase,
    unknownCount,
    unknownPriority: "UNKNOWN_AND_OLDEST_FIRST",
    neverInventAvailability: true,
    capacityEstimate: capacity,
    policyOk,
    note:
      "UNKNOWN means missing authoritative sourceUpdatedAt / availability — rotate preferentially but do not display as CURRENT. Growth budget must not block reverify of existing identities.",
  };
}
