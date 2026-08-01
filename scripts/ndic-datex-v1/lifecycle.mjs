/**
 * Traffic-event lifecycle — independent of news-article time windows.
 */

/**
 * @param {object} input
 * @param {string|null} input.validFrom
 * @param {string|null} input.validTo
 * @param {boolean} [input.openEnded]
 * @param {string} [input.validityStatus]
 * @param {boolean} [input.explicitlyCancelled]
 * @param {boolean} [input.missingFromSnapshot]
 * @param {number} [input.missingStreak]
 * @param {string} [input.nowIso]
 */
export function classifyTrafficLifecycle(input = {}) {
  const nowMs = Date.parse(input.nowIso || new Date().toISOString());
  const fromMs = input.validFrom ? Date.parse(input.validFrom) : NaN;
  const toMs = input.validTo ? Date.parse(input.validTo) : NaN;
  const statusRaw = String(input.validityStatus || "").toLowerCase();

  if (input.explicitlyCancelled || /suspend|cancel/.test(statusRaw)) {
    return {
      temporalState: "cancelled",
      status: "zruseno",
      lifecycle: "cancelled",
      publishable: false,
      badge: "zrušeno",
      openEnded: false,
    };
  }

  if (Number.isFinite(toMs) && toMs < nowMs) {
    return {
      temporalState: "expired",
      status: "ukonceno",
      lifecycle: "ended",
      publishable: false,
      badge: "ukončeno",
      openEnded: false,
    };
  }

  // Soft miss from snapshot — do NOT hard-end on first absence
  if (input.missingFromSnapshot) {
    const streak = Number(input.missingStreak) || 0;
    if (streak >= 3) {
      return {
        temporalState: "expired",
        status: "ukonceno",
        lifecycle: "ended_missing",
        publishable: false,
        badge: "ukončeno",
        openEnded: false,
      };
    }
    // Keep previous publishability; caller merges with prior state
    return {
      temporalState: "active",
      status: "aktivni",
      lifecycle: "active_unconfirmed",
      publishable: true,
      badge: "aktivní",
      openEnded: Boolean(input.openEnded),
      softMissing: true,
    };
  }

  if (Number.isFinite(fromMs) && fromMs > nowMs) {
    return {
      temporalState: "scheduled",
      status: "naplanovano",
      lifecycle: "scheduled",
      publishable: true,
      badge: "plánované",
      openEnded: !Number.isFinite(toMs),
    };
  }

  const openEnded = Boolean(input.openEnded) || !Number.isFinite(toMs);
  return {
    temporalState: "active",
    status: "aktivni",
    lifecycle: openEnded ? "active_open_ended" : "active",
    publishable: true,
    badge: "aktivní",
    openEnded,
  };
}

/**
 * Compare two revision keys / version times — detect out-of-order older revision.
 * @returns {'newer'|'same'|'older'|'unknown'}
 */
export function compareRevisions(prev, next) {
  if (!prev && next) return "newer";
  if (prev && !next) return "same";
  const a = String(prev || "");
  const b = String(next || "");
  if (a === b) return "same";
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isFinite(ta) && Number.isFinite(tb)) {
    if (tb > ta) return "newer";
    if (tb < ta) return "older";
    return "same";
  }
  // numeric version
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    if (nb > na) return "newer";
    if (nb < na) return "older";
    return "same";
  }
  return "unknown";
}

/**
 * Significant user-visible change (feed bump) vs technical no-op.
 */
export function classifyChangeSignificance(prevItem, nextItem) {
  if (!prevItem) return { kind: "new", significant: true };
  if (!nextItem) return { kind: "removed", significant: true };
  const fields = [
    ["status", "status"],
    ["lifecycle", "lifecycle"],
    ["category", "eventType"],
    ["roadNumber", "roadNumber"],
    ["direction", "direction"],
    ["validTo", "validTo"],
    ["validFrom", "validFrom"],
    ["severity", "severity"],
    ["summary", "summary"],
    ["title", "title"],
  ];
  const changed = [];
  for (const [a, b] of fields) {
    const pv = prevItem[a] != null ? prevItem[a] : prevItem[b];
    const nv = nextItem[a] != null ? nextItem[a] : nextItem[b];
    if (String(pv || "") !== String(nv || "")) changed.push(a);
  }
  const geoPrev = JSON.stringify((prevItem.tmcLocationCodes || prevItem.region && prevItem.region.tmcCodes) || []);
  const geoNext = JSON.stringify((nextItem.tmcLocationCodes || nextItem.region && nextItem.region.tmcCodes) || []);
  if (geoPrev !== geoNext) changed.push("geo");

  if (!changed.length) return { kind: "unchanged", significant: false, changed };
  const techOnly = changed.every((c) => c === "summary" && String(prevItem.title) === String(nextItem.title));
  return { kind: "updated", significant: !techOnly, changed };
}
