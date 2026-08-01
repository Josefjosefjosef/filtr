/**
 * Namespace-safe composition for Update info events vs CHMI CAP v2 ownership.
 * Info-events may update its own items/sections; must never wipe CAP v2 feed items or monitoring.chmiCapV2.
 */
export const CHMI_CAP_V2_ID_RE = /^ie-chmi-v2-/i;
export const NDIC_DATEX_V1_ID_RE = /^ie-ndic-v1-/i;

/** Items owned by the CHMI CAP v2 adapter (not by info-events legacy CAP). */
export function isOwnedByChmiCapV2(item) {
  if (!item || typeof item !== "object") return false;
  if (String(item.sourceId || "") !== "chmi") return false;
  if (item.capV2 && typeof item.capV2 === "object") return true;
  if (CHMI_CAP_V2_ID_RE.test(String(item.id || ""))) return true;
  return false;
}

/** Items owned by the NDIC DATEX II v1 adapter. */
export function isOwnedByNdicDatexV1(item) {
  if (!item || typeof item !== "object") return false;
  if (String(item.adapterOwner || "") === "ndic-datex-v1") return true;
  if (String(item.sourceId || "") === "ndic" && (item.ndicV1 || NDIC_DATEX_V1_ID_RE.test(String(item.id || "")))) {
    return true;
  }
  if (NDIC_DATEX_V1_ID_RE.test(String(item.id || ""))) return true;
  return false;
}

/** Foreign feed namespaces that info-events must not delete. */
export function isForeignFeedItem(item) {
  if (isOwnedByChmiCapV2(item)) return true;
  if (isOwnedByNdicDatexV1(item)) return true;
  if (item && item.adapterOwner && String(item.adapterOwner) !== "info-events") return true;
  return false;
}

/** Info-events must never legacy-ingest CHMI when CAP v2 owns production items. */
export function shouldSkipChmiLegacyIngest(prevFeedItems, chmiV2Config) {
  const mode = chmiV2Config && chmiV2Config.mode;
  if (mode === "active") return true;
  const prev = Array.isArray(prevFeedItems) ? prevFeedItems : [];
  return prev.some(isOwnedByChmiCapV2);
}

/**
 * Compose feed items: preserve foreign namespaces from previous feed;
 * keep info-events-owned items from this run; drop legacy CHMI replacements.
 */
export function composeFeedItemsWithForeignNamespaces(prevItems, nextItems) {
  const prev = Array.isArray(prevItems) ? prevItems : [];
  const next = Array.isArray(nextItems) ? nextItems : [];
  const preservedForeign = prev.filter(isForeignFeedItem);
  const preserveIds = new Set(preservedForeign.map((i) => String(i.id || "")).filter(Boolean));
  const hasCapV2 = preservedForeign.some(isOwnedByChmiCapV2);

  const ownedNext = [];
  const seenOwned = new Set();
  for (const it of next) {
    if (!it) continue;
    if (isForeignFeedItem(it)) {
      // Info-events must not author foreign-owned items.
      continue;
    }
    if (String(it.sourceId || "") === "chmi" && hasCapV2) {
      // Drop legacy CHMI replacements when CAP v2 set is being preserved.
      continue;
    }
    const id = String(it.id || "");
    if (id && preserveIds.has(id)) {
      throw new Error(
        "NAMESPACE_ID_CONFLICT: info-events item id collides with preserved foreign id: " + id
      );
    }
    if (id) {
      if (seenOwned.has(id)) continue;
      seenOwned.add(id);
    }
    ownedNext.push(it);
  }

  return preservedForeign.concat(ownedNext);
}

/** Top-level monitoring keys owned/updated by Update info events. */
export const INFO_EVENTS_MONITORING_OWNED_KEYS = [
  "version",
  "generatedAt",
  "cutover",
  "runMs",
  "onlyGroup",
  "feedItemCount",
  "droppedHomepageUrls",
  "removedDuplicates",
  "sourceErrors",
  "laneCounts",
  "failedConnectors",
  "ingest",
  "sources",
  "pendingSources",
  "dedupeGroups",
  "droppedOutsideActiveWindow",
  "dataQuality",
  "commercialAggregationActive",
  "datasetAges",
  "alerts",
  "outageHistory",
];

