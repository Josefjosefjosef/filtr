/**
 * Internal traffic feed model — NOT published.
 * Sorted by last meaningful change time (not download time).
 */
import { FEED_SIGNAL, EVENT_CHANGE_KIND, AGGREGATION_FEATURE_FLAGS } from "./traffic-event-aggregation-constants.mjs";

function categoryToSignal(category, changeKinds) {
  const cat = String(category || "").toLowerCase();
  const kinds = new Set(changeKinds || []);
  if (kinds.has(EVENT_CHANGE_KIND.STATUS_ENDED) || kinds.has(EVENT_CHANGE_KIND.STATUS_CANCELLED)) {
    if (/uzavir|uzávěr|closure|omezen/.test(cat)) return FEED_SIGNAL.RESTRICTION_ENDED;
    return FEED_SIGNAL.GENERIC_ENDED;
  }
  if (kinds.has(EVENT_CHANGE_KIND.NEW_EVENT)) {
    if (/nehod|accident|crash/.test(cat)) return FEED_SIGNAL.NEW_ACCIDENT;
    if (/prace|roadwork|works/.test(cat)) return FEED_SIGNAL.NEW_ROADWORKS;
    if (/pocasi|weather/.test(cat)) return FEED_SIGNAL.WEATHER_CHANGE;
    return FEED_SIGNAL.GENERIC_NEW;
  }
  if (kinds.has(EVENT_CHANGE_KIND.END_TIME_CHANGED) && /uzavir|closure|omezen/.test(cat)) {
    return FEED_SIGNAL.CLOSURE_EXTENDED;
  }
  if (/pocasi|weather/.test(cat)) return FEED_SIGNAL.WEATHER_CHANGE;
  if (kinds.has(EVENT_CHANGE_KIND.EVENT_UPDATED)) return FEED_SIGNAL.GENERIC_UPDATE;
  return FEED_SIGNAL.UNSIGNALED;
}

/**
 * Build internal feed entries from normalized events + optional diffs.
 * publicationEnabled always false here.
 */
export function buildTrafficFeedModel(events, diffsByHash = {}, opts = {}) {
  const list = Array.isArray(events) ? events : [];
  const entries = [];

  for (const ev of list) {
    if (!ev || ev.quarantine) continue;
    // Feed prep requires at least identity; location optional but marked
    const diff = diffsByHash[ev.eventIdHash] || { changeKinds: [EVENT_CHANGE_KIND.NO_CHANGE], meaningful: false };
    const category = ev.fields && ev.fields.trafficCategory && ev.fields.trafficCategory.value;
    const signal = categoryToSignal(category, diff.changeKinds);
    const lastChange =
      (diff.lastMeaningfulChangeAt) ||
      (ev.fields && ev.fields.lastMeaningfulChangeAt && ev.fields.lastMeaningfulChangeAt.value) ||
      null;
    // Never sort by download time — use last meaningful change
    const sortKey = lastChange || (ev.fields && ev.fields.validFrom && ev.fields.validFrom.value) || ev.aggregatedAt || "";

    entries.push({
      eventIdHash: ev.eventIdHash,
      feedSignal: signal,
      sortKey,
      lastMeaningfulChangeAt: lastChange,
      locationPublishable: ev.locationPublishable === true,
      titleSafe: ev.fields && ev.fields.titleSafe ? ev.fields.titleSafe.value : null,
      status: ev.fields && ev.fields.status ? ev.fields.status.value : null,
      roadNumber: ev.locationPublishable && ev.fields.roadNumber ? ev.fields.roadNumber.value : null,
      direction: ev.locationPublishable && ev.fields.direction ? ev.fields.direction.value : null,
      changeKinds: diff.changeKinds || [],
      published: false,
      publicationEnabled: AGGREGATION_FEATURE_FLAGS.PUBLICATION_ENABLED,
    });
  }

  entries.sort((a, b) => {
    const ta = Date.parse(a.sortKey) || 0;
    const tb = Date.parse(b.sortKey) || 0;
    if (tb !== ta) return tb - ta; // newest meaningful change first
    return String(a.eventIdHash).localeCompare(String(b.eventIdHash));
  });

  return {
    schema: "iu-traffic-feed-model-v1",
    publicationEnabled: false,
    trafficCardsEnabled: false,
    entryCount: entries.length,
    entries: Object.freeze(entries),
    builtAt: opts.nowIso || new Date().toISOString(),
  };
}
