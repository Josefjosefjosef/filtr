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

  // Theoretical serial stream at 2.4s ≈ 25 req/min ≈ 2500 rows/min @ pageSize 100.
  const theoreticalRowsPerMin = reqPerMin * pageSize;
  const theoreticalRowsPer15Min = theoreticalRowsPerMin * 15;
  const claimedWindowRows = Number(input.claimedWindowRows);
  const claimedWindowMinutes = Number(input.claimedWindowMinutes) || 15;
  let reproducible = false;
  let reproducibilityNote = "No observed duration+rows pair yet — model is theoretical only.";
  if (observedDurationMs > 0 && observedFetchedRows > 0) {
    const obsRowsPerMin = observedFetchedRows / (observedDurationMs / 60000);
    const ratio = obsRowsPerMin / theoreticalRowsPerMin;
    // Allow 0.5x–2.0x of theoretical serial throttle (parallelism / overhead / multi-run sums).
    reproducible = ratio >= 0.5 && ratio <= 2.0;
    reproducibilityNote = reproducible
      ? "Observed throughput within 0.5x–2.0x of serial throttle model."
      : "Observed throughput outside serial throttle band — do not treat ETA as validated.";
  }
  if (Number.isFinite(claimedWindowRows) && claimedWindowRows > 0) {
    const expected = theoreticalRowsPerMin * claimedWindowMinutes;
    const claimRatio = claimedWindowRows / Math.max(1, expected);
    if (claimRatio < 0.5 || claimRatio > 2.0) {
      reproducible = false;
      reproducibilityNote =
        "Claimed window rows (" +
        claimedWindowRows +
        ") vs theoretical " +
        Math.round(expected) +
        " in " +
        claimedWindowMinutes +
        "m not reproducible from serial 2.4s throttle alone.";
    } else if (!(observedDurationMs > 0 && observedFetchedRows > 0)) {
      reproducible = false;
      reproducibilityNote =
        "Claimed " +
        claimedWindowRows +
        " rows/" +
        claimedWindowMinutes +
        "m is within 0.5x–2.0x of theoretical " +
        Math.round(expected) +
        " but lacks timed run evidence — ETA not validated (prior ~82d remains unproven).";
    }
  }

  return {
    schema: CATALOG_CAPACITY_SCHEMA,
    at: input.nowIso || new Date().toISOString(),
    reproducible,
    reproducibilityNote,
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
      theoreticalRowsPerMin: Number(theoreticalRowsPerMin.toFixed(2)),
      theoreticalRowsPer15Min: Number(theoreticalRowsPer15Min.toFixed(2)),
      claimedWindowRows: Number.isFinite(claimedWindowRows) ? claimedWindowRows : null,
      claimedWindowMinutes,
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
      etaValidated: false,
      prior82DayClaimStatus: "NOT_REPRODUCIBLE_FROM_SERIAL_THROTTLE_ALONE",
    },
    rationale: {
      priorLimit1to5:
        "Historical refresh_priority used 1 page and full used 5 to protect CJ spacing (~2.4s) and GA job time while all partners are scanned each run.",
      changeV518c2:
        "Base raised to 2/8 with incomplete deepen 6/20; fair order prioritizes starved incomplete feeds; LKG merge prevents publication wipe.",
      hardLimitsUnknown:
        "CJ absolute daily quota not disclosed in responses observed here; spacing IU_CJ_SYNC_REQ_SPACING_MS=2400 is the enforced client throttle.",
      math82d:
        "Serial 2.4s → ~25 req/min → ~2500 rows/min → ~37500 rows/15min. Claimed ~47204/window is not explained by one serial stream; may be multi-run sum, different page size, or mixed sources.",
    },
    note: "ETA uses declared remaining totals (may include duplicates across feeds) — upper-bound, not unique identity guarantee. Do not present as validated until reproducible=true with timed run evidence.",
  };
}
