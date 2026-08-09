/**
 * Allowlisted public history items from normalized diffs only.
 */
import { FEED_CHANGE_TYPE, CONFIDENCE_CLASS, publicProvenance } from "./traffic-publication-constants.mjs";
import { EVENT_CHANGE_KIND } from "./traffic-event-aggregation-constants.mjs";

const KIND_MAP = Object.freeze({
  [EVENT_CHANGE_KIND.NEW_EVENT]: FEED_CHANGE_TYPE.EVENT_CREATED,
  [EVENT_CHANGE_KIND.START_TIME_CHANGED]: FEED_CHANGE_TYPE.VALIDITY_START_CHANGED,
  [EVENT_CHANGE_KIND.END_TIME_CHANGED]: FEED_CHANGE_TYPE.VALIDITY_EXTENDED,
  [EVENT_CHANGE_KIND.DIRECTION_CHANGED]: FEED_CHANGE_TYPE.DIRECTION_CHANGED,
  [EVENT_CHANGE_KIND.ROAD_CHANGED]: FEED_CHANGE_TYPE.ROAD_CHANGED,
  [EVENT_CHANGE_KIND.SEGMENT_CHANGED]: FEED_CHANGE_TYPE.SECTION_CHANGED,
  [EVENT_CHANGE_KIND.SEVERITY_CHANGED]: FEED_CHANGE_TYPE.SEVERITY_CHANGED,
  [EVENT_CHANGE_KIND.DESCRIPTION_CHANGED]: FEED_CHANGE_TYPE.IMPACT_CHANGED,
  [EVENT_CHANGE_KIND.STATUS_ENDED]: FEED_CHANGE_TYPE.EVENT_ENDED,
  [EVENT_CHANGE_KIND.STATUS_CANCELLED]: FEED_CHANGE_TYPE.EVENT_CANCELLED,
  [EVENT_CHANGE_KIND.EVENT_UPDATED]: FEED_CHANGE_TYPE.EVENT_UPDATED,
});

/**
 * @param {string} publicEventId
 * @param {object} diff — from diffNormalizedEvents / batch
 */
export function buildHistoryProjection(publicEventId, diff, opts = {}) {
  if (!publicEventId || !diff) return { ok: false, items: [] };
  const items = [];
  const kinds = diff.changeKinds || [];
  const seen = new Set();
  for (const k of kinds) {
    const mapped = KIND_MAP[k];
    if (!mapped || seen.has(mapped)) continue;
    if (opts.validityDelta === "shortened" && mapped === FEED_CHANGE_TYPE.VALIDITY_EXTENDED) {
      items.push({
        schema: "iu-traffic-history-item-v1",
        publicEventId,
        changeType: FEED_CHANGE_TYPE.VALIDITY_SHORTENED,
        at: diff.lastMeaningfulChangeAt || null,
        provenance: publicProvenance(FEED_CHANGE_TYPE.VALIDITY_SHORTENED, "diff", null, diff.lastMeaningfulChangeAt, "validated", CONFIDENCE_CLASS.VERIFIED_DERIVED_DIFF),
      });
      seen.add(FEED_CHANGE_TYPE.VALIDITY_SHORTENED);
      continue;
    }
    seen.add(mapped);
    items.push({
      schema: "iu-traffic-history-item-v1",
      publicEventId,
      changeType: mapped,
      at: diff.lastMeaningfulChangeAt || null,
      provenance: publicProvenance(mapped, "diff", null, diff.lastMeaningfulChangeAt, "validated", CONFIDENCE_CLASS.VERIFIED_DERIVED_DIFF),
    });
  }
  return { ok: true, items: Object.freeze(items) };
}
