/**
 * IU CJ Affiliate Phase3Z — adaptive growth controller (V51.8).
 * DISARMED-only pure helpers: no I/O, no env reads, no production activation.
 */

export const REASON_OWNER_GATES_DISARMED = 'OWNER_GATES_DISARMED';

const DEFAULT_CAPS = Object.freeze({
  minBatch: 0,
  maxBatch: 500,
  maxHoldRate: 0.2,
  maxApiErrorRate: 0.1,
  maxSyncDurationMs: 600000,
  maxPublicBytes: 50 * 1024 * 1024,
});

const DEFAULT_THRESHOLDS = Object.freeze({
  holdRateStop: 0.35,
  holdRateThrottle: 0.2,
  invalidRateStop: 0.25,
  invalidRateThrottle: 0.1,
  syncDurationStopMs: 1200000,
  syncDurationThrottleMs: 600000,
  maxPagesFail: 0,
  maxConsecutiveFailures: 3,
});

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
}

function rate(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? 1 : n;
}

export function estimateSafeBatchSize({
  deferredCount = 0,
  holdRate = 0,
  apiErrorRate = 0,
  syncDurationMs = 0,
  publicBytes = 0,
  caps = {},
} = {}) {
  const c = { ...DEFAULT_CAPS, ...(caps || {}) };
  const deferred = Math.floor(num(deferredCount));
  let size = Math.min(deferred, Math.floor(num(c.maxBatch, DEFAULT_CAPS.maxBatch)));
  if (rate(holdRate) > num(c.maxHoldRate, DEFAULT_CAPS.maxHoldRate)) size = Math.floor(size / 2);
  if (rate(apiErrorRate) > num(c.maxApiErrorRate, DEFAULT_CAPS.maxApiErrorRate)) size = Math.floor(size / 2);
  if (num(syncDurationMs) > num(c.maxSyncDurationMs, DEFAULT_CAPS.maxSyncDurationMs)) size = Math.floor(size / 2);
  if (num(publicBytes) > num(c.maxPublicBytes, DEFAULT_CAPS.maxPublicBytes)) size = 0;
  size = Math.max(size, Math.floor(num(c.minBatch)));
  return Math.min(size, deferred);
}

export function evaluateGrowthHealth({
  uniqueProducts = 0,
  holdCount = 0,
  invalidRate = 0,
  syncDurationMs = 0,
  pagesFail = 0,
} = {}) {
  const t = DEFAULT_THRESHOLDS;
  const reasons = [];
  let stop = false;
  let throttle = false;
  const unique = num(uniqueProducts);
  const holdRate = unique > 0 ? num(holdCount) / unique : num(holdCount) > 0 ? 1 : 0;
  const inv = rate(invalidRate);
  const dur = num(syncDurationMs);

  if (holdRate >= t.holdRateStop) { stop = true; reasons.push('HOLD_RATE_STOP'); }
  else if (holdRate >= t.holdRateThrottle) { throttle = true; reasons.push('HOLD_RATE_THROTTLE'); }

  if (inv >= t.invalidRateStop) { stop = true; reasons.push('INVALID_RATE_STOP'); }
  else if (inv >= t.invalidRateThrottle) { throttle = true; reasons.push('INVALID_RATE_THROTTLE'); }

  if (dur >= t.syncDurationStopMs) { stop = true; reasons.push('SYNC_DURATION_STOP'); }
  else if (dur >= t.syncDurationThrottleMs) { throttle = true; reasons.push('SYNC_DURATION_THROTTLE'); }

  if (num(pagesFail) > t.maxPagesFail) { stop = true; reasons.push('PAGES_FAIL_STOP'); }

  return { ok: !stop && !throttle, throttle: throttle && !stop, stop, reasons };
}

export function planAdaptiveBatch({
  candidates = [],
  health = null,
  remainingCumulative = 0,
  uncappedGate = false,
  executeArmed = false,
} = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (uncappedGate !== true || executeArmed !== true) {
    return { allowed: 0, reason: REASON_OWNER_GATES_DISARMED, selected: [] };
  }
  if (!health || typeof health !== 'object' || health.stop === true) {
    return { allowed: 0, reason: 'HEALTH_STOP', selected: [] };
  }
  const remaining = Math.floor(num(remainingCumulative));
  if (remaining <= 0) return { allowed: 0, reason: 'CUMULATIVE_CAP_REACHED', selected: [] };
  let allowed = Math.min(list.length, remaining);
  if (health.throttle === true) allowed = Math.floor(allowed / 2);
  return {
    allowed,
    reason: allowed > 0 ? 'OK' : 'NO_CANDIDATES',
    selected: list.slice(0, allowed),
  };
}

export function circuitBreakerDecide({ consecutiveFailures = 0, manualStop = false } = {}) {
  if (manualStop === true) return 'STOP';
  if (num(consecutiveFailures) >= DEFAULT_THRESHOLDS.maxConsecutiveFailures) return 'STOP';
  return 'CONTINUE';
}
