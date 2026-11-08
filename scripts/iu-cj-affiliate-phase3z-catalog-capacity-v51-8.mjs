#!/usr/bin/env node
/**
 * V51.8-c2 — measured catalog capacity model (evidence-backed estimates only).
 * Does not invent CJ quotas; records observed spacing + pages + throughput.
 */

export const CATALOG_CAPACITY_SCHEMA = "iu-cj-affiliate-phase3z-catalog-capacity-v51-8";

/**
 * Build capacity evidence from continuation events / partner fetch meta / schedule runs.
 */
export function measureCatalogCapacity(input = {}) {
  const callIntervalMs = Math.max(1, Number(input.callIntervalMs) || 2400);
  const pageSize = Math.max(1, Number(input.pageSize) || 100);
  const baseMaxPages = Math.max(1, Number(input.baseMaxPages) || 2);
  const deepenMaxPages = Math.max(baseMaxPages, Number(input.deepenMaxPages) || 6);
  const partnersPerRun = Math.max(0, Number(input.partnersPerRun) || 0);
  const incompletePartners = Math.max(0, Number(input.incompletePartners) || 0);
  const observedFetchedRows = Math.max(0, Number(input.observedFetchedRows) || 0);
  const observedDurationMs = Math.max(0, Number(input.observedDurationMs) || 0);
  const declaredRemaining = Math.max(0, Number(input.declaredRemaining) || 0);
  const scheduleRunsPerDay = Math.max(0, Number(input.scheduleRunsPerDay) || 8);

  const reqPerMin = 60000 / callIntervalMs;
  const pagesIfAllBase = partnersPerRun * baseMaxPages;
  const pagesIfDeepen =
    Math.max(0, partnersPerRun - incompletePartners) * baseMaxPages +
    incompletePartners * deepenMaxPages;
  const rowsEstimateBase = pagesIfAllBase * pageSize;
  const rowsEstimateDeepen = pagesIfDeepen * pageSize;
  const observedRowsPerHour =
    observedDurationMs > 0 ? (observedFetchedRows / observedDurationMs) * 3600000 : null;
  const estimatedRowsPerRun = observedFetchedRows || rowsEstimateDeepen;
  const estimatedRowsPerDay = estimatedRowsPerRun * scheduleRunsPerDay;
  const etaDays =
    estimatedRowsPerDay > 0 && declaredRemaining > 0
      ? declaredRemaining / estimatedRowsPerDay
      : null;

  return {
    schema: CATALOG_CAPACITY_SCHEMA,
    at: input.nowIso || new Date().toISOString(),
    measured: {
      callIntervalMs,
      approxReqPerMin: Number(reqPerMin.toFixed(2)),
      pageSize,
      baseMaxPages,
      deepenMaxPages,
      partnersPerRun,
      incompletePartners,
      observedFetchedRows,
      observedDurationMs,
      observedRowsPerHour,
      scheduleRunsPerDay,
    },
    estimates: {
      pagesIfAllBase,
      pagesIfDeepen,
      rowsEstimateBase,
      rowsEstimateDeepen,
      estimatedRowsPerRun,
      estimatedRowsPerDay,
      declaredRemaining,
      etaDaysToDrainDeclaredRemaining: etaDays != null ? Number(etaDays.toFixed(2)) : null,
    },
    rationale: {
      priorLimit1to5:
        "Historical refresh_priority used 1 page and full used 5 to protect CJ spacing (~2.4s) and GA job time while all partners are scanned each run.",
      changeV518c2:
        "Base raised to 2/8 with incomplete deepen 6/20; fair order prioritizes starved incomplete feeds; LKG merge prevents publication wipe.",
      hardLimitsUnknown:
        "CJ absolute daily quota not disclosed in responses observed here; spacing IU_CJ_SYNC_REQ_SPACING_MS=2400 is the enforced client throttle.",
    },
    note: "ETA uses declared remaining totals (may include duplicates across feeds) — upper-bound, not unique identity guarantee.",
  };
}