export const MONITORING_REQUIRED_CORE = ["datasetAges", "alerts", "outageHistory"];

/**
 * Compose monitoring: start from previous document (keeps chmiCapV2 + unknown keys),
 * overlay only info-events-owned keys from the new base.
 */
export function composeMonitoringWithForeignNamespaces(prevMonitoring, nextOwned) {
  const prev = prevMonitoring && typeof prevMonitoring === "object" ? prevMonitoring : {};
  const owned = nextOwned && typeof nextOwned === "object" ? nextOwned : {};
  const out = Object.assign({}, prev);

  for (const key of INFO_EVENTS_MONITORING_OWNED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(owned, key)) {
      out[key] = owned[key];
    }
  }

  // Hard preserve CAP v2 ops block when it existed.
  if (Object.prototype.hasOwnProperty.call(prev, "chmiCapV2")) {
    out.chmiCapV2 = prev.chmiCapV2;
  }
  // Hard preserve NDIC DATEX v1 ops block when it existed.
  if (Object.prototype.hasOwnProperty.call(prev, "ndicDatexV1")) {
    out.ndicDatexV1 = prev.ndicDatexV1;
  }

  // Preserve any other foreign/unknown keys already on out via Object.assign({}, prev).
  return out;
}

export function assertMonitoringForeignNamespacesPreserved(prevMonitoring, nextMonitoring) {
  const prev = prevMonitoring && typeof prevMonitoring === "object" ? prevMonitoring : null;
  const next = nextMonitoring && typeof nextMonitoring === "object" ? nextMonitoring : null;
  if (!next) throw new Error("MONITORING_COMPOSE_ABORT: next monitoring missing");
  for (const k of MONITORING_REQUIRED_CORE) {
    if (k === "datasetAges") {
      if (!next.datasetAges || typeof next.datasetAges.feedAgeHours !== "number") {
        throw new Error("MONITORING_COMPOSE_ABORT: missing datasetAges.feedAgeHours");
      }
    } else if (!Array.isArray(next[k])) {
      throw new Error("MONITORING_COMPOSE_ABORT: missing array " + k);
    }
  }
  if (!prev) return;
  if (Object.prototype.hasOwnProperty.call(prev, "chmiCapV2") && !Object.prototype.hasOwnProperty.call(next, "chmiCapV2")) {
    throw new Error("MONITORING_COMPOSE_ABORT: chmiCapV2 removed");
  }
  if (Object.prototype.hasOwnProperty.call(prev, "ndicDatexV1") && !Object.prototype.hasOwnProperty.call(next, "ndicDatexV1")) {
    throw new Error("MONITORING_COMPOSE_ABORT: ndicDatexV1 removed");
  }
  for (const key of Object.keys(prev)) {
    if (INFO_EVENTS_MONITORING_OWNED_KEYS.includes(key)) continue;
    if (!Object.prototype.hasOwnProperty.call(next, key)) {
      throw new Error("MONITORING_COMPOSE_ABORT: foreign key removed: " + key);
    }
  }
}

export function assertChmiCapV2FeedPreserved(prevItems, nextItems) {
  const prevChmi = (prevItems || []).filter(isOwnedByChmiCapV2);
  if (!prevChmi.length) return;
  const nextById = new Map((nextItems || []).filter(isOwnedByChmiCapV2).map((i) => [String(i.id), i]));
  for (const prev of prevChmi) {
    const id = String(prev.id || "");
    const next = nextById.get(id);
    if (!next) throw new Error("FEED_COMPOSE_ABORT: missing preserved CHMI CAP v2 id " + id);
    if (String(next.publicUrl || "") !== String(prev.publicUrl || "")) {
      throw new Error("FEED_COMPOSE_ABORT: publicUrl changed for " + id);
    }
    if (!!next.capV2 !== !!prev.capV2) {
      throw new Error("FEED_COMPOSE_ABORT: capV2 flag lost for " + id);
    }
  }
  // Legacy CHMI must not remain when CAP v2 set is present.
  const legacy = (nextItems || []).filter(
    (i) => String(i.sourceId || "") === "chmi" && !isOwnedByChmiCapV2(i)
  );
  if (legacy.length) {
    throw new Error("FEED_COMPOSE_ABORT: legacy CHMI items present alongside CAP v2 (" + legacy.length + ")");
  }
}
