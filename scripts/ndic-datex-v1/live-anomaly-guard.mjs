/**
 * Anomaly guard for live traffic candidates vs last-known-good production.
 * Blocks catastrophic collapses; allows legitimate large traffic swings with diagnostics.
 */
export function evaluateLiveAnomalyGuard({ previous, candidate, nowIso } = {}) {
  const prev = previous || {};
  const cand = candidate || {};
  const reasons = [];
  const okFlags = [];

  const prevCards = num(prev.cardCount, prev.TOTAL_RECORDS);
  const candCards = num(cand.cardCount, cand.TOTAL_RECORDS);
  const prevActive = num(prev.ACTIVE_COUNT, prev.active);
  const candActive = num(cand.ACTIVE_COUNT, cand.active);
  const prevUnresolved = num(prev.UNRESOLVED_COUNT, prev.unresolved);
  const candUnresolved = num(cand.UNRESOLVED_COUNT, cand.unresolved);
  const prevResolved = num(prev.RESOLVED_COUNT, prev.resolved);
  const candResolved = num(cand.RESOLVED_COUNT, cand.resolved);

  // Hard invariants
  if (candCards != null && candCards === 0 && prevCards != null && prevCards >= 100) {
    reasons.push("CATASTROPHIC_ZERO_CARDS");
  }
  if (candActive != null && candActive === 0 && prevActive != null && prevActive >= 100) {
    reasons.push("CATASTROPHIC_ZERO_ACTIVE");
  }
  if (
    prevUnresolved != null &&
    candUnresolved != null &&
    prevUnresolved >= 50 &&
    candUnresolved >= prevUnresolved * 5 &&
    candUnresolved - prevUnresolved >= 1500
  ) {
    reasons.push("CATASTROPHIC_UNRESOLVED_SPIKE");
  }
  if (
    prevResolved != null &&
    candResolved != null &&
    prevResolved >= 500 &&
    candResolved <= prevResolved * 0.2
  ) {
    reasons.push("CATASTROPHIC_RESOLVED_COLLAPSE");
  }
  if (cand.schema && cand.schema !== "iu-traffic-offline-snapshot-v1") {
    reasons.push("INVALID_SNAPSHOT_SCHEMA");
  }
  if (candCards != null && candCards > 0) okFlags.push("HAS_CARDS");
  if (candActive != null && candActive > 0) okFlags.push("HAS_ACTIVE");

  const blocked = reasons.length > 0;
  return {
    ok: !blocked,
    blocked,
    reasons,
    okFlags,
    comparedAt: nowIso || new Date().toISOString(),
    previous: {
      cardCount: prevCards,
      ACTIVE_COUNT: prevActive,
      RESOLVED_COUNT: prevResolved,
      UNRESOLVED_COUNT: prevUnresolved,
    },
    candidate: {
      cardCount: candCards,
      ACTIVE_COUNT: candActive,
      RESOLVED_COUNT: candResolved,
      UNRESOLVED_COUNT: candUnresolved,
    },
  };
}

function num(...vals) {
  for (const v of vals) {
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
