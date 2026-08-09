/**
 * Publication-layer traffic feed — headlines, change types, sorting.
 * Sorted by lastMeaningfulChangeAt; download fallback explicitly marked.
 */
import { PUBLICATION_LAYER_FLAGS, FEED_CHANGE_TYPE } from "./traffic-publication-constants.mjs";

const SEVERITY_RANK = Object.freeze({ high: 3, medium: 2, low: 1, null: 0 });

function severityRank(s) {
  if (s == null) return 0;
  return SEVERITY_RANK[String(s).toLowerCase()] || 0;
}

/**
 * @param {object[]} projections — successful publication projections
 */
export function buildPublicationTrafficFeed(projections, opts = {}) {
  const list = Array.isArray(projections) ? projections : [];
  const items = [];

  for (const p of list) {
    if (!p || p.publicationEnabled === true) continue;
    if (!p.publicEventId || !p.feedHeadline) continue;
    const sortKey = p.lastMeaningfulChangeAt || null;
    const changeTimeSource = p.changeTimeSource || "UNKNOWN";
    items.push({
      schema: "iu-traffic-feed-item-v1",
      publicEventId: p.publicEventId,
      feedHeadline: p.feedHeadline,
      feedChangeType: p.feedChangeType || FEED_CHANGE_TYPE.EVENT_UPDATED,
      lifecycleStatus: p.lifecycleStatus,
      changeStatus: p.changeStatus,
      severity: p.severity,
      roadNumber: p.roadNumber,
      direction: p.direction,
      locationLabel: p.locationLabel,
      lastMeaningfulChangeAt: sortKey,
      changeTimeSource,
      freshnessStatus: p.freshnessStatus,
      sortKey: sortKey || p.downloadedAt || "",
      publicationEnabled: false,
      published: false,
    });
  }

  items.sort((a, b) => {
    const ta = Date.parse(a.sortKey) || 0;
    const tb = Date.parse(b.sortKey) || 0;
    if (tb !== ta) return tb - ta;
    const sa = severityRank(a.severity);
    const sb = severityRank(b.severity);
    if (sb !== sa) return sb - sa;
    return String(a.publicEventId).localeCompare(String(b.publicEventId));
  });

  return {
    schema: "iu-traffic-publication-feed-v1",
    publicationEnabled: PUBLICATION_LAYER_FLAGS.PUBLICATION_ENABLED,
    trafficUiEnabled: PUBLICATION_LAYER_FLAGS.TRAFFIC_UI_ENABLED,
    itemCount: items.length,
    items: Object.freeze(items),
    builtAt: opts.nowIso || new Date().toISOString(),
  };
}
